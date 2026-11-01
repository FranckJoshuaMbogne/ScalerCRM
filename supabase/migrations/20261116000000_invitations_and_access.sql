-- =====================================================================
-- Sprint 1: invitations, permission lookup, membership guards
-- =====================================================================

-- ---------------------------------------------------------------------
-- Invitations. The raw token is returned once to the inviter and only
-- its SHA-256 hash is stored, so a database read never reveals a link.
-- ---------------------------------------------------------------------
create table public.invitations (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  email              extensions.citext not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role_id            uuid not null references public.roles(id),
  default_branch_id  uuid,
  all_branches       boolean not null default true,
  branch_ids         uuid[] not null default '{}',
  token_hash         text not null unique,
  invited_by         uuid references public.profiles(id),
  expires_at         timestamptz not null default now() + interval '7 days',
  accepted_at        timestamptz,
  accepted_by        uuid references public.profiles(id),
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  foreign key (business_id, default_branch_id) references public.branches (business_id, id)
);

create index invitations_business_idx on public.invitations (business_id, created_at desc);
create unique index invitations_one_pending_per_email
  on public.invitations (business_id, email)
  where accepted_at is null and revoked_at is null;

create or replace function private.hash_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Creates an invitation and returns the one-time token.
create or replace function public.create_invitation(
  p_business_id uuid,
  p_email text,
  p_role_id uuid,
  p_default_branch_id uuid default null,
  p_all_branches boolean default true,
  p_branch_ids uuid[] default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_role_business uuid;
begin
  if not private.has_permission(p_business_id, 'team.members.manage') then
    raise exception 'not allowed to invite members' using errcode = '42501';
  end if;

  select business_id into v_role_business from public.roles where id = p_role_id;
  if not found or (v_role_business is not null and v_role_business <> p_business_id) then
    raise exception 'unknown role' using errcode = '23514';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_branch_ids, '{}')) b(id)
     where not exists (select 1 from public.branches br where br.id = b.id and br.business_id = p_business_id)
  ) then
    raise exception 'branch does not belong to this business' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.business_memberships m
      join public.profiles p on p.id = m.user_id
     where m.business_id = p_business_id and lower(p.email) = lower(p_email) and m.status = 'active'
  ) then
    raise exception 'this person is already a member' using errcode = '23505';
  end if;

  -- Re-inviting the same email replaces the previous pending invitation.
  update public.invitations
     set revoked_at = now()
   where business_id = p_business_id and email = p_email
     and accepted_at is null and revoked_at is null;

  insert into public.invitations
    (business_id, email, role_id, default_branch_id, all_branches, branch_ids, token_hash, invited_by)
  values
    (p_business_id, p_email, p_role_id, p_default_branch_id, p_all_branches,
     case when p_all_branches then '{}' else coalesce(p_branch_ids, '{}') end,
     private.hash_token(v_token), auth.uid());

  return v_token;
end;
$$;

