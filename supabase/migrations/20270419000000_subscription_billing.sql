-- Sprint 11 — subscription billing: payment provider subscriptions, signed idempotent
-- webhooks, the subscription state machine, GST invoices, dunning and read-only on non-payment.

-- =====================================================================
-- Permission
-- =====================================================================
insert into public.permissions (key, module, description) values
-- BEGIN permissions
  ('billing.manage', 'settings', 'Pay for SCALER: plan changes, payment method, billing details and invoices')
-- END permissions
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'billing.manage' from public.roles r
 where r.business_id is null and r.key in ('business_admin', 'accounts')
on conflict do nothing;

-- A suspended business keeps its view and export permissions (Sprint 10), and can also pay:
-- paying is how a business that fell behind gets out of read-only.
create or replace function private.is_export_permission(p_permission text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_permission in ('leads.export', 'customers.export', 'reports.export', 'billing.manage');
$$;

-- Who suspended a business. Billing only lifts its own suspensions.
alter table public.businesses add column suspended_by text check (suspended_by in ('platform', 'billing'));
update public.businesses set suspended_by = 'platform' where status = 'suspended';

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
  update public.businesses
     set status = p_status,
         status_reason = case when p_status = 'active' then null else p_reason end,
         suspended_by = case when p_status = 'active' then null else 'platform' end
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

-- =====================================================================
-- Seller (Springs 360) details printed on every invoice. Platform-managed.
-- =====================================================================
create table private.billing_seller (
  id              boolean primary key default true check (id),
  legal_name      text check (length(trim(legal_name)) between 2 and 200),
  gstin           text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  state_code      text check (state_code ~ '^(0[1-9]|[12][0-9]|3[0-8]|97)$'),
  address         text check (length(address) <= 400),
  email           text check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invoice_prefix  text not null default 'SCL' check (invoice_prefix ~ '^[A-Z]{2,4}$'),
  sac_code        text not null default '997331' check (sac_code ~ '^[0-9]{6}$'),
  gst_rate        numeric(5,2) not null default 18.00 check (gst_rate between 0 and 28),
  updated_at      timestamptz not null default now(),
  check (gstin is null or state_code = left(gstin, 2))
);
insert into private.billing_seller default values;

-- Tax invoices need the seller's GSTIN. Until it's set, invoices are test invoices on their own series.
create or replace function private.seller_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.billing_seller where gstin is not null and legal_name is not null and address is not null);
$$;

-- Provider-side plan ids, created on first use per plan, interval and amount:
-- {"razorpay": {"monthly:2359.82": "plan_…"}}. A price change creates a new provider plan.
alter table public.plans add column provider_plan_ids jsonb not null default '{}' check (jsonb_typeof(provider_plan_ids) = 'object');

-- What the payment provider charges for a plan: the price plus GST.
create or replace function private.charge_amount(p_plan_key text, p_interval text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(case p_interval when 'monthly' then p.price_monthly when 'yearly' then p.price_yearly end
               * (100 + s.gst_rate) / 100, 2)
    from public.plans p cross join private.billing_seller s
   where p.key = p_plan_key;
$$;

-- =====================================================================
-- Billing details (the buyer on the invoice). Tenant configuration: audited.
-- =====================================================================
create table public.billing_profiles (
  business_id    uuid primary key references public.businesses(id) on delete cascade,
  legal_name     text not null check (length(trim(legal_name)) between 2 and 200),
  gstin          text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  country_code   char(2) not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  state_code     text check (state_code ~ '^(0[1-9]|[12][0-9]|3[0-8]|97)$'),
  address        text not null check (length(trim(address)) between 5 and 400),
  city           text check (length(city) <= 80),
  postal_code    text check (postal_code ~ '^[A-Za-z0-9 -]{3,12}$'),
  billing_email  text not null check (billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(billing_email) <= 254),
  billing_phone  text check (billing_phone ~ '^\+[1-9][0-9]{6,14}$'),
  updated_at     timestamptz not null default now(),
  -- Indian buyers need a state (place of supply). A GSTIN fixes the state.
  check (country_code <> 'IN' or state_code is not null),
  check (gstin is null or (country_code = 'IN' and state_code = left(gstin, 2)))
);
create trigger billing_profiles_updated_at before update on public.billing_profiles
  for each row execute function private.set_updated_at();
create trigger audit_billing_profiles after insert or update or delete on public.billing_profiles
  for each row execute function private.audit_row();

-- A GSTIN decides the state; uppercase it so people can paste it as they have it.
create or replace function private.billing_profile_normalise()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.gstin := nullif(upper(trim(new.gstin)), '');
  new.billing_email := lower(trim(new.billing_email));
  if new.gstin is not null then
    new.state_code := left(new.gstin, 2);
  end if;
  return new;
end;
$$;
create trigger billing_profiles_normalise before insert or update on public.billing_profiles
  for each row execute function private.billing_profile_normalise();

alter table public.billing_profiles enable row level security;
create policy billing_profiles_select on public.billing_profiles for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('billing.manage'))::uuid[]) or private.is_platform_admin());
create policy billing_profiles_insert on public.billing_profiles for insert to authenticated
  with check (business_id = any ((select private.permitted_business_ids('billing.manage'))::uuid[]));
create policy billing_profiles_update on public.billing_profiles for update to authenticated
  using (business_id = any ((select private.permitted_business_ids('billing.manage'))::uuid[]))
  with check (business_id = any ((select private.permitted_business_ids('billing.manage'))::uuid[]));
revoke all on public.billing_profiles from anon, authenticated;
grant select, insert, update on public.billing_profiles to authenticated;

