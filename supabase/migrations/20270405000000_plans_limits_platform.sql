-- Sprint 10 — plans, limits, usage, suspension, support access and the platform console.

-- =====================================================================
-- Plans
-- =====================================================================
-- Global catalogue (not tenant data). A null limit means unlimited.
-- Prices are set by Springs 360 (null = not on sale yet).
create table public.plans (
  key                   text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name                  text not null check (length(trim(name)) between 1 and 60),
  description           text check (length(description) <= 300),
  position              int not null default 0,
  is_public             boolean not null default true,
  max_users             int check (max_users > 0),
  max_branches          int check (max_branches > 0),
  max_whatsapp_numbers  int check (max_whatsapp_numbers >= 0),
  monthly_messages      int check (monthly_messages >= 0),
  max_automations       int check (max_automations >= 0),
  daily_api_calls       int check (daily_api_calls >= 0),
  price_monthly         numeric(14,2) check (price_monthly >= 0),
  price_yearly          numeric(14,2) check (price_yearly >= 0),
  currency              char(3) not null default 'INR',
  updated_at            timestamptz not null default now()
);
create trigger plans_updated_at before update on public.plans
  for each row execute function private.set_updated_at();

insert into public.plans (key, name, description, position, is_public, max_users, max_branches, max_whatsapp_numbers,
                          monthly_messages, max_automations, daily_api_calls) values
  ('starter',    'Starter',    'One shop getting organised',            1, true,    5,    1,    1,   1000,    5,   1000),
  ('growth',     'Growth',     'A growing team across a few branches',  2, true,   15,    3,    2,  10000,   15,  10000),
  ('scale',      'Scale',      'Several branches and heavy campaigns',  3, true,   50,   10,    5,  50000,   50,  50000),
  ('enterprise', 'Enterprise', 'Custom limits agreed with Springs 360', 4, false, null, null, null,   null, null,   null);

alter table public.plans enable row level security;
create policy plans_select on public.plans for select to authenticated using (true);
revoke all on public.plans from anon, authenticated;
grant select on public.plans to authenticated;

-- The business's plan, per-business overrides (grandfathered or negotiated limits) and trial end.
alter table public.businesses alter column plan_key set default 'growth';
alter table public.businesses
  add column plan_overrides jsonb not null default '{}' check (jsonb_typeof(plan_overrides) = 'object'),
  add column trial_ends_at timestamptz,
  add column status_reason text check (length(status_reason) <= 300);

-- Append-only record of every plan or status change.
create table public.business_plan_history (
  id              bigint generated always as identity primary key,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  plan_key        text not null references public.plans(key),
  plan_overrides  jsonb not null default '{}',
  trial_ends_at   timestamptz,
  status          public.business_status not null,
  reason          text check (length(reason) <= 300),
  changed_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index business_plan_history_idx on public.business_plan_history (business_id, created_at desc);
alter table public.business_plan_history enable row level security;
create policy business_plan_history_select on public.business_plan_history for select to authenticated
  using (private.has_permission(business_id, 'settings.business.manage') or private.is_platform_admin());
revoke all on public.business_plan_history from anon, authenticated;
grant select on public.business_plan_history to authenticated;

-- =====================================================================
-- Usage
-- =====================================================================
-- Fast-moving counters: template messages per calendar month (UTC), API calls per day.
create table private.usage_counters (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  metric       text not null check (metric in ('messages', 'api_calls')),
  period       date not null,
  count        bigint not null default 0,
  primary key (business_id, metric, period)
);

create or replace function private.bump_usage(p_business_id uuid, p_metric text, p_by int default 1)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.usage_counters (business_id, metric, period, count)
  values (p_business_id, p_metric,
          case when p_metric = 'messages' then date_trunc('month', now() at time zone 'utc')::date
               else (now() at time zone 'utc')::date end,
          p_by)
  on conflict (business_id, metric, period) do update set count = private.usage_counters.count + excluded.count;
$$;

create or replace function private.usage_count(p_business_id uuid, p_metric text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select count from private.usage_counters
                    where business_id = p_business_id and metric = p_metric
                      and period = case when p_metric = 'messages' then date_trunc('month', now() at time zone 'utc')::date
                                        else (now() at time zone 'utc')::date end), 0);
