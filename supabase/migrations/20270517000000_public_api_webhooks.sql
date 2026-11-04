-- Sprint 13: public API and outbound webhooks (ADR 0014).
--
--   * API keys carry scopes; the Sprint 2 keys become leads:write keys.
--   * /api/v1 reads and writes go through api_* functions: the key decides the
--     business and the scopes, then the same tables, triggers and guards as the
--     app do the work (a key acts like a user with exactly its scopes).
--   * Per-plan rate limits with the numbers the X-RateLimit-* headers need.
--   * Outbound webhooks: endpoints, an event outbox written by triggers,
--     deliveries sent and retried by the job route, a delivery log with replay.

-- =====================================================================
-- Scoped API keys
-- =====================================================================
create or replace function private.api_scopes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['leads:read', 'leads:write', 'customers:read', 'orders:read', 'orders:write', 'tasks:write', 'webhooks:manage'];
$$;

-- Existing keys were made for website forms: they keep exactly that.
alter table public.api_keys add column scopes text[] not null default '{leads:write}';
alter table public.api_keys add constraint api_keys_scopes_check
  check (cardinality(scopes) between 1 and 7
         and scopes <@ array['leads:read', 'leads:write', 'customers:read', 'orders:read', 'orders:write', 'tasks:write', 'webhooks:manage']);

grant select (scopes) on public.api_keys to authenticated;

-- Requests a minute per key, by plan (the daily allowance stays daily_api_calls).
alter table public.plans add column api_requests_per_minute int check (api_requests_per_minute > 0);
update public.plans set api_requests_per_minute = case key
  when 'starter' then 120 when 'growth' then 300 when 'scale' then 600 else null end;

drop function public.create_api_key(uuid, text);
create or replace function public.create_api_key(p_business_id uuid, p_name text, p_scopes text[] default '{leads:write}')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'sk_live_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_scopes text[] := array(select distinct s from unnest(coalesce(p_scopes, '{}')) s order by s);
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage API keys' using errcode = '42501';
  end if;
  if cardinality(v_scopes) = 0 then
    raise exception 'choose at least one scope' using errcode = '23514';
  end if;
  if not v_scopes <@ private.api_scopes() then
    raise exception 'unknown scope' using errcode = '23514';
  end if;
  insert into public.api_keys (business_id, name, prefix, key_hash, created_by, scopes)
  values (p_business_id, p_name, left(v_key, 12), private.hash_token(v_key), auth.uid(), v_scopes);
  return v_key;
end;
$$;
revoke execute on function public.create_api_key(uuid, text, text[]) from public, anon;
grant execute on function public.create_api_key(uuid, text, text[]) to authenticated;

-- The key's business, if the key is live and has the scope.
--   28000 unknown or revoked key (or a closed business)
--   42501 the key lacks the scope
--   25006 the business is read-only (suspended) and this is a write
create or replace function private.api_key_auth(p_api_key text, p_scope text, p_write boolean)
returns public.api_keys
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys;
  v_status public.business_status;
begin
  select k.* into v_key from public.api_keys k
   where k.key_hash = private.hash_token(coalesce(p_api_key, '')) and k.revoked_at is null;
  if not found then
    raise exception 'invalid api key' using errcode = '28000';
  end if;
  select status into v_status from public.businesses where id = v_key.business_id;
  if v_status is distinct from 'active' and v_status is distinct from 'suspended' then
    raise exception 'invalid api key' using errcode = '28000';
  end if;
  if not p_scope = any (v_key.scopes) then
    raise exception 'this key does not have the % scope', p_scope using errcode = '42501';
  end if;
  if p_write and v_status = 'suspended' then
    raise exception 'the business is read-only' using errcode = '25006';
  end if;
  -- One write a minute at most, so a busy key doesn't turn reads into writes.
  if v_key.last_used_at is null or v_key.last_used_at < now() - interval '1 minute' then
    update public.api_keys set last_used_at = now() where id = v_key.id;
  end if;
  return v_key;
end;
$$;

-- A read-only (suspended) business can still be read; its writes are refused
-- with business_read_only instead of looking like a bad key.
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
     and b.status in ('active', 'suspended');
$$;

-- Per-plan, per-key rate limit. Returns what the X-RateLimit-* headers need:
-- { allowed, limit, remaining, reset } (reset in seconds). Unknown keys are let
-- through here; the endpoint refuses them right after.
create or replace function public.api_rate(p_api_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key uuid;
  v_business uuid;
  v_limit int;
  v_daily int;
  v_hits int;
  v_now timestamptz := now();
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / 60) * 60);
  v_reset int := 60 - (floor(extract(epoch from now()))::bigint % 60)::int;
begin
  select id, business_id into v_key, v_business from public.api_keys
   where key_hash = private.hash_token(coalesce(p_api_key, '')) and revoked_at is null;
  if v_key is null then
    return jsonb_build_object('allowed', true);
  end if;
  v_limit := coalesce(private.plan_limit(v_business, 'api_requests_per_minute'), 1200);
  insert into private.rate_limits (bucket, window_start) values ('api:' || v_key, v_start)
  on conflict (bucket, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  if v_hits > v_limit then
    return jsonb_build_object('allowed', false, 'limit', v_limit, 'remaining', 0, 'reset', v_reset, 'window', 'minute');
  end if;
  v_daily := private.plan_limit(v_business, 'daily_api_calls');
  if v_daily is not null and private.usage_count(v_business, 'api_calls') >= v_daily then
    return jsonb_build_object('allowed', false, 'limit', v_limit, 'remaining', 0, 'window', 'day',
      'reset', ceil(extract(epoch from (date_trunc('day', v_now at time zone 'utc') + interval '1 day') - (v_now at time zone 'utc')))::int);
  end if;
  perform private.bump_usage(v_business, 'api_calls');
  return jsonb_build_object('allowed', true, 'limit', v_limit, 'remaining', greatest(v_limit - v_hits, 0), 'reset', v_reset);
end;
$$;

-- Sprint 9 callers keep working.
create or replace function public.api_rate_limit(p_api_key text)
returns boolean
language sql
security definer
set search_path = ''
as $$ select coalesce((public.api_rate(p_api_key) ->> 'allowed')::boolean, true) $$;

-- =====================================================================
-- Idempotency for every write
-- =====================================================================
-- Returns the stored response for a retried request, null for a new one.
-- Holds a transaction lock on the key so two retries in flight can't both run.
create or replace function private.api_idem_get(p_business_id uuid, p_key text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior public.api_idempotency_keys;
begin
  if p_key is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || p_key, 1));
  select * into v_prior from public.api_idempotency_keys where business_id = p_business_id and idempotency_key = p_key;
  if not found then
    return null;
  end if;
  if v_prior.request_hash <> p_hash then
    raise exception 'idempotency key reused with a different request' using errcode = 'P0409';
  end if;
  return v_prior.response || jsonb_build_object('replayed', true);
