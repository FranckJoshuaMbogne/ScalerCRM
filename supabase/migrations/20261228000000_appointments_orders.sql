-- =====================================================================
-- Sprint 4: appointments & walk-ins, catalogue, quotations, orders,
-- payments, tailoring measurements, customer purchase history.
--
-- Money is numeric(14,2). Line amounts are generated columns, document
-- totals are kept by triggers, and an order's balance is always computed
-- from its payments (never stored).
-- =====================================================================

-- Supabase linter: pin search_path on the remaining helper functions.
alter function private.set_updated_at() set search_path = '';
alter function private.hash_token(text) set search_path = '';
alter function private.path_uuid(text, int) set search_path = '';

-- ---------------------------------------------------------------------
-- New permission
-- ---------------------------------------------------------------------
insert into public.permissions (key, module, description) values
-- BEGIN permissions
  ('settings.orders.manage', 'settings', 'Configure the catalogue, fulfilment stages and measurement templates')
-- END permissions
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'settings.orders.manage' from public.roles r
 where r.business_id is null and r.key in ('business_admin', 'store_manager')
on conflict do nothing;

-- Orders get custom fields too (used by the tailoring extension).
alter type public.custom_field_entity add value if not exists 'order';

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.appointment_kind as enum
  ('consultation', 'measurement', 'trial', 'alteration', 'delivery', 'other');
create type public.appointment_status as enum
  ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled');
create type public.catalog_item_kind as enum ('product', 'service');
create type public.order_stage_category as enum ('open', 'done', 'cancelled');
create type public.quotation_status as enum ('draft', 'sent', 'accepted', 'declined', 'expired');
create type public.payment_kind as enum ('payment', 'refund');
create type public.payment_method as enum ('cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other');

-- ---------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------
create table public.appointments (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  branch_id           uuid,
  customer_id         uuid not null,
  lead_id             uuid,
  order_id            uuid,
  kind                public.appointment_kind not null default 'consultation',
  title               text check (length(title) <= 160),
  notes               text check (length(notes) <= 4000),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  staff_id            uuid references public.profiles(id) on delete set null,
  status              public.appointment_status not null default 'scheduled',
  status_changed_at   timestamptz,
  reminder_sent_at    timestamptz,
  outcome_prompted_at timestamptz,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, id),
  check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours'),
  foreign key (business_id, branch_id) references public.branches (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, lead_id) references public.leads (business_id, id)
);
create index appointments_calendar_idx on public.appointments (business_id, starts_at);
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
create index appointments_due_idx on public.appointments (starts_at) where status in ('scheduled', 'confirmed');
create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();

create table public.appointment_status_history (
  id              bigint generated always as identity primary key,
  business_id     uuid not null,
  appointment_id  uuid not null,
  from_status     public.appointment_status,
  to_status       public.appointment_status not null,
  changed_by      uuid references public.profiles(id) on delete set null,
  changed_at      timestamptz not null default now(),
  foreign key (business_id, appointment_id) references public.appointments (business_id, id) on delete cascade
);
create index appointment_status_history_idx on public.appointment_status_history (appointment_id, changed_at);

-- Every walk-in is recorded, linked to the customer file and the lead it touched.
create table public.walk_ins (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  branch_id    uuid,
  customer_id  uuid not null,
  lead_id      uuid,
  staff_id     uuid references public.profiles(id) on delete set null,
  purpose      text check (length(purpose) <= 160),
  notes        text check (length(notes) <= 4000),
  visited_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (business_id, branch_id) references public.branches (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, lead_id) references public.leads (business_id, id)
);
create index walk_ins_business_idx on public.walk_ins (business_id, visited_at desc);
create index walk_ins_customer_idx on public.walk_ins (customer_id);

-- ---------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------
create table public.catalog_items (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  kind         public.catalog_item_kind not null default 'product',
  sku          text check (length(sku) <= 40),
  name         text not null check (length(trim(name)) between 1 and 120),
  category     text check (length(category) <= 60),
  description  text check (length(description) <= 2000),
  unit_price   numeric(14,2) not null default 0 check (unit_price >= 0),
  tax_rate     numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, id)
);
create unique index catalog_items_sku_unique on public.catalog_items (business_id, lower(sku)) where sku is not null;
create index catalog_items_business_idx on public.catalog_items (business_id, lower(name));
create trigger catalog_items_updated_at before update on public.catalog_items
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Tailoring: measurement templates and measurement records
-- ---------------------------------------------------------------------
create table public.measurement_templates (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  garment      text not null check (length(trim(garment)) between 1 and 60),
  -- [{ "key": "chest", "label": "Chest" }, …]
  fields       jsonb not null check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) between 1 and 40),
  position     int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, id)
);
create unique index measurement_templates_garment_unique on public.measurement_templates (business_id, lower(garment));
create trigger measurement_templates_updated_at before update on public.measurement_templates
  for each row execute function private.set_updated_at();

-- Each measurement session is a new row: history is kept, never overwritten.
create table public.customer_measurements (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  customer_id  uuid not null,
  garment      text not null check (length(trim(garment)) between 1 and 60),
  unit         text not null default 'in' check (unit in ('in', 'cm')),
  -- { "chest": 40.5, "waist": 34 }
  readings     jsonb not null check (jsonb_typeof(readings) = 'object'),
  notes        text check (length(notes) <= 2000),
  taken_by     uuid references public.profiles(id) on delete set null,
  taken_at     timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id)
);
create index customer_measurements_customer_idx on public.customer_measurements (customer_id, garment, taken_at desc);

-- ---------------------------------------------------------------------
-- Fulfilment stages (configurable per business)
-- ---------------------------------------------------------------------
create table public.order_stages (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  key          text not null check (key ~ '^[a-z0-9_]+$'),
  name         text not null check (length(trim(name)) between 1 and 60),
  category     public.order_stage_category not null default 'open',
  position     int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, id)
);
create trigger order_stages_updated_at before update on public.order_stages
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------
create table public.quotations (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  quotation_number  text not null,
  customer_id       uuid not null,
  lead_id           uuid,
  branch_id         uuid,
  owner_id          uuid references public.profiles(id) on delete set null,
  status            public.quotation_status not null default 'draft',
  valid_until       date,
  notes             text check (length(notes) <= 4000),
  subtotal          numeric(14,2) not null default 0,
  discount_total    numeric(14,2) not null default 0,
  tax_total         numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  order_id          uuid,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, quotation_number),
  unique (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, lead_id) references public.leads (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id)
);
create index quotations_business_idx on public.quotations (business_id, created_at desc);
create index quotations_customer_idx on public.quotations (customer_id);
create trigger quotations_updated_at before update on public.quotations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  order_number    text not null,
  customer_id     uuid not null,
  lead_id         uuid,
  quotation_id    uuid,
  branch_id       uuid,
  owner_id        uuid references public.profiles(id) on delete set null,
  stage_id        uuid not null,
  due_date        date,
  notes           text check (length(notes) <= 4000),
  subtotal        numeric(14,2) not null default 0,
  discount_total  numeric(14,2) not null default 0,
  tax_total       numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  custom_fields   jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object'),
  closed_at       timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, order_number),
  unique (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, lead_id) references public.leads (business_id, id),
  foreign key (business_id, quotation_id) references public.quotations (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id),
  foreign key (business_id, stage_id) references public.order_stages (business_id, id)
);
create index orders_business_idx on public.orders (business_id, created_at desc);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_stage_idx on public.orders (business_id, stage_id);
create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