$$;

-- Effective limit: the override if set, else the plan's. Null = unlimited.
create or replace function private.plan_limit(p_business_id uuid, p_key text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(b.plan_overrides ->> p_key, '')::int, (to_jsonb(p) ->> p_key)::int)
    from public.businesses b join public.plans p on p.key = b.plan_key
   where b.id = p_business_id;
$$;

-- Raises when adding p_adding to p_current would go over the limit.
create or replace function private.check_limit(p_business_id uuid, p_key text, p_current bigint, p_adding bigint default 1)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := private.plan_limit(p_business_id, p_key);
begin
  if v_limit is not null and p_current + p_adding > v_limit then
    raise exception 'plan limit reached: % (limit %)', p_key, v_limit
      using errcode = 'P0429', hint = 'Ask Springs 360 to move the business to a bigger plan.';
  end if;
end;
$$;

-- Everything a business uses against its limits.
create or replace function private.usage_of(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'max_users', (select count(*) from public.business_memberships where business_id = p_business_id and status = 'active'),
    'max_branches', (select count(*) from public.branches where business_id = p_business_id and is_active),
    'max_whatsapp_numbers', (select count(*) from public.whatsapp_accounts where business_id = p_business_id and status = 'connected'),
    'monthly_messages', private.usage_count(p_business_id, 'messages'),
    'max_automations', (select count(*) from public.automations where business_id = p_business_id and is_active),
    'daily_api_calls', private.usage_count(p_business_id, 'api_calls'));
$$;

-- =====================================================================
-- Limit enforcement, where rows are created
-- =====================================================================
create or replace function private.limit_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform private.check_limit(new.business_id, 'max_users',
      (select count(*) from public.business_memberships m
        where m.business_id = new.business_id and m.status = 'active' and m.id <> new.id));
  end if;
  return new;
end;
$$;
create trigger business_memberships_limit before insert or update of status on public.business_memberships
  for each row execute function private.limit_members();

-- Invitations count against the limit too, so nobody is invited who can't join.
create or replace function private.limit_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_limit(new.business_id, 'max_users',
    (select count(*) from public.business_memberships m where m.business_id = new.business_id and m.status = 'active')
    + (select count(*) from public.invitations i
        where i.business_id = new.business_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()));
  return new;
end;
$$;
create trigger invitations_limit before insert on public.invitations
  for each row execute function private.limit_invitations();

create or replace function private.limit_branches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    perform private.check_limit(new.business_id, 'max_branches',
      (select count(*) from public.branches b where b.business_id = new.business_id and b.is_active and b.id <> new.id));
  end if;
  return new;
end;
$$;
create trigger branches_limit before insert or update of is_active on public.branches
  for each row execute function private.limit_branches();

create or replace function private.limit_whatsapp_numbers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'connected' and (tg_op = 'INSERT' or old.status is distinct from 'connected') then
    perform private.check_limit(new.business_id, 'max_whatsapp_numbers',
      (select count(*) from public.whatsapp_accounts a
        where a.business_id = new.business_id and a.status = 'connected' and a.id <> new.id));
  end if;
  return new;
end;
$$;
create trigger whatsapp_accounts_limit before insert or update of status on public.whatsapp_accounts
  for each row execute function private.limit_whatsapp_numbers();

create or replace function private.limit_automations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    perform private.check_limit(new.business_id, 'max_automations',
      (select count(*) from public.automations a where a.business_id = new.business_id and a.is_active and a.id <> new.id));
  end if;
  return new;
end;
$$;
create trigger automations_limit before insert or update of is_active on public.automations
  for each row execute function private.limit_automations();

-- Campaigns: a launch must fit in what's left of the month's messages,
-- counting what's already sent and what other campaigns still have queued.
create or replace function private.limit_campaign_recipients()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select business_id, count(*) as n from new_rows group by business_id loop
    perform private.check_limit(r.business_id, 'monthly_messages',
      private.usage_count(r.business_id, 'messages')
      + (select count(*) from public.campaign_recipients cr
          where cr.business_id = r.business_id and cr.status in ('pending', 'sending'))
      - r.n,
      r.n);
  end loop;
  return null;
