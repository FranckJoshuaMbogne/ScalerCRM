-- =====================================================================
-- SCALER foundation: tenants, branches, people, roles, permissions, audit
-- Sprint 0. Every tenant-owned table carries business_id and RLS.
-- =====================================================================

create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Shared utilities
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.business_status as enum ('active', 'suspended', 'closed');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'removed');

-- ---------------------------------------------------------------------
-- Businesses (tenants)
-- ---------------------------------------------------------------------
create table public.businesses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 2 and 120),
  slug          extensions.citext not null unique
                  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 48),
  legal_name    text,
  country_code  char(2) not null default 'IN',
  currency      char(3) not null default 'INR',
  timezone      text not null default 'Asia/Kolkata',
  industry      text,
  status        public.business_status not null default 'active',
  plan_key      text not null default 'starter',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger businesses_updated_at before update on public.businesses
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Branches
-- ---------------------------------------------------------------------
create table public.branches (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null check (length(trim(name)) between 2 and 120),
  code          text,
  phone         text,
  address_line  text,
  city          text,
  state         text,
  postal_code   text,
  country_code  char(2),
  timezone      text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, name),
  unique (business_id, id)
);

create index branches_business_idx on public.branches (business_id);

create trigger branches_updated_at before update on public.branches
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Profiles (one per auth user, platform-wide)
-- ---------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text,
  email              text,
  phone              text,
  avatar_url         text,
  is_platform_admin  boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Permissions and roles
-- ---------------------------------------------------------------------
create table public.permissions (
  key          text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  module       text not null,
  description  text not null
);

-- business_id null = built-in system role shared by every tenant (read-only).
create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id) on delete cascade,
  key          text not null check (key ~ '^[a-z_]+$'),
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (is_system = (business_id is null))
);

create unique index roles_key_unique on public.roles (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create trigger roles_updated_at before update on public.roles
  for each row execute function private.set_updated_at();

create table public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_key  text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

-- ---------------------------------------------------------------------
-- Memberships: which user belongs to which business, with which role
-- ---------------------------------------------------------------------
create table public.business_memberships (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  role_id            uuid not null references public.roles(id),
  default_branch_id  uuid,
  all_branches       boolean not null default true,
  status             public.membership_status not null default 'active',
  invited_by         uuid references public.profiles(id),
  joined_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (business_id, user_id),
  foreign key (business_id, default_branch_id) references public.branches (business_id, id)
);

create index memberships_user_idx on public.business_memberships (user_id) where status = 'active';

create trigger memberships_updated_at before update on public.business_memberships
  for each row execute function private.set_updated_at();

-- A membership's role must be a system role or a role of the same business.
create or replace function private.check_membership_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_business uuid;
begin
  select business_id into role_business from public.roles where id = new.role_id;
  if role_business is not null and role_business <> new.business_id then
    raise exception 'role % does not belong to business %', new.role_id, new.business_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger memberships_role_check before insert or update of role_id, business_id
  on public.business_memberships
  for each row execute function private.check_membership_role();

-- Record-level restriction: when all_branches = false, only these branches.
create table public.user_branch_access (
  membership_id  uuid not null references public.business_memberships(id) on delete cascade,
  branch_id      uuid not null references public.branches(id) on delete cascade,
  primary key (membership_id, branch_id)
);

-- ---------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  business_id  uuid,          -- no FK: the trail must outlive deleted records
  actor_id     uuid,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  changes      jsonb,
  created_at   timestamptz not null default now()
);

create index audit_logs_business_time_idx on public.audit_logs (business_id, created_at desc);

create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
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

create trigger audit_businesses after insert or update or delete on public.businesses
  for each row execute function private.audit_row();
create trigger audit_branches after insert or update or delete on public.branches
  for each row execute function private.audit_row();
create trigger audit_memberships after insert or update or delete on public.business_memberships
  for each row execute function private.audit_row();
create trigger audit_roles after insert or update or delete on public.roles
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- Tenant helper functions (used by every RLS policy from here on)
-- security definer so policies don't recurse into membership RLS.
-- ---------------------------------------------------------------------
create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select is_platform_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function private.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.business_memberships m
      join public.businesses b on b.id = m.business_id
     where m.business_id = p_business_id
       and m.user_id = auth.uid()
       and m.status = 'active'
       and b.status = 'active'
  );
$$;

