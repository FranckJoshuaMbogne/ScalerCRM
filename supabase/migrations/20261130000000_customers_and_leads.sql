-- =====================================================================
-- Sprint 2: customers (CIF), leads, history, custom fields, public API
--
-- Matching rule: phone (E.164) -> email -> create. Never on name.
-- Phone numbers arrive already normalised by normalisePhone() in the app;
-- the database only checks the E.164 shape and enforces uniqueness.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Per-business number sequences (CIF-000001, L-000001)
-- ---------------------------------------------------------------------
create table private.business_counters (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  kind         text not null,
  last_value   bigint not null,
  primary key (business_id, kind)
);
alter table private.business_counters enable row level security;

create or replace function private.next_number(p_business_id uuid, p_kind text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  insert into private.business_counters as c (business_id, kind, last_value)
  values (p_business_id, p_kind, 1)
  on conflict (business_id, kind) do update set last_value = c.last_value + 1
  returning last_value into v;
  -- lpad would truncate past six digits, so only pad below a million.
  return p_prefix || case when v < 1000000 then lpad(v::text, 6, '0') else v::text end;
end;
$$;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.contact_kind as enum ('phone', 'email');
create type public.lead_status_category as enum ('open', 'won', 'lost');
create type public.lead_channel as enum ('meta', 'google', 'whatsapp', 'website', 'walk_in', 'referral', 'phone', 'other');
create type public.consent_channel as enum ('whatsapp', 'sms', 'email', 'call');
create type public.consent_purpose as enum ('marketing', 'service');
create type public.consent_status as enum ('opted_in', 'opted_out');
create type public.custom_field_entity as enum ('customer', 'lead');
create type public.custom_field_type as enum ('text', 'textarea', 'number', 'date', 'select', 'multiselect', 'boolean');

-- ---------------------------------------------------------------------
-- Customers (CIF)
-- ---------------------------------------------------------------------
create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  cif_number          text not null,
  full_name           text not null check (length(trim(full_name)) between 1 and 160),
  -- Display copies of the primary contacts; customer_contacts is the matching source.
  primary_phone       text,
  primary_email       extensions.citext,
  gender              text check (gender in ('female', 'male', 'other')),
  date_of_birth       date,
  preferred_language  text,
  branch_id           uuid,
  owner_id            uuid references public.profiles(id) on delete set null,
  custom_fields       jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object'),
  merged_into_id      uuid references public.customers(id),
  merged_at           timestamptz,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, cif_number),
  unique (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id),
  check (merged_into_id is null or merged_into_id <> id)
);

create index customers_business_idx on public.customers (business_id, created_at desc) where merged_into_id is null;
create index customers_name_idx on public.customers (business_id, lower(full_name) text_pattern_ops);
create index customers_owner_idx on public.customers (business_id, owner_id);

create trigger customers_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

create table public.customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  customer_id  uuid not null,
  kind         public.contact_kind not null,
  value        text not null,
  label        text,
  is_primary   boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade,
  check (
    (kind = 'phone' and value ~ '^\+[1-9][0-9]{6,14}$')
    or (kind = 'email' and value = lower(value) and value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  )
);

-- One phone / email belongs to exactly one customer file per business.
create unique index customer_contacts_value_unique on public.customer_contacts (business_id, kind, value);
create index customer_contacts_customer_idx on public.customer_contacts (customer_id);

create table public.customer_addresses (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  customer_id   uuid not null,
  label         text,
  line1         text not null check (length(trim(line1)) > 0),
  line2         text,
  city          text,
  state         text,
  postal_code   text,
  country_code  char(2),
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade
);
create index customer_addresses_customer_idx on public.customer_addresses (customer_id);

create table public.tags (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 40),
  color        text,
  created_at   timestamptz not null default now(),
  unique (business_id, id)
);
create unique index tags_name_unique on public.tags (business_id, lower(name));

create table public.customer_tags (
  business_id  uuid not null,
  customer_id  uuid not null,
  tag_id       uuid not null,
  created_at   timestamptz not null default now(),
  primary key (customer_id, tag_id),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade,
  foreign key (business_id, tag_id) references public.tags (business_id, id) on delete cascade
);

-- Consent is a log: the current state is the latest row per channel/purpose.
create table public.customer_consents (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  customer_id  uuid not null,
  channel      public.consent_channel not null,
  purpose      public.consent_purpose not null default 'marketing',
  status       public.consent_status not null,
  source       text not null default 'manual',
  evidence     text,
  captured_by  uuid references public.profiles(id) on delete set null,
  captured_at  timestamptz not null default now(),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade
);
create index customer_consents_customer_idx on public.customer_consents (customer_id, channel, purpose, captured_at desc);

create view public.customer_consent_state with (security_invoker = true) as
  select distinct on (customer_id, channel, purpose)
         business_id, customer_id, channel, purpose, status, source, captured_at
    from public.customer_consents
   order by customer_id, channel, purpose, captured_at desc, id desc;

-- Customer timeline: creation, edits, notes, contact changes, merges. Append-only.
create table public.customer_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null,
  customer_id  uuid not null,
  type         text not null check (type ~ '^[a-z_]+$'),
  body         text,
  changes      jsonb,
  actor_id     uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade
);
create index customer_events_customer_idx on public.customer_events (customer_id, created_at desc);

create table public.customer_attachments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  customer_id   uuid not null,
  storage_path  text not null unique,
  file_name     text not null,
  content_type  text,
  size_bytes    bigint check (size_bytes >= 0),
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade,
  check (storage_path like business_id::text || '/' || customer_id::text || '/%')
);
create index customer_attachments_customer_idx on public.customer_attachments (customer_id, created_at desc);

-- Record of every merge, with a snapshot of the file that was folded in.
create table public.customer_merges (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  survivor_id   uuid not null references public.customers(id),
  merged_id     uuid not null references public.customers(id),
  snapshot      jsonb not null,
  merged_by     uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index customer_merges_business_idx on public.customer_merges (business_id, created_at desc);

-- ---------------------------------------------------------------------
-- Lead configuration: sources and statuses (per business, configurable)
-- ---------------------------------------------------------------------
create table public.lead_sources (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  key          text not null check (key ~ '^[a-z0-9_]+$'),
  name         text not null check (length(trim(name)) between 1 and 60),
  channel      public.lead_channel not null default 'other',
  position     int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, id)
);
create trigger lead_sources_updated_at before update on public.lead_sources
  for each row execute function private.set_updated_at();