end;
$$;
create trigger campaign_recipients_limit after insert on public.campaign_recipients
  referencing new table as new_rows
  for each statement execute function private.limit_campaign_recipients();

-- Every business-initiated template message counts towards the month.
create or replace function private.count_template_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bump_usage(new.business_id, 'messages');
  return null;
end;
$$;
create trigger messages_count_templates after insert on public.messages
  for each row when (new.direction = 'outbound' and new.type = 'template')
  execute function private.count_template_message();

-- Automations stop sending templates when the month's messages are used up.
create or replace function public.automation_whatsapp_context(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.automation_runs;
  v_action jsonb;
  v_customer public.customers;
  v_template public.whatsapp_templates;
  v_account public.whatsapp_accounts;
  v_limit int;
begin
  select * into r from public.automation_runs where id = p_run_id;
  v_limit := private.plan_limit(r.business_id, 'monthly_messages');
  if v_limit is not null and private.usage_count(r.business_id, 'messages') >= v_limit then
    return jsonb_build_object('error', 'monthly message limit reached');
  end if;
  select a.actions -> r.step into v_action from public.automations a where a.id = r.automation_id;
  select * into v_customer from public.customers where id = private.run_customer(r);
  select * into v_template from public.whatsapp_templates where id = (v_action ->> 'template_id')::uuid and business_id = r.business_id;
  select * into v_account from public.whatsapp_accounts
   where business_id = r.business_id and status = 'connected' and waba_id = v_template.waba_id
   order by connected_at limit 1;
  if v_template.id is null or v_template.status <> 'approved' then
    return jsonb_build_object('error', 'template is not approved');
  end if;
  if v_customer.primary_phone is null then
    return jsonb_build_object('error', 'customer has no phone number');
  end if;
  if v_template.category = 'MARKETING' and (not private.has_marketing_consent(v_customer.id)
                                             or private.is_suppressed(r.business_id, v_customer.primary_phone)) then
    return jsonb_build_object('error', 'no marketing opt-in, or the number is suppressed');
  end if;
  if v_account.id is null then
    return jsonb_build_object('error', 'no connected WhatsApp number for this template');
  end if;
  return jsonb_build_object(
    'to', v_customer.primary_phone, 'customer_id', v_customer.id, 'account_id', v_account.id,
    'provider', v_account.provider, 'phone_number_id', v_account.phone_number_id, 'waba_id', v_account.waba_id,
    'token', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = v_account.token_secret_id),
    'template_name', v_template.name, 'language', v_template.language, 'components', v_template.components,
    'params', private.resolve_params(coalesce(v_action -> 'variables', '[]'), v_customer.full_name,
                                     (select name from public.businesses where id = r.business_id)));
end;
$$;

-- Lead API: 120 a minute per key (Sprint 9), and the plan's daily allowance per business.
create or replace function public.api_rate_limit(p_api_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key uuid;
  v_business uuid;
  v_limit int;
begin
  select id, business_id into v_key, v_business from public.api_keys
   where key_hash = private.hash_token(p_api_key) and revoked_at is null;
  if v_key is null then return true; end if;
  if not private.hit_rate_limit('api:' || v_key, 120, 60) then return false; end if;
  v_limit := private.plan_limit(v_business, 'daily_api_calls');
  if v_limit is not null and private.usage_count(v_business, 'api_calls') >= v_limit then return false; end if;
  perform private.bump_usage(v_business, 'api_calls');
  return true;
end;
$$;

-- =====================================================================
-- Suspension (read-only) and support access
-- =====================================================================
-- Permissions that only read. A suspended business keeps these (plus exports);
-- support staff get the viewing ones only.
create or replace function private.is_view_permission(p_permission text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_permission ~ '\.(view|view_all|view_assigned)$' or p_permission like 'analytics.%';
$$;

create or replace function private.is_export_permission(p_permission text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_permission in ('leads.export', 'customers.export', 'reports.export');
$$;

-- A business admin can let SCALER support see the business, read-only, for a limited time.
create table public.support_access_grants (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  granted_by   uuid references public.profiles(id) on delete set null,
  reason       text check (length(reason) <= 300),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);
create index support_access_grants_business_idx on public.support_access_grants (business_id, expires_at desc);

-- Businesses whose support grant is open to the caller (a platform admin).
create or replace function private.support_business_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct g.business_id), '{}')
    from public.support_access_grants g
    join public.businesses b on b.id = g.business_id
   where g.revoked_at is null and g.expires_at > now() and b.status <> 'closed'
     and private.is_platform_admin();
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
       and b.status in ('active', 'suspended')
  ) or p_business_id = any (private.support_business_ids());
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
       and rp.permission_key = p_permission
       and (b.status = 'active'
            or (b.status = 'suspended' and (private.is_view_permission(p_permission) or private.is_export_permission(p_permission))))
  ) or (private.is_view_permission(p_permission) and p_business_id = any (private.support_business_ids()));