alter table public.quotations
  add constraint quotations_order_fk foreign key (business_id, order_id) references public.orders (business_id, id);
alter table public.appointments
  add constraint appointments_order_fk foreign key (business_id, order_id) references public.orders (business_id, id);

create table public.order_status_history (
  id             bigint generated always as identity primary key,
  business_id    uuid not null,
  order_id       uuid not null,
  from_stage_id  uuid,
  to_stage_id    uuid not null,
  note           text,
  changed_by     uuid references public.profiles(id) on delete set null,
  changed_at     timestamptz not null default now(),
  foreign key (business_id, order_id) references public.orders (business_id, id) on delete cascade
);
create index order_status_history_idx on public.order_status_history (order_id, changed_at);

-- Line items. Amounts are generated, so a line can never disagree with itself.
-- gross = qty × price; tax applies after the line discount.
create table public.quotation_items (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  quotation_id     uuid not null,
  position         int not null default 0,
  catalog_item_id  uuid,
  description      text not null check (length(trim(description)) between 1 and 300),
  quantity         numeric(12,3) not null default 1 check (quantity > 0),
  unit_price       numeric(14,2) not null check (unit_price >= 0),
  discount         numeric(14,2) not null default 0 check (discount >= 0),
  tax_rate         numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  gross            numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  tax_amount       numeric(14,2) generated always as (round((round(quantity * unit_price, 2) - discount) * tax_rate / 100, 2)) stored,
  line_total       numeric(14,2) generated always as
                     (round(quantity * unit_price, 2) - discount
                      + round((round(quantity * unit_price, 2) - discount) * tax_rate / 100, 2)) stored,
  garment          text check (length(garment) <= 60),
  fabric           text check (length(fabric) <= 120),
  measurement_id   uuid,
  check (discount <= round(quantity * unit_price, 2)),
  foreign key (business_id, quotation_id) references public.quotations (business_id, id) on delete cascade,
  foreign key (business_id, catalog_item_id) references public.catalog_items (business_id, id),
  foreign key (business_id, measurement_id) references public.customer_measurements (business_id, id)
);
create index quotation_items_parent_idx on public.quotation_items (quotation_id, position);

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  order_id         uuid not null,
  position         int not null default 0,
  catalog_item_id  uuid,
  description      text not null check (length(trim(description)) between 1 and 300),
  quantity         numeric(12,3) not null default 1 check (quantity > 0),
  unit_price       numeric(14,2) not null check (unit_price >= 0),
  discount         numeric(14,2) not null default 0 check (discount >= 0),
  tax_rate         numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  gross            numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  tax_amount       numeric(14,2) generated always as (round((round(quantity * unit_price, 2) - discount) * tax_rate / 100, 2)) stored,
  line_total       numeric(14,2) generated always as
                     (round(quantity * unit_price, 2) - discount
                      + round((round(quantity * unit_price, 2) - discount) * tax_rate / 100, 2)) stored,
  garment          text check (length(garment) <= 60),
  fabric           text check (length(fabric) <= 120),
  measurement_id   uuid,
  check (discount <= round(quantity * unit_price, 2)),
  foreign key (business_id, order_id) references public.orders (business_id, id) on delete cascade,
  foreign key (business_id, catalog_item_id) references public.catalog_items (business_id, id),
  foreign key (business_id, measurement_id) references public.customer_measurements (business_id, id)
);
create index order_items_parent_idx on public.order_items (order_id, position);

-- ---------------------------------------------------------------------
-- Payments: an append-only ledger per order
-- ---------------------------------------------------------------------
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null,
  order_id        uuid not null,
  customer_id     uuid not null,
  receipt_number  text not null,
  kind            public.payment_kind not null default 'payment',
  amount          numeric(14,2) not null check (amount > 0),
  method          public.payment_method not null default 'cash',
  reference       text check (length(reference) <= 120),
  notes           text check (length(notes) <= 1000),
  received_at     timestamptz not null default now(),
  recorded_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (business_id, receipt_number),
  foreign key (business_id, order_id) references public.orders (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id)
);
create index payments_order_idx on public.payments (order_id, received_at);
create index payments_business_idx on public.payments (business_id, received_at desc);

-- =====================================================================
-- Defaults for every business
-- =====================================================================
create or replace function private.seed_order_defaults(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.order_stages (business_id, key, name, category, position) values
    (p_business_id, 'confirmed', 'Confirmed', 'open', 1),
    (p_business_id, 'in_production', 'In production', 'open', 2),
    (p_business_id, 'trial', 'Trial', 'open', 3),
    (p_business_id, 'alterations', 'Alterations', 'open', 4),
    (p_business_id, 'ready', 'Ready for pickup', 'open', 5),
    (p_business_id, 'delivered', 'Delivered', 'done', 6),
    (p_business_id, 'cancelled', 'Cancelled', 'cancelled', 7)
  on conflict (business_id, key) do nothing;

  insert into public.measurement_templates (business_id, garment, fields, position) values
    (p_business_id, 'Shirt', '[{"key":"neck","label":"Neck"},{"key":"chest","label":"Chest"},{"key":"waist","label":"Waist"},{"key":"seat","label":"Seat"},{"key":"shoulder","label":"Shoulder"},{"key":"sleeve","label":"Sleeve"},{"key":"length","label":"Length"}]', 1),
    (p_business_id, 'Trousers', '[{"key":"waist","label":"Waist"},{"key":"seat","label":"Seat"},{"key":"thigh","label":"Thigh"},{"key":"knee","label":"Knee"},{"key":"bottom","label":"Bottom"},{"key":"inseam","label":"Inseam"},{"key":"length","label":"Length"}]', 2),
    (p_business_id, 'Suit jacket', '[{"key":"chest","label":"Chest"},{"key":"waist","label":"Waist"},{"key":"seat","label":"Seat"},{"key":"shoulder","label":"Shoulder"},{"key":"sleeve","label":"Sleeve"},{"key":"back_length","label":"Back length"}]', 3),
    (p_business_id, 'Sherwani', '[{"key":"neck","label":"Neck"},{"key":"chest","label":"Chest"},{"key":"waist","label":"Waist"},{"key":"seat","label":"Seat"},{"key":"shoulder","label":"Shoulder"},{"key":"sleeve","label":"Sleeve"},{"key":"length","label":"Length"}]', 4)
  on conflict do nothing;
end;
$$;

create or replace function private.on_business_created_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_order_defaults(new.id);
  return new;
end;
$$;

create trigger businesses_seed_order_defaults after insert on public.businesses
  for each row execute function private.on_business_created_orders();

select private.seed_order_defaults(id) from public.businesses;

-- =====================================================================
-- Access helpers
-- =====================================================================
create or replace function private.can_see_order(p_business_id uuid, p_branch_id uuid, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.has_permission(p_business_id, 'orders.view_all')
          and private.branch_visible(p_business_id, p_branch_id))
      or (private.has_permission(p_business_id, 'orders.view_assigned')
          and p_owner_id = auth.uid());
$$;

create or replace function private.can_see_appointment(p_business_id uuid, p_branch_id uuid, p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_business_id, 'appointments.view')
     and (private.branch_visible(p_business_id, p_branch_id) or p_staff_id = auth.uid());
$$;

-- Paid and refunded so far on one order. Definer so a balance can be shown to
-- anyone who can see the order, while payment rows need payments.view.
create or replace function private.order_payment_totals(p_order_id uuid, out paid numeric, out refunded numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount) filter (where kind = 'payment'), 0)::numeric(14,2),
         coalesce(sum(amount) filter (where kind = 'refund'), 0)::numeric(14,2)
    from public.payments where order_id = p_order_id;