end;
$$;

create or replace function private.api_idem_put(p_business_id uuid, p_key text, p_hash text, p_response jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key is not null then
    insert into public.api_idempotency_keys (business_id, idempotency_key, request_hash, response)
    values (p_business_id, p_key, p_hash, p_response);
  end if;
  return p_response || jsonb_build_object('replayed', false);
end;
$$;

-- The website lead endpoint now checks the leads:write scope.
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
  v_key public.api_keys := private.api_key_auth(p_api_key, 'leads:write', true);
  v_input jsonb := coalesce(p_input, '{}');
  v_prior jsonb;
  v_result jsonb;
begin
  v_prior := private.api_idem_get(v_key.business_id, p_idempotency_key, p_request_hash);
  if v_prior is not null then
    return v_prior;
  end if;

  -- The API never chooses owner, status, branch or an existing customer id.
  v_input := (v_input - 'owner_id' - 'status_id' - 'customer_id' - 'source_id' - 'branch_id')
             || jsonb_build_object('reuse_open_lead', true);
  if not v_input ? 'source' then
    v_input := v_input || jsonb_build_object('source', 'website');
  end if;

  v_result := private.create_lead_internal(v_key.business_id, v_input, null);
  return private.api_idem_put(v_key.business_id, p_idempotency_key, p_request_hash, v_result);
end;
$$;

-- =====================================================================
-- API representations (also the webhook payloads)
-- Money is a string ("1250.00"): numeric(14,2) never becomes a float.
-- =====================================================================
create or replace function private.api_customer_json(c public.customers)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'object', 'customer', 'id', c.id, 'cif_number', c.cif_number, 'full_name', c.full_name,
    'phone', c.primary_phone, 'email', c.primary_email::text, 'gender', c.gender,
    'date_of_birth', c.date_of_birth, 'preferred_language', c.preferred_language,
    'branch_id', c.branch_id, 'owner_id', c.owner_id, 'custom_fields', c.custom_fields,
    'tags', (select coalesce(jsonb_agg(t.name order by t.name), '[]')
               from public.customer_tags ct join public.tags t on t.id = ct.tag_id where ct.customer_id = c.id),
    'merged_into_id', c.merged_into_id, 'created_at', c.created_at, 'updated_at', c.updated_at);
$$;

create or replace function private.api_lead_json(l public.leads)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'object', 'lead', 'id', l.id, 'lead_number', l.lead_number, 'customer_id', l.customer_id,
    'branch_id', l.branch_id, 'owner_id', l.owner_id,
    'status', s.key, 'status_name', s.name, 'status_category', s.category,
    'title', l.title, 'description', l.description, 'expected_value', l.expected_value::text,
    'source', fs.key, 'campaign', l.first_campaign, 'first_touch', l.first_touch,
    'latest_source', ls.key, 'latest_campaign', l.latest_campaign, 'latest_touch', l.latest_touch,
    'lost_reason_id', l.lost_reason_id, 'lost_note', l.lost_note,
    'next_follow_up_at', l.next_follow_up_at, 'custom_fields', l.custom_fields,
    'closed_at', l.closed_at, 'archived_at', l.archived_at, 'created_at', l.created_at, 'updated_at', l.updated_at)
    from public.lead_statuses s
    left join public.lead_sources fs on fs.id = l.first_source_id
    left join public.lead_sources ls on ls.id = l.latest_source_id
   where s.id = l.status_id;
$$;

create or replace function private.api_order_json(o public.orders)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'object', 'order', 'id', o.id, 'order_number', o.order_number, 'customer_id', o.customer_id,
    'lead_id', o.lead_id, 'branch_id', o.branch_id, 'owner_id', o.owner_id,
    'stage', s.key, 'stage_name', s.name, 'stage_category', s.category,
    'due_date', o.due_date, 'notes', o.notes,
    'subtotal', o.subtotal::text, 'discount_total', o.discount_total::text, 'tax_total', o.tax_total::text,
    'total', o.total::text, 'paid', (t.paid - t.refunded)::numeric(14,2)::text,
    'balance', (o.total - (t.paid - t.refunded))::numeric(14,2)::text,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'description', i.description, 'quantity', i.quantity::text,
                'unit_price', i.unit_price::text, 'discount', i.discount::text, 'tax_rate', i.tax_rate::text,
                'tax_amount', i.tax_amount::text, 'line_total', i.line_total::text,
                'catalog_item_id', i.catalog_item_id) order by i.position), '[]')
                from public.order_items i where i.order_id = o.id),
    'custom_fields', o.custom_fields, 'closed_at', o.closed_at, 'created_at', o.created_at, 'updated_at', o.updated_at)
    from public.order_stages s
    cross join lateral private.order_payment_totals(o.id) t
   where s.id = o.stage_id;
$$;

create or replace function private.api_payment_json(p public.payments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'object', 'payment', 'id', p.id, 'receipt_number', p.receipt_number, 'order_id', p.order_id,
    'customer_id', p.customer_id, 'kind', p.kind, 'amount', p.amount::text, 'method', p.method,
    'reference', p.reference, 'received_at', p.received_at, 'created_at', p.created_at);
$$;

create or replace function private.api_task_json(t public.tasks)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'object', 'task', 'id', t.id, 'lead_id', t.lead_id, 'customer_id', t.customer_id, 'branch_id', t.branch_id,
    'type', t.type, 'title', t.title, 'notes', t.notes, 'due_at', t.due_at, 'assignee_id', t.assignee_id,
    'completed_at', t.completed_at, 'cancelled_at', t.cancelled_at, 'outcome', t.outcome,
    'created_at', t.created_at, 'updated_at', t.updated_at);
$$;