$$;

create or replace function private.permitted_business_ids(p_permission text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select m.business_id
      from public.business_memberships m
      join public.businesses b on b.id = m.business_id
      join public.role_permissions rp on rp.role_id = m.role_id
     where m.user_id = auth.uid() and m.status = 'active' and rp.permission_key = p_permission
       and (b.status = 'active'
            or (b.status = 'suspended' and (private.is_view_permission(p_permission) or private.is_export_permission(p_permission))))
    union
    select unnest(private.support_business_ids()) where private.is_view_permission(p_permission));
$$;

create or replace function private.my_business_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select m.business_id
      from public.business_memberships m
      join public.businesses b on b.id = m.business_id
     where m.user_id = auth.uid() and m.status = 'active' and b.status in ('active', 'suspended')
    union
    select unnest(private.support_business_ids()));
$$;

-- Support sees every branch of the business it was let into.
create or replace function private.my_branch_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select b.id
      from public.branches b
      join public.business_memberships m on m.business_id = b.business_id and m.user_id = auth.uid() and m.status = 'active'
     where m.all_branches
        or exists (select 1 from public.user_branch_access uba where uba.membership_id = m.id and uba.branch_id = b.id)
    union
    select b.id from public.branches b where b.business_id = any (private.support_business_ids()));
$$;

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
     and (m.all_branches
          or exists (select 1 from public.user_branch_access uba where uba.membership_id = m.id and uba.branch_id = b.id))
  union
  select b.id from public.branches b
   where b.business_id = p_business_id and p_business_id = any (private.support_business_ids());
$$;

-- The app's permission list follows the same rules.
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
     and (b.status = 'active'
          or (b.status = 'suspended' and (private.is_view_permission(rp.permission_key) or private.is_export_permission(rp.permission_key))))
  union
  select p.key from public.permissions p
   where private.is_view_permission(p.key) and p_business_id = any (private.support_business_ids());
$$;

-- The two write policies that only checked membership now also need an active business.
create or replace function private.business_writable(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.businesses where id = p_business_id and status = 'active');
$$;
alter policy conversations_update on public.conversations
  with check (private.is_member(business_id) and private.business_writable(business_id));
alter policy views_insert on public.saved_views
  with check (private.is_member(business_id) and user_id = auth.uid() and private.business_writable(business_id));

alter table public.support_access_grants enable row level security;
create policy support_access_grants_select on public.support_access_grants for select to authenticated
  using (private.has_permission(business_id, 'settings.business.manage') or private.is_platform_admin());
revoke all on public.support_access_grants from anon, authenticated;
grant select on public.support_access_grants to authenticated;