$$;

-- =====================================================================
-- Totals: documents are the sum of their lines
-- =====================================================================
create or replace function private.refresh_document_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'order_items' then
    v_id := coalesce(new.order_id, old.order_id);
    update public.orders o
       set subtotal = t.subtotal, discount_total = t.discount_total, tax_total = t.tax_total, total = t.total
      from (select coalesce(sum(gross), 0) subtotal, coalesce(sum(discount), 0) discount_total,
                   coalesce(sum(tax_amount), 0) tax_total, coalesce(sum(line_total), 0) total
              from public.order_items where order_id = v_id) t
     where o.id = v_id
       and (o.subtotal, o.discount_total, o.tax_total, o.total)
           is distinct from (t.subtotal, t.discount_total, t.tax_total, t.total);
  else
    v_id := coalesce(new.quotation_id, old.quotation_id);
    update public.quotations q
       set subtotal = t.subtotal, discount_total = t.discount_total, tax_total = t.tax_total, total = t.total
      from (select coalesce(sum(gross), 0) subtotal, coalesce(sum(discount), 0) discount_total,
                   coalesce(sum(tax_amount), 0) tax_total, coalesce(sum(line_total), 0) total
              from public.quotation_items where quotation_id = v_id) t
     where q.id = v_id
       and (q.subtotal, q.discount_total, q.tax_total, q.total)
           is distinct from (t.subtotal, t.discount_total, t.tax_total, t.total);
  end if;
  return null;
end;
$$;

create trigger order_items_totals after insert or update or delete on public.order_items
  for each row execute function private.refresh_document_totals();
create trigger quotation_items_totals after insert or update or delete on public.quotation_items
  for each row execute function private.refresh_document_totals();