create table public.lead_statuses (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  key          text not null check (key ~ '^[a-z0-9_]+$'),
  name         text not null check (length(trim(name)) between 1 and 60),
  category     public.lead_status_category not null default 'open',
  -- Colour token: new | contacted | qualified | negotiation | won | lost
  stage        text not null default 'new'
                 check (stage in ('new', 'contacted', 'qualified', 'negotiation', 'won', 'lost')),
  position     int not null default 0,
  is_default   boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, id)
);
create unique index lead_statuses_one_default on public.lead_statuses (business_id) where is_default;
create trigger lead_statuses_updated_at before update on public.lead_statuses
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Custom fields engine: definitions here, values in <entity>.custom_fields
-- ---------------------------------------------------------------------
create table public.custom_field_definitions (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  entity       public.custom_field_entity not null,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text not null check (length(trim(label)) between 1 and 60),
  field_type   public.custom_field_type not null,
  options      jsonb not null default '[]' check (jsonb_typeof(options) = 'array'),
  is_required  boolean not null default false,
  help_text    text,
  position     int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, entity, key),
  check (field_type not in ('select', 'multiselect') or jsonb_array_length(options) > 0)
);
create trigger custom_field_definitions_updated_at before update on public.custom_field_definitions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------
create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  lead_number       text not null,
  customer_id       uuid not null,
  branch_id         uuid,
  status_id         uuid not null,
  owner_id          uuid references public.profiles(id) on delete set null,
  title             text check (length(title) <= 160),
  description       text,
  expected_value    numeric(14,2) check (expected_value >= 0),
  first_source_id   uuid,
  first_campaign    text,
  first_touch       jsonb not null default '{}' check (jsonb_typeof(first_touch) = 'object'),
  latest_source_id  uuid,
  latest_campaign   text,
  latest_touch      jsonb not null default '{}' check (jsonb_typeof(latest_touch) = 'object'),
  last_activity_at  timestamptz not null default now(),
  custom_fields     jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object'),
  archived_at       timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, lead_number),
  unique (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id),
  foreign key (business_id, status_id) references public.lead_statuses (business_id, id),
  foreign key (business_id, first_source_id) references public.lead_sources (business_id, id),
  foreign key (business_id, latest_source_id) references public.lead_sources (business_id, id)
);

create index leads_business_idx on public.leads (business_id, created_at desc) where archived_at is null;
create index leads_customer_idx on public.leads (customer_id);
create index leads_status_idx on public.leads (business_id, status_id);
create index leads_owner_idx on public.leads (business_id, owner_id);

create trigger leads_updated_at before update on public.leads
  for each row execute function private.set_updated_at();

create table public.lead_status_history (
  id              bigint generated always as identity primary key,
  business_id     uuid not null,
  lead_id         uuid not null,
  from_status_id  uuid,
  to_status_id    uuid not null,
  changed_by      uuid references public.profiles(id) on delete set null,
  changed_at      timestamptz not null default now(),
  foreign key (business_id, lead_id) references public.leads (business_id, id) on delete cascade
);
create index lead_status_history_lead_idx on public.lead_status_history (lead_id, changed_at);

create table public.lead_activities (
  id           bigint generated always as identity primary key,
  business_id  uuid not null,
  lead_id      uuid not null,
  type         text not null check (type ~ '^[a-z_]+$'),
  body         text,
  meta         jsonb not null default '{}',
  actor_id     uuid references public.profiles(id) on delete set null,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  foreign key (business_id, lead_id) references public.leads (business_id, id) on delete cascade
);
create index lead_activities_lead_idx on public.lead_activities (lead_id, occurred_at desc);

-- ---------------------------------------------------------------------
-- Public API keys and idempotency
-- ---------------------------------------------------------------------
create table public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 60),
  prefix        text not null,
  key_hash      text not null unique,
  created_by    uuid references public.profiles(id) on delete set null,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index api_keys_business_idx on public.api_keys (business_id, created_at desc);

create table public.api_idempotency_keys (
  business_id      uuid not null references public.businesses(id) on delete cascade,
  idempotency_key  text not null check (length(idempotency_key) between 1 and 200),
  request_hash     text not null,
  response         jsonb not null,
  created_at       timestamptz not null default now(),
  primary key (business_id, idempotency_key)
);