create or replace function public.grant_support_access(p_business_id uuid, p_hours int, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_permission(p_business_id, 'settings.business.manage') then
    raise exception 'not allowed to grant support access' using errcode = '42501';
  end if;
  if p_hours not between 1 and 72 then
    raise exception 'support access lasts 1 to 72 hours' using errcode = '22023';
  end if;
  update public.support_access_grants set revoked_at = now(), revoked_by = auth.uid()
   where business_id = p_business_id and revoked_at is null and expires_at > now();
  insert into public.support_access_grants (business_id, granted_by, reason, expires_at)
  values (p_business_id, auth.uid(), nullif(trim(p_reason), ''), now() + make_interval(hours => p_hours))
  returning id into v_id;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (p_business_id, auth.uid(), 'insert', 'support_access', v_id::text,
          jsonb_build_object('hours', p_hours, 'reason', p_reason));
  return v_id;
end;
$$;

create or replace function public.revoke_support_access(p_business_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if not (private.has_permission(p_business_id, 'settings.business.manage') or private.is_platform_admin()) then
    raise exception 'not allowed to revoke support access' using errcode = '42501';
  end if;
  update public.support_access_grants set revoked_at = now(), revoked_by = auth.uid()
   where business_id = p_business_id and revoked_at is null and expires_at > now();
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
    values (p_business_id, auth.uid(), 'delete', 'support_access', null, null);
  end if;
  return n;
end;
$$;

-- What a business sees on its Plan & usage page.
create or replace function public.business_plan(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  v_limits jsonb;
begin
  if not private.is_member(p_business_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = p_business_id;
  select jsonb_object_agg(k, private.plan_limit(p_business_id, k)) into v_limits
    from unnest(array['max_users', 'max_branches', 'max_whatsapp_numbers', 'monthly_messages', 'max_automations', 'daily_api_calls']) k;
  return jsonb_build_object(
    'plan_key', b.plan_key,
    'plan_name', (select name from public.plans where key = b.plan_key),
    'status', b.status,
    'status_reason', b.status_reason,
    'trial_ends_at', b.trial_ends_at,
    'limits', v_limits,
    'usage', private.usage_of(p_business_id),
    'support_until', (select max(expires_at) from public.support_access_grants
                       where business_id = p_business_id and revoked_at is null and expires_at > now()));
end;
$$;

-- =====================================================================
-- Platform console (platform admins only; every change audited)
-- =====================================================================
create or replace function private.require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'platform admins only' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.platform_businesses()
returns table (id uuid, name text, slug text, status public.business_status, plan_key text, trial_ends_at timestamptz,
               created_at timestamptz, admin_email text, usage jsonb, leads_30d bigint, support_open boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
  select b.id, b.name::text, b.slug::text, b.status, b.plan_key, b.trial_ends_at, b.created_at,
         (select p.email::text from public.business_memberships m join public.roles r on r.id = m.role_id
            join public.profiles p on p.id = m.user_id
           where m.business_id = b.id and m.status = 'active' and r.key = 'business_admin'
           order by m.created_at limit 1),
         private.usage_of(b.id),
         (select count(*) from public.leads l where l.business_id = b.id and l.created_at > now() - interval '30 days'),
         b.id = any (private.support_business_ids())
    from public.businesses b
   order by b.created_at desc;
end;
$$;

create or replace function public.platform_business(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.businesses;
begin
  perform private.require_platform_admin();
  select * into b from public.businesses where id = p_business_id;
  if b.id is null then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', b.id, 'name', b.name, 'slug', b.slug, 'status', b.status, 'status_reason', b.status_reason,
    'plan_key', b.plan_key, 'plan_overrides', b.plan_overrides, 'trial_ends_at', b.trial_ends_at,
    'created_at', b.created_at, 'country_code', b.country_code, 'timezone', b.timezone,
    'usage', private.usage_of(b.id),
    'limits', (select jsonb_object_agg(k, private.plan_limit(b.id, k))
                 from unnest(array['max_users', 'max_branches', 'max_whatsapp_numbers', 'monthly_messages',
                                   'max_automations', 'daily_api_calls']) k),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('name', p.full_name, 'email', p.email, 'role', r.name)
                                          order by m.created_at), '[]')
                  from public.business_memberships m join public.profiles p on p.id = m.user_id
                  join public.roles r on r.id = m.role_id
                 where m.business_id = b.id and m.status = 'active'),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('plan_key', h.plan_key, 'status', h.status,
                                          'overrides', h.plan_overrides, 'trial_ends_at', h.trial_ends_at,
                                          'reason', h.reason, 'at', h.created_at,
                                          'by', (select email from public.profiles where id = h.changed_by))
                                          order by h.created_at desc), '[]')
                  from public.business_plan_history h where h.business_id = b.id),
    'health', jsonb_build_object(
      'whatsapp', (select coalesce(jsonb_agg(jsonb_build_object('display', coalesce(a.display_phone, a.phone_number_id),
                                            'status', a.status)), '[]')
                     from public.whatsapp_accounts a where a.business_id = b.id),
      'webhook_failures_24h', (select count(*) from private.webhook_events e
                                where e.business_id = b.id and e.status = 'failed' and e.received_at > now() - interval '24 hours'),
      'automation_failures_7d', (select count(*) from public.automation_runs r
                                  where r.business_id = b.id and r.status = 'failed' and r.created_at > now() - interval '7 days'),
      'ad_account_errors', (select count(*) from public.ad_accounts a where a.business_id = b.id and a.last_error is not null)),
    'support_until', (select max(expires_at) from public.support_access_grants
                       where business_id = b.id and revoked_at is null and expires_at > now()));