-- What the invite page shows before the person signs in.
create or replace function public.get_invitation(p_token text)
returns table (business_name text, role_name text, email text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.name,
         r.name,
         i.email::text,
         case
           when i.accepted_at is not null then 'accepted'
           when i.revoked_at is not null then 'revoked'
           when i.expires_at < now() then 'expired'
           else 'pending'
         end
    from public.invitations i
    join public.businesses b on b.id = i.business_id
    join public.roles r on r.id = i.role_id
   where i.token_hash = private.hash_token(p_token);
$$;

-- Accepts an invitation for the signed-in user. Email must match.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.invitations;
  v_membership uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_inv from public.invitations
   where token_hash = private.hash_token(p_token)
   for update;

  if not found or v_inv.revoked_at is not null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation already used' using errcode = 'P0001';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'invitation expired' using errcode = 'P0001';
  end if;

  select email into v_email from auth.users where id = v_user;
  if v_email is null or lower(v_email) <> lower(v_inv.email::text) then
    raise exception 'invitation was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.business_memberships
    (business_id, user_id, role_id, default_branch_id, all_branches, status, invited_by, joined_at)
  values
    (v_inv.business_id, v_user, v_inv.role_id, v_inv.default_branch_id, v_inv.all_branches,
     'active', v_inv.invited_by, now())
  on conflict (business_id, user_id) do update
     set role_id = excluded.role_id,
         default_branch_id = excluded.default_branch_id,
         all_branches = excluded.all_branches,
         status = 'active',
         joined_at = now()
  returning id into v_membership;

  delete from public.user_branch_access where membership_id = v_membership;
  insert into public.user_branch_access (membership_id, branch_id)
  select v_membership, unnest(v_inv.branch_ids);

  update public.invitations
     set accepted_at = now(), accepted_by = v_user
   where id = v_inv.id;

  return v_inv.business_id;
end;
$$;

-- Permission keys the current user holds in a business (for UI gating).
create or replace function public.my_permissions(p_business_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select rp.permission_key
    from public.business_memberships m
    join public.businesses b on b.id = m.business_id
    join public.role_permissions rp on rp.role_id = m.role_id
   where m.business_id = p_business_id
     and m.user_id = auth.uid()
     and m.status = 'active'
     and b.status = 'active';
$$;

revoke execute on function public.create_invitation(uuid, text, uuid, uuid, boolean, uuid[]) from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
revoke execute on function public.my_permissions(uuid) from public, anon;
grant execute on function public.create_invitation(uuid, text, uuid, uuid, boolean, uuid[]) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;
grant execute on function public.get_invitation(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- A business must always keep at least one active business admin.
-- ---------------------------------------------------------------------
create or replace function private.keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := coalesce(old.business_id, new.business_id);
begin
  -- Skip when the whole business is being deleted.
  if not exists (select 1 from public.businesses where id = v_business) then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1 from public.business_memberships m
      join public.roles r on r.id = m.role_id
     where m.business_id = v_business
       and m.status = 'active'
       and r.business_id is null and r.key = 'business_admin'
  ) then
    raise exception 'a business needs at least one active business admin' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create constraint trigger memberships_keep_one_admin
  after update or delete on public.business_memberships
  deferrable initially immediate
  for each row execute function private.keep_one_admin();

-- ---------------------------------------------------------------------
-- RLS for invitations
-- ---------------------------------------------------------------------
alter table public.invitations enable row level security;

create policy invitations_select on public.invitations for select to authenticated
  using (private.has_permission(business_id, 'team.members.manage'));
create policy invitations_revoke on public.invitations for update to authenticated
  using (private.has_permission(business_id, 'team.members.manage'))
  with check (private.has_permission(business_id, 'team.members.manage'));

-- Inserts only through create_invitation(); only revoked_at is editable.
revoke insert, update, delete on public.invitations from authenticated, anon;
grant update (revoked_at) on public.invitations to authenticated;
-- token_hash is never readable from the app.
revoke select on public.invitations from authenticated, anon;
grant select (id, business_id, email, role_id, default_branch_id, all_branches, branch_ids,
              invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at)
  on public.invitations to authenticated;

create trigger audit_invitations after insert or update on public.invitations
  for each row execute function private.audit_row();

-- Audit diffs must never carry the token hash.
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token_hash' end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token_hash' end;
  row_data jsonb := coalesce(new_row, old_row);
  biz uuid;
  diff jsonb;
begin
  biz := case
    when tg_table_name = 'businesses' then (row_data ->> 'id')::uuid
    else (row_data ->> 'business_id')::uuid
  end;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('from', old_row -> n.key, 'to', n.value))
      into diff
      from jsonb_each(new_row) n
     where n.value is distinct from old_row -> n.key
       and n.key <> 'updated_at';
    if diff is null then
      return new;
    end if;
  else
    diff := row_data;
  end if;

  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (biz, auth.uid(), lower(tg_op), tg_table_name, row_data ->> 'id', diff);

  return coalesce(new, old);
end;
$$;