create or replace function private.has_permission(p_business_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.business_memberships m
      join public.businesses b on b.id = m.business_id
      join public.role_permissions rp on rp.role_id = m.role_id
     where m.business_id = p_business_id
       and m.user_id = auth.uid()
       and m.status = 'active'
       and b.status = 'active'
       and rp.permission_key = p_permission
  );
$$;

create or replace function private.shares_business(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.business_memberships mine
      join public.business_memberships theirs on theirs.business_id = mine.business_id
     where mine.user_id = auth.uid()
       and mine.status = 'active'
       and theirs.user_id = p_user_id
  );
$$;

-- Branches the current user may see in a business (all, or the restricted set).
create or replace function private.accessible_branch_ids(p_business_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
    from public.branches b
    join public.business_memberships m
      on m.business_id = b.business_id and m.user_id = auth.uid() and m.status = 'active'
   where b.business_id = p_business_id
     and (
       m.all_branches
       or exists (
         select 1 from public.user_branch_access uba
          where uba.membership_id = m.id and uba.branch_id = b.id
       )
     );
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Onboarding RPC: the only way a tenant is created from the app.
-- Creates the business, its first branch and an admin membership atomically.
-- ---------------------------------------------------------------------
create or replace function public.create_business(
  p_name text,
  p_slug text,
  p_branch_name text,
  p_country_code char(2) default 'IN',
  p_currency char(3) default 'INR',
  p_timezone text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_business uuid;
  v_branch uuid;
  v_admin_role uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.businesses (name, slug, country_code, currency, timezone, created_by)
  values (p_name, p_slug, p_country_code, p_currency, p_timezone, v_user)
  returning id into v_business;

  insert into public.branches (business_id, name, country_code, timezone)
  values (v_business, p_branch_name, p_country_code, p_timezone)
  returning id into v_branch;

  select id into v_admin_role from public.roles
   where business_id is null and key = 'business_admin';

  insert into public.business_memberships
    (business_id, user_id, role_id, default_branch_id, status, joined_at)
  values (v_business, v_user, v_admin_role, v_branch, 'active', now());

  return v_business;
end;
$$;

revoke execute on function public.create_business(text, text, text, char, char, text) from public, anon;
grant execute on function public.create_business(text, text, text, char, char, text) to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.businesses           enable row level security;
alter table public.branches             enable row level security;
alter table public.profiles             enable row level security;
alter table public.permissions          enable row level security;
alter table public.roles                enable row level security;
alter table public.role_permissions     enable row level security;
alter table public.business_memberships enable row level security;
alter table public.user_branch_access   enable row level security;
alter table public.audit_logs           enable row level security;

-- businesses: insert only via create_business(); no deletes from the app.
create policy businesses_select on public.businesses for select to authenticated
  using (private.is_member(id) or private.is_platform_admin());
create policy businesses_update on public.businesses for update to authenticated
  using (private.has_permission(id, 'settings.business.manage'))
  with check (private.has_permission(id, 'settings.business.manage'));

-- Tenants cannot change their own status or plan; that's platform admin territory.
revoke update on public.businesses from authenticated;
grant update (name, legal_name, country_code, currency, timezone, industry)
  on public.businesses to authenticated;

-- branches
create policy branches_select on public.branches for select to authenticated
  using (private.is_member(business_id));
create policy branches_insert on public.branches for insert to authenticated
  with check (private.has_permission(business_id, 'settings.branches.manage'));
create policy branches_update on public.branches for update to authenticated
  using (private.has_permission(business_id, 'settings.branches.manage'))
  with check (private.has_permission(business_id, 'settings.branches.manage'));
create policy branches_delete on public.branches for delete to authenticated
  using (private.has_permission(business_id, 'settings.branches.manage'));

-- profiles: see yourself and colleagues; edit only your own basic fields.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.shares_business(id) or private.is_platform_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

-- permissions: readable catalogue.
create policy permissions_select on public.permissions for select to authenticated using (true);
revoke insert, update, delete on public.permissions from authenticated;

-- roles: system roles visible to all; custom roles to members; manage with permission.
create policy roles_select on public.roles for select to authenticated
  using (business_id is null or private.is_member(business_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (business_id is not null and not is_system
              and private.has_permission(business_id, 'team.roles.manage'));
create policy roles_update on public.roles for update to authenticated
  using (not is_system and private.has_permission(business_id, 'team.roles.manage'))
  with check (not is_system and private.has_permission(business_id, 'team.roles.manage'));
create policy roles_delete on public.roles for delete to authenticated
  using (not is_system and private.has_permission(business_id, 'team.roles.manage'));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id
                 and (r.business_id is null or private.is_member(r.business_id))));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and not r.is_system
                 and private.has_permission(r.business_id, 'team.roles.manage')))
  with check (exists (select 1 from public.roles r where r.id = role_id and not r.is_system
                      and private.has_permission(r.business_id, 'team.roles.manage')));