end;
$$;

-- p_overrides: {limit_key: number} for limits that differ from the plan; {} for none.
create or replace function public.platform_set_plan(p_business_id uuid, p_plan_key text, p_overrides jsonb,
                                                    p_trial_ends_at timestamptz, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  v_bad text;
begin
  perform private.require_platform_admin();
  if not exists (select 1 from public.plans where key = p_plan_key) then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_overrides, '{}')) <> 'object' then
    raise exception 'overrides must be an object' using errcode = '22023';
  end if;
  select k into v_bad from jsonb_each(coalesce(p_overrides, '{}')) e(k, v)
   where k not in ('max_users', 'max_branches', 'max_whatsapp_numbers', 'monthly_messages', 'max_automations', 'daily_api_calls')
      or jsonb_typeof(v) <> 'number' or (v::text)::numeric < 0
   limit 1;
  if v_bad is not null then
    raise exception 'invalid override %', v_bad using errcode = '22023';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  update public.businesses
     set plan_key = p_plan_key, plan_overrides = coalesce(p_overrides, '{}'), trial_ends_at = p_trial_ends_at
   where id = p_business_id
  returning * into b;
  if b.id is null then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  insert into public.business_plan_history (business_id, plan_key, plan_overrides, trial_ends_at, status, reason, changed_by)
  values (b.id, b.plan_key, b.plan_overrides, b.trial_ends_at, b.status, p_reason, auth.uid());
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (b.id, auth.uid(), 'update', 'plan', b.plan_key,
          jsonb_build_object('plan_key', b.plan_key, 'overrides', b.plan_overrides, 'trial_ends_at', b.trial_ends_at,
                             'reason', p_reason));
end;
$$;