-- =====================================================================
-- Defaults seeded for every business
-- =====================================================================
create or replace function private.seed_business_defaults(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_statuses (business_id, key, name, category, stage, position, is_default) values
  -- BEGIN lead_statuses
    (p_business_id, 'new', 'New', 'open', 'new', 1, true),
    (p_business_id, 'contacted', 'Contacted', 'open', 'contacted', 2, false),
    (p_business_id, 'no_response', 'No response', 'open', 'contacted', 3, false),
    (p_business_id, 'interested', 'Interested', 'open', 'contacted', 4, false),
    (p_business_id, 'qualified', 'Qualified', 'open', 'qualified', 5, false),
    (p_business_id, 'appointment_booked', 'Appointment booked', 'open', 'qualified', 6, false),
    (p_business_id, 'visited', 'Visited store', 'open', 'qualified', 7, false),
    (p_business_id, 'quotation_sent', 'Quotation sent', 'open', 'negotiation', 8, false),
    (p_business_id, 'negotiation', 'Negotiation', 'open', 'negotiation', 9, false),
    (p_business_id, 'won', 'Converted', 'won', 'won', 10, false),
    (p_business_id, 'lost', 'Lost', 'lost', 'lost', 11, false),
    (p_business_id, 'invalid', 'Invalid or junk', 'lost', 'lost', 12, false)
  -- END lead_statuses
  on conflict (business_id, key) do nothing;

  insert into public.lead_sources (business_id, key, name, channel, position) values
    (p_business_id, 'meta_ads', 'Meta ads', 'meta', 1),
    (p_business_id, 'google_ads', 'Google ads', 'google', 2),
    (p_business_id, 'whatsapp', 'WhatsApp', 'whatsapp', 3),
    (p_business_id, 'website', 'Website', 'website', 4),
    (p_business_id, 'walk_in', 'Walk-in', 'walk_in', 5),
    (p_business_id, 'referral', 'Referral', 'referral', 6),
    (p_business_id, 'phone_call', 'Phone call', 'phone', 7),
    (p_business_id, 'instagram', 'Instagram', 'meta', 8),
    (p_business_id, 'other', 'Other', 'other', 9)
  on conflict (business_id, key) do nothing;
end;
$$;

create or replace function private.on_business_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_business_defaults(new.id);
  return new;
end;
$$;

create trigger businesses_seed_defaults after insert on public.businesses
  for each row execute function private.on_business_created();

select private.seed_business_defaults(id) from public.businesses;

-- =====================================================================
-- Access helpers
-- =====================================================================

-- Branch-scoped record visibility: unbranched records are business-wide.
create or replace function private.branch_visible(p_business_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_branch_id is null
      or p_branch_id in (select private.accessible_branch_ids(p_business_id));
$$;

create or replace function private.can_see_lead(p_business_id uuid, p_branch_id uuid, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.has_permission(p_business_id, 'leads.view_all')
          and private.branch_visible(p_business_id, p_branch_id))
      or (private.has_permission(p_business_id, 'leads.view_assigned')
          and p_owner_id = auth.uid());
$$;

create or replace function private.can_see_customer(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.customers c
     where c.id = p_customer_id
       and (
         (private.has_permission(c.business_id, 'customers.view_all')
          and private.branch_visible(c.business_id, c.branch_id))
         or (private.has_permission(c.business_id, 'customers.view_assigned')
             and (c.owner_id = auth.uid()
                  or exists (select 1 from public.leads l
                              where l.customer_id = c.id and l.owner_id = auth.uid())))
       )
  );
$$;

create or replace function private.can_edit_customer(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_see_customer(p_customer_id)
     and exists (select 1 from public.customers c
                  where c.id = p_customer_id
                    and c.merged_into_id is null
                    and private.has_permission(c.business_id, 'customers.edit'));
$$;

-- =====================================================================
-- History triggers
-- =====================================================================

-- Keep customers.primary_phone / primary_email in step with the contacts table.
create or replace function private.sync_primary_contacts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := coalesce(new.customer_id, old.customer_id);
begin
  update public.customers c
     set primary_phone = (select value from public.customer_contacts
                           where customer_id = v_customer and kind = 'phone'
                           order by is_primary desc, created_at, id limit 1),
         primary_email = (select value from public.customer_contacts
                           where customer_id = v_customer and kind = 'email'
                           order by is_primary desc, created_at, id limit 1)
   where c.id = v_customer;
  if tg_op = 'UPDATE' and old.customer_id <> new.customer_id then
    update public.customers c
       set primary_phone = (select value from public.customer_contacts
                             where customer_id = old.customer_id and kind = 'phone'
                             order by is_primary desc, created_at, id limit 1),
           primary_email = (select value from public.customer_contacts
                             where customer_id = old.customer_id and kind = 'email'
                             order by is_primary desc, created_at, id limit 1)
     where c.id = old.customer_id;
  end if;
  return null;
end;
$$;

create trigger customer_contacts_sync after insert or update or delete on public.customer_contacts
  for each row execute function private.sync_primary_contacts();

create or replace function private.log_contact_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.customer_events (business_id, customer_id, type, changes, actor_id)
    values (new.business_id, new.customer_id, 'contact_added',
            jsonb_build_object('kind', new.kind, 'value', new.value), auth.uid());
  elsif tg_op = 'DELETE' and exists (select 1 from public.customers where id = old.customer_id) then
    insert into public.customer_events (business_id, customer_id, type, changes, actor_id)
    values (old.business_id, old.customer_id, 'contact_removed',
            jsonb_build_object('kind', old.kind, 'value', old.value), auth.uid());
  end if;
  return null;
end;
$$;

create trigger customer_contacts_log after insert or delete on public.customer_contacts
  for each row execute function private.log_contact_change();

-- Every edit to a customer file lands on its timeline with a from/to diff.
create or replace function private.log_customer_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  diff jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.customer_events (business_id, customer_id, type, actor_id)
    values (new.business_id, new.id, 'created', auth.uid());
    return null;
  end if;

  select jsonb_object_agg(n.key, jsonb_build_object('from', to_jsonb(old) -> n.key, 'to', n.value))
    into diff
    from jsonb_each(to_jsonb(new)) n
   where n.value is distinct from to_jsonb(old) -> n.key
     and n.key not in ('updated_at', 'primary_phone', 'primary_email');
  if diff is not null then
    insert into public.customer_events (business_id, customer_id, type, changes, actor_id)
    values (new.business_id, new.id, 'updated', diff, auth.uid());
  end if;
  return null;
end;
$$;

create trigger customers_log after insert or update on public.customers
  for each row execute function private.log_customer_change();

-- Guard lead updates: assignment and archiving need their own permissions,
-- status must be this business's, branch must be one the user can access.
create or replace function private.guard_lead_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Internal writes (merge, API) run without a signed-in user.
  if auth.uid() is null then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
     and not private.has_permission(new.business_id, 'leads.assign') then
    raise exception 'not allowed to assign leads' using errcode = '42501';
  end if;
  if new.archived_at is distinct from old.archived_at
     and not private.has_permission(new.business_id, 'leads.delete') then
    raise exception 'not allowed to archive leads' using errcode = '42501';
  end if;
  if new.branch_id is distinct from old.branch_id
     and not private.branch_visible(new.business_id, new.branch_id) then
    raise exception 'branch not accessible' using errcode = '42501';
  end if;
  if new.owner_id is not null and new.owner_id is distinct from old.owner_id
     and not exists (select 1 from public.business_memberships m
                      where m.business_id = new.business_id and m.user_id = new.owner_id
                        and m.status = 'active') then
    raise exception 'owner must be an active member of the business' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger leads_guard before update on public.leads
  for each row execute function private.guard_lead_update();

-- Status history + timeline entries for every lead change.
create or replace function private.log_lead_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  diff jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.lead_status_history (business_id, lead_id, from_status_id, to_status_id, changed_by)
    values (new.business_id, new.id, null, new.status_id, auth.uid());
    insert into public.lead_activities (business_id, lead_id, type, meta, actor_id)
    values (new.business_id, new.id, 'created',
            jsonb_build_object('source_id', new.first_source_id, 'campaign', new.first_campaign,
                               'status_id', new.status_id),
            auth.uid());
    return null;
  end if;

  if new.status_id is distinct from old.status_id then
    insert into public.lead_status_history (business_id, lead_id, from_status_id, to_status_id, changed_by)
    values (new.business_id, new.id, old.status_id, new.status_id, auth.uid());
    insert into public.lead_activities (business_id, lead_id, type, meta, actor_id)
    values (new.business_id, new.id, 'status_changed',
            jsonb_build_object('from', old.status_id, 'to', new.status_id), auth.uid());
  end if;

  select jsonb_object_agg(n.key, jsonb_build_object('from', to_jsonb(old) -> n.key, 'to', n.value))
    into diff
    from jsonb_each(to_jsonb(new)) n
   where n.value is distinct from to_jsonb(old) -> n.key
     and n.key not in ('updated_at', 'last_activity_at', 'status_id',
                       'latest_source_id', 'latest_campaign', 'latest_touch');
  if diff is not null then
    insert into public.lead_activities (business_id, lead_id, type, meta, actor_id)
    values (new.business_id, new.id,
            case when diff ? 'archived_at' and new.archived_at is not null then 'archived'
                 when diff ? 'archived_at' then 'restored'
                 when diff ? 'customer_id' then 'customer_merged'
                 when diff ? 'owner_id' and (select count(*) from jsonb_object_keys(diff)) = 1 then 'assigned'
                 else 'updated' end,
            jsonb_build_object('changes', diff), auth.uid());
  end if;
  return null;
end;
$$;

create trigger leads_log after insert or update on public.leads
  for each row execute function private.log_lead_change();

create or replace function private.touch_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.leads set last_activity_at = greatest(last_activity_at, new.occurred_at)
   where id = new.lead_id and last_activity_at < new.occurred_at;
  return null;
end;
$$;

create trigger lead_activities_touch after insert on public.lead_activities
  for each row execute function private.touch_lead_activity();

-- Configuration tables are audited. Strip secrets from audit diffs.
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token_hash' - 'key_hash' end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token_hash' - 'key_hash' end;
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
       and n.key not in ('updated_at', 'last_used_at');
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

create trigger audit_lead_statuses after insert or update or delete on public.lead_statuses
  for each row execute function private.audit_row();
create trigger audit_lead_sources after insert or update or delete on public.lead_sources
  for each row execute function private.audit_row();
create trigger audit_custom_field_definitions after insert or update or delete on public.custom_field_definitions
  for each row execute function private.audit_row();
create trigger audit_api_keys after insert or update or delete on public.api_keys
  for each row execute function private.audit_row();
create trigger audit_tags after insert or update or delete on public.tags
  for each row execute function private.audit_row();

-- =====================================================================
-- Matching and lead creation
-- =====================================================================

-- Finds the customer for a phone (first) or email (second), or creates one.
-- Never matches on name. Fills in a missing phone/email on the matched file
-- only when no other file already owns it.
create or replace function private.match_or_create_customer(
  p_business_id uuid,
  p_phone text,
  p_email text,
  p_full_name text,
  p_branch_id uuid,
  p_actor uuid
)
returns table (customer_id uuid, created boolean, matched_on text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(trim(p_phone), '');
  v_email text := lower(nullif(trim(p_email), ''));
  v_customer uuid;
  v_matched text;
begin
  if v_phone is null and v_email is null then
    raise exception 'a phone number or email is required' using errcode = '23514';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'phone must be in E.164 format' using errcode = '22023';
  end if;

  -- Serialise concurrent submissions for the same contact.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || coalesce(v_phone, v_email), 0));

  if v_phone is not null then
    select cc.customer_id into v_customer from public.customer_contacts cc
     where cc.business_id = p_business_id and cc.kind = 'phone' and cc.value = v_phone;
    if found then v_matched := 'phone'; end if;
  end if;

  if v_customer is null and v_email is not null then
    select cc.customer_id into v_customer from public.customer_contacts cc
     where cc.business_id = p_business_id and cc.kind = 'email' and cc.value = v_email;
    if found then v_matched := 'email'; end if;
  end if;

  if v_customer is not null then
    -- Defensive: contacts move on merge, but follow the chain if one didn't.
    while exists (select 1 from public.customers c where c.id = v_customer and c.merged_into_id is not null) loop
      select c.merged_into_id into v_customer from public.customers c where c.id = v_customer;
    end loop;

    if v_phone is not null and v_matched = 'email' then
      insert into public.customer_contacts (business_id, customer_id, kind, value, created_by)
      values (p_business_id, v_customer, 'phone', v_phone, p_actor)
      on conflict (business_id, kind, value) do nothing;
    end if;
    if v_email is not null and v_matched = 'phone' then
      insert into public.customer_contacts (business_id, customer_id, kind, value, created_by)
      values (p_business_id, v_customer, 'email', v_email, p_actor)
      on conflict (business_id, kind, value) do nothing;
    end if;

    return query select v_customer, false, v_matched;
    return;
  end if;

  insert into public.customers (business_id, cif_number, full_name, branch_id, created_by)
  values (p_business_id, private.next_number(p_business_id, 'customer', 'CIF-'),
          coalesce(nullif(trim(p_full_name), ''), coalesce(v_phone, v_email)),
          p_branch_id, p_actor)
  returning id into v_customer;

  if v_phone is not null then
    insert into public.customer_contacts (business_id, customer_id, kind, value, is_primary, created_by)
    values (p_business_id, v_customer, 'phone', v_phone, true, p_actor);
  end if;
  if v_email is not null then
    insert into public.customer_contacts (business_id, customer_id, kind, value, is_primary, created_by)
    values (p_business_id, v_customer, 'email', v_email, true, p_actor)
    on conflict (business_id, kind, value) do nothing;
  end if;

  return query select v_customer, true, null::text;
end;
$$;

-- Shared by the app RPC and the public API. Input keys:
--   phone (E.164), email, full_name, customer_id, branch_id, owner_id,
--   source (key) or source_id, status_id, title, description, expected_value,
--   campaign, touch (object: utm_*, gclid, fbclid, ad ids, page url…),
--   custom_fields (object), reuse_open_lead (boolean)
create or replace function private.create_lead_internal(
  p_business_id uuid,
  p_input jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := nullif(p_input ->> 'customer_id', '')::uuid;
  v_created boolean := false;
  v_matched text;
  v_branch uuid := nullif(p_input ->> 'branch_id', '')::uuid;
  v_source uuid := nullif(p_input ->> 'source_id', '')::uuid;
  v_status uuid := nullif(p_input ->> 'status_id', '')::uuid;
  v_touch jsonb := coalesce(p_input -> 'touch', '{}');
  v_campaign text := nullif(trim(coalesce(p_input ->> 'campaign', v_touch ->> 'utm_campaign')), '');
  v_custom jsonb;
  v_lead public.leads;
  v_existing public.leads;
begin
  if jsonb_typeof(v_touch) <> 'object' then
    raise exception 'touch must be an object' using errcode = '22023';
  end if;
  if p_input ? 'custom_fields' and jsonb_typeof(p_input -> 'custom_fields') <> 'object' then
    raise exception 'custom_fields must be an object' using errcode = '22023';
  end if;
  -- Only keys defined (and active) for leads in this business are kept.
  select coalesce(jsonb_object_agg(e.key, e.value), '{}') into v_custom
    from jsonb_each(coalesce(p_input -> 'custom_fields', '{}')) e
   where exists (select 1 from public.custom_field_definitions d
                  where d.business_id = p_business_id and d.entity = 'lead'
                    and d.key = e.key and d.is_active);

  if v_customer is not null then
    if not exists (select 1 from public.customers c where c.id = v_customer
                    and c.business_id = p_business_id and c.merged_into_id is null) then
      raise exception 'customer not found' using errcode = 'P0002';
    end if;
  else
    select m.customer_id, m.created, m.matched_on into v_customer, v_created, v_matched
      from private.match_or_create_customer(
        p_business_id, p_input ->> 'phone', p_input ->> 'email',
        p_input ->> 'full_name', v_branch, p_actor) m;
  end if;

  if v_source is null and p_input ? 'source' then
    select id into v_source from public.lead_sources
     where business_id = p_business_id and key = p_input ->> 'source';
    if not found then
      raise exception 'unknown lead source %', p_input ->> 'source' using errcode = '22023';
    end if;
  elsif v_source is not null and not exists (
    select 1 from public.lead_sources where id = v_source and business_id = p_business_id) then
    raise exception 'unknown lead source' using errcode = '22023';
  end if;

  -- Repeat enquiry from an existing customer with an open lead: record it there.
  if coalesce((p_input ->> 'reuse_open_lead')::boolean, false) and not v_created then
    select l.* into v_existing from public.leads l
      join public.lead_statuses s on s.id = l.status_id
     where l.customer_id = v_customer and l.archived_at is null and s.category = 'open'
     order by l.created_at desc
     limit 1;
    if found then
      update public.leads
         set latest_source_id = coalesce(v_source, latest_source_id),
             latest_campaign = coalesce(v_campaign, latest_campaign),
             latest_touch = case when v_touch = '{}' then latest_touch else v_touch end
       where id = v_existing.id;
      insert into public.lead_activities (business_id, lead_id, type, body, meta, actor_id)
      values (p_business_id, v_existing.id, 'enquiry', nullif(trim(p_input ->> 'description'), ''),
              jsonb_build_object('source_id', v_source, 'campaign', v_campaign, 'touch', v_touch,
                                 'title', p_input ->> 'title'),
              p_actor);
      return jsonb_build_object(
        'lead_id', v_existing.id, 'lead_number', v_existing.lead_number,
        'customer_id', v_customer,
        'cif_number', (select cif_number from public.customers where id = v_customer),
        'customer_created', false, 'matched_on', v_matched, 'lead_created', false);
    end if;
  end if;

  if v_status is null then
    select id into v_status from public.lead_statuses
     where business_id = p_business_id and is_default;
  elsif not exists (select 1 from public.lead_statuses where id = v_status and business_id = p_business_id) then
    raise exception 'unknown lead status' using errcode = '22023';
  end if;

  insert into public.leads (
    business_id, lead_number, customer_id, branch_id, status_id, owner_id,
    title, description, expected_value,
    first_source_id, first_campaign, first_touch,
    latest_source_id, latest_campaign, latest_touch,
    custom_fields, created_by)
  values (
    p_business_id, private.next_number(p_business_id, 'lead', 'L-'), v_customer, v_branch, v_status,
    nullif(p_input ->> 'owner_id', '')::uuid,
    nullif(trim(p_input ->> 'title'), ''), nullif(trim(p_input ->> 'description'), ''),
    nullif(p_input ->> 'expected_value', '')::numeric(14,2),
    v_source, v_campaign, v_touch,
    v_source, v_campaign, v_touch,
    v_custom, p_actor)
  returning * into v_lead;

  return jsonb_build_object(
    'lead_id', v_lead.id, 'lead_number', v_lead.lead_number,
    'customer_id', v_customer,
    'cif_number', (select cif_number from public.customers where id = v_customer),
    'customer_created', v_created, 'matched_on', v_matched, 'lead_created', true);
end;
$$;

-- App entry point: manual lead creation by a signed-in member.
create or replace function public.create_lead(p_business_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_input jsonb := coalesce(p_input, '{}');
  v_branch uuid := nullif(v_input ->> 'branch_id', '')::uuid;
  v_owner uuid := nullif(v_input ->> 'owner_id', '')::uuid;
begin
  if not private.has_permission(p_business_id, 'leads.create') then
    raise exception 'not allowed to create leads' using errcode = '42501';
  end if;
  if v_branch is not null and not private.branch_visible(p_business_id, v_branch) then
    raise exception 'branch not accessible' using errcode = '42501';
  end if;
  if (v_input ? 'customer_id') and not private.can_see_customer(nullif(v_input ->> 'customer_id', '')::uuid) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  if v_owner is not null and v_owner <> v_user then
    if not private.has_permission(p_business_id, 'leads.assign') then
      raise exception 'not allowed to assign leads' using errcode = '42501';
    end if;
    if not exists (select 1 from public.business_memberships m
                    where m.business_id = p_business_id and m.user_id = v_owner and m.status = 'active') then
      raise exception 'owner must be an active member of the business' using errcode = '23514';
    end if;
  end if;
  -- Someone who only sees their own leads owns what they create.
  if v_owner is null and not private.has_permission(p_business_id, 'leads.view_all') then
    v_owner := v_user;
  end if;

  v_input := (v_input - 'reuse_open_lead') || jsonb_build_object('owner_id', v_owner);
  return private.create_lead_internal(p_business_id, v_input, v_user);
end;
$$;

-- Creates a customer file without a lead (matching applies).
create or replace function public.find_or_create_customer(
  p_business_id uuid,
  p_phone text,
  p_email text,
  p_full_name text,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not private.has_permission(p_business_id, 'customers.create') then
    raise exception 'not allowed to create customers' using errcode = '42501';
  end if;
  if p_branch_id is not null and not private.branch_visible(p_business_id, p_branch_id) then
    raise exception 'branch not accessible' using errcode = '42501';
  end if;
  select * into r from private.match_or_create_customer(
    p_business_id, p_phone, p_email, p_full_name, p_branch_id, auth.uid());
  if r.created and not private.has_permission(p_business_id, 'customers.view_all') then
    update public.customers set owner_id = auth.uid() where id = r.customer_id;
  end if;
  return jsonb_build_object(
    'customer_id', r.customer_id, 'created', r.created, 'matched_on', r.matched_on,
    'cif_number', (select cif_number from public.customers where id = r.customer_id),
    'visible', private.can_see_customer(r.customer_id));
end;
$$;

-- =====================================================================
-- Merge: fold a duplicate into a survivor, keeping all history
-- =====================================================================
create or replace function public.merge_customers(p_survivor_id uuid, p_duplicate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survivor public.customers;
  v_dup public.customers;
begin
  if p_survivor_id = p_duplicate_id then
    raise exception 'cannot merge a customer into itself' using errcode = '23514';
  end if;

  select * into v_survivor from public.customers where id = p_survivor_id for update;
  select * into v_dup from public.customers where id = p_duplicate_id for update;
  if v_survivor.id is null or v_dup.id is null or v_survivor.business_id <> v_dup.business_id then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if not private.has_permission(v_survivor.business_id, 'customers.merge')
     or not private.can_see_customer(v_survivor.id) or not private.can_see_customer(v_dup.id) then
    raise exception 'not allowed to merge customers' using errcode = '42501';
  end if;
  if v_survivor.merged_into_id is not null or v_dup.merged_into_id is not null then
    raise exception 'customer was already merged' using errcode = '23514';
  end if;

  insert into public.customer_merges (business_id, survivor_id, merged_id, snapshot, merged_by)
  values (v_survivor.business_id, v_survivor.id, v_dup.id,
          jsonb_build_object(
            'customer', to_jsonb(v_dup),
            'contacts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.customer_contacts c where c.customer_id = v_dup.id),
            'addresses', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.customer_addresses a where a.customer_id = v_dup.id),
            'leads', (select coalesce(jsonb_agg(l.id), '[]') from public.leads l where l.customer_id = v_dup.id)),
          auth.uid());

  -- Fill gaps on the survivor; never overwrite what it already has.
  update public.customers
     set gender = coalesce(gender, v_dup.gender),
         date_of_birth = coalesce(date_of_birth, v_dup.date_of_birth),
         preferred_language = coalesce(preferred_language, v_dup.preferred_language),
         branch_id = coalesce(branch_id, v_dup.branch_id),
         owner_id = coalesce(owner_id, v_dup.owner_id),
         custom_fields = v_dup.custom_fields || custom_fields
   where id = v_survivor.id;

  update public.customer_contacts set customer_id = v_survivor.id, is_primary = false
   where customer_id = v_dup.id;
  update public.customer_addresses set customer_id = v_survivor.id, is_default = false
   where customer_id = v_dup.id;
  insert into public.customer_tags (business_id, customer_id, tag_id)
  select business_id, v_survivor.id, tag_id from public.customer_tags where customer_id = v_dup.id
  on conflict do nothing;
  delete from public.customer_tags where customer_id = v_dup.id;
  update public.customer_consents set customer_id = v_survivor.id where customer_id = v_dup.id;
  update public.customer_attachments set customer_id = v_survivor.id where customer_id = v_dup.id;
  update public.customer_events set customer_id = v_survivor.id where customer_id = v_dup.id;
  update public.leads set customer_id = v_survivor.id where customer_id = v_dup.id;

  update public.customers set merged_into_id = v_survivor.id, merged_at = now()
   where id = v_dup.id;

  insert into public.customer_events (business_id, customer_id, type, body, changes, actor_id)
  values (v_survivor.business_id, v_survivor.id, 'merged',
          format('Merged %s (%s) into this file', v_dup.cif_number, v_dup.full_name),
          jsonb_build_object('merged_id', v_dup.id, 'merged_cif', v_dup.cif_number), auth.uid());

  return v_survivor.id;
end;
$$;

-- =====================================================================
-- Public API (website forms): authenticated by a per-business API key
-- =====================================================================
create or replace function public.create_api_key(p_business_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'sk_live_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage API keys' using errcode = '42501';
  end if;
  insert into public.api_keys (business_id, name, prefix, key_hash, created_by)
  values (p_business_id, p_name, left(v_key, 12), private.hash_token(v_key), auth.uid());
  return v_key;
end;
$$;

-- Resolves an API key to its business (for phone normalisation by country).
create or replace function public.api_key_business(p_api_key text)
returns table (business_id uuid, country_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.country_code::text
    from public.api_keys k
    join public.businesses b on b.id = k.business_id
   where k.key_hash = private.hash_token(p_api_key)
     and k.revoked_at is null
     and b.status = 'active';
$$;

create or replace function public.api_submit_lead(
  p_api_key text,
  p_idempotency_key text,
  p_request_hash text,
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys;
  v_prior public.api_idempotency_keys;
  v_input jsonb := coalesce(p_input, '{}');
  v_result jsonb;
begin
  select k.* into v_key from public.api_keys k
    join public.businesses b on b.id = k.business_id
   where k.key_hash = private.hash_token(p_api_key)
     and k.revoked_at is null and b.status = 'active';
  if not found then
    raise exception 'invalid api key' using errcode = '28000';
  end if;

  update public.api_keys set last_used_at = now() where id = v_key.id;

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_key.business_id::text || p_idempotency_key, 1));
    select * into v_prior from public.api_idempotency_keys
     where business_id = v_key.business_id and idempotency_key = p_idempotency_key;
    if found then
      if v_prior.request_hash <> p_request_hash then
        raise exception 'idempotency key reused with a different request' using errcode = 'P0409';
      end if;
      return v_prior.response || jsonb_build_object('replayed', true);
    end if;
  end if;

  -- The API never chooses owner, status, branch or an existing customer id.
  v_input := (v_input - 'owner_id' - 'status_id' - 'customer_id' - 'source_id' - 'branch_id')
             || jsonb_build_object('reuse_open_lead', true);
  if not v_input ? 'source' then
    v_input := v_input || jsonb_build_object('source', 'website');
  end if;

  v_result := private.create_lead_internal(v_key.business_id, v_input, null);

  if p_idempotency_key is not null then
    insert into public.api_idempotency_keys (business_id, idempotency_key, request_hash, response)
    values (v_key.business_id, p_idempotency_key, p_request_hash, v_result);
  end if;
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

revoke execute on function public.create_lead(uuid, jsonb) from public, anon;
revoke execute on function public.find_or_create_customer(uuid, text, text, text, uuid) from public, anon;
revoke execute on function public.merge_customers(uuid, uuid) from public, anon;
revoke execute on function public.create_api_key(uuid, text) from public, anon;
revoke execute on function public.api_key_business(text) from public;
revoke execute on function public.api_submit_lead(text, text, text, jsonb) from public;
grant execute on function public.create_lead(uuid, jsonb) to authenticated;
grant execute on function public.find_or_create_customer(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.merge_customers(uuid, uuid) to authenticated;
grant execute on function public.create_api_key(uuid, text) to authenticated;
grant execute on function public.api_key_business(text) to anon, authenticated;
grant execute on function public.api_submit_lead(text, text, text, jsonb) to anon, authenticated;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.customers                enable row level security;
alter table public.customer_contacts        enable row level security;
alter table public.customer_addresses       enable row level security;
alter table public.tags                     enable row level security;
alter table public.customer_tags            enable row level security;
alter table public.customer_consents        enable row level security;
alter table public.customer_events          enable row level security;
alter table public.customer_attachments     enable row level security;
alter table public.customer_merges          enable row level security;
alter table public.lead_sources             enable row level security;
alter table public.lead_statuses            enable row level security;
alter table public.custom_field_definitions enable row level security;
alter table public.leads                    enable row level security;
alter table public.lead_status_history      enable row level security;
alter table public.lead_activities          enable row level security;
alter table public.api_keys                 enable row level security;
alter table public.api_idempotency_keys     enable row level security;

-- customers: created through find_or_create_customer() / create_lead() only.
create policy customers_select on public.customers for select to authenticated
  using (private.is_member(business_id) and private.can_see_customer(id));
create policy customers_update on public.customers for update to authenticated
  using (private.can_edit_customer(id))
  with check (private.has_permission(business_id, 'customers.edit')
              and private.branch_visible(business_id, branch_id));
revoke insert, update, delete on public.customers from authenticated, anon;
grant update (full_name, gender, date_of_birth, preferred_language, branch_id, custom_fields)
  on public.customers to authenticated;

create policy contacts_select on public.customer_contacts for select to authenticated
  using (private.can_see_customer(customer_id));
create policy contacts_insert on public.customer_contacts for insert to authenticated
  with check (private.can_edit_customer(customer_id)
              and exists (select 1 from public.customers c where c.id = customer_id and c.business_id = customer_contacts.business_id));
create policy contacts_update on public.customer_contacts for update to authenticated
  using (private.can_edit_customer(customer_id)) with check (private.can_edit_customer(customer_id));
create policy contacts_delete on public.customer_contacts for delete to authenticated
  using (private.can_edit_customer(customer_id));
revoke update on public.customer_contacts from authenticated, anon;
grant update (label, is_primary) on public.customer_contacts to authenticated;

create policy addresses_select on public.customer_addresses for select to authenticated
  using (private.can_see_customer(customer_id));
create policy addresses_write on public.customer_addresses for all to authenticated
  using (private.can_edit_customer(customer_id))
  with check (private.can_edit_customer(customer_id)
              and exists (select 1 from public.customers c where c.id = customer_id and c.business_id = customer_addresses.business_id));

create policy tags_select on public.tags for select to authenticated
  using (private.is_member(business_id));
create policy tags_insert on public.tags for insert to authenticated
  with check (private.has_permission(business_id, 'customers.edit'));
create policy tags_update on public.tags for update to authenticated
  using (private.has_permission(business_id, 'customers.edit'))
  with check (private.has_permission(business_id, 'customers.edit'));
create policy tags_delete on public.tags for delete to authenticated
  using (private.has_permission(business_id, 'customers.edit'));

create policy customer_tags_select on public.customer_tags for select to authenticated
  using (private.can_see_customer(customer_id));
create policy customer_tags_write on public.customer_tags for all to authenticated
  using (private.can_edit_customer(customer_id))
  with check (private.can_edit_customer(customer_id));

-- Consent and events are append-only.
create policy consents_select on public.customer_consents for select to authenticated
  using (private.can_see_customer(customer_id));
create policy consents_insert on public.customer_consents for insert to authenticated
  with check (private.can_edit_customer(customer_id) and captured_by = auth.uid()
              and exists (select 1 from public.customers c where c.id = customer_id and c.business_id = customer_consents.business_id));
revoke update, delete on public.customer_consents from authenticated, anon;

create policy events_select on public.customer_events for select to authenticated
  using (private.can_see_customer(customer_id));
create policy events_insert_note on public.customer_events for insert to authenticated
  with check (type = 'note' and actor_id = auth.uid() and changes is null
              and private.can_edit_customer(customer_id)
              and exists (select 1 from public.customers c where c.id = customer_id and c.business_id = customer_events.business_id));
revoke update, delete on public.customer_events from authenticated, anon;

create policy attachments_select on public.customer_attachments for select to authenticated
  using (private.can_see_customer(customer_id));
create policy attachments_insert on public.customer_attachments for insert to authenticated
  with check (private.can_edit_customer(customer_id) and uploaded_by = auth.uid()
              and exists (select 1 from public.customers c where c.id = customer_id and c.business_id = customer_attachments.business_id));
create policy attachments_delete on public.customer_attachments for delete to authenticated
  using (private.can_edit_customer(customer_id));
revoke update on public.customer_attachments from authenticated, anon;

create policy merges_select on public.customer_merges for select to authenticated
  using (private.has_permission(business_id, 'customers.merge') or private.can_see_customer(survivor_id));
revoke insert, update, delete on public.customer_merges from authenticated, anon;

-- Lead configuration: readable by members, managed with settings.pipeline.manage.
create policy lead_sources_select on public.lead_sources for select to authenticated
  using (private.is_member(business_id));
create policy lead_sources_write on public.lead_sources for all to authenticated
  using (private.has_permission(business_id, 'settings.pipeline.manage'))
  with check (private.has_permission(business_id, 'settings.pipeline.manage'));

create policy lead_statuses_select on public.lead_statuses for select to authenticated
  using (private.is_member(business_id));
create policy lead_statuses_write on public.lead_statuses for all to authenticated
  using (private.has_permission(business_id, 'settings.pipeline.manage'))
  with check (private.has_permission(business_id, 'settings.pipeline.manage'));

create policy cfd_select on public.custom_field_definitions for select to authenticated
  using (private.is_member(business_id));
create policy cfd_write on public.custom_field_definitions for all to authenticated
  using (private.has_permission(business_id, 'settings.custom_fields.manage'))
  with check (private.has_permission(business_id, 'settings.custom_fields.manage'));

-- leads: created through create_lead() only; archived, never deleted.
create policy leads_select on public.leads for select to authenticated
  using (private.is_member(business_id) and private.can_see_lead(business_id, branch_id, owner_id));
create policy leads_update on public.leads for update to authenticated
  using (private.has_permission(business_id, 'leads.edit')
         and private.can_see_lead(business_id, branch_id, owner_id))
  with check (private.has_permission(business_id, 'leads.edit'));
revoke insert, update, delete on public.leads from authenticated, anon;
grant update (status_id, branch_id, owner_id, title, description, expected_value, custom_fields, archived_at)
  on public.leads to authenticated;

create policy lsh_select on public.lead_status_history for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
revoke insert, update, delete on public.lead_status_history from authenticated, anon;

create policy activities_select on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
-- Members log their own notes, calls and visits; system types come from triggers.
create policy activities_insert on public.lead_activities for insert to authenticated
  with check (actor_id = auth.uid()
              and type in ('note', 'call', 'whatsapp', 'email', 'meeting', 'visit')
              and private.has_permission(business_id, 'leads.edit')
              and exists (select 1 from public.leads l where l.id = lead_id and l.business_id = lead_activities.business_id));
revoke update, delete on public.lead_activities from authenticated, anon;

create policy api_keys_select on public.api_keys for select to authenticated
  using (private.has_permission(business_id, 'integrations.manage'));
create policy api_keys_revoke on public.api_keys for update to authenticated
  using (private.has_permission(business_id, 'integrations.manage'))
  with check (private.has_permission(business_id, 'integrations.manage'));
revoke insert, update, delete on public.api_keys from authenticated, anon;
grant update (revoked_at) on public.api_keys to authenticated;
revoke select on public.api_keys from authenticated, anon;
grant select (id, business_id, name, prefix, created_by, last_used_at, revoked_at, created_at)
  on public.api_keys to authenticated;

-- Idempotency records are internal to the API.
revoke all on public.api_idempotency_keys from authenticated, anon;

-- The anon role must never read tenant tables directly.
revoke all on public.customers, public.customer_contacts, public.customer_addresses, public.tags,
  public.customer_tags, public.customer_consents, public.customer_events, public.customer_attachments,
  public.customer_merges, public.lead_sources, public.lead_statuses, public.custom_field_definitions,
  public.leads, public.lead_status_history, public.lead_activities, public.api_keys,
  public.customer_consent_state
  from anon;

grant execute on all functions in schema private to authenticated, service_role;

-- =====================================================================
-- Storage for customer attachments (Supabase only; skipped on plain Postgres)
-- Path: <business_id>/<customer_id>/<file>
-- =====================================================================
-- Path segment n as a uuid, or null. CASE guarantees the regex runs before the cast,
-- so objects in other buckets with non-uuid paths never raise.
create or replace function private.path_uuid(p_name text, p_index int)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(p_name, '/', p_index) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', p_index)::uuid
  end;
$$;

-- Does a storage path <business>/<customer>/<file> point at a customer of that business?
create or replace function private.customer_file_path_ok(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.customers c
     where c.id = private.path_uuid(p_name, 2)
       and c.business_id = private.path_uuid(p_name, 1)
  );
$$;

grant execute on function private.path_uuid(text, int) to authenticated, service_role;
grant execute on function private.customer_file_path_ok(text) to authenticated, service_role;

do $storage$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping customer-files bucket';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('customer-files', 'customer-files', false, 10485760)
  on conflict (id) do nothing;

  execute $p$
    create policy customer_files_select on storage.objects for select to authenticated
      using (case when bucket_id = 'customer-files'
                  then private.customer_file_path_ok(name)
                       and private.can_see_customer(private.path_uuid(name, 2))
                  else false end)
  $p$;
  execute $p$
    create policy customer_files_insert on storage.objects for insert to authenticated
      with check (case when bucket_id = 'customer-files'
                       then private.customer_file_path_ok(name)
                            and private.can_edit_customer(private.path_uuid(name, 2))
                       else false end)
  $p$;
  execute $p$
    create policy customer_files_delete on storage.objects for delete to authenticated
      using (case when bucket_id = 'customer-files'
                  then private.customer_file_path_ok(name)
                       and private.can_edit_customer(private.path_uuid(name, 2))
                  else false end)
  $p$;
end
$storage$;