-- =====================================================================
-- Subscriptions: one per business, driven by provider webhooks
-- =====================================================================
-- trialing:  not paying yet (on a trial, or never subscribed)
-- active:    paid up
-- past_due:  a renewal failed; the provider is retrying
-- grace:     retries are over (or the trial ended); 7 days to pay from the first failure
-- read_only: unpaid after grace; the business is suspended (view, export and pay only)
-- cancelled: ended by the business; also read-only
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'grace', 'read_only', 'cancelled');

create table public.subscriptions (
  business_id               uuid primary key references public.businesses(id) on delete cascade,
  status                    public.subscription_status not null default 'trialing',
  provider                  text check (provider in ('razorpay', 'fake')),
  provider_subscription_id  text check (length(provider_subscription_id) between 3 and 80),
  provider_customer_id      text check (length(provider_customer_id) <= 80),
  live                      boolean not null default false,
  plan_key                  text references public.plans(key),
  billing_interval          text check (billing_interval in ('monthly', 'yearly')),
  -- What the open checkout is for, until the provider confirms it.
  checkout_plan_key         text references public.plans(key),
  checkout_interval         text check (checkout_interval in ('monthly', 'yearly')),
  -- A downgrade waiting for the next renewal.
  pending_plan_key          text references public.plans(key),
  pending_interval          text check (pending_interval in ('monthly', 'yearly')),
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean not null default false,
  past_due_since            timestamptz,
  grace_ends_at             timestamptz,
  read_only_since           timestamptz,
  payment_method            jsonb check (payment_method is null or jsonb_typeof(payment_method) = 'object'),
  last_event_at             timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();
create index subscriptions_dunning_idx on public.subscriptions (grace_ends_at) where status in ('past_due', 'grace');

alter table public.subscriptions enable row level security;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('billing.manage'))::uuid[]) or private.is_platform_admin());
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

-- Every status change, append-only.
create table public.subscription_status_history (
  id                bigint generated always as identity primary key,
  business_id       uuid not null references public.businesses(id) on delete cascade,
  from_status       public.subscription_status,
  to_status         public.subscription_status not null,
  reason            text not null check (length(reason) <= 300),
  billing_event_id  bigint,
  created_at        timestamptz not null default now()
);
create index subscription_status_history_idx on public.subscription_status_history (business_id, created_at desc);
alter table public.subscription_status_history enable row level security;
create policy subscription_status_history_select on public.subscription_status_history for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('billing.manage'))::uuid[]) or private.is_platform_admin());
revoke all on public.subscription_status_history from anon, authenticated;
grant select on public.subscription_status_history to authenticated;

-- =====================================================================
-- Provider webhooks: stored once per provider event id, never edited
-- =====================================================================
create table public.billing_events (
  id                 bigint generated always as identity primary key,
  provider           text not null check (provider in ('razorpay', 'fake')),
  provider_event_id  text not null check (length(provider_event_id) between 1 and 120),
  event_type         text not null check (length(event_type) between 1 and 80),
  business_id        uuid references public.businesses(id) on delete set null,
  payload            jsonb not null,
  -- The provider-neutral event the adapter made of the payload.
  normalized         jsonb not null,
  result             text,
  error              text,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  unique (provider, provider_event_id)
);
create index billing_events_business_idx on public.billing_events (business_id, received_at desc);
create index billing_events_failed_idx on public.billing_events (received_at desc) where error is not null;

-- Append-only: the only change allowed is recording the outcome, once.
create or replace function private.billing_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'billing events are append-only' using errcode = '42501';
  end if;
  if old.processed_at is not null
     or (to_jsonb(new) - array['business_id', 'result', 'error', 'processed_at'])
        is distinct from (to_jsonb(old) - array['business_id', 'result', 'error', 'processed_at']) then
    raise exception 'billing events are append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger billing_events_append_only before update or delete on public.billing_events
  for each row execute function private.billing_events_append_only();

alter table public.billing_events enable row level security;
create policy billing_events_select on public.billing_events for select to authenticated
  using (private.is_platform_admin());
revoke all on public.billing_events from anon, authenticated;
grant select on public.billing_events to authenticated;

-- =====================================================================
-- GST invoices: one per payment, sequential per financial year, never edited
-- =====================================================================
create table private.invoice_counters (
  series          text not null check (series in ('live', 'test')),
  financial_year  text not null,
  last_number     int not null default 0,
  primary key (series, financial_year)
);

create table public.invoices (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete restrict,
  number               text not null unique check (length(number) <= 16),
  financial_year       text not null check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  sequence             int not null check (sequence > 0),
  -- Issued before Springs 360's GSTIN was set, or for a test-mode payment: not a tax invoice.
  test_mode            boolean not null,
  issued_at            timestamptz not null default now(),
  period_start         timestamptz,
  period_end           timestamptz,
  description          text not null check (length(description) <= 300),
  plan_key             text references public.plans(key),
  billing_interval     text check (billing_interval in ('monthly', 'yearly')),
  seller               jsonb not null,
  buyer                jsonb not null,
  sac_code             text not null,
  gst_rate             numeric(5,2) not null,
  place_of_supply      text,
  supply_type          text not null check (supply_type in ('intra_state', 'inter_state', 'export')),
  taxable_amount       numeric(14,2) not null check (taxable_amount >= 0),
  cgst                 numeric(14,2) not null default 0 check (cgst >= 0),
  sgst                 numeric(14,2) not null default 0 check (sgst >= 0),
  igst                 numeric(14,2) not null default 0 check (igst >= 0),
  total                numeric(14,2) not null check (total > 0),
  currency             char(3) not null default 'INR',
  provider             text not null,
  provider_payment_id  text not null,
  paid_at              timestamptz not null,
  unique (provider, provider_payment_id),
  unique (test_mode, financial_year, sequence),
  check (total = taxable_amount + cgst + sgst + igst),
  check (supply_type <> 'intra_state' or igst = 0),
  check (supply_type <> 'inter_state' or (cgst = 0 and sgst = 0))
);
create index invoices_business_idx on public.invoices (business_id, issued_at desc);