-- Inserts one set of line items from JSON. Input keys per line:
-- catalog_item_id, description, quantity, unit_price, discount, tax_rate, garment, fabric, measurement_id.
create or replace function private.insert_document_items(p_business_id uuid, p_kind text, p_parent_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' then
    raise exception 'items must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) > 100 then
    raise exception 'too many line items' using errcode = '22023';
  end if;

  if p_kind = 'order' then
    insert into public.order_items
      (business_id, order_id, position, catalog_item_id, description, quantity, unit_price, discount, tax_rate,
       garment, fabric, measurement_id)
    select p_business_id, p_parent_id, i.n::int, nullif(i.v ->> 'catalog_item_id', '')::uuid,
           trim(i.v ->> 'description'), coalesce(nullif(i.v ->> 'quantity', '')::numeric, 1),
           coalesce(nullif(i.v ->> 'unit_price', '')::numeric, 0), coalesce(nullif(i.v ->> 'discount', '')::numeric, 0),
           coalesce(nullif(i.v ->> 'tax_rate', '')::numeric, 0),
           nullif(trim(i.v ->> 'garment'), ''), nullif(trim(i.v ->> 'fabric'), ''),
           nullif(i.v ->> 'measurement_id', '')::uuid
      from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality i(v, n);
  else
    insert into public.quotation_items
      (business_id, quotation_id, position, catalog_item_id, description, quantity, unit_price, discount, tax_rate,
       garment, fabric, measurement_id)
    select p_business_id, p_parent_id, i.n::int, nullif(i.v ->> 'catalog_item_id', '')::uuid,
           trim(i.v ->> 'description'), coalesce(nullif(i.v ->> 'quantity', '')::numeric, 1),
           coalesce(nullif(i.v ->> 'unit_price', '')::numeric, 0), coalesce(nullif(i.v ->> 'discount', '')::numeric, 0),
           coalesce(nullif(i.v ->> 'tax_rate', '')::numeric, 0),
           nullif(trim(i.v ->> 'garment'), ''), nullif(trim(i.v ->> 'fabric'), ''),
           nullif(i.v ->> 'measurement_id', '')::uuid
      from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality i(v, n);
  end if;
end;
$$;

-- Only keys defined (and active) as order custom fields are kept.
create or replace function private.order_custom_fields(p_business_id uuid, p_values jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}')
    from jsonb_each(case when jsonb_typeof(p_values) = 'object' then p_values else '{}' end) e
   where exists (select 1 from public.custom_field_definitions d
                  where d.business_id = p_business_id and d.entity::text = 'order'
                    and d.key = e.key and d.is_active);
$$;

-- =====================================================================
-- Guards and history
-- =====================================================================

-- Order header rules. Lines may only change while the order is open.
create or replace function private.guard_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to public.order_stages;
  v_from public.order_stages;
  v_uid uuid := auth.uid();
begin
  select * into v_to from public.order_stages where id = new.stage_id;

  if new.owner_id is not null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and not exists (select 1 from public.business_memberships m
                      where m.business_id = new.business_id and m.user_id = new.owner_id and m.status = 'active') then
    raise exception 'owner must be an active member of the business' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_to.category <> 'open' or not v_to.is_active then
      raise exception 'new orders start in an active open stage' using errcode = '23514';
    end if;
    new.closed_at := null;
    return new;
  end if;

  select * into v_from from public.order_stages where id = old.stage_id;

  if v_uid is not null then
    -- Anything but a stage move needs orders.edit; production can only move stages.
    if (new.due_date, new.notes, new.branch_id, new.owner_id, new.custom_fields)
         is distinct from (old.due_date, old.notes, old.branch_id, old.owner_id, old.custom_fields)
       and not private.has_permission(new.business_id, 'orders.edit') then
      raise exception 'not allowed to edit orders' using errcode = '42501';
    end if;
    if new.owner_id is distinct from old.owner_id
       and not private.has_permission(new.business_id, 'orders.view_all') then
      raise exception 'not allowed to reassign orders' using errcode = '42501';
    end if;
    if new.branch_id is distinct from old.branch_id
       and not private.branch_visible(new.business_id, new.branch_id) then
      raise exception 'branch not accessible' using errcode = '42501';
    end if;
    if new.stage_id is distinct from old.stage_id then
      if not (private.has_permission(new.business_id, 'orders.edit')
              or private.has_permission(new.business_id, 'orders.fulfil')) then
        raise exception 'not allowed to move orders' using errcode = '42501';
      end if;
      if (v_to.category = 'cancelled' or v_from.category <> 'open')
         and not private.has_permission(new.business_id, 'orders.edit') then
        raise exception 'only someone who can edit orders can cancel or reopen them' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.stage_id is distinct from old.stage_id then
    if not v_to.is_active then
      raise exception 'that stage is no longer in use' using errcode = '23514';
    end if;
    new.closed_at := case when v_to.category = 'open' then null else now() end;
  end if;
  return new;
end;
$$;

create trigger orders_guard before insert or update on public.orders
  for each row execute function private.guard_order();

create or replace function private.guard_order_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open boolean;
  v_id uuid := coalesce(new.order_id, old.order_id);
begin
  select s.category = 'open' into v_open
    from public.orders o join public.order_stages s on s.id = o.stage_id where o.id = v_id;
  -- v_open is null while the order is being deleted in a cascade.
  if v_open is false then
    raise exception 'order is closed' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger order_items_guard before insert or update or delete on public.order_items
  for each row execute function private.guard_order_items();

create or replace function private.guard_quotation_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.quotation_status;
begin
  select status into v_status from public.quotations where id = coalesce(new.quotation_id, old.quotation_id);
  if v_status in ('accepted', 'declined', 'expired') then
    raise exception 'quotation is closed' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger quotation_items_guard before insert or update or delete on public.quotation_items
  for each row execute function private.guard_quotation_items();

create or replace function private.log_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (business_id, order_id, from_stage_id, to_stage_id, changed_by)
    values (new.business_id, new.id, null, new.stage_id, auth.uid());
    insert into public.customer_events (business_id, customer_id, type, body, changes, actor_id)
    values (new.business_id, new.customer_id, 'order_created', new.order_number,
            jsonb_build_object('order_id', new.id), auth.uid());
    if new.lead_id is not null then
      insert into public.lead_activities (business_id, lead_id, type, meta, actor_id)
      values (new.business_id, new.lead_id, 'order_created',
              jsonb_build_object('order_id', new.id, 'order_number', new.order_number), auth.uid());
    end if;
  elsif new.stage_id is distinct from old.stage_id then
    insert into public.order_status_history (business_id, order_id, from_stage_id, to_stage_id, changed_by)
    values (new.business_id, new.id, old.stage_id, new.stage_id, auth.uid());
  end if;
  return null;
end;
$$;

create trigger orders_log after insert or update of stage_id on public.orders
  for each row execute function private.log_order_change();

-- Payments: lock the order, check the amount against what's owed or paid, number the receipt.
create or replace function private.prepare_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_cat public.order_stage_category;
  v_paid numeric;
  v_refunded numeric;
begin
  select * into v_order from public.orders where id = new.order_id and business_id = new.business_id for update;
  if v_order.id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  select category into v_cat from public.order_stages where id = v_order.stage_id;
  select t.paid, t.refunded into v_paid, v_refunded from private.order_payment_totals(new.order_id) t;

  if new.kind = 'payment' then
    if v_cat = 'cancelled' then
      raise exception 'order is cancelled' using errcode = '23514';
    end if;
    if new.amount > v_order.total - (v_paid - v_refunded) then
      raise exception 'payment is more than the balance due' using errcode = '23514';
    end if;
  elsif new.amount > v_paid - v_refunded then
    raise exception 'refund is more than was paid' using errcode = '23514';
  end if;

  new.customer_id := v_order.customer_id;
  new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  new.receipt_number := private.next_number(new.business_id, 'receipt', case when new.kind = 'refund' then 'RF-' else 'R-' end);
  return new;
end;
$$;

create trigger payments_prepare before insert on public.payments
  for each row execute function private.prepare_payment();

create or replace function private.log_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.customer_events (business_id, customer_id, type, body, changes, actor_id)
  values (new.business_id, new.customer_id,
          case when new.kind = 'refund' then 'refund_recorded' else 'payment_received' end,
          new.receipt_number,
          jsonb_build_object('order_id', new.order_id, 'amount', new.amount, 'method', new.method),
          auth.uid());
  return null;
end;
$$;

create trigger payments_log after insert on public.payments
  for each row execute function private.log_payment();

-- Appointments: links must belong to the same customer; staff must be active.
create or replace function private.prepare_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null and not exists (
    select 1 from public.leads l where l.id = new.lead_id and l.customer_id = new.customer_id) then
    raise exception 'lead belongs to another customer' using errcode = '23514';
  end if;
  if new.order_id is not null and not exists (
    select 1 from public.orders o where o.id = new.order_id and o.customer_id = new.customer_id) then
    raise exception 'order belongs to another customer' using errcode = '23514';
  end if;
  if new.staff_id is not null
     and (tg_op = 'INSERT' or new.staff_id is distinct from old.staff_id)
     and not exists (select 1 from public.business_memberships m
                      where m.business_id = new.business_id and m.user_id = new.staff_id and m.status = 'active') then
    raise exception 'staff must be an active member of the business' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'scheduled';
    new.reminder_sent_at := null;
    new.outcome_prompted_at := null;
  else
    if new.status is distinct from old.status then
      new.status_changed_at := now();
    end if;
    if new.starts_at is distinct from old.starts_at then
      new.reminder_sent_at := null;
      new.outcome_prompted_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger appointments_prepare before insert or update on public.appointments
  for each row execute function private.prepare_appointment();

create or replace function private.on_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_customer text;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.appointment_status_history (business_id, appointment_id, from_status, to_status, changed_by)
    values (new.business_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid());

    if new.lead_id is not null and (tg_op = 'INSERT' or new.status in ('completed', 'no_show', 'cancelled')) then
      insert into public.lead_activities (business_id, lead_id, type, meta, actor_id)
      values (new.business_id, new.lead_id,
              case when tg_op = 'INSERT' then 'appointment_booked'
                   when new.status = 'completed' then 'appointment_completed'
                   when new.status = 'no_show' then 'appointment_no_show'
                   else 'appointment_cancelled' end,
              jsonb_build_object('appointment_id', new.id, 'kind', new.kind, 'starts_at', new.starts_at),
              auth.uid());
    end if;
  end if;

  if new.staff_id is not null and new.staff_id is distinct from auth.uid()
     and new.status in ('scheduled', 'confirmed')
     and (tg_op = 'INSERT' or new.staff_id is distinct from old.staff_id) then
    select b.timezone into v_tz from public.businesses b where b.id = new.business_id;
    select full_name into v_customer from public.customers where id = new.customer_id;
    perform private.notify(new.business_id, new.staff_id, 'appointment_assigned',
      format('Appointment with %s', coalesce(v_customer, 'a customer')),
      to_char(new.starts_at at time zone coalesce(v_tz, 'UTC'), 'DD Mon, HH24:MI') || ' · ' || replace(new.kind::text, '_', ' '),
      '/appointments?date=' || to_char(new.starts_at at time zone coalesce(v_tz, 'UTC'), 'YYYY-MM-DD'));
  end if;
  return null;
end;
$$;

create trigger appointments_after_change after insert or update of status, staff_id on public.appointments
  for each row execute function private.on_appointment_change();

-- Measurements land on the customer timeline.
create or replace function private.log_measurement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.customer_events (business_id, customer_id, type, body, changes, actor_id)
  values (new.business_id, new.customer_id, 'measurement_added', new.garment,
          jsonb_build_object('measurement_id', new.id), auth.uid());
  return null;
end;
$$;

create trigger customer_measurements_log after insert on public.customer_measurements
  for each row execute function private.log_measurement();

-- Merges (Sprint 2) also move tasks (Sprint 3) and now everything Sprint 4 adds.
create or replace function private.move_tasks_on_merge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.merged_into_id is not null and old.merged_into_id is null then
    update public.tasks set customer_id = new.merged_into_id where customer_id = new.id;
    update public.appointments set customer_id = new.merged_into_id where customer_id = new.id;
    update public.walk_ins set customer_id = new.merged_into_id where customer_id = new.id;
    update public.customer_measurements set customer_id = new.merged_into_id where customer_id = new.id;
    update public.quotations set customer_id = new.merged_into_id where customer_id = new.id;
    update public.orders set customer_id = new.merged_into_id where customer_id = new.id;
    update public.payments set customer_id = new.merged_into_id where customer_id = new.id;
  end if;
  return null;
end;
$$;

-- Audit configuration
create trigger audit_catalog_items after insert or update or delete on public.catalog_items
  for each row execute function private.audit_row();
create trigger audit_order_stages after insert or update or delete on public.order_stages
  for each row execute function private.audit_row();
create trigger audit_measurement_templates after insert or update or delete on public.measurement_templates
  for each row execute function private.audit_row();

-- =====================================================================
-- RPCs
-- =====================================================================

-- Creates an order with its lines. Input: customer_id, lead_id, branch_id,
-- owner_id, due_date, notes, custom_fields, items (array).
create or replace function public.create_order(p_business_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in jsonb := coalesce(p_input, '{}');
  v_customer uuid := nullif(v_in ->> 'customer_id', '')::uuid;
  v_lead uuid := nullif(v_in ->> 'lead_id', '')::uuid;
  v_branch uuid := nullif(v_in ->> 'branch_id', '')::uuid;
  v_owner uuid := coalesce(nullif(v_in ->> 'owner_id', '')::uuid, auth.uid());
  v_stage uuid;
  v_order public.orders;
begin
  if not private.has_permission(p_business_id, 'orders.create') then
    raise exception 'not allowed to create orders' using errcode = '42501';
  end if;
  if v_customer is null or not exists (
       select 1 from public.customers c where c.id = v_customer and c.business_id = p_business_id and c.merged_into_id is null)
     or not private.can_see_customer(v_customer) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if v_lead is not null and not exists (
       select 1 from public.leads l where l.id = v_lead and l.customer_id = v_customer
          and private.can_see_lead(l.business_id, l.branch_id, l.owner_id)) then
    raise exception 'lead belongs to another customer' using errcode = '23514';
  end if;
  if v_branch is not null and not private.branch_visible(p_business_id, v_branch) then
    raise exception 'branch not accessible' using errcode = '42501';
  end if;
  -- Someone who only sees their own orders owns what they create.
  if v_owner <> auth.uid() and not private.has_permission(p_business_id, 'orders.view_all') then
    v_owner := auth.uid();
  end if;
  if jsonb_array_length(coalesce(v_in -> 'items', '[]')) = 0 then
    raise exception 'an order needs at least one line' using errcode = '23514';
  end if;

  select id into v_stage from public.order_stages
   where business_id = p_business_id and category = 'open' and is_active
   order by position limit 1;

  insert into public.orders (business_id, order_number, customer_id, lead_id, quotation_id, branch_id, owner_id,
                             stage_id, due_date, notes, custom_fields, created_by)
  values (p_business_id, private.next_number(p_business_id, 'order', 'O-'), v_customer, v_lead,
          nullif(v_in ->> 'quotation_id', '')::uuid,
          coalesce(v_branch, (select branch_id from public.customers where id = v_customer)),
          v_owner, v_stage, nullif(v_in ->> 'due_date', '')::date, nullif(trim(v_in ->> 'notes'), ''),
          private.order_custom_fields(p_business_id, v_in -> 'custom_fields'), auth.uid())
  returning * into v_order;

  perform private.insert_document_items(p_business_id, 'order', v_order.id, v_in -> 'items');
  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number);
end;
$$;

-- Replaces all lines of an open order (orders.edit).
create or replace function public.replace_order_items(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
begin
  select * into v from public.orders where id = p_order_id for update;
  if v.id is null or not private.has_permission(v.business_id, 'orders.edit')
     or not private.can_see_order(v.business_id, v.branch_id, v.owner_id) then
    raise exception 'not allowed to edit orders' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception 'an order needs at least one line' using errcode = '23514';
  end if;
  delete from public.order_items where order_id = v.id;
  perform private.insert_document_items(v.business_id, 'order', v.id, p_items);
end;
$$;

create or replace function public.create_quotation(p_business_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in jsonb := coalesce(p_input, '{}');
  v_customer uuid := nullif(v_in ->> 'customer_id', '')::uuid;
  v_lead uuid := nullif(v_in ->> 'lead_id', '')::uuid;
  v_branch uuid := nullif(v_in ->> 'branch_id', '')::uuid;
  v_q public.quotations;
begin
  if not private.has_permission(p_business_id, 'orders.create') then
    raise exception 'not allowed to create quotations' using errcode = '42501';
  end if;
  if v_customer is null or not exists (
       select 1 from public.customers c where c.id = v_customer and c.business_id = p_business_id and c.merged_into_id is null)
     or not private.can_see_customer(v_customer) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if v_lead is not null and not exists (
       select 1 from public.leads l where l.id = v_lead and l.customer_id = v_customer
          and private.can_see_lead(l.business_id, l.branch_id, l.owner_id)) then
    raise exception 'lead belongs to another customer' using errcode = '23514';
  end if;
  if v_branch is not null and not private.branch_visible(p_business_id, v_branch) then
    raise exception 'branch not accessible' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(v_in -> 'items', '[]')) = 0 then
    raise exception 'a quotation needs at least one line' using errcode = '23514';
  end if;

  insert into public.quotations (business_id, quotation_number, customer_id, lead_id, branch_id, owner_id,
                                 valid_until, notes, created_by)
  values (p_business_id, private.next_number(p_business_id, 'quotation', 'Q-'), v_customer, v_lead,
          coalesce(v_branch, (select branch_id from public.customers where id = v_customer)),
          auth.uid(), coalesce(nullif(v_in ->> 'valid_until', '')::date, current_date + 15),
          nullif(trim(v_in ->> 'notes'), ''), auth.uid())
  returning * into v_q;

  perform private.insert_document_items(p_business_id, 'quotation', v_q.id, v_in -> 'items');
  if v_lead is not null then
    insert into public.lead_activities (business_id, lead_id, type, meta, actor_id)
    values (p_business_id, v_lead, 'quotation_created',
            jsonb_build_object('quotation_id', v_q.id, 'quotation_number', v_q.quotation_number), auth.uid());
  end if;
  return jsonb_build_object('quotation_id', v_q.id, 'quotation_number', v_q.quotation_number);
end;
$$;

create or replace function public.replace_quotation_items(p_quotation_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.quotations;
begin
  select * into v from public.quotations where id = p_quotation_id for update;
  if v.id is null or not private.can_see_order(v.business_id, v.branch_id, v.owner_id)
     or not (private.has_permission(v.business_id, 'orders.edit')
             or (private.has_permission(v.business_id, 'orders.create') and v.created_by = auth.uid())) then
    raise exception 'not allowed to edit quotations' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception 'a quotation needs at least one line' using errcode = '23514';
  end if;
  delete from public.quotation_items where quotation_id = v.id;
  perform private.insert_document_items(v.business_id, 'quotation', v.id, p_items);
end;
$$;

-- Accepts a quotation and creates the order with the same lines.
create or replace function public.convert_quotation(p_quotation_id uuid, p_input jsonb default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.quotations;
  v_result jsonb;
  v_items jsonb;
begin
  select * into v from public.quotations where id = p_quotation_id for update;
  if v.id is null or not private.can_see_order(v.business_id, v.branch_id, v.owner_id) then
    raise exception 'quotation not found' using errcode = 'P0002';
  end if;
  if v.status not in ('draft', 'sent') then
    raise exception 'quotation is closed' using errcode = '23514';
  end if;
  select jsonb_agg(jsonb_build_object(
           'catalog_item_id', catalog_item_id, 'description', description, 'quantity', quantity,
           'unit_price', unit_price, 'discount', discount, 'tax_rate', tax_rate,
           'garment', garment, 'fabric', fabric, 'measurement_id', measurement_id) order by position)
    into v_items
    from public.quotation_items where quotation_id = v.id;

  v_result := public.create_order(v.business_id,
    coalesce(p_input, '{}') || jsonb_build_object(
      'customer_id', v.customer_id, 'lead_id', v.lead_id, 'branch_id', v.branch_id,
      'quotation_id', v.id, 'items', coalesce(v_items, '[]'), 'notes', coalesce(p_input ->> 'notes', v.notes)));

  update public.quotations
     set status = 'accepted', order_id = (v_result ->> 'order_id')::uuid
   where id = v.id;
  return v_result;
end;
$$;

-- Walk-in: phone lookup → customer file → lead (source walk_in), recorded as a visit.
-- An open lead for the same customer gets the visit instead of a new lead.
-- Today's booked appointment at this branch is marked completed.
create or replace function public.register_walk_in(p_business_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in jsonb := coalesce(p_input, '{}');
  v_uid uuid := auth.uid();
  v_branch uuid := nullif(v_in ->> 'branch_id', '')::uuid;
  v_staff uuid := coalesce(nullif(v_in ->> 'staff_id', '')::uuid, v_uid);
  v_lead jsonb;
  v_walk uuid;
  v_appt uuid;
  v_tz text;
begin
  if not private.has_permission(p_business_id, 'appointments.manage') then
    raise exception 'not allowed to register walk-ins' using errcode = '42501';
  end if;
  if v_branch is not null and not private.branch_visible(p_business_id, v_branch) then
    raise exception 'branch not accessible' using errcode = '42501';
  end if;
  if (v_in ? 'customer_id') and not private.can_see_customer(nullif(v_in ->> 'customer_id', '')::uuid) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  v_lead := private.create_lead_internal(p_business_id,
    jsonb_build_object(
      'customer_id', v_in ->> 'customer_id', 'phone', v_in ->> 'phone', 'email', v_in ->> 'email',
      'full_name', v_in ->> 'full_name', 'branch_id', v_branch, 'source', 'walk_in',
      'title', v_in ->> 'purpose', 'description', v_in ->> 'notes',
      'owner_id', case when private.member_can_own_lead(p_business_id, v_staff, v_branch) then v_staff end,
      'reuse_open_lead', true),
    v_uid);

  insert into public.walk_ins (business_id, branch_id, customer_id, lead_id, staff_id, purpose, notes, created_by)
  values (p_business_id, v_branch, (v_lead ->> 'customer_id')::uuid, (v_lead ->> 'lead_id')::uuid, v_staff,
          nullif(trim(v_in ->> 'purpose'), ''), nullif(trim(v_in ->> 'notes'), ''), v_uid)
  returning id into v_walk;

  insert into public.lead_activities (business_id, lead_id, type, body, meta, actor_id)
  values (p_business_id, (v_lead ->> 'lead_id')::uuid, 'visit',
          coalesce(nullif(trim(v_in ->> 'notes'), ''), nullif(trim(v_in ->> 'purpose'), ''), 'Walked in'),
          jsonb_build_object('walk_in_id', v_walk), v_uid);

  select timezone into v_tz from public.businesses where id = p_business_id;
  update public.appointments a set status = 'completed'
   where a.id = (select x.id from public.appointments x
                  where x.customer_id = (v_lead ->> 'customer_id')::uuid
                    and x.status in ('scheduled', 'confirmed')
                    and (v_branch is null or x.branch_id is null or x.branch_id = v_branch)
                    and (x.starts_at at time zone coalesce(v_tz, 'UTC'))::date = (now() at time zone coalesce(v_tz, 'UTC'))::date
                  order by abs(extract(epoch from x.starts_at - now())) limit 1)
  returning a.id into v_appt;

  return v_lead || jsonb_build_object('walk_in_id', v_walk, 'appointment_id', v_appt);
end;
$$;

-- Background jobs (Sprint 3) now also cover appointments:
--   staff reminder 60 minutes before (in-app + email), and an "outcome?"
--   prompt 30 minutes after an appointment nobody closed.
create or replace function public.run_task_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_overdue uuid[];
  v_reminders int;
  v_appt_reminders int;
  v_prompts int;
begin
  with upd as (
    update public.tasks t set overdue_notified_at = now()
     where t.completed_at is null and t.cancelled_at is null
       and t.overdue_notified_at is null and t.due_at <= now()
    returning t.id
  )
  select coalesce(array_agg(id), '{}') into v_overdue from upd;

  insert into public.notifications (business_id, user_id, type, title, body, link)
  select t.business_id, t.assignee_id, 'task_overdue', left('Overdue: ' || t.title, 200),
         (select concat_ws(' · ', l.lead_number, c.full_name)
            from public.leads l left join public.customers c on c.id = l.customer_id
           where l.id = t.lead_id),
         coalesce('/leads/' || t.lead_id, '/tasks')
    from public.tasks t
    join public.business_memberships m
      on m.business_id = t.business_id and m.user_id = t.assignee_id and m.status = 'active'
   where t.id = any (v_overdue);

  insert into public.notifications (business_id, user_id, type, title, link)
  select t.business_id, m.user_id, 'team_tasks_overdue',
         case when count(*) = 1 then '1 follow-up is overdue in your team'
              else count(*) || ' follow-ups are overdue in your team' end,
         '/tasks?who=team'
    from public.tasks t
    join public.business_memberships m on m.business_id = t.business_id and m.status = 'active'
    join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'tasks.view_all'
   where t.id = any (v_overdue)
     and t.assignee_id is distinct from m.user_id
     and (t.branch_id is null or m.all_branches
          or exists (select 1 from public.user_branch_access a
                      where a.membership_id = m.id and a.branch_id = t.branch_id))
   group by t.business_id, m.user_id;

  with due as (
    update public.tasks t set reminder_sent_at = now()
     where t.completed_at is null and t.cancelled_at is null
       and t.reminder_sent_at is null and t.due_at <= now() + interval '15 minutes'
    returning t.*
  ), queued as (
    insert into private.email_outbox (business_id, to_email, template, payload)
    select d.business_id, p.email, 'task_reminder',
           jsonb_build_object(
             'business_name', b.name, 'timezone', b.timezone,
             'assignee_name', p.full_name,
             'task_title', d.title, 'task_type', d.type, 'notes', d.notes, 'due_at', d.due_at,
             'lead_number', l.lead_number, 'customer_name', c.full_name, 'customer_phone', c.primary_phone,
             'path', coalesce('/leads/' || d.lead_id, '/tasks'))
      from due d
      join public.businesses b on b.id = d.business_id and b.status = 'active'
      join public.profiles p on p.id = d.assignee_id and p.email is not null
      join public.business_memberships m
        on m.business_id = d.business_id and m.user_id = d.assignee_id and m.status = 'active'
      left join public.leads l on l.id = d.lead_id
      left join public.customers c on c.id = d.customer_id
     where d.due_at > now() - interval '6 hours'
    returning 1
  )
  select count(*) into v_reminders from queued;

  -- Appointment reminders for the staff member, an hour ahead.
  with due as (
    update public.appointments a set reminder_sent_at = now()
     where a.status in ('scheduled', 'confirmed') and a.reminder_sent_at is null
       and a.starts_at <= now() + interval '60 minutes'
    returning a.*
  ), notified as (
    insert into public.notifications (business_id, user_id, type, title, body, link)
    select d.business_id, d.staff_id, 'appointment_soon',
           left('Coming up: ' || replace(d.kind::text, '_', ' ') || ' with ' || c.full_name, 200),
           to_char(d.starts_at at time zone b.timezone, 'HH24:MI'),
           '/appointments?date=' || to_char(d.starts_at at time zone b.timezone, 'YYYY-MM-DD')
      from due d
      join public.businesses b on b.id = d.business_id and b.status = 'active'
      join public.customers c on c.id = d.customer_id
      join public.business_memberships m
        on m.business_id = d.business_id and m.user_id = d.staff_id and m.status = 'active'
     where d.starts_at > now()
    returning 1
  ), queued as (
    insert into private.email_outbox (business_id, to_email, template, payload)
    select d.business_id, p.email, 'appointment_reminder',
           jsonb_build_object(
             'business_name', b.name, 'timezone', b.timezone, 'kind', d.kind, 'title', d.title,
             'starts_at', d.starts_at, 'customer_name', c.full_name, 'customer_phone', c.primary_phone,
             'branch_name', br.name, 'notes', d.notes,
             'path', '/appointments?date=' || to_char(d.starts_at at time zone b.timezone, 'YYYY-MM-DD'))
      from due d
      join public.businesses b on b.id = d.business_id and b.status = 'active'
      join public.customers c on c.id = d.customer_id
      join public.profiles p on p.id = d.staff_id and p.email is not null
      join public.business_memberships m
        on m.business_id = d.business_id and m.user_id = d.staff_id and m.status = 'active'
      left join public.branches br on br.id = d.branch_id
     where d.starts_at > now()
    returning 1
  )
  -- (Data-modifying CTEs always run, so the notifications are written even though only emails are counted.)
  select count(*) into v_appt_reminders from queued;

  -- Ask the staff member how an appointment went once it is 30 minutes past its end.
  with stale as (
    update public.appointments a set outcome_prompted_at = now()
     where a.status in ('scheduled', 'confirmed') and a.outcome_prompted_at is null
       and a.ends_at <= now() - interval '30 minutes'
       and a.ends_at > now() - interval '2 days'
    returning a.*
  ), notified as (
    insert into public.notifications (business_id, user_id, type, title, body, link)
    select s.business_id, s.staff_id, 'appointment_outcome',
           left('Did ' || c.full_name || ' come in?', 200),
           'Mark the appointment as completed or no-show.',
           '/appointments?date=' || to_char(s.starts_at at time zone b.timezone, 'YYYY-MM-DD')
      from stale s
      join public.businesses b on b.id = s.business_id
      join public.customers c on c.id = s.customer_id
      join public.business_memberships m
        on m.business_id = s.business_id and m.user_id = s.staff_id and m.status = 'active'
    returning 1
  )
  select count(*) into v_prompts from notified;

  return jsonb_build_object('overdue', coalesce(array_length(v_overdue, 1), 0), 'reminders_queued', v_reminders,
                            'appointment_reminders_queued', v_appt_reminders, 'outcome_prompts', v_prompts);
end;
$$;

revoke execute on function public.create_order(uuid, jsonb) from public, anon;
revoke execute on function public.replace_order_items(uuid, jsonb) from public, anon;
revoke execute on function public.create_quotation(uuid, jsonb) from public, anon;
revoke execute on function public.replace_quotation_items(uuid, jsonb) from public, anon;
revoke execute on function public.convert_quotation(uuid, jsonb) from public, anon;
revoke execute on function public.register_walk_in(uuid, jsonb) from public, anon;
revoke execute on function public.run_task_jobs() from public, anon, authenticated;
grant execute on function public.create_order(uuid, jsonb) to authenticated;
grant execute on function public.replace_order_items(uuid, jsonb) to authenticated;
grant execute on function public.create_quotation(uuid, jsonb) to authenticated;
grant execute on function public.replace_quotation_items(uuid, jsonb) to authenticated;
grant execute on function public.convert_quotation(uuid, jsonb) to authenticated;
grant execute on function public.register_walk_in(uuid, jsonb) to authenticated;
grant execute on function public.run_task_jobs() to service_role;

-- =====================================================================
-- Views (security invoker: the caller's RLS applies)
-- =====================================================================
create view public.order_balances with (security_invoker = true) as
select o.id as order_id, o.business_id, o.customer_id, o.stage_id, o.total, t.paid, t.refunded,
       (t.paid - t.refunded)::numeric(14,2) as net_paid,
       (o.total - (t.paid - t.refunded))::numeric(14,2) as balance
  from public.orders o
  cross join lateral private.order_payment_totals(o.id) t;

-- Purchase history per customer. Cancelled orders don't count.
create view public.customer_value with (security_invoker = true) as
select o.business_id, o.customer_id,
       count(*) as orders_count,
       coalesce(sum(o.total), 0)::numeric(14,2) as lifetime_value,
       min(o.created_at) as first_order_at,
       max(o.created_at) as last_order_at
  from public.orders o
  join public.order_stages s on s.id = o.stage_id
 where s.category <> 'cancelled'
 group by o.business_id, o.customer_id;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.appointments                enable row level security;
alter table public.appointment_status_history  enable row level security;
alter table public.walk_ins                    enable row level security;
alter table public.catalog_items               enable row level security;
alter table public.measurement_templates       enable row level security;
alter table public.customer_measurements       enable row level security;
alter table public.order_stages                enable row level security;
alter table public.quotations                  enable row level security;
alter table public.quotation_items             enable row level security;
alter table public.orders                      enable row level security;
alter table public.order_status_history        enable row level security;
alter table public.order_items                 enable row level security;
alter table public.payments                    enable row level security;

-- Appointments
create policy appointments_select on public.appointments for select to authenticated
  using (private.is_member(business_id) and private.can_see_appointment(business_id, branch_id, staff_id));
create policy appointments_insert on public.appointments for insert to authenticated
  with check (private.has_permission(business_id, 'appointments.manage')
              and private.branch_visible(business_id, branch_id)
              and private.can_see_customer(customer_id)
              and created_by = auth.uid());
create policy appointments_update on public.appointments for update to authenticated
  using (private.has_permission(business_id, 'appointments.manage')
         and private.can_see_appointment(business_id, branch_id, staff_id))
  with check (private.has_permission(business_id, 'appointments.manage')
              and (private.branch_visible(business_id, branch_id) or staff_id = auth.uid()));
revoke insert, update, delete on public.appointments from authenticated, anon;
grant insert (business_id, branch_id, customer_id, lead_id, order_id, kind, title, notes, starts_at, ends_at,
              staff_id, created_by) on public.appointments to authenticated;
grant update (branch_id, kind, title, notes, starts_at, ends_at, staff_id, status) on public.appointments to authenticated;

create policy ash_select on public.appointment_status_history for select to authenticated
  using (exists (select 1 from public.appointments a where a.id = appointment_id));
revoke insert, update, delete on public.appointment_status_history from authenticated, anon;

create policy walk_ins_select on public.walk_ins for select to authenticated
  using (private.is_member(business_id)
         and private.has_permission(business_id, 'appointments.view')
         and (private.branch_visible(business_id, branch_id) or staff_id = auth.uid()));
revoke insert, update, delete on public.walk_ins from authenticated, anon;

-- Catalogue, stages and templates: members read, settings.orders.manage writes. Never deleted.
create policy catalog_select on public.catalog_items for select to authenticated
  using (private.is_member(business_id));
create policy catalog_insert on public.catalog_items for insert to authenticated
  with check (private.has_permission(business_id, 'settings.orders.manage'));
create policy catalog_update on public.catalog_items for update to authenticated
  using (private.has_permission(business_id, 'settings.orders.manage'))
  with check (private.has_permission(business_id, 'settings.orders.manage'));
revoke delete on public.catalog_items from authenticated, anon;

create policy order_stages_select on public.order_stages for select to authenticated
  using (private.is_member(business_id));
create policy order_stages_insert on public.order_stages for insert to authenticated
  with check (private.has_permission(business_id, 'settings.orders.manage'));
create policy order_stages_update on public.order_stages for update to authenticated
  using (private.has_permission(business_id, 'settings.orders.manage'))
  with check (private.has_permission(business_id, 'settings.orders.manage'));
revoke delete on public.order_stages from authenticated, anon;
revoke update on public.order_stages from authenticated;
grant update (name, position, is_active) on public.order_stages to authenticated;

create policy mt_select on public.measurement_templates for select to authenticated
  using (private.is_member(business_id));
create policy mt_insert on public.measurement_templates for insert to authenticated
  with check (private.has_permission(business_id, 'settings.orders.manage'));
create policy mt_update on public.measurement_templates for update to authenticated
  using (private.has_permission(business_id, 'settings.orders.manage'))
  with check (private.has_permission(business_id, 'settings.orders.manage'));
revoke delete on public.measurement_templates from authenticated, anon;

-- Measurements: append-only, on customers you can edit.
create policy measurements_select on public.customer_measurements for select to authenticated
  using (private.can_see_customer(customer_id));
create policy measurements_insert on public.customer_measurements for insert to authenticated
  with check (private.can_edit_customer(customer_id) and taken_by = auth.uid());
revoke update, delete on public.customer_measurements from authenticated, anon;

-- Quotations and orders: created through RPCs, never deleted.
create policy quotations_select on public.quotations for select to authenticated
  using (private.is_member(business_id) and private.can_see_order(business_id, branch_id, owner_id));
create policy quotations_update on public.quotations for update to authenticated
  using (private.can_see_order(business_id, branch_id, owner_id)
         and (private.has_permission(business_id, 'orders.edit')
              or (private.has_permission(business_id, 'orders.create') and created_by = auth.uid())))
  with check (private.has_permission(business_id, 'orders.edit')
              or (private.has_permission(business_id, 'orders.create') and created_by = auth.uid()));
revoke insert, update, delete on public.quotations from authenticated, anon;
grant update (status, valid_until, notes) on public.quotations to authenticated;

create policy quotation_items_select on public.quotation_items for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id));
revoke insert, update, delete on public.quotation_items from authenticated, anon;

create policy orders_select on public.orders for select to authenticated
  using (private.is_member(business_id) and private.can_see_order(business_id, branch_id, owner_id));
create policy orders_update on public.orders for update to authenticated
  using ((private.has_permission(business_id, 'orders.edit') or private.has_permission(business_id, 'orders.fulfil'))
         and private.can_see_order(business_id, branch_id, owner_id))
  with check (private.has_permission(business_id, 'orders.edit') or private.has_permission(business_id, 'orders.fulfil'));
revoke insert, update, delete on public.orders from authenticated, anon;
grant update (stage_id, due_date, notes, branch_id, owner_id, custom_fields) on public.orders to authenticated;

create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
revoke insert, update, delete on public.order_items from authenticated, anon;

create policy osh_select on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
revoke insert, update, delete on public.order_status_history from authenticated, anon;

-- Payments: an append-only ledger. Corrections are refunds, never edits.
create policy payments_select on public.payments for select to authenticated
  using (private.has_permission(business_id, 'payments.view')
         and exists (select 1 from public.orders o where o.id = order_id));
create policy payments_insert on public.payments for insert to authenticated
  with check (private.has_permission(business_id, case when kind = 'refund' then 'payments.refund' else 'payments.record' end)
              and exists (select 1 from public.orders o where o.id = order_id and o.business_id = payments.business_id));
revoke insert, update, delete on public.payments from authenticated, anon;
grant insert (business_id, order_id, kind, amount, method, reference, notes, received_at) on public.payments to authenticated;

revoke all on public.appointments, public.appointment_status_history, public.walk_ins, public.catalog_items,
  public.measurement_templates, public.customer_measurements, public.order_stages, public.quotations,
  public.quotation_items, public.orders, public.order_status_history, public.order_items, public.payments,
  public.order_balances, public.customer_value
  from anon;

grant execute on all functions in schema private to authenticated, service_role;