-- =====================================================================
-- Reads: list (cursor pagination, updated_since) and get by id
-- =====================================================================
-- Lists page through (updated_at, id) per business.
create index customers_api_sync_idx on public.customers (business_id, updated_at, id);
create index leads_api_sync_idx on public.leads (business_id, updated_at, id);
create index orders_api_sync_idx on public.orders (business_id, updated_at, id);
create index payments_api_sync_idx on public.payments (business_id, created_at, id);

-- Lists in (updated_at, id) order, oldest first, so a client can sync by
-- remembering the last cursor or the last updated_at it saw. Payments never
-- change, so they are ordered by created_at.
create or replace function public.api_list(
  p_api_key text,
  p_resource text,
  p_after_ts timestamptz default null,
  p_after_id uuid default null,
  p_updated_since timestamptz default null,
  p_limit int default 50,
  p_filters jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_table text;
  v_ts text := 'updated_at';
  v_fn text;
  v_where text := '';
  v_key public.api_keys;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_filters jsonb := coalesce(p_filters, '{}');
  v_data jsonb := '[]';
  v_n int := 0;
  v_more boolean := false;
  v_last_ts timestamptz;
  v_last_id uuid;
  r record;
begin
  case p_resource
    when 'customers' then
      v_scope := 'customers:read'; v_table := 'customers'; v_fn := 'api_customer_json';
      v_where := $w$ and ($5 ->> 'phone' is null or exists (select 1 from public.customer_contacts cc
                       where cc.customer_id = t.id and cc.kind = 'phone' and cc.value = $5 ->> 'phone'))
                     and ($5 ->> 'email' is null or exists (select 1 from public.customer_contacts cc
                       where cc.customer_id = t.id and cc.kind = 'email' and cc.value = lower($5 ->> 'email'))) $w$;
    when 'leads' then
      v_scope := 'leads:read'; v_table := 'leads'; v_fn := 'api_lead_json';
      v_where := $w$ and ($5 ->> 'customer_id' is null or t.customer_id = ($5 ->> 'customer_id')::uuid)
                     and ($5 ->> 'status' is null or t.status_id = (select s.id from public.lead_statuses s
                            where s.business_id = $1 and s.key = $5 ->> 'status')) $w$;
    when 'orders' then
      v_scope := 'orders:read'; v_table := 'orders'; v_fn := 'api_order_json';
      v_where := $w$ and ($5 ->> 'customer_id' is null or t.customer_id = ($5 ->> 'customer_id')::uuid)
                     and ($5 ->> 'stage' is null or t.stage_id = (select s.id from public.order_stages s
                            where s.business_id = $1 and s.key = $5 ->> 'stage')) $w$;
    when 'payments' then
      v_scope := 'orders:read'; v_table := 'payments'; v_fn := 'api_payment_json'; v_ts := 'created_at';
      v_where := $w$ and ($5 ->> 'customer_id' is null or t.customer_id = ($5 ->> 'customer_id')::uuid)
                     and ($5 ->> 'order_id' is null or t.order_id = ($5 ->> 'order_id')::uuid) $w$;
    else
      raise exception 'unknown resource' using errcode = '22023';
  end case;
  v_key := private.api_key_auth(p_api_key, v_scope, false);

  for r in execute format(
    $q$select t.%1$I as ts, t.id, private.%2$I(t) as j
         from public.%3$I t
        where t.business_id = $1
          and ($2 is null or t.%1$I >= $2)
          and ($3 is null or (t.%1$I, t.id) > ($3, $4))
          %4$s
        order by t.%1$I, t.id
        limit $6$q$, v_ts, v_fn, v_table, v_where)
    using v_key.business_id, p_updated_since, p_after_ts, p_after_id, v_filters, v_limit + 1
  loop
    v_n := v_n + 1;
    if v_n > v_limit then
      v_more := true;
      exit;
    end if;
    v_data := v_data || jsonb_build_array(r.j);
    v_last_ts := r.ts;
    v_last_id := r.id;
  end loop;

  return jsonb_build_object(
    'object', 'list', 'data', v_data, 'has_more', v_more,
    'next', case when v_more then jsonb_build_object('t', v_last_ts, 'id', v_last_id) end);
end;
$$;

create or replace function public.api_get(p_api_key text, p_resource text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys;
begin
  case p_resource
    when 'customers' then
      v_key := private.api_key_auth(p_api_key, 'customers:read', false);
      return (select private.api_customer_json(c) from public.customers c where c.id = p_id and c.business_id = v_key.business_id);
    when 'leads' then
      v_key := private.api_key_auth(p_api_key, 'leads:read', false);
      return (select private.api_lead_json(l) from public.leads l where l.id = p_id and l.business_id = v_key.business_id);
    when 'orders' then
      v_key := private.api_key_auth(p_api_key, 'orders:read', false);
      return (select private.api_order_json(o) from public.orders o where o.id = p_id and o.business_id = v_key.business_id);
    when 'payments' then
      v_key := private.api_key_auth(p_api_key, 'orders:read', false);
      return (select private.api_payment_json(p) from public.payments p where p.id = p_id and p.business_id = v_key.business_id);
    else
      raise exception 'unknown resource' using errcode = '22023';
  end case;
end;
$$;

-- =====================================================================
-- Writes. Each takes an optional idempotency key and the request hash, and
-- returns { status, <resource> } (status is the HTTP status to answer with).
-- =====================================================================
create or replace function public.api_update_lead(
  p_api_key text, p_lead_id uuid, p_idempotency_key text, p_request_hash text, p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys := private.api_key_auth(p_api_key, 'leads:write', true);
  v_in jsonb := coalesce(p_input, '{}');
  v_prior jsonb;
  v_lead public.leads;
  v_status uuid;
begin
  v_prior := private.api_idem_get(v_key.business_id, p_idempotency_key, p_request_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select * into v_lead from public.leads where id = p_lead_id and business_id = v_key.business_id for update;
  if not found then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  if v_in ? 'status' then
    select id into v_status from public.lead_statuses
     where business_id = v_key.business_id and key = v_in ->> 'status' and is_active;
    if v_status is null then
      raise exception 'unknown lead status %', v_in ->> 'status' using errcode = '22023';
    end if;
  end if;

  -- The same guards as the app run on this update (stage rules, lost reasons, owners).
  update public.leads l set
    status_id = coalesce(v_status, l.status_id),
    title = case when v_in ? 'title' then nullif(trim(v_in ->> 'title'), '') else l.title end,
    description = case when v_in ? 'description' then nullif(trim(v_in ->> 'description'), '') else l.description end,
    expected_value = case when v_in ? 'expected_value' then nullif(v_in ->> 'expected_value', '')::numeric(14,2) else l.expected_value end,
    owner_id = case when v_in ? 'owner_id' then nullif(v_in ->> 'owner_id', '')::uuid else l.owner_id end,
    lost_reason_id = case when v_in ? 'lost_reason_id' then nullif(v_in ->> 'lost_reason_id', '')::uuid else l.lost_reason_id end,
    lost_note = case when v_in ? 'lost_note' then nullif(trim(v_in ->> 'lost_note'), '') else l.lost_note end,
    custom_fields = case when v_in ? 'custom_fields' then l.custom_fields || (
        select coalesce(jsonb_object_agg(e.key, e.value), '{}')
          from jsonb_each(case when jsonb_typeof(v_in -> 'custom_fields') = 'object' then v_in -> 'custom_fields' else '{}' end) e
         where exists (select 1 from public.custom_field_definitions d
                        where d.business_id = l.business_id and d.entity = 'lead' and d.key = e.key and d.is_active))
      else l.custom_fields end,
    last_activity_at = now()
   where l.id = v_lead.id
  returning * into v_lead;

  return private.api_idem_put(v_key.business_id, p_idempotency_key, p_request_hash,
    jsonb_build_object('status', 200, 'lead', private.api_lead_json(v_lead)));
end;
$$;

create or replace function public.api_create_order(
  p_api_key text, p_idempotency_key text, p_request_hash text, p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys := private.api_key_auth(p_api_key, 'orders:write', true);
  v_in jsonb := coalesce(p_input, '{}');
  v_customer uuid := nullif(v_in ->> 'customer_id', '')::uuid;
  v_lead uuid := nullif(v_in ->> 'lead_id', '')::uuid;
  v_prior jsonb;
  v_stage uuid;
  v_order public.orders;
begin
  v_prior := private.api_idem_get(v_key.business_id, p_idempotency_key, p_request_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if v_customer is null or not exists (select 1 from public.customers c
      where c.id = v_customer and c.business_id = v_key.business_id and c.merged_into_id is null) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if v_lead is not null and not exists (select 1 from public.leads l
      where l.id = v_lead and l.business_id = v_key.business_id and l.customer_id = v_customer) then
    raise exception 'lead belongs to another customer' using errcode = '23514';
  end if;
  if jsonb_array_length(case when jsonb_typeof(v_in -> 'items') = 'array' then v_in -> 'items' else '[]' end) = 0 then
    raise exception 'an order needs at least one line' using errcode = '23514';
  end if;

  select id into v_stage from public.order_stages
   where business_id = v_key.business_id and category = 'open' and is_active
   order by position limit 1;

  insert into public.orders (business_id, order_number, customer_id, lead_id, branch_id, stage_id, due_date, notes, custom_fields)
  values (v_key.business_id, private.next_number(v_key.business_id, 'order', 'O-'), v_customer, v_lead,
          (select branch_id from public.customers where id = v_customer), v_stage,
          nullif(v_in ->> 'due_date', '')::date, nullif(trim(v_in ->> 'notes'), ''),
          private.order_custom_fields(v_key.business_id, v_in -> 'custom_fields'))
  returning * into v_order;
  perform private.insert_document_items(v_key.business_id, 'order', v_order.id, v_in -> 'items');

  select * into v_order from public.orders where id = v_order.id;
  return private.api_idem_put(v_key.business_id, p_idempotency_key, p_request_hash,
    jsonb_build_object('status', 201, 'order', private.api_order_json(v_order)));
end;
$$;

create or replace function public.api_update_order(
  p_api_key text, p_order_id uuid, p_idempotency_key text, p_request_hash text, p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys := private.api_key_auth(p_api_key, 'orders:write', true);
  v_in jsonb := coalesce(p_input, '{}');
  v_prior jsonb;
  v_order public.orders;
  v_stage uuid;
begin
  v_prior := private.api_idem_get(v_key.business_id, p_idempotency_key, p_request_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select * into v_order from public.orders where id = p_order_id and business_id = v_key.business_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_in ? 'stage' then
    select id into v_stage from public.order_stages where business_id = v_key.business_id and key = v_in ->> 'stage';
    if v_stage is null then
      raise exception 'unknown order stage %', v_in ->> 'stage' using errcode = '22023';
    end if;
  end if;

  update public.orders o set
    stage_id = coalesce(v_stage, o.stage_id),
    due_date = case when v_in ? 'due_date' then nullif(v_in ->> 'due_date', '')::date else o.due_date end,
    notes = case when v_in ? 'notes' then nullif(trim(v_in ->> 'notes'), '') else o.notes end,
    custom_fields = case when v_in ? 'custom_fields'
                         then o.custom_fields || private.order_custom_fields(o.business_id, v_in -> 'custom_fields')
                         else o.custom_fields end
   where o.id = v_order.id
  returning * into v_order;

  return private.api_idem_put(v_key.business_id, p_idempotency_key, p_request_hash,
    jsonb_build_object('status', 200, 'order', private.api_order_json(v_order)));
end;
$$;

create or replace function public.api_create_task(
  p_api_key text, p_idempotency_key text, p_request_hash text, p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys := private.api_key_auth(p_api_key, 'tasks:write', true);
  v_in jsonb := coalesce(p_input, '{}');
  v_lead uuid := nullif(v_in ->> 'lead_id', '')::uuid;
  v_customer uuid := nullif(v_in ->> 'customer_id', '')::uuid;
  v_assignee uuid := nullif(v_in ->> 'assignee_id', '')::uuid;
  v_prior jsonb;
  v_task public.tasks;
begin
  v_prior := private.api_idem_get(v_key.business_id, p_idempotency_key, p_request_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if v_lead is not null then
    select coalesce(v_assignee, l.owner_id) into v_assignee from public.leads l
     where l.id = v_lead and l.business_id = v_key.business_id;
    if not found then
      raise exception 'lead not found' using errcode = 'P0002';
    end if;
  elsif v_customer is not null then
    select coalesce(v_assignee, c.owner_id) into v_assignee from public.customers c
     where c.id = v_customer and c.business_id = v_key.business_id and c.merged_into_id is null;
    if not found then
      raise exception 'customer not found' using errcode = 'P0002';
    end if;
  end if;
  if v_assignee is null then
    raise exception 'assignee_id is required when the lead or customer has no owner' using errcode = '23514';
  end if;

  insert into public.tasks (business_id, lead_id, customer_id, type, title, notes, due_at, assignee_id)
  values (v_key.business_id, v_lead, case when v_lead is null then v_customer end,
          coalesce(nullif(v_in ->> 'type', ''), 'follow_up')::public.task_type,
          trim(v_in ->> 'title'), nullif(trim(v_in ->> 'notes'), ''),
          (v_in ->> 'due_at')::timestamptz, v_assignee)
  returning * into v_task;

  return private.api_idem_put(v_key.business_id, p_idempotency_key, p_request_hash,
    jsonb_build_object('status', 201, 'task', private.api_task_json(v_task)));
end;
$$;

-- =====================================================================
-- Outbound webhooks
-- =====================================================================
create or replace function private.webhook_event_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['lead.created', 'lead.stage_changed', 'order.created', 'order.stage_changed', 'payment.recorded', 'customer.merged'];
$$;

create table public.webhook_endpoints (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  url                   text not null check (url ~ '^https://[^\s/?#@]+(/[^\s]*)?$' and length(url) <= 2000),
  description           text check (length(description) <= 200),
  events                text[] not null check (cardinality(events) >= 1 and events <@ array['lead.created', 'lead.stage_changed', 'order.created', 'order.stage_changed', 'payment.recorded', 'customer.merged']),
  -- The signing secret is in Vault; the prefix helps people tell secrets apart.
  secret_vault_id       uuid not null,
  secret_prefix         text not null,
  is_active             boolean not null default true,
  disabled_reason       text check (length(disabled_reason) <= 300),
  consecutive_failures  int not null default 0,
  last_success_at       timestamptz,
  last_failure_at       timestamptz,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (business_id, id)
);
create index webhook_endpoints_business_idx on public.webhook_endpoints (business_id) where is_active;
create trigger webhook_endpoints_updated_at before update on public.webhook_endpoints
  for each row execute function private.set_updated_at();
create trigger audit_webhook_endpoints after insert or update or delete on public.webhook_endpoints
  for each row execute function private.audit_row();

-- The outbox: one row per event, written in the same transaction as the change.
create table public.webhook_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  type         text not null check (type = 'ping' or type = any (array['lead.created', 'lead.stage_changed', 'order.created', 'order.stage_changed', 'payment.recorded', 'customer.merged'])),
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  unique (business_id, id)
);
create index webhook_events_created_idx on public.webhook_events (created_at);

create table public.webhook_deliveries (
  id                bigint generated always as identity primary key,
  business_id       uuid not null,
  endpoint_id       uuid not null,
  event_id          bigint not null,
  status            text not null default 'pending' check (status in ('pending', 'sending', 'succeeded', 'failed', 'cancelled')),
  attempts          int not null default 0,
  next_attempt_at   timestamptz not null default now(),
  locked_until      timestamptz,
  last_status_code  int,
  last_error        text check (length(last_error) <= 500),
  duration_ms       int,
  delivered_at      timestamptz,
  replay_of         bigint references public.webhook_deliveries(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (business_id, endpoint_id) references public.webhook_endpoints (business_id, id) on delete cascade,
  foreign key (business_id, event_id) references public.webhook_events (business_id, id) on delete cascade
);
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at) where status in ('pending', 'sending');
create index webhook_deliveries_endpoint_idx on public.webhook_deliveries (endpoint_id, created_at desc);
create index webhook_deliveries_event_idx on public.webhook_deliveries (event_id);
create trigger webhook_deliveries_updated_at before update on public.webhook_deliveries
  for each row execute function private.set_updated_at();

-- Events are facts: never edited.
create or replace function private.webhook_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'webhook events are append-only' using errcode = '42501';
end;
$$;
create trigger webhook_events_append_only before update on public.webhook_events
  for each row execute function private.webhook_events_append_only();

alter table public.webhook_endpoints  enable row level security;
alter table public.webhook_events     enable row level security;
alter table public.webhook_deliveries enable row level security;

create policy webhook_endpoints_select on public.webhook_endpoints for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('integrations.manage'))::uuid[]));
create policy webhook_events_select on public.webhook_events for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('integrations.manage'))::uuid[]));
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('integrations.manage'))::uuid[]));
-- Written only by the functions below.
revoke all on public.webhook_endpoints, public.webhook_events, public.webhook_deliveries from anon, authenticated;
grant select on public.webhook_events, public.webhook_deliveries to authenticated;
grant select (id, business_id, url, description, events, secret_prefix, is_active, disabled_reason, consecutive_failures,
              last_success_at, last_failure_at, created_by, created_at, updated_at)
  on public.webhook_endpoints to authenticated;