create or replace function public.platform_set_status(p_business_id uuid, p_status public.business_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.businesses;
begin
  perform private.require_platform_admin();
  if p_status not in ('active', 'suspended') then
    raise exception 'businesses are closed by deleting them, not from here' using errcode = '22023';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.businesses set status = p_status, status_reason = case when p_status = 'active' then null else p_reason end
   where id = p_business_id
  returning * into b;
  if b.id is null then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  insert into public.business_plan_history (business_id, plan_key, plan_overrides, trial_ends_at, status, reason, changed_by)
  values (b.id, b.plan_key, b.plan_overrides, b.trial_ends_at, b.status, p_reason, auth.uid());
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (b.id, auth.uid(), 'update', 'business_status', b.status::text, jsonb_build_object('status', b.status, 'reason', p_reason));
end;
$$;

create or replace function public.platform_save_plan(p_key text, p_input jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  update public.plans set
    name = coalesce(nullif(trim(p_input ->> 'name'), ''), name),
    description = nullif(trim(p_input ->> 'description'), ''),
    is_public = coalesce((p_input ->> 'is_public')::boolean, is_public),
    max_users = nullif(p_input ->> 'max_users', '')::int,
    max_branches = nullif(p_input ->> 'max_branches', '')::int,
    max_whatsapp_numbers = nullif(p_input ->> 'max_whatsapp_numbers', '')::int,
    monthly_messages = nullif(p_input ->> 'monthly_messages', '')::int,
    max_automations = nullif(p_input ->> 'max_automations', '')::int,
    daily_api_calls = nullif(p_input ->> 'daily_api_calls', '')::int,
    price_monthly = nullif(p_input ->> 'price_monthly', '')::numeric(14,2),
    price_yearly = nullif(p_input ->> 'price_yearly', '')::numeric(14,2)
  where key = p_key;
  if not found then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (null, auth.uid(), 'update', 'plan_catalogue', p_key, p_input);
end;
$$;

-- =====================================================================
-- Daily usage snapshots (written by the job route)
-- =====================================================================
create table public.usage_snapshots (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  day          date not null,
  usage        jsonb not null,
  primary key (business_id, day)
);
alter table public.usage_snapshots enable row level security;
create policy usage_snapshots_select on public.usage_snapshots for select to authenticated
  using (private.has_permission(business_id, 'settings.business.manage') or private.is_platform_admin());
revoke all on public.usage_snapshots from anon, authenticated;
grant select on public.usage_snapshots to authenticated;

create or replace function public.snapshot_usage()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.usage_snapshots (business_id, day, usage)
  select b.id, (now() at time zone 'utc')::date, private.usage_of(b.id)
    from public.businesses b where b.status <> 'closed'
  on conflict (business_id, day) do update set usage = excluded.usage;
  get diagnostics n = row_count;
  delete from private.usage_counters where period < (now() at time zone 'utc')::date - interval '400 days';
  return n;
end;
$$;

-- =====================================================================
-- Existing businesses: Growth, with anything they already use above it kept (grandfathered)
-- =====================================================================
update public.businesses b
   set plan_key = 'growth',
       plan_overrides = coalesce((
         select jsonb_object_agg(u.key, (u.value::text)::int)
           from jsonb_each(private.usage_of(b.id)) u
           join public.plans p on p.key = 'growth'
          where u.key in ('max_users', 'max_branches', 'max_whatsapp_numbers', 'max_automations')
            and (u.value::text)::int > coalesce((to_jsonb(p) ->> u.key)::int, 2147483647)), '{}');
insert into public.business_plan_history (business_id, plan_key, plan_overrides, trial_ends_at, status, reason)
select id, plan_key, plan_overrides, trial_ends_at, status, 'Plans introduced (Sprint 10); existing usage kept'
  from public.businesses;
alter table public.businesses add constraint businesses_plan_fk foreign key (plan_key) references public.plans(key);

-- Tenants still cannot change their own plan or status: plan_overrides, trial_ends_at and
-- status_reason have no column grant to authenticated (same as plan_key and status).

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.grant_support_access(uuid, int, text) from public, anon;
revoke execute on function public.revoke_support_access(uuid) from public, anon;
revoke execute on function public.business_plan(uuid) from public, anon;
revoke execute on function public.platform_businesses() from public, anon;
revoke execute on function public.platform_business(uuid) from public, anon;
revoke execute on function public.platform_set_plan(uuid, text, jsonb, timestamptz, text) from public, anon;
revoke execute on function public.platform_set_status(uuid, public.business_status, text) from public, anon;
revoke execute on function public.platform_save_plan(text, jsonb) from public, anon;
grant execute on function public.grant_support_access(uuid, int, text) to authenticated;
grant execute on function public.revoke_support_access(uuid) to authenticated;
grant execute on function public.business_plan(uuid) to authenticated;
grant execute on function public.platform_businesses() to authenticated;
grant execute on function public.platform_business(uuid) to authenticated;
grant execute on function public.platform_set_plan(uuid, text, jsonb, timestamptz, text) to authenticated;
grant execute on function public.platform_set_status(uuid, public.business_status, text) to authenticated;
grant execute on function public.platform_save_plan(text, jsonb) to authenticated;

revoke execute on function public.snapshot_usage() from public, anon, authenticated;
grant execute on function public.snapshot_usage() to service_role;