-- memberships
create policy memberships_select on public.business_memberships for select to authenticated
  using (user_id = auth.uid() or private.is_member(business_id));
create policy memberships_insert on public.business_memberships for insert to authenticated
  with check (private.has_permission(business_id, 'team.members.manage'));
create policy memberships_update on public.business_memberships for update to authenticated
  using (private.has_permission(business_id, 'team.members.manage') and user_id <> auth.uid())
  with check (private.has_permission(business_id, 'team.members.manage') and user_id <> auth.uid());
create policy memberships_delete on public.business_memberships for delete to authenticated
  using (private.has_permission(business_id, 'team.members.manage') and user_id <> auth.uid());

-- user_branch_access
create policy uba_select on public.user_branch_access for select to authenticated
  using (exists (select 1 from public.business_memberships m
                 where m.id = membership_id and private.is_member(m.business_id)));
create policy uba_write on public.user_branch_access for all to authenticated
  using (exists (select 1 from public.business_memberships m
                 where m.id = membership_id and private.has_permission(m.business_id, 'team.members.manage')))
  with check (exists (select 1 from public.business_memberships m
                      join public.branches b on b.id = branch_id and b.business_id = m.business_id
                      where m.id = membership_id and private.has_permission(m.business_id, 'team.members.manage')));

-- audit_logs: read-only, written by triggers.
create policy audit_select on public.audit_logs for select to authenticated
  using (private.has_permission(business_id, 'audit.view') or private.is_platform_admin());
revoke insert, update, delete on public.audit_logs from authenticated, anon;

-- ---------------------------------------------------------------------
-- Reference data: permission catalogue and system roles
-- Keep in sync with src/modules/permissions/catalog.ts (enforced by test).
-- ---------------------------------------------------------------------
insert into public.permissions (key, module, description) values
-- BEGIN permissions
  ('dashboard.view', 'dashboard', 'View the business dashboard'),
  ('leads.view_all', 'leads', 'View every lead in accessible branches'),
  ('leads.view_assigned', 'leads', 'View leads assigned to me'),
  ('leads.create', 'leads', 'Create leads'),
  ('leads.edit', 'leads', 'Edit leads and move them through the pipeline'),
  ('leads.assign', 'leads', 'Assign or reassign leads to a PIC'),
  ('leads.delete', 'leads', 'Archive leads'),
  ('leads.export', 'leads', 'Export lead lists'),
  ('customers.view_all', 'customers', 'View every customer file'),
  ('customers.view_assigned', 'customers', 'View customers assigned to me'),
  ('customers.create', 'customers', 'Create customer files'),
  ('customers.edit', 'customers', 'Edit customer files'),
  ('customers.merge', 'customers', 'Merge duplicate customer files'),
  ('customers.export', 'customers', 'Export customer data'),
  ('inbox.view_all', 'inbox', 'View all WhatsApp conversations'),
  ('inbox.view_assigned', 'inbox', 'View conversations assigned to me'),
  ('inbox.reply', 'inbox', 'Reply to conversations'),
  ('campaigns.view', 'campaigns', 'View campaigns and their results'),
  ('campaigns.manage', 'campaigns', 'Create and edit campaigns'),
  ('campaigns.send', 'campaigns', 'Launch, schedule and pause campaigns'),
  ('templates.manage', 'campaigns', 'Create and submit WhatsApp templates'),
  ('appointments.view', 'appointments', 'View appointments and walk-ins'),
  ('appointments.manage', 'appointments', 'Book, edit and register walk-ins'),
  ('orders.view_all', 'orders', 'View every order'),
  ('orders.view_assigned', 'orders', 'View orders assigned to me'),
  ('orders.create', 'orders', 'Create quotations and orders'),
  ('orders.edit', 'orders', 'Edit orders'),
  ('orders.fulfil', 'orders', 'Update production and fulfilment status'),
  ('payments.view', 'payments', 'View payments and balances'),
  ('payments.record', 'payments', 'Record payments'),
  ('payments.refund', 'payments', 'Record refunds'),
  ('tasks.view_all', 'tasks', 'View everyone''s tasks'),
  ('tasks.manage', 'tasks', 'Create and complete tasks'),
  ('analytics.view', 'analytics', 'View analytics'),
  ('analytics.marketing', 'analytics', 'View marketing analytics'),
  ('analytics.sales', 'analytics', 'View sales and PIC analytics'),
  ('analytics.financial', 'analytics', 'View revenue and outstanding payments'),
  ('reports.export', 'reports', 'Export CSV and PDF reports'),
  ('team.members.manage', 'team', 'Invite, remove and change employees'),
  ('team.roles.manage', 'team', 'Create and edit custom roles'),
  ('settings.business.manage', 'settings', 'Edit business profile'),
  ('settings.branches.manage', 'settings', 'Add and edit branches'),
  ('settings.pipeline.manage', 'settings', 'Configure pipeline stages'),
  ('settings.custom_fields.manage', 'settings', 'Configure custom fields'),
  ('integrations.manage', 'integrations', 'Connect and configure integrations'),
  ('automation.manage', 'automation', 'Configure automation workflows'),
  ('audit.view', 'settings', 'View the audit log')
