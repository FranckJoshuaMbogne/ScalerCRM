-- Sprint 9 — hardening and go-live:
-- CSV imports (customers, leads, orders), rate limits, export alerts,
-- web push subscriptions, job heartbeats and a public health check.

-- =====================================================================
-- Permission
-- =====================================================================
insert into public.permissions (key, module, description) values
-- BEGIN permissions
  ('data.import', 'settings', 'Import customers, leads and orders from CSV files')
-- END permissions
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'data.import' from public.roles r
 where r.business_id is null and r.key = 'business_admin'
on conflict do nothing;

-- =====================================================================
-- Imports
-- =====================================================================
-- Ids from the system a record was imported from. Re-running an import skips
-- rows whose reference is already in SCALER.
alter table public.leads add column external_ref text check (length(external_ref) between 1 and 80);
alter table public.orders add column external_ref text check (length(external_ref) between 1 and 80);
create unique index leads_external_ref_unique on public.leads (business_id, external_ref) where external_ref is not null;
create unique index orders_external_ref_unique on public.orders (business_id, external_ref) where external_ref is not null;

create table public.import_jobs (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  kind           text not null check (kind in ('customers', 'leads', 'orders')),
  file_name      text not null check (length(trim(file_name)) between 1 and 200),
  status         text not null default 'running' check (status in ('running', 'done')),
  total_rows     int not null check (total_rows between 1 and 50000),
  created_count  int not null default 0,
  matched_count  int not null default 0,
  skipped_count  int not null default 0,
  failed_count   int not null default 0,
  -- First 500 failures: [{row, error}]
  errors         jsonb not null default '[]' check (jsonb_typeof(errors) = 'array'),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,
  unique (business_id, id)
);
create index import_jobs_business_idx on public.import_jobs (business_id, created_at desc);

-- One row per processed file row, so a retried batch never imports twice.
create table public.import_job_rows (
  business_id  uuid not null,
  job_id       uuid not null,
  row_number   int not null check (row_number > 0),
  outcome      text not null check (outcome in ('created', 'matched', 'skipped', 'failed')),
  record_id    uuid,
  primary key (job_id, row_number),
  foreign key (business_id, job_id) references public.import_jobs (business_id, id) on delete cascade
);

alter table public.import_jobs enable row level security;
alter table public.import_job_rows enable row level security;
create policy import_jobs_select on public.import_jobs for select to authenticated
  using (private.has_permission(business_id, 'data.import'));
create policy import_job_rows_select on public.import_job_rows for select to authenticated
  using (private.has_permission(business_id, 'data.import'));
revoke all on public.import_jobs, public.import_job_rows from anon, authenticated;
grant select on public.import_jobs, public.import_job_rows to authenticated;