create or replace function private.invoices_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'invoices cannot be changed or deleted; issue a credit note instead' using errcode = '42501';
end;
$$;
create trigger invoices_immutable before update or delete on public.invoices
  for each row execute function private.invoices_immutable();

alter table public.invoices enable row level security;
create policy invoices_select on public.invoices for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('billing.manage'))::uuid[]) or private.is_platform_admin());
revoke all on public.invoices from anon, authenticated;
grant select on public.invoices to authenticated;

-- Indian financial year (April–March, IST) as "27-28".
create or replace function private.financial_year(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select lpad((y % 100)::text, 2, '0') || '-' || lpad(((y + 1) % 100)::text, 2, '0')
    from (select extract(year from (p_at at time zone 'Asia/Kolkata') - interval '3 months')::int y) x;
$$;

-- Splits a GST-inclusive amount. Intra-state: CGST + SGST; inter-state: IGST; export: zero-rated.
create or replace function private.gst_split(p_total numeric, p_rate numeric, p_supply_type text,
                                             out taxable numeric, out cgst numeric, out sgst numeric, out igst numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tax numeric;
begin
  if p_supply_type = 'export' then
    taxable := p_total; cgst := 0; sgst := 0; igst := 0;
    return;
  end if;
  taxable := round(p_total * 100 / (100 + p_rate), 2);
  v_tax := p_total - taxable;
  if p_supply_type = 'intra_state' then
    cgst := round(v_tax / 2, 2); sgst := v_tax - cgst; igst := 0;
  else
    cgst := 0; sgst := 0; igst := v_tax;
  end if;
end;
$$;

-- Issues the invoice for one captured payment. Idempotent per payment id.
create or replace function private.issue_invoice(p_business_id uuid, p_provider text, p_payment_id text, p_amount numeric,
                                                 p_currency text, p_paid_at timestamptz, p_live boolean,
                                                 p_plan_key text, p_interval text, p_period_start timestamptz, p_period_end timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.billing_seller;
  bp public.billing_profiles;
  v_id uuid;
  v_test boolean;
  v_fy text;
  v_seq int;
  v_supply text;
  v_split record;
  v_number text;
begin
  select id into v_id from public.invoices where provider = p_provider and provider_payment_id = p_payment_id;
  if v_id is not null then
    return v_id;
  end if;
  select * into s from private.billing_seller;
  select * into bp from public.billing_profiles where business_id = p_business_id;
  v_test := not p_live or not private.seller_ready();
  v_fy := private.financial_year(p_paid_at);

  insert into private.invoice_counters (series, financial_year, last_number)
  values (case when v_test then 'test' else 'live' end, v_fy, 1)
  on conflict (series, financial_year) do update set last_number = private.invoice_counters.last_number + 1
  returning last_number into v_seq;
  v_number := case when v_test then 'TEST' else s.invoice_prefix end || '/' || v_fy || '/' || lpad(v_seq::text, 5, '0');

  v_supply := case
    when coalesce(bp.country_code, 'IN') <> 'IN' then 'export'
    when bp.state_code is not null and bp.state_code = s.state_code then 'intra_state'
    else 'inter_state' end;
  select * into v_split from private.gst_split(p_amount, s.gst_rate, v_supply);

  insert into public.invoices (business_id, number, financial_year, sequence, test_mode, period_start, period_end, description,
                               plan_key, billing_interval, seller, buyer, sac_code, gst_rate, place_of_supply, supply_type,
                               taxable_amount, cgst, sgst, igst, total, currency, provider, provider_payment_id, paid_at)
  values (p_business_id, v_number, v_fy, v_seq, v_test, p_period_start, p_period_end,
          'SCALER ' || coalesce((select name from public.plans where key = p_plan_key), 'subscription')
            || coalesce(' plan, ' || p_interval, ''),
          p_plan_key, p_interval,
          jsonb_build_object('legal_name', coalesce(s.legal_name, 'Springs 360'), 'gstin', s.gstin, 'state_code', s.state_code,
                             'address', s.address, 'email', s.email),
          jsonb_build_object('legal_name', coalesce(bp.legal_name, (select name from public.businesses where id = p_business_id)),
                             'gstin', bp.gstin, 'state_code', bp.state_code, 'country_code', coalesce(bp.country_code, 'IN'),
                             'address', bp.address, 'city', bp.city, 'postal_code', bp.postal_code, 'email', bp.billing_email),
          s.sac_code, s.gst_rate, case when v_supply = 'export' then null else bp.state_code end, v_supply,
          v_split.taxable, v_split.cgst, v_split.sgst, v_split.igst, p_amount, coalesce(p_currency, 'INR'),
          p_provider, p_payment_id, p_paid_at)
  returning id into v_id;
  return v_id;
end;
$$;

-- =====================================================================
-- Dunning notices: each one emailed once
-- =====================================================================
create table private.billing_notices (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  kind         text not null check (kind ~ '^[a-z_]+$'),
  ref          text not null,
  created_at   timestamptz not null default now(),
  primary key (business_id, kind, ref)
);

-- Emails the billing contact (or, without one, every active business admin). Returns false if already sent.
create or replace function private.billing_notify(p_business_id uuid, p_kind text, p_ref text, p_payload jsonb default '{}')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  insert into private.billing_notices (business_id, kind, ref) values (p_business_id, p_kind, p_ref)
  on conflict do nothing;
  if not found then
    return false;
  end if;
  select coalesce(p_payload, '{}') || jsonb_build_object('business_name', b.name, 'timezone', b.timezone, 'path', '/settings/billing')
    into v_payload from public.businesses b where b.id = p_business_id;
  insert into private.email_outbox (business_id, to_email, template, payload)
  select p_business_id, e.email, 'billing_' || p_kind, v_payload
    from (select bp.billing_email as email from public.billing_profiles bp where bp.business_id = p_business_id
          union
          select p.email from public.business_memberships m
            join public.roles r on r.id = m.role_id and r.key = 'business_admin'
            join public.profiles p on p.id = m.user_id
           where m.business_id = p_business_id and m.status = 'active'
             and not exists (select 1 from public.billing_profiles bp where bp.business_id = p_business_id)) e
   where e.email is not null;
  return true;
end;
$$;

-- =====================================================================
-- The state machine
-- =====================================================================
-- Moves a subscription to a new status and keeps the business in step:
-- read_only and cancelled suspend the business (marked as billing's doing);
-- every other status lifts a suspension that billing made, never one the platform made.
create or replace function private.set_subscription_status(p_business_id uuid, p_status public.subscription_status,
                                                           p_reason text, p_event_id bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.subscription_status;
  b public.businesses;
begin
  select status into v_old from public.subscriptions where business_id = p_business_id for update;
  if v_old is not distinct from p_status then
    return;
  end if;
  update public.subscriptions
     set status = p_status,
         read_only_since = case when p_status in ('read_only', 'cancelled') then coalesce(read_only_since, now()) end,
         past_due_since = case when p_status in ('past_due', 'grace') then past_due_since end,
         grace_ends_at = case when p_status in ('past_due', 'grace') then grace_ends_at end
   where business_id = p_business_id;
  insert into public.subscription_status_history (business_id, from_status, to_status, reason, billing_event_id)
  values (p_business_id, v_old, p_status, p_reason, p_event_id);

  if p_status in ('read_only', 'cancelled') then
    update public.businesses set status = 'suspended', suspended_by = 'billing', status_reason = p_reason
     where id = p_business_id and status = 'active'
    returning * into b;
  else
    update public.businesses set status = 'active', suspended_by = null, status_reason = null
     where id = p_business_id and status = 'suspended' and suspended_by = 'billing'
    returning * into b;
  end if;
  if b.id is not null then
    insert into public.business_plan_history (business_id, plan_key, plan_overrides, trial_ends_at, status, reason)
    values (b.id, b.plan_key, b.plan_overrides, b.trial_ends_at, b.status, p_reason);
  end if;
end;
$$;

-- Puts the business on a plan (from a checkout, an upgrade or a renewal downgrade), with history.
create or replace function private.billing_set_plan(p_business_id uuid, p_plan_key text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.businesses;
begin
  update public.businesses set plan_key = p_plan_key, trial_ends_at = null
   where id = p_business_id and (plan_key <> p_plan_key or trial_ends_at is not null)
  returning * into b;
  if b.id is not null then
    insert into public.business_plan_history (business_id, plan_key, plan_overrides, trial_ends_at, status, reason)
    values (b.id, b.plan_key, b.plan_overrides, b.trial_ends_at, b.status, p_reason);
  end if;
end;
$$;

-- Limits a business already uses beyond a plan. Empty = it fits.
create or replace function private.plan_blockers(p_business_id uuid, p_plan_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', u.key, 'uses', (u.value::text)::int, 'allows', lim)
                            order by u.key), '[]')
    from jsonb_each(private.usage_of(p_business_id)) u
    cross join lateral (
      select coalesce((b.plan_overrides ->> u.key)::int, (to_jsonb(p) ->> u.key)::int) lim
        from public.plans p, public.businesses b
       where p.key = p_plan_key and b.id = p_business_id) l
   where u.key in ('max_users', 'max_branches', 'max_whatsapp_numbers', 'max_automations')
     and l.lim is not null and (u.value::text)::int > l.lim;
$$;

-- Applies one provider-neutral event. The adapter (src/modules/billing) makes these from webhooks:
-- {kind, subscription_id, business_id?, occurred_at, period_start?, period_end?,
--  payment?: {id, amount, currency, method?}, payment_method?: {type, label}, live}
create or replace function private.billing_apply(p_event_id bigint, p_provider text, e jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subscriptions;
  v_kind text := e ->> 'kind';
  v_at timestamptz := coalesce((e ->> 'occurred_at')::timestamptz, now());
  v_stale boolean;
  v_plan text;
  v_interval text;
  v_blockers jsonb;
  v_invoice uuid;
  v_number text;
begin
  if v_kind = 'ignored' then
    return 'ignored';
  end if;
  select * into s from public.subscriptions
   where provider = p_provider and provider_subscription_id = e ->> 'subscription_id'
   for update;
  if s.business_id is null then
    raise exception 'unknown subscription %', e ->> 'subscription_id' using errcode = 'P0002';
  end if;
  if e ->> 'business_id' is not null and (e ->> 'business_id')::uuid <> s.business_id then
    raise exception 'subscription belongs to another business' using errcode = '42501';
  end if;
  -- Webhooks arrive out of order. An older event never moves the status back,
  -- but a payment is always invoiced: the money moved whatever the order.
  v_stale := s.last_event_at is not null and v_at < s.last_event_at;
  if not v_stale then
    update public.subscriptions set last_event_at = v_at,
           payment_method = coalesce(e -> 'payment_method', payment_method)
     where business_id = s.business_id;
  end if;

  if v_kind in ('activated', 'charged') then
    v_plan := coalesce(s.checkout_plan_key, s.plan_key);
    v_interval := coalesce(s.checkout_interval, s.billing_interval);
    -- A renewal applies a downgrade that was waiting for it, if the business still fits.
    if v_kind = 'charged' and s.pending_plan_key is not null and s.status = 'active' and s.checkout_plan_key is null then
      v_blockers := private.plan_blockers(s.business_id, s.pending_plan_key);
      if jsonb_array_length(v_blockers) = 0 then
        v_plan := s.pending_plan_key;
        v_interval := coalesce(s.pending_interval, v_interval);
      end if;
    end if;
    if e ? 'payment' then
      v_invoice := private.issue_invoice(s.business_id, p_provider, e -> 'payment' ->> 'id', (e -> 'payment' ->> 'amount')::numeric,
                                         e -> 'payment' ->> 'currency', v_at, coalesce((e ->> 'live')::boolean, false),
                                         v_plan, v_interval, (e ->> 'period_start')::timestamptz, (e ->> 'period_end')::timestamptz);
    end if;
    if v_stale then
      return case when v_invoice is null then 'stale' else 'invoiced (stale)' end;
    end if;
    update public.subscriptions
       set plan_key = v_plan, billing_interval = v_interval,
           checkout_plan_key = null, checkout_interval = null,
           current_period_start = coalesce((e ->> 'period_start')::timestamptz, current_period_start),
           current_period_end = coalesce((e ->> 'period_end')::timestamptz, current_period_end),
           live = coalesce((e ->> 'live')::boolean, live),
           past_due_since = null, grace_ends_at = null, read_only_since = null
     where business_id = s.business_id;
    -- Clear the applied downgrade (kept when it no longer fits: the business is told why below).
    update public.subscriptions set pending_plan_key = null, pending_interval = null
     where business_id = s.business_id and pending_plan_key = v_plan;
    perform private.billing_set_plan(s.business_id, v_plan,
      case when v_kind = 'activated' then 'Subscribed' when v_plan <> s.plan_key then 'Plan changed at renewal' else 'Renewed' end);
    perform private.set_subscription_status(s.business_id, 'active',
      case when v_kind = 'activated' then 'Subscription started' else 'Payment received' end, p_event_id);
    if v_blockers is not null and jsonb_array_length(v_blockers) > 0 then
      perform private.billing_notify(s.business_id, 'downgrade_blocked', coalesce(e ->> 'period_start', v_at::text),
                                     jsonb_build_object('plan_key', s.pending_plan_key, 'blockers', v_blockers));
    end if;
    if v_invoice is not null then
      select number into v_number from public.invoices where id = v_invoice;
      perform private.billing_notify(s.business_id, 'invoice', v_number,
        (select jsonb_build_object('number', number, 'total', total::text, 'currency', currency, 'invoice_id', id, 'test_mode', test_mode)
           from public.invoices where id = v_invoice));
    end if;
    return case when v_invoice is null then v_kind else v_kind || ', invoiced ' || v_number end;
  end if;

  if v_stale then
    return 'stale';
  end if;

  if v_kind = 'authenticated' then
    return 'noted';
  elsif v_kind = 'payment_failed' then
    if s.status = 'active' then
      perform private.set_subscription_status(s.business_id, 'past_due', 'Renewal payment failed', p_event_id);
      update public.subscriptions set past_due_since = v_at, grace_ends_at = v_at + interval '7 days'
       where business_id = s.business_id;
      perform private.billing_notify(s.business_id, 'payment_failed', v_at::date::text,
                                     jsonb_build_object('grace_ends_at', v_at + interval '7 days'));
      return 'past_due';
    end if;
    return 'no change';
  elsif v_kind = 'halted' then
    if s.status in ('active', 'past_due') then
      perform private.set_subscription_status(s.business_id, 'grace', 'Payment retries exhausted', p_event_id);
      update public.subscriptions set past_due_since = coalesce(s.past_due_since, v_at),
             grace_ends_at = coalesce(s.grace_ends_at, v_at + interval '7 days')
       where business_id = s.business_id;
      return 'grace';
    end if;
    return 'no change';
  elsif v_kind = 'cancelled' then
    if s.status <> 'cancelled' then
      perform private.set_subscription_status(s.business_id, 'cancelled', 'Subscription cancelled', p_event_id);
      update public.subscriptions set cancel_at_period_end = false where business_id = s.business_id;
      perform private.billing_notify(s.business_id, 'cancelled', s.provider_subscription_id);
      return 'cancelled';
    end if;
    return 'no change';
  elsif v_kind = 'updated' then
    return 'noted';
  end if;
  return 'ignored';
end;
$$;

-- Webhook entry point (service role). Stores the event once; a repeat delivery returns 'duplicate'.
-- A failure to apply is recorded on the event and reported, not retried forever.
create or replace function public.billing_ingest(p_provider text, p_event_id text, p_event_type text, p_payload jsonb, p_normalized jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_result text;
  v_error text;
  v_business uuid;
begin
  insert into public.billing_events (provider, provider_event_id, event_type, payload, normalized)
  values (p_provider, p_event_id, p_event_type, p_payload, p_normalized)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;
  begin
    v_result := private.billing_apply(v_id, p_provider, p_normalized);
  exception when others then
    v_error := sqlerrm;
  end;
  select business_id into v_business from public.subscriptions
   where provider = p_provider and provider_subscription_id = p_normalized ->> 'subscription_id';
  update public.billing_events set business_id = v_business, result = v_result, error = v_error, processed_at = now()
   where id = v_id;
  return jsonb_build_object('status', case when v_error is null then 'applied' else 'failed' end,
                            'id', v_id, 'result', v_result, 'error', v_error);
end;
$$;

-- Time-based moves, run by the job route: trials ending, grace running out, reminders.
create or replace function public.billing_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_trials int := 0;
  v_read_only int := 0;
  v_reminders int := 0;
begin
  -- Every business on a trial has a subscription row to track it.
  insert into public.subscriptions (business_id, status)
  select b.id, 'trialing' from public.businesses b
   where b.trial_ends_at is not null and b.status = 'active'
  on conflict (business_id) do nothing;

  -- Trial ending in the next 3 days.
  for r in select b.id, b.trial_ends_at from public.businesses b join public.subscriptions s on s.business_id = b.id
            where s.status = 'trialing' and b.trial_ends_at between now() and now() + interval '3 days' loop
    if private.billing_notify(r.id, 'trial_ending', r.trial_ends_at::text, jsonb_build_object('trial_ends_at', r.trial_ends_at)) then
      v_reminders := v_reminders + 1;
    end if;
  end loop;

  -- Trial over without a subscription: 7 days' grace from the trial's end.
  for r in select b.id, b.trial_ends_at from public.businesses b join public.subscriptions s on s.business_id = b.id
            where s.status = 'trialing' and b.trial_ends_at <= now() loop
    perform private.set_subscription_status(r.id, 'grace', 'Trial ended');
    update public.subscriptions set past_due_since = r.trial_ends_at, grace_ends_at = r.trial_ends_at + interval '7 days'
     where business_id = r.id;
    perform private.billing_notify(r.id, 'trial_ended', r.trial_ends_at::text,
                                   jsonb_build_object('grace_ends_at', r.trial_ends_at + interval '7 days'));
    v_trials := v_trials + 1;
  end loop;

  -- Grace ending in the next 2 days.
  for r in select business_id, grace_ends_at from public.subscriptions
            where status in ('past_due', 'grace') and grace_ends_at between now() and now() + interval '2 days' loop
    if private.billing_notify(r.business_id, 'grace_ending', r.grace_ends_at::text,
                              jsonb_build_object('grace_ends_at', r.grace_ends_at)) then
      v_reminders := v_reminders + 1;
    end if;
  end loop;

  -- Grace over: read-only. Nothing is deleted.
  for r in select business_id, grace_ends_at from public.subscriptions
            where status in ('past_due', 'grace') and grace_ends_at <= now() loop
    perform private.set_subscription_status(r.business_id, 'read_only', 'Payment overdue');
    perform private.billing_notify(r.business_id, 'read_only', r.grace_ends_at::text);
    v_read_only := v_read_only + 1;
  end loop;

  return jsonb_build_object('trials_ended', v_trials, 'read_only', v_read_only, 'reminders', v_reminders);
end;
$$;

-- =====================================================================
-- Business-facing RPCs (billing.manage)
-- =====================================================================
create or replace function private.require_billing(p_business_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_business_id, 'billing.manage') then
    raise exception 'not allowed to manage billing' using errcode = '42501';
  end if;
end;
$$;

-- What changing to a plan would do. effective: 'checkout' (start paying), 'now' (upgrade,
-- prorated) or 'renewal' (downgrade or interval change). blockers: limits the business is over.
create or replace function public.billing_quote(p_business_id uuid, p_plan_key text, p_interval text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.subscriptions;
  p public.plans;
  v_charge numeric;
  v_current numeric;
  v_effective text;
  v_proration numeric := 0;
  v_fraction numeric;
begin
  perform private.require_billing(p_business_id);
  select * into p from public.plans where key = p_plan_key and is_public;
  if p.key is null or p_interval not in ('monthly', 'yearly') then
    raise exception 'plan not on sale' using errcode = '22023';
  end if;
  v_charge := private.charge_amount(p_plan_key, p_interval);
  if v_charge is null or v_charge <= 0 then
    raise exception 'plan not on sale' using errcode = '22023';
  end if;
  select * into s from public.subscriptions where business_id = p_business_id;

  -- In grace the provider has stopped retrying, so paying means a fresh checkout.
  if s.status is null or s.status not in ('active', 'past_due') or s.provider_subscription_id is null then
    v_effective := 'checkout';
  elsif s.plan_key = p_plan_key and s.billing_interval = p_interval then
    v_effective := 'same';
  else
    v_current := private.charge_amount(s.plan_key, s.billing_interval);
    -- Compare per month, so a yearly plan isn't mistaken for an upgrade.
    if p_interval = s.billing_interval
       and v_charge > coalesce(v_current, 0) then
      v_effective := 'now';
      if s.current_period_end > now() and s.current_period_end > s.current_period_start then
        v_fraction := extract(epoch from s.current_period_end - now()) / extract(epoch from s.current_period_end - s.current_period_start);
        v_proration := greatest(round((v_charge - coalesce(v_current, 0)) * v_fraction, 2), 0);
      end if;
    else
      v_effective := 'renewal';
    end if;
  end if;

  return jsonb_build_object(
    'plan_key', p.key, 'plan_name', p.name, 'interval', p_interval,
    'price', case p_interval when 'monthly' then p.price_monthly else p.price_yearly end,
    'charge_amount', v_charge, 'currency', p.currency,
    'gst_rate', (select gst_rate from private.billing_seller),
    'effective', v_effective, 'proration_amount', v_proration,
    'blockers', private.plan_blockers(p_business_id, p_plan_key),
    'renews_at', s.current_period_end);
end;
$$;

-- Starting a checkout: checks the plan fits and billing details are complete, then
-- returns what the provider needs. The subscription is attached by billing_attach_subscription.
create or replace function public.billing_begin_checkout(p_business_id uuid, p_plan_key text, p_interval text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q jsonb;
  bp public.billing_profiles;
begin
  q := public.billing_quote(p_business_id, p_plan_key, p_interval);
  if q ->> 'effective' <> 'checkout' then
    raise exception 'already subscribed; change plan instead' using errcode = '22023';
  end if;
  if jsonb_array_length(q -> 'blockers') > 0 then
    raise exception 'plan too small: %', q -> 'blockers' using errcode = '22023';
  end if;
  select * into bp from public.billing_profiles where business_id = p_business_id;
  if bp.business_id is null then
    raise exception 'billing details needed' using errcode = '22023';
  end if;
  return q || jsonb_build_object(
    'business_name', (select name from public.businesses where id = p_business_id),
    'billing_email', bp.billing_email, 'billing_phone', bp.billing_phone, 'legal_name', bp.legal_name,
    'provider_plan_ids', (select provider_plan_ids from public.plans where key = p_plan_key));
end;
$$;

create or replace function public.billing_attach_subscription(p_business_id uuid, p_provider text, p_subscription_id text,
                                                              p_customer_id text, p_plan_key text, p_interval text, p_live boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q jsonb;
begin
  q := public.billing_quote(p_business_id, p_plan_key, p_interval);
  if q ->> 'effective' <> 'checkout' then
    raise exception 'already subscribed; change plan instead' using errcode = '22023';
  end if;
  insert into public.subscriptions (business_id, status, provider, provider_subscription_id, provider_customer_id, live,
                                    checkout_plan_key, checkout_interval)
  values (p_business_id, 'trialing', p_provider, p_subscription_id, p_customer_id, p_live, p_plan_key, p_interval)
  on conflict (business_id) do update
    set provider = excluded.provider, provider_subscription_id = excluded.provider_subscription_id,
        provider_customer_id = excluded.provider_customer_id, live = excluded.live,
        checkout_plan_key = excluded.checkout_plan_key, checkout_interval = excluded.checkout_interval,
        cancel_at_period_end = false, last_event_at = null;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (p_business_id, auth.uid(), 'insert', 'subscription', p_subscription_id,
          jsonb_build_object('plan_key', p_plan_key, 'interval', p_interval, 'provider', p_provider));
end;
$$;

-- Records a plan change the provider has accepted: an upgrade applies at once, anything else at renewal.
create or replace function public.billing_record_change(p_business_id uuid, p_plan_key text, p_interval text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q jsonb;
begin
  q := public.billing_quote(p_business_id, p_plan_key, p_interval);
  if q ->> 'effective' not in ('now', 'renewal') then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  if jsonb_array_length(q -> 'blockers') > 0 then
    raise exception 'plan too small: %', q -> 'blockers' using errcode = '22023';
  end if;
  if q ->> 'effective' = 'now' then
    update public.subscriptions set plan_key = p_plan_key, pending_plan_key = null, pending_interval = null
     where business_id = p_business_id;
    perform private.billing_set_plan(p_business_id, p_plan_key, 'Upgraded');
  else
    update public.subscriptions set pending_plan_key = p_plan_key, pending_interval = p_interval
     where business_id = p_business_id;
  end if;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (p_business_id, auth.uid(), 'update', 'subscription', p_plan_key,
          jsonb_build_object('plan_key', p_plan_key, 'interval', p_interval, 'effective', q ->> 'effective',
                             'proration', q ->> 'proration_amount'));
  return q;
end;
$$;

-- Cancelling stops renewal; the business keeps its plan until the period ends.
create or replace function public.billing_cancel(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_billing(p_business_id);
  update public.subscriptions set cancel_at_period_end = true, pending_plan_key = null, pending_interval = null
   where business_id = p_business_id and status in ('active', 'past_due', 'grace');
  if not found then
    raise exception 'no subscription to cancel' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (p_business_id, auth.uid(), 'delete', 'subscription', null, jsonb_build_object('at_period_end', true));
end;
$$;

-- The Plan & usage summary (Sprint 10) also says who suspended the business and where billing stands,
-- so every member sees why the business is read-only and when a payment is due.
create or replace function public.business_plan(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  s public.subscriptions;
  v_limits jsonb;
begin
  if not private.is_member(p_business_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = p_business_id;
  select * into s from public.subscriptions where business_id = p_business_id;
  select jsonb_object_agg(k, private.plan_limit(p_business_id, k)) into v_limits
    from unnest(array['max_users', 'max_branches', 'max_whatsapp_numbers', 'monthly_messages', 'max_automations', 'daily_api_calls']) k;
  return jsonb_build_object(
    'plan_key', b.plan_key,
    'plan_name', (select name from public.plans where key = b.plan_key),
    'status', b.status,
    'status_reason', b.status_reason,
    'suspended_by', b.suspended_by,
    'trial_ends_at', b.trial_ends_at,
    'billing_status', s.status,
    'grace_ends_at', s.grace_ends_at,
    'limits', v_limits,
    'usage', private.usage_of(p_business_id),
    'support_until', (select max(expires_at) from public.support_access_grants
                       where business_id = p_business_id and revoked_at is null and expires_at > now()));
end;
$$;

-- =====================================================================
-- Service-role helpers for the adapter
-- =====================================================================
create or replace function public.billing_save_provider_plan(p_provider text, p_plan_key text, p_ref text, p_provider_plan_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.plans
     set provider_plan_ids = jsonb_set(provider_plan_ids, array[p_provider],
                                       coalesce(provider_plan_ids -> p_provider, '{}') || jsonb_build_object(p_ref, p_provider_plan_id))
   where key = p_plan_key;
$$;

-- =====================================================================
-- Platform console: seller details, billing health, reconciliation
-- =====================================================================
create or replace function public.platform_save_seller(p_input jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  update private.billing_seller set
    legal_name = nullif(trim(p_input ->> 'legal_name'), ''),
    gstin = nullif(upper(trim(p_input ->> 'gstin')), ''),
    state_code = coalesce(left(nullif(upper(trim(p_input ->> 'gstin')), ''), 2), nullif(trim(p_input ->> 'state_code'), '')),
    address = nullif(trim(p_input ->> 'address'), ''),
    email = nullif(lower(trim(p_input ->> 'email')), ''),
    invoice_prefix = coalesce(nullif(upper(trim(p_input ->> 'invoice_prefix')), ''), invoice_prefix),
    sac_code = coalesce(nullif(trim(p_input ->> 'sac_code'), ''), sac_code),
    updated_at = now();
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (null, auth.uid(), 'update', 'billing_seller', null, p_input);
end;
$$;

create or replace function public.platform_billing()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return jsonb_build_object(
    'seller', (select to_jsonb(s) - 'id' from private.billing_seller s),
    'seller_ready', private.seller_ready(),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}')
                    from (select status, count(*) n from public.subscriptions group by status) x),
    'failed_events', (select coalesce(jsonb_agg(to_jsonb(e) - 'payload' order by e.received_at desc), '[]')
                        from (select * from public.billing_events where error is not null
                               order by received_at desc limit 50) e),
    -- Read-only for 90 days or more: a person decides what happens next. Nothing is deleted automatically.
    'long_read_only', (select coalesce(jsonb_agg(jsonb_build_object('business_id', s.business_id, 'name', b.name,
                                                                    'since', s.read_only_since) order by s.read_only_since), '[]')
                         from public.subscriptions s join public.businesses b on b.id = s.business_id
                        where s.status in ('read_only', 'cancelled') and s.read_only_since <= now() - interval '90 days'),
    'unreconciled', (select coalesce(jsonb_agg(r), '[]') from private.billing_reconciliation() r));
end;
$$;

-- Payments the provider reported against the invoices issued for them.
create or replace function private.billing_reconciliation()
returns table (provider text, payment_id text, business_id uuid, paid numeric, invoiced numeric, problem text)
language sql
stable
security definer
set search_path = ''
as $$
  with payments as (
    select distinct on (e.provider, e.normalized -> 'payment' ->> 'id')
           e.provider, e.normalized -> 'payment' ->> 'id' payment_id, e.business_id,
           (e.normalized -> 'payment' ->> 'amount')::numeric paid
      from public.billing_events e
     where e.normalized ->> 'kind' in ('activated', 'charged') and e.normalized ? 'payment' and e.error is null
     order by e.provider, e.normalized -> 'payment' ->> 'id', e.received_at)
  select p.provider, p.payment_id, p.business_id, p.paid, i.total,
         case when i.id is null then 'payment without an invoice' else 'invoice total differs from the payment' end
    from payments p
    left join public.invoices i on i.provider = p.provider and i.provider_payment_id = p.payment_id
   where i.id is null or i.total <> p.paid
  union all
  select i.provider, i.provider_payment_id, i.business_id, null, i.total, 'invoice without a payment event'
    from public.invoices i
   where not exists (select 1 from payments p where p.provider = i.provider and p.payment_id = i.provider_payment_id);
$$;

-- Invoices for the payment ids in a provider settlement report.
create or replace function public.platform_invoices_by_payment(p_provider text, p_payment_ids text[])
returns table (payment_id text, number text, total numeric, business_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
    select i.provider_payment_id, i.number, i.total, b.name::text
      from public.invoices i join public.businesses b on b.id = i.business_id
     where i.provider = p_provider and i.provider_payment_id = any (p_payment_ids);
end;
$$;

create or replace function public.platform_business_billing(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return jsonb_build_object(
    'subscription', (select to_jsonb(s) from public.subscriptions s where s.business_id = p_business_id),
    'history', (select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc), '[]')
                  from (select * from public.subscription_status_history where business_id = p_business_id
                         order by created_at desc limit 20) h),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'total', i.total,
                                                              'issued_at', i.issued_at, 'test_mode', i.test_mode)
                                           order by i.issued_at desc), '[]')
                   from (select * from public.invoices where business_id = p_business_id order by issued_at desc limit 20) i),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) - 'payload' order by e.received_at desc), '[]')
                 from (select * from public.billing_events where business_id = p_business_id
                        order by received_at desc limit 20) e));
end;
$$;

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.billing_quote(uuid, text, text) from public, anon;
revoke execute on function public.billing_begin_checkout(uuid, text, text) from public, anon;
revoke execute on function public.billing_attach_subscription(uuid, text, text, text, text, text, boolean) from public, anon;
revoke execute on function public.billing_record_change(uuid, text, text) from public, anon;
revoke execute on function public.billing_cancel(uuid) from public, anon;
revoke execute on function public.platform_save_seller(jsonb) from public, anon;
revoke execute on function public.platform_billing() from public, anon;
revoke execute on function public.platform_invoices_by_payment(text, text[]) from public, anon;
revoke execute on function public.platform_business_billing(uuid) from public, anon;
grant execute on function public.billing_quote(uuid, text, text) to authenticated;
grant execute on function public.billing_begin_checkout(uuid, text, text) to authenticated;
grant execute on function public.billing_attach_subscription(uuid, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.billing_record_change(uuid, text, text) to authenticated;
grant execute on function public.billing_cancel(uuid) to authenticated;
grant execute on function public.platform_save_seller(jsonb) to authenticated;
grant execute on function public.platform_billing() to authenticated;
grant execute on function public.platform_invoices_by_payment(text, text[]) to authenticated;
grant execute on function public.platform_business_billing(uuid) to authenticated;

revoke execute on function public.billing_ingest(text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.billing_tick() from public, anon, authenticated;
revoke execute on function public.billing_save_provider_plan(text, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_ingest(text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.billing_tick() to service_role;
grant execute on function public.billing_save_provider_plan(text, text, text, text) to service_role;