-- END permissions
;

insert into public.roles (business_id, key, name, description, is_system) values
-- BEGIN system_roles
  (null, 'business_admin', 'Business admin', 'Full control of the business', true),
  (null, 'marketing_manager', 'Marketing manager', 'Campaigns, integrations and marketing reports', true),
  (null, 'sales_manager', 'Sales manager', 'All leads, PICs and sales reports', true),
  (null, 'sales_executive', 'Sales executive', 'Assigned leads and customers', true),
  (null, 'store_manager', 'Store manager', 'Walk-ins, appointments and store orders', true),
  (null, 'production_manager', 'Production manager', 'Production and order fulfilment', true),
  (null, 'accounts', 'Accounts', 'Payments, invoices and financial reports', true)
-- END system_roles
;

-- Role grants
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
  from public.roles r
  cross join public.permissions p
 where r.business_id is null
   and (
     r.key = 'business_admin'
     or (r.key = 'marketing_manager' and p.key in (
       'dashboard.view', 'leads.view_all', 'leads.export', 'customers.view_all',
       'campaigns.view', 'campaigns.manage', 'campaigns.send', 'templates.manage',
       'inbox.view_all', 'analytics.view', 'analytics.marketing', 'reports.export',
       'integrations.manage', 'automation.manage'))
     or (r.key = 'sales_manager' and p.key in (
       'dashboard.view', 'leads.view_all', 'leads.create', 'leads.edit', 'leads.assign',
       'leads.delete', 'leads.export', 'customers.view_all', 'customers.create',
       'customers.edit', 'customers.merge', 'inbox.view_all', 'inbox.reply',
       'campaigns.view', 'appointments.view', 'appointments.manage', 'orders.view_all',
       'orders.create', 'orders.edit', 'payments.view', 'tasks.view_all', 'tasks.manage',
       'analytics.view', 'analytics.sales', 'reports.export', 'settings.pipeline.manage'))
     or (r.key = 'sales_executive' and p.key in (
       'dashboard.view', 'leads.view_assigned', 'leads.create', 'leads.edit',
       'customers.view_assigned', 'customers.create', 'customers.edit',
       'inbox.view_assigned', 'inbox.reply', 'appointments.view', 'appointments.manage',
       'orders.view_assigned', 'orders.create', 'payments.view', 'tasks.manage'))
     or (r.key = 'store_manager' and p.key in (
       'dashboard.view', 'leads.view_all', 'leads.create', 'leads.edit', 'leads.assign',
       'customers.view_all', 'customers.create', 'customers.edit', 'inbox.view_all',
       'inbox.reply', 'appointments.view', 'appointments.manage', 'orders.view_all',
       'orders.create', 'orders.edit', 'payments.view', 'payments.record',
       'tasks.view_all', 'tasks.manage', 'analytics.view', 'analytics.sales'))
     or (r.key = 'production_manager' and p.key in (
       'dashboard.view', 'customers.view_all', 'orders.view_all', 'orders.fulfil',
       'appointments.view', 'tasks.manage'))
     or (r.key = 'accounts' and p.key in (
       'dashboard.view', 'customers.view_all', 'orders.view_all', 'payments.view',
       'payments.record', 'payments.refund', 'analytics.view', 'analytics.financial',
       'reports.export'))
   );