-- While an import runs (transaction-local setting, only set by import_rows),
-- new-lead side effects are skipped: round-robin, owner notifications,
-- automations, and the "new leads start open" rule, which import_rows checks itself.
drop trigger leads_assign_round_robin on public.leads;
create trigger leads_assign_round_robin before insert on public.leads
  for each row when (current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.auto_assign_new_lead();

drop trigger leads_status_rules on public.leads;
create trigger leads_status_rules before insert or update on public.leads
  for each row when (current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.apply_lead_status_rules();

drop trigger leads_notify_owner on public.leads;
create trigger leads_notify_owner after insert or update of owner_id on public.leads
  for each row when (current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.notify_lead_owner();

drop trigger leads_automation on public.leads;
create trigger leads_automation after insert or update of status_id, owner_id on public.leads
  for each row when (current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.automation_lead_events();

drop trigger orders_automation on public.orders;
create trigger orders_automation after insert or update of stage_id on public.orders
  for each row when (current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.automation_order_events();

-- Back-dating an imported customer isn't an edit worth a timeline entry.
drop trigger customers_log on public.customers;
create trigger customers_log after insert on public.customers
  for each row execute function private.log_customer_change();
create trigger customers_log_update after update on public.customers
  for each row when (current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.log_customer_change();

-- Shared by the three importers. Returns null when the value is empty.
create or replace function private.import_ts(p_value text)
returns timestamptz
language sql
stable
set search_path = ''
as $$ select nullif(trim(p_value), '')::timestamptz $$;

create or replace function private.import_customer(p_business_id uuid, p_row jsonb, p_actor uuid)
returns table (outcome text, record_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_branch uuid := nullif(p_row ->> 'branch_id', '')::uuid;
  v_tag text;
  v_tag_id uuid;
begin
  if v_branch is not null and not exists (select 1 from public.branches where id = v_branch and business_id = p_business_id) then
    raise exception 'unknown branch' using errcode = '22023';
  end if;
  select * into r from private.match_or_create_customer(
    p_business_id, p_row ->> 'phone', p_row ->> 'email', p_row ->> 'full_name', v_branch, p_actor);

  -- Fill gaps only; never overwrite what a matched file already has.
  update public.customers c
     set gender = coalesce(c.gender, nullif(p_row ->> 'gender', '')),
         date_of_birth = coalesce(c.date_of_birth, nullif(p_row ->> 'date_of_birth', '')::date),
         created_at = case when r.created then coalesce(private.import_ts(p_row ->> 'created_at'), c.created_at) else c.created_at end
   where c.id = r.customer_id;

  for v_tag in select distinct trim(t) from jsonb_array_elements_text(coalesce(p_row -> 'tags', '[]')) t where trim(t) <> '' loop
    insert into public.tags (business_id, name) values (p_business_id, left(v_tag, 40))
    on conflict (business_id, lower(name)) do nothing;
    select id into v_tag_id from public.tags where business_id = p_business_id and lower(name) = lower(left(v_tag, 40));
    insert into public.customer_tags (business_id, customer_id, tag_id)
    values (p_business_id, r.customer_id, v_tag_id) on conflict do nothing;
  end loop;

  return query select case when r.created then 'created' else 'matched' end, r.customer_id;
end;
$$;

create or replace function private.import_lead(p_business_id uuid, p_row jsonb, p_actor uuid)
returns table (outcome text, record_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text := nullif(trim(p_row ->> 'external_ref'), '');
  v_branch uuid := nullif(p_row ->> 'branch_id', '')::uuid;
  v_status public.lead_statuses;
  v_source uuid := nullif(p_row ->> 'source_id', '')::uuid;
  v_owner uuid := nullif(p_row ->> 'owner_id', '')::uuid;
  v_lost uuid := nullif(p_row ->> 'lost_reason_id', '')::uuid;
  v_created timestamptz := coalesce(private.import_ts(p_row ->> 'created_at'), now());
  v_closed timestamptz;
  v_customer uuid;
  v_id uuid;
begin
  if v_ref is not null then
    select id into v_id from public.leads where business_id = p_business_id and external_ref = v_ref;
    if found then return query select 'skipped', v_id; return; end if;
  end if;

  if nullif(p_row ->> 'status_id', '') is null then
    select * into v_status from public.lead_statuses where business_id = p_business_id and is_default;
  else
    select * into v_status from public.lead_statuses
     where id = (p_row ->> 'status_id')::uuid and business_id = p_business_id and is_active;
  end if;
  if v_status.id is null then
    raise exception 'unknown lead stage' using errcode = '22023';
  end if;
  if v_source is not null and not exists (select 1 from public.lead_sources where id = v_source and business_id = p_business_id) then
    raise exception 'unknown lead source' using errcode = '22023';
  end if;
  if v_branch is not null and not exists (select 1 from public.branches where id = v_branch and business_id = p_business_id) then
    raise exception 'unknown branch' using errcode = '22023';
  end if;
  if v_owner is not null and not private.member_can_own_lead(p_business_id, v_owner, v_branch) then
    raise exception 'owner cannot see leads in this branch' using errcode = '23514';
  end if;
  if v_status.category = 'lost' then
    if v_lost is not null and not exists (select 1 from public.lead_lost_reasons where id = v_lost and business_id = p_business_id) then
      raise exception 'unknown lost reason' using errcode = '23514';
    end if;
  else
    v_lost := null;
  end if;
  if v_status.category <> 'open' then
    v_closed := greatest(coalesce(private.import_ts(p_row ->> 'closed_at'), v_created), v_created);
  end if;

  select m.customer_id into v_customer from private.match_or_create_customer(
    p_business_id, p_row ->> 'phone', p_row ->> 'email', p_row ->> 'full_name', v_branch, p_actor) m;

  insert into public.leads (
    business_id, lead_number, customer_id, branch_id, status_id, owner_id, title, expected_value,
    first_source_id, first_campaign, latest_source_id, latest_campaign,
    lost_reason_id, closed_at, last_activity_at, external_ref, created_by, created_at)
  values (
    p_business_id, private.next_number(p_business_id, 'lead', 'L-'), v_customer, v_branch, v_status.id, v_owner,
    nullif(trim(p_row ->> 'title'), ''), nullif(p_row ->> 'expected_value', '')::numeric(14,2),
    v_source, nullif(trim(p_row ->> 'campaign'), ''), v_source, nullif(trim(p_row ->> 'campaign'), ''),
    v_lost, v_closed, coalesce(v_closed, v_created), v_ref, p_actor, v_created)
  returning id into v_id;

  return query select 'created', v_id;
end;
$$;

create or replace function private.import_order(p_business_id uuid, p_row jsonb, p_actor uuid)
returns table (outcome text, record_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text := nullif(trim(p_row ->> 'external_ref'), '');
  v_branch uuid := nullif(p_row ->> 'branch_id', '')::uuid;
  v_owner uuid := nullif(p_row ->> 'owner_id', '')::uuid;
  v_total numeric(14,2) := nullif(p_row ->> 'total', '')::numeric(14,2);
  v_paid numeric(14,2) := coalesce(nullif(p_row ->> 'paid', '')::numeric(14,2), 0);
  v_created timestamptz := coalesce(private.import_ts(p_row ->> 'created_at'), now());
  v_open uuid;
  v_stage public.order_stages;
  v_customer uuid;
  v_id uuid;
begin
  if v_ref is not null then
    select id into v_id from public.orders where business_id = p_business_id and external_ref = v_ref;
    if found then return query select 'skipped', v_id; return; end if;
  end if;
  if v_total is null or v_total < 0 then
    raise exception 'order total is required' using errcode = '22023';
  end if;
  if v_paid < 0 or v_paid > v_total then
    raise exception 'paid amount must be between 0 and the total' using errcode = '22023';
  end if;
  if v_branch is not null and not exists (select 1 from public.branches where id = v_branch and business_id = p_business_id) then
    raise exception 'unknown branch' using errcode = '22023';
  end if;

  select id into v_open from public.order_stages
   where business_id = p_business_id and category = 'open' and is_active order by position limit 1;
  if nullif(p_row ->> 'stage_id', '') is null then
    select * into v_stage from public.order_stages where id = v_open;
  else
    select * into v_stage from public.order_stages
     where id = (p_row ->> 'stage_id')::uuid and business_id = p_business_id and is_active;
  end if;
  if v_open is null or v_stage.id is null then
    raise exception 'unknown order stage' using errcode = '22023';
  end if;

  select m.customer_id into v_customer from private.match_or_create_customer(
    p_business_id, p_row ->> 'phone', p_row ->> 'email', p_row ->> 'full_name', v_branch, p_actor) m;

  insert into public.orders (business_id, order_number, customer_id, branch_id, owner_id, stage_id, due_date, notes,
                             external_ref, created_by)
  values (p_business_id, private.next_number(p_business_id, 'order', 'O-'), v_customer,
          coalesce(v_branch, (select branch_id from public.customers where id = v_customer)),
          v_owner, v_open, nullif(p_row ->> 'due_date', '')::date, nullif(trim(p_row ->> 'notes'), ''), v_ref, p_actor)
  returning id into v_id;

  perform private.insert_document_items(p_business_id, 'order', v_id, jsonb_build_array(jsonb_build_object(
    'description', coalesce(nullif(trim(p_row ->> 'description'), ''), 'Imported order'),
    'quantity', 1, 'unit_price', v_total)));

  if v_paid > 0 then
    insert into public.payments (business_id, order_id, customer_id, kind, amount, method, reference, received_at, recorded_by)
    values (p_business_id, v_id, v_customer, 'payment', v_paid,
            coalesce(nullif(p_row ->> 'payment_method', ''), 'other')::public.payment_method,
            coalesce(v_ref, 'Import'), coalesce(private.import_ts(p_row ->> 'paid_at'), v_created), p_actor);
  end if;

  if v_stage.id <> v_open then
    update public.orders set stage_id = v_stage.id where id = v_id;
  end if;
  update public.orders
     set created_at = v_created,
         closed_at = case when v_stage.category = 'open' then null
                          else greatest(coalesce(private.import_ts(p_row ->> 'closed_at'), v_created), v_created) end
   where id = v_id;

  return query select 'created', v_id;
end;
$$;

create or replace function public.start_import(p_business_id uuid, p_kind text, p_file_name text, p_total_rows int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_permission(p_business_id, 'data.import') then
    raise exception 'not allowed to import' using errcode = '42501';
  end if;
  insert into public.import_jobs (business_id, kind, file_name, total_rows, created_by)
  values (p_business_id, p_kind, p_file_name, p_total_rows, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Imports up to 500 rows of a job. Each row is its own savepoint: one bad row
-- is recorded as failed and the rest carry on. Rows already processed for this
-- job are skipped, so a batch can be retried safely.
create or replace function public.import_rows(p_job_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.import_jobs;
  v_row jsonb;
  v_n int;
  v_outcome text;
  v_record uuid;
  v_counts jsonb := '{"created":0,"matched":0,"skipped":0,"failed":0}';
  v_errors jsonb := '[]';
begin
  select * into v_job from public.import_jobs where id = p_job_id for update;
  if v_job.id is null or not private.has_permission(v_job.business_id, 'data.import') then
    raise exception 'not allowed to import' using errcode = '42501';
  end if;
  if v_job.status <> 'running' then
    raise exception 'import is already finished' using errcode = '23514';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'rows must be a list of at most 500' using errcode = '22023';
  end if;

  perform set_config('scaler.importing', 'on', true);

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_n := (v_row ->> 'row')::int;
    if v_n is null or v_n < 1 or v_n > v_job.total_rows then
      raise exception 'row number out of range' using errcode = '22023';
    end if;
    continue when exists (select 1 from public.import_job_rows where job_id = v_job.id and row_number = v_n);

    begin
      if v_job.kind = 'customers' then
        select i.outcome, i.record_id into v_outcome, v_record from private.import_customer(v_job.business_id, v_row, auth.uid()) i;
      elsif v_job.kind = 'leads' then
        select i.outcome, i.record_id into v_outcome, v_record from private.import_lead(v_job.business_id, v_row, auth.uid()) i;
      else
        select i.outcome, i.record_id into v_outcome, v_record from private.import_order(v_job.business_id, v_row, auth.uid()) i;
      end if;
    exception when others then
      v_outcome := 'failed';
      v_record := null;
      v_errors := v_errors || jsonb_build_object('row', v_n, 'error', left(sqlerrm, 200));
    end;

    insert into public.import_job_rows (business_id, job_id, row_number, outcome, record_id)
    values (v_job.business_id, v_job.id, v_n, v_outcome, v_record);
    v_counts := jsonb_set(v_counts, array[v_outcome], to_jsonb((v_counts ->> v_outcome)::int + 1));
  end loop;

  perform set_config('scaler.importing', 'off', true);

  update public.import_jobs
     set created_count = created_count + (v_counts ->> 'created')::int,
         matched_count = matched_count + (v_counts ->> 'matched')::int,
         skipped_count = skipped_count + (v_counts ->> 'skipped')::int,
         failed_count = failed_count + (v_counts ->> 'failed')::int,
         errors = case when jsonb_array_length(errors) >= 500 then errors
                       else (select coalesce(jsonb_agg(e), '[]') from (
                               select e from jsonb_array_elements(errors || v_errors) e limit 500) x) end
   where id = v_job.id;

  return v_counts || jsonb_build_object('errors', v_errors);
end;
$$;

create or replace function public.finish_import(p_job_id uuid)
returns public.import_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.import_jobs;
begin
  select * into v_job from public.import_jobs where id = p_job_id for update;
  if v_job.id is null or not private.has_permission(v_job.business_id, 'data.import') then
    raise exception 'not allowed to import' using errcode = '42501';
  end if;
  if v_job.status = 'running' then
    update public.import_jobs set status = 'done', finished_at = now() where id = v_job.id returning * into v_job;
    insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
    values (v_job.business_id, auth.uid(), 'import', v_job.kind, v_job.id::text,
            jsonb_build_object('file', v_job.file_name, 'rows', v_job.total_rows, 'created', v_job.created_count,
                               'matched', v_job.matched_count, 'skipped', v_job.skipped_count, 'failed', v_job.failed_count));
  end if;
  return v_job;
end;
$$;

-- =====================================================================
-- Rate limits (fixed windows; rows older than a day are cleared by housekeeping)
-- =====================================================================
create table private.rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  hits          int not null default 1,
  primary key (bucket, window_start)
);

-- True while the bucket is within p_limit hits for the current window.
create or replace function private.hit_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_limits (bucket, window_start) values (p_bucket, v_start)
  on conflict (bucket, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Public lead API: 120 submissions a minute per key. Unknown keys pass here
-- and are refused by api_submit_lead.
create or replace function public.api_rate_limit(p_api_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key uuid;
begin
  select id into v_key from public.api_keys where key_hash = private.hash_token(p_api_key) and revoked_at is null;
  if v_key is null then return true; end if;
  return private.hit_rate_limit('api:' || v_key, 120, 60);
end;
$$;

-- Exports: 20 an hour per person.
create or replace function public.export_allowed(p_business_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_business_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return private.hit_rate_limit('export:' || auth.uid(), 20, 3600);
end;
$$;

-- Exports are audited (Sprint 8); large ones now also alert the people who can read the audit log.
create or replace function public.log_export(p_business_id uuid, p_kind text, p_rows int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
begin
  if not private.is_member(p_business_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (p_business_id, auth.uid(), 'export', left(p_kind, 40), null, jsonb_build_object('rows', p_rows));

  if p_rows >= 1000 then
    select coalesce(full_name, 'Someone') into v_actor from public.profiles where id = auth.uid();
    insert into public.notifications (business_id, user_id, type, title, body, link)
    select p_business_id, m.user_id, 'large_export',
           format('%s exported %s %s', v_actor, p_rows, left(p_kind, 40)),
           'Large exports are listed in the audit log.', '/settings/audit'
      from public.business_memberships m
     where m.business_id = p_business_id and m.status = 'active' and m.user_id <> auth.uid()
       and exists (select 1 from public.role_permissions rp
                    where rp.role_id = m.role_id and rp.permission_key = 'audit.view');
  end if;
end;
$$;

-- =====================================================================
-- Web push
-- =====================================================================
-- Per person, not per business: one phone receives notifications from every
-- business its owner belongs to.
create table public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  endpoint         text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh           text not null check (length(p256dh) between 20 and 200),
  auth             text not null check (length(auth) between 8 and 100),
  user_agent       text check (length(user_agent) <= 300),
  failure_count    int not null default 0,
  last_success_at  timestamptz,
  created_at       timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_subscriptions_own_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- A browser endpoint belongs to whoever subscribed last on that device.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, failure_count = 0
  returning id into v_id;
  return v_id;
end;
$$;

alter table public.notifications add column pushed_at timestamptz;
update public.notifications set pushed_at = created_at;
create index notifications_push_idx on public.notifications (id) where pushed_at is null;

-- Marks up to p_limit new notifications as pushed and returns the subscriptions
-- to wake (one per device). Notifications older than an hour are marked, not sent.
create or replace function public.claim_push_batch(p_limit int default 200)
returns table (subscription_id uuid, endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select n.id, n.user_id, n.created_at from public.notifications n
     where n.pushed_at is null
     order by n.id
     limit p_limit
     for update skip locked
  ), marked as (
    update public.notifications n set pushed_at = now() from due where n.id = due.id
    returning due.user_id, due.created_at
  )
  select distinct s.id, s.endpoint, s.p256dh, s.auth
    from marked m
    join public.push_subscriptions s on s.user_id = m.user_id
   where m.created_at > now() - interval '1 hour';
end;
$$;

-- p_status: 'ok', 'gone' (410/404: the browser dropped it) or 'failed'.
create or replace function public.record_push_result(p_subscription_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status = 'ok' then
    update public.push_subscriptions set failure_count = 0, last_success_at = now() where id = p_subscription_id;
  elsif p_status = 'gone' then
    delete from public.push_subscriptions where id = p_subscription_id;
  else
    update public.push_subscriptions set failure_count = failure_count + 1 where id = p_subscription_id;
    delete from public.push_subscriptions where id = p_subscription_id and failure_count >= 5;
  end if;
end;
$$;

-- =====================================================================
-- Job heartbeats, health and housekeeping
-- =====================================================================
create table private.job_heartbeats (
  name         text primary key,
  last_run_at  timestamptz not null,
  last_ok_at   timestamptz,
  last_error   text,
  details      jsonb
);

create or replace function public.record_job_heartbeat(p_name text, p_error text default null, p_details jsonb default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.job_heartbeats (name, last_run_at, last_ok_at, last_error, details)
  values (p_name, now(), case when p_error is null then now() end, left(p_error, 500), p_details)
  on conflict (name) do update
    set last_run_at = now(),
        last_ok_at = case when p_error is null then now() else private.job_heartbeats.last_ok_at end,
        last_error = left(p_error, 500),
        details = p_details;
$$;

-- For uptime monitors. Says only whether the database answers and whether
-- background jobs ran successfully in the last 15 minutes.
create or replace function public.health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'database', 'ok',
    'jobs_last_ok_at', (select max(last_ok_at) from private.job_heartbeats),
    'jobs_ok', coalesce((select max(last_ok_at) > now() - interval '15 minutes' from private.job_heartbeats), false));
$$;

create or replace function public.housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits int;
  v_idem int;
begin
  delete from private.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_limits = row_count;
  delete from public.api_idempotency_keys where created_at < now() - interval '30 days';
  get diagnostics v_idem = row_count;
  return jsonb_build_object('rate_limit_rows', v_limits, 'idempotency_keys', v_idem);
end;
$$;

-- =====================================================================
-- Privilege clean-up (found by supabase/tests/99_security_audit.sql)
-- =====================================================================
-- Supabase's default grants gave the anonymous role full table rights on the
-- foundation tables, and every role TRUNCATE, which RLS does not cover.
-- Policies already blocked all of it; the grants are removed as a second line.
-- Signed-out visitors only ever call the RPCs granted to anon explicitly.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- =====================================================================
-- Row level security at scale (docs/load-test.md)
-- =====================================================================
-- The original read policies call permission helpers once per row. At 150,000
-- leads a salesperson's lead count took 34 s. These helpers return the caller's
-- businesses, permissions and branches as arrays; wrapped in (select …) they run
-- once per statement (an InitPlan), and each row is only compared with them.
-- Access rules are unchanged: has_permission(b, p) ⇔ b ∈ permitted_business_ids(p),
-- is_member(b) ⇔ b ∈ my_business_ids(), branch_visible(b, br) ⇔ br is null or
-- br ∈ my_branch_ids() (a row's branch always belongs to its business).

create or replace function private.permitted_business_ids(p_permission text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.business_id), '{}')
    from public.business_memberships m
    join public.businesses b on b.id = m.business_id
    join public.role_permissions rp on rp.role_id = m.role_id
   where m.user_id = auth.uid() and m.status = 'active' and b.status = 'active' and rp.permission_key = p_permission;
$$;

create or replace function private.my_business_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.business_id), '{}')
    from public.business_memberships m
    join public.businesses b on b.id = m.business_id
   where m.user_id = auth.uid() and m.status = 'active' and b.status = 'active';
$$;

create or replace function private.my_branch_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(b.id), '{}')
    from public.branches b
    join public.business_memberships m on m.business_id = b.business_id and m.user_id = auth.uid() and m.status = 'active'
   where m.all_branches
      or exists (select 1 from public.user_branch_access uba where uba.membership_id = m.id and uba.branch_id = b.id);
$$;

-- Customers seen through their leads: only checked for people limited to their own customers.
create or replace function private.owns_lead_of(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.leads l where l.customer_id = p_customer_id and l.owner_id = auth.uid());
$$;

alter policy leads_select on public.leads using (
  (business_id = any ((select private.permitted_business_ids('leads.view_all'))::uuid[])
   and (branch_id is null or branch_id = any ((select private.my_branch_ids())::uuid[])))
  or (owner_id = (select auth.uid())
      and business_id = any ((select private.permitted_business_ids('leads.view_assigned'))::uuid[])));

alter policy customers_select on public.customers using (
  (business_id = any ((select private.permitted_business_ids('customers.view_all'))::uuid[])
   and (branch_id is null or branch_id = any ((select private.my_branch_ids())::uuid[])))
  or (business_id = any ((select private.permitted_business_ids('customers.view_assigned'))::uuid[])
      and (owner_id = (select auth.uid()) or private.owns_lead_of(id))));

alter policy orders_select on public.orders using (
  (business_id = any ((select private.permitted_business_ids('orders.view_all'))::uuid[])
   and (branch_id is null or branch_id = any ((select private.my_branch_ids())::uuid[])))
  or (owner_id = (select auth.uid())
      and business_id = any ((select private.permitted_business_ids('orders.view_assigned'))::uuid[])));

alter policy quotations_select on public.quotations using (
  (business_id = any ((select private.permitted_business_ids('orders.view_all'))::uuid[])
   and (branch_id is null or branch_id = any ((select private.my_branch_ids())::uuid[])))
  or (owner_id = (select auth.uid())
      and business_id = any ((select private.permitted_business_ids('orders.view_assigned'))::uuid[])));

alter policy payments_select on public.payments using (
  business_id = any ((select private.permitted_business_ids('payments.view'))::uuid[])
  and exists (select 1 from public.orders o where o.id = payments.order_id));

alter policy tasks_select on public.tasks using (
  business_id = any ((select private.my_business_ids())::uuid[])
  and (assignee_id = (select auth.uid())
       or created_by = (select auth.uid())
       or (business_id = any ((select private.permitted_business_ids('tasks.view_all'))::uuid[])
           and (branch_id is null or branch_id = any ((select private.my_branch_ids())::uuid[])))
       or (lead_id is not null and exists (select 1 from public.leads l where l.id = tasks.lead_id))));

alter policy conversations_select on public.conversations using (
  business_id = any ((select private.permitted_business_ids('inbox.view_all'))::uuid[])
  or (assignee_id = (select auth.uid())
      and business_id = any ((select private.permitted_business_ids('inbox.view_assigned'))::uuid[])));

alter policy appointments_select on public.appointments using (
  business_id = any ((select private.permitted_business_ids('appointments.view'))::uuid[])
  and (branch_id is null or branch_id = any ((select private.my_branch_ids())::uuid[]) or staff_id = (select auth.uid())));

alter policy walk_ins_select on public.walk_ins using (
  business_id = any ((select private.permitted_business_ids('appointments.view'))::uuid[])
  and (branch_id is null or branch_id = any ((select private.my_branch_ids())::uuid[]) or staff_id = (select auth.uid())));

alter policy campaigns_select on public.campaigns using (
  business_id = any ((select private.permitted_business_ids('campaigns.view'))::uuid[])
  or business_id = any ((select private.permitted_business_ids('campaigns.manage'))::uuid[]));

alter policy suppressions_select on public.suppressions using (
  business_id = any ((select private.permitted_business_ids('campaigns.view'))::uuid[])
  or business_id = any ((select private.permitted_business_ids('campaigns.manage'))::uuid[]));

alter policy audit_select on public.audit_logs using (
  business_id = any ((select private.permitted_business_ids('audit.view'))::uuid[])
  or (select private.is_platform_admin()));

alter policy notifications_select on public.notifications using (
  user_id = (select auth.uid()) and business_id = any ((select private.my_business_ids())::uuid[]));

-- Indexes for the list orderings the app uses (lead list sorts by recent activity or score).
create index leads_activity_idx on public.leads (business_id, last_activity_at desc) where archived_at is null;
drop index public.leads_score_idx;
create index leads_score_idx on public.leads (business_id, score desc, last_activity_at desc) where archived_at is null;
-- Lead scoring checks for appointments on every lead change.
create index appointments_lead_idx on public.appointments (lead_id) where lead_id is not null;

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.start_import(uuid, text, text, int) from public, anon;
revoke execute on function public.import_rows(uuid, jsonb) from public, anon;
revoke execute on function public.finish_import(uuid) from public, anon;
revoke execute on function public.export_allowed(uuid) from public, anon;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.start_import(uuid, text, text, int) to authenticated;
grant execute on function public.import_rows(uuid, jsonb) to authenticated;
grant execute on function public.finish_import(uuid) to authenticated;
grant execute on function public.export_allowed(uuid) to authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

revoke execute on function public.api_rate_limit(text) from public;
grant execute on function public.api_rate_limit(text) to anon, authenticated;
revoke execute on function public.health() from public;
grant execute on function public.health() to anon, authenticated, service_role;

revoke execute on function public.claim_push_batch(int) from public, anon, authenticated;
revoke execute on function public.record_push_result(uuid, text) from public, anon, authenticated;
revoke execute on function public.record_job_heartbeat(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.housekeeping() from public, anon, authenticated;
grant execute on function public.claim_push_batch(int) to service_role;
grant execute on function public.record_push_result(uuid, text) to service_role;
grant execute on function public.record_job_heartbeat(text, text, jsonb) to service_role;
grant execute on function public.housekeeping() to service_role;