-- Queues an event for every active endpoint that wants it. Cheap when nobody does.
create or replace function private.emit_webhook(p_business_id uuid, p_type text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event bigint;
begin
  if not exists (select 1 from public.webhook_endpoints e
                  where e.business_id = p_business_id and e.is_active and p_type = any (e.events)) then
    return;
  end if;
  insert into public.webhook_events (business_id, type, data) values (p_business_id, p_type, p_data)
  returning id into v_event;
  insert into public.webhook_deliveries (business_id, endpoint_id, event_id)
  select p_business_id, e.id, v_event from public.webhook_endpoints e
   where e.business_id = p_business_id and e.is_active and p_type = any (e.events);
end;
$$;

create or replace function private.webhook_on_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.emit_webhook(new.business_id, 'lead.created', private.api_lead_json(new));
  elsif new.status_id is distinct from old.status_id then
    perform private.emit_webhook(new.business_id, 'lead.stage_changed', jsonb_build_object(
      'lead', private.api_lead_json(new),
      'from_status', (select key from public.lead_statuses where id = old.status_id),
      'to_status', (select key from public.lead_statuses where id = new.status_id)));
  end if;
  return null;
end;
$$;
create trigger leads_webhooks after insert or update of status_id on public.leads
  for each row when (current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.webhook_on_lead();

-- A new order's lines and totals are written after the order row, so the
-- event is built at commit time.
create or replace function private.webhook_on_order_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = new.id;
  if found then
    perform private.emit_webhook(v_order.business_id, 'order.created', private.api_order_json(v_order));
  end if;
  return null;
end;
$$;
create constraint trigger orders_webhooks_created after insert on public.orders
  deferrable initially deferred
  for each row when (current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.webhook_on_order_created();

create or replace function private.webhook_on_order_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage_id is distinct from old.stage_id then
    perform private.emit_webhook(new.business_id, 'order.stage_changed', jsonb_build_object(
      'order', private.api_order_json(new),
      'from_stage', (select key from public.order_stages where id = old.stage_id),
      'to_stage', (select key from public.order_stages where id = new.stage_id)));
  end if;
  return null;
end;
$$;
create trigger orders_webhooks_stage after update of stage_id on public.orders
  for each row when (current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.webhook_on_order_stage();

create or replace function private.webhook_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.emit_webhook(new.business_id, 'payment.recorded', private.api_payment_json(new));
  return null;
end;
$$;
create trigger payments_webhooks after insert on public.payments
  for each row when (current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.webhook_on_payment();

create or replace function private.webhook_on_customer_merge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.merged_into_id is null and new.merged_into_id is not null then
    perform private.emit_webhook(new.business_id, 'customer.merged', jsonb_build_object(
      'merged_customer_id', new.id,
      'customer', (select private.api_customer_json(c) from public.customers c where c.id = new.merged_into_id)));
  end if;
  return null;
end;
$$;
create trigger customers_webhooks_merge after update of merged_into_id on public.customers
  for each row execute function private.webhook_on_customer_merge();

-- ---------------------------------------------------------------- managing endpoints
create or replace function private.webhook_endpoint_json(e public.webhook_endpoints)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'object', 'webhook_endpoint', 'id', e.id, 'url', e.url, 'description', e.description, 'events', to_jsonb(e.events),
    'secret_prefix', e.secret_prefix, 'is_active', e.is_active, 'disabled_reason', e.disabled_reason,
    'consecutive_failures', e.consecutive_failures, 'last_success_at', e.last_success_at,
    'last_failure_at', e.last_failure_at, 'created_at', e.created_at, 'updated_at', e.updated_at);
$$;

create or replace function private.webhook_check_input(p_url text, p_events text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_url is not null and (p_url !~ '^https://[^\s/?#@]+(/[^\s]*)?$' or length(p_url) > 2000) then
    raise exception 'the URL must start with https://' using errcode = '23514';
  end if;
  -- Addresses inside a private network are refused here and again at send time.
  if p_url ~* '^https://(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|0\.|\[|[^/]*\.(local|internal|localhost)(:|/|$))' then
    raise exception 'the URL must be a public address' using errcode = '23514';
  end if;
  if p_events is not null and (cardinality(p_events) = 0 or not p_events <@ private.webhook_event_types()) then
    raise exception 'choose events from the list' using errcode = '23514';
  end if;
end;
$$;

-- Creates an endpoint and returns it with its signing secret (shown once).
create or replace function private.webhook_create(p_business_id uuid, p_url text, p_events text[], p_description text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := 'whsec_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_events text[] := array(select distinct e from unnest(coalesce(p_events, '{}')) e order by e);
  v_endpoint public.webhook_endpoints;
begin
  perform private.webhook_check_input(trim(p_url), v_events);
  if (select count(*) from public.webhook_endpoints where business_id = p_business_id) >= 10 then
    raise exception 'a business can have up to 10 webhook endpoints' using errcode = '23514';
  end if;
  insert into public.webhook_endpoints (business_id, url, description, events, secret_vault_id, secret_prefix, created_by)
  values (p_business_id, trim(p_url), nullif(trim(p_description), ''), v_events,
          private.store_secret(null, v_secret, 'webhook_secret'), left(v_secret, 12), p_actor)
  returning * into v_endpoint;
  return jsonb_build_object('endpoint', private.webhook_endpoint_json(v_endpoint), 'secret', v_secret);
end;
$$;

-- Changes url, events, description or is_active. Turning an endpoint back on clears its failures.
create or replace function private.webhook_update(p_business_id uuid, p_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in jsonb := coalesce(p_input, '{}');
  v_events text[];
  v_endpoint public.webhook_endpoints;
begin
  if v_in ? 'events' then
    if jsonb_typeof(v_in -> 'events') <> 'array' then
      raise exception 'events must be a list' using errcode = '22023';
    end if;
    v_events := array(select distinct e from jsonb_array_elements_text(v_in -> 'events') e order by e);
  end if;
  perform private.webhook_check_input(trim(v_in ->> 'url'), v_events);
  update public.webhook_endpoints e set
    url = coalesce(trim(v_in ->> 'url'), e.url),
    events = coalesce(v_events, e.events),
    description = case when v_in ? 'description' then nullif(trim(v_in ->> 'description'), '') else e.description end,
    is_active = coalesce((v_in ->> 'is_active')::boolean, e.is_active),
    disabled_reason = case when coalesce((v_in ->> 'is_active')::boolean, e.is_active) then null
                           when (v_in ->> 'is_active')::boolean is false then 'Turned off by hand'
                           else e.disabled_reason end,
    consecutive_failures = case when (v_in ->> 'is_active')::boolean and not e.is_active then 0 else e.consecutive_failures end
   where e.id = p_id and e.business_id = p_business_id
  returning * into v_endpoint;
  if not found then
    raise exception 'webhook endpoint not found' using errcode = 'P0002';
  end if;
  -- Nothing waits for a switched-off endpoint.
  if not v_endpoint.is_active then
    update public.webhook_deliveries set status = 'cancelled', last_error = 'endpoint turned off'
     where endpoint_id = v_endpoint.id and status in ('pending', 'sending');
  end if;
  return private.webhook_endpoint_json(v_endpoint);
end;
$$;

create or replace function private.webhook_delete(p_business_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
begin
  delete from public.webhook_endpoints where id = p_id and business_id = p_business_id returning secret_vault_id into v_secret;
  if v_secret is null then
    raise exception 'webhook endpoint not found' using errcode = 'P0002';
  end if;
  perform vault.update_secret(v_secret, 'revoked');
end;
$$;

-- App (signed-in, integrations.manage)
create or replace function public.create_webhook_endpoint(p_business_id uuid, p_url text, p_events text[], p_description text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage webhooks' using errcode = '42501';
  end if;
  return private.webhook_create(p_business_id, p_url, p_events, p_description, auth.uid());
end;
$$;

create or replace function public.update_webhook_endpoint(p_business_id uuid, p_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage webhooks' using errcode = '42501';
  end if;
  return private.webhook_update(p_business_id, p_id, p_input);
end;
$$;

create or replace function public.delete_webhook_endpoint(p_business_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage webhooks' using errcode = '42501';
  end if;
  perform private.webhook_delete(p_business_id, p_id);
end;
$$;

create or replace function public.rotate_webhook_secret(p_business_id uuid, p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := 'whsec_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_vault uuid;
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage webhooks' using errcode = '42501';
  end if;
  select secret_vault_id into v_vault from public.webhook_endpoints where id = p_id and business_id = p_business_id for update;
  if v_vault is null then
    raise exception 'webhook endpoint not found' using errcode = 'P0002';
  end if;
  perform vault.update_secret(v_vault, v_secret);
  update public.webhook_endpoints set secret_prefix = left(v_secret, 12) where id = p_id;
  return v_secret;
end;
$$;

-- Sends a "ping" event to one endpoint, to check it end to end.
create or replace function public.send_webhook_test(p_business_id uuid, p_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event bigint;
  v_delivery bigint;
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage webhooks' using errcode = '42501';
  end if;
  if not exists (select 1 from public.webhook_endpoints where id = p_id and business_id = p_business_id and is_active) then
    raise exception 'turn the endpoint on first' using errcode = '23514';
  end if;
  insert into public.webhook_events (business_id, type, data)
  values (p_business_id, 'ping', jsonb_build_object('message', 'Test event from SCALER'))
  returning id into v_event;
  insert into public.webhook_deliveries (business_id, endpoint_id, event_id) values (p_business_id, p_id, v_event)
  returning id into v_delivery;
  return v_delivery;
end;
$$;

-- Sends an earlier event again, as a new delivery with its own 24 hours of retries.
create or replace function public.replay_webhook_delivery(p_business_id uuid, p_delivery_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.webhook_deliveries;
  v_new bigint;
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage webhooks' using errcode = '42501';
  end if;
  select * into v_old from public.webhook_deliveries where id = p_delivery_id and business_id = p_business_id;
  if not found then
    raise exception 'delivery not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.webhook_endpoints where id = v_old.endpoint_id and is_active) then
    raise exception 'turn the endpoint on first' using errcode = '23514';
  end if;
  insert into public.webhook_deliveries (business_id, endpoint_id, event_id, replay_of)
  values (p_business_id, v_old.endpoint_id, v_old.event_id, v_old.id)
  returning id into v_new;
  return v_new;
end;
$$;

-- API (webhooks:manage)
create or replace function public.api_list_webhooks(p_api_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys := private.api_key_auth(p_api_key, 'webhooks:manage', false);
begin
  return jsonb_build_object('object', 'list', 'has_more', false, 'next', null, 'data',
    (select coalesce(jsonb_agg(private.webhook_endpoint_json(e) order by e.created_at, e.id), '[]')
       from public.webhook_endpoints e where e.business_id = v_key.business_id));
end;
$$;

create or replace function public.api_create_webhook(p_api_key text, p_idempotency_key text, p_request_hash text, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys := private.api_key_auth(p_api_key, 'webhooks:manage', true);
  v_in jsonb := coalesce(p_input, '{}');
  v_prior jsonb;
  v_created jsonb;
begin
  -- The secret is only ever returned once, so a replay doesn't return it again.
  v_prior := private.api_idem_get(v_key.business_id, p_idempotency_key, p_request_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if jsonb_typeof(v_in -> 'events') is distinct from 'array' then
    raise exception 'events must be a list' using errcode = '22023';
  end if;
  v_created := private.webhook_create(v_key.business_id, v_in ->> 'url',
    array(select jsonb_array_elements_text(v_in -> 'events')), v_in ->> 'description', null);
  perform private.api_idem_put(v_key.business_id, p_idempotency_key, p_request_hash,
    jsonb_build_object('status', 201, 'webhook_endpoint', v_created -> 'endpoint'));
  return jsonb_build_object('status', 201, 'webhook_endpoint', (v_created -> 'endpoint') || jsonb_build_object('secret', v_created ->> 'secret'),
                            'replayed', false);
end;
$$;

create or replace function public.api_update_webhook(p_api_key text, p_id uuid, p_idempotency_key text, p_request_hash text, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys := private.api_key_auth(p_api_key, 'webhooks:manage', true);
  v_prior jsonb;
begin
  v_prior := private.api_idem_get(v_key.business_id, p_idempotency_key, p_request_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  return private.api_idem_put(v_key.business_id, p_idempotency_key, p_request_hash,
    jsonb_build_object('status', 200, 'webhook_endpoint', private.webhook_update(v_key.business_id, p_id, p_input)));
end;
$$;

create or replace function public.api_delete_webhook(p_api_key text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys := private.api_key_auth(p_api_key, 'webhooks:manage', true);
begin
  perform private.webhook_delete(v_key.business_id, p_id);
  return jsonb_build_object('status', 200, 'deleted', true, 'id', p_id);
end;
$$;

-- ---------------------------------------------------------------- sending (job route)
-- Claims due deliveries with their endpoint, secret and event. A claimed
-- delivery is leased for 2 minutes; if the sender dies it becomes due again.
create or replace function public.claim_webhook_deliveries(p_limit int default 50)
returns table (id bigint, business_id uuid, endpoint_id uuid, url text, secret text, event_id bigint,
               event_type text, data jsonb, event_created_at timestamptz, attempt int)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select d.id from public.webhook_deliveries d
     where (d.status = 'pending' and d.next_attempt_at <= now())
        or (d.status = 'sending' and d.locked_until < now())
     order by d.next_attempt_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update skip locked
  ), claimed as (
    update public.webhook_deliveries d
       set status = 'sending', locked_until = now() + interval '2 minutes', attempts = d.attempts + 1
      from due where d.id = due.id
    returning d.id, d.business_id, d.endpoint_id, d.event_id, d.attempts
  )
  select c.id, c.business_id, c.endpoint_id, e.url, s.decrypted_secret::text, ev.id, ev.type, ev.data, ev.created_at, c.attempts
    from claimed c
    join public.webhook_endpoints e on e.id = c.endpoint_id
    join public.webhook_events ev on ev.id = c.event_id
    join vault.decrypted_secrets s on s.id = e.secret_vault_id;
end;
$$;

-- Records one attempt. 2xx is success; anything else retries with back-off
-- (1, 5, 30 min, 2, 5, 10 h…) until the delivery is 24 hours old. After 20
-- failed attempts in a row the endpoint is switched off and admins are emailed.
create or replace function public.finish_webhook_delivery(p_id bigint, p_status_code int, p_error text, p_duration_ms int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.webhook_deliveries;
  v_e public.webhook_endpoints;
  v_ok boolean := p_error is null and p_status_code between 200 and 299;
  v_backoff interval[] := array[interval '1 minute', interval '5 minutes', interval '30 minutes', interval '2 hours',
                                interval '5 hours', interval '10 hours'];
  v_next timestamptz;
begin
  select * into v_d from public.webhook_deliveries where id = p_id and status = 'sending' for update;
  if not found then
    return 'ignored';
  end if;

  if v_ok then
    update public.webhook_deliveries
       set status = 'succeeded', delivered_at = now(), locked_until = null, last_status_code = p_status_code,
           last_error = null, duration_ms = p_duration_ms
     where id = p_id;
    update public.webhook_endpoints set consecutive_failures = 0, last_success_at = now() where id = v_d.endpoint_id;
    return 'succeeded';
  end if;

  v_next := now() + v_backoff[least(v_d.attempts, array_length(v_backoff, 1))];
  update public.webhook_deliveries
     set status = case when v_next > v_d.created_at + interval '24 hours' then 'failed' else 'pending' end,
         next_attempt_at = v_next, locked_until = null, last_status_code = p_status_code,
         last_error = left(coalesce(p_error, 'HTTP ' || p_status_code), 500), duration_ms = p_duration_ms
   where id = p_id
  returning * into v_d;

  update public.webhook_endpoints
     set consecutive_failures = consecutive_failures + 1, last_failure_at = now()
   where id = v_d.endpoint_id
  returning * into v_e;

  if v_e.is_active and v_e.consecutive_failures >= 20 then
    update public.webhook_endpoints
       set is_active = false, disabled_reason = 'Turned off after 20 failed deliveries in a row'
     where id = v_e.id;
    update public.webhook_deliveries set status = 'cancelled', last_error = coalesce(last_error, 'endpoint turned off')
     where endpoint_id = v_e.id and status in ('pending', 'sending');
    insert into private.email_outbox (business_id, to_email, template, payload)
    select v_e.business_id, p.email, 'webhook_disabled',
           jsonb_build_object('business_name', b.name, 'url', v_e.url, 'last_error', v_d.last_error,
                              'path', '/settings/webhooks/' || v_e.id)
      from public.business_memberships m
      join public.businesses b on b.id = m.business_id
      join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'integrations.manage'
      join public.profiles p on p.id = m.user_id
     where m.business_id = v_e.business_id and m.status = 'active' and p.email is not null;
    return 'disabled';
  end if;
  return v_d.status;
end;
$$;

-- Deliveries and events are kept for 30 days.
create or replace function public.prune_webhook_log()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.webhook_events ev
   where ev.created_at < now() - interval '30 days'
     and not exists (select 1 from public.webhook_deliveries d where d.event_id = ev.id and d.status in ('pending', 'sending'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.api_rate(text) from public;
revoke execute on function public.api_list(text, text, timestamptz, uuid, timestamptz, int, jsonb) from public;
revoke execute on function public.api_get(text, text, uuid) from public;
revoke execute on function public.api_update_lead(text, uuid, text, text, jsonb) from public;
revoke execute on function public.api_create_order(text, text, text, jsonb) from public;
revoke execute on function public.api_update_order(text, uuid, text, text, jsonb) from public;
revoke execute on function public.api_create_task(text, text, text, jsonb) from public;
revoke execute on function public.api_list_webhooks(text) from public;
revoke execute on function public.api_create_webhook(text, text, text, jsonb) from public;
revoke execute on function public.api_update_webhook(text, uuid, text, text, jsonb) from public;
revoke execute on function public.api_delete_webhook(text, uuid) from public;
grant execute on function public.api_rate(text) to anon, authenticated;
grant execute on function public.api_list(text, text, timestamptz, uuid, timestamptz, int, jsonb) to anon, authenticated;
grant execute on function public.api_get(text, text, uuid) to anon, authenticated;
grant execute on function public.api_update_lead(text, uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.api_create_order(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.api_update_order(text, uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.api_create_task(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.api_list_webhooks(text) to anon, authenticated;
grant execute on function public.api_create_webhook(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.api_update_webhook(text, uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.api_delete_webhook(text, uuid) to anon, authenticated;

revoke execute on function public.create_webhook_endpoint(uuid, text, text[], text) from public, anon;
revoke execute on function public.update_webhook_endpoint(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.delete_webhook_endpoint(uuid, uuid) from public, anon;
revoke execute on function public.rotate_webhook_secret(uuid, uuid) from public, anon;
revoke execute on function public.send_webhook_test(uuid, uuid) from public, anon;
revoke execute on function public.replay_webhook_delivery(uuid, bigint) from public, anon;
grant execute on function public.create_webhook_endpoint(uuid, text, text[], text) to authenticated;
grant execute on function public.update_webhook_endpoint(uuid, uuid, jsonb) to authenticated;
grant execute on function public.delete_webhook_endpoint(uuid, uuid) to authenticated;
grant execute on function public.rotate_webhook_secret(uuid, uuid) to authenticated;
grant execute on function public.send_webhook_test(uuid, uuid) to authenticated;
grant execute on function public.replay_webhook_delivery(uuid, bigint) to authenticated;

revoke execute on function public.claim_webhook_deliveries(int) from public, anon, authenticated;
revoke execute on function public.finish_webhook_delivery(bigint, int, text, int) from public, anon, authenticated;
revoke execute on function public.prune_webhook_log() from public, anon, authenticated;
grant execute on function public.claim_webhook_deliveries(int) to service_role;
grant execute on function public.finish_webhook_delivery(bigint, int, text, int) to service_role;
grant execute on function public.prune_webhook_log() to service_role;

grant execute on all functions in schema private to authenticated, service_role;
