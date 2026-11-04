-- =====================================================================
-- Sprint 7: Meta Lead Ads, Google Ads lead forms, ad spend sync,
-- touchpoints and attribution, integration health.
--
-- Tokens (page tokens, ads tokens, Google refresh tokens) live in Vault,
-- like WhatsApp tokens. Inbound leads go through private.webhook_events
-- (stored first, deduplicated, retried) and private.create_lead_internal(),
-- so matching, round-robin and history behave exactly as for other leads.
-- =====================================================================

alter table private.webhook_events drop constraint webhook_events_kind_check;
alter table private.webhook_events add constraint webhook_events_kind_check
  check (kind in ('message', 'status', 'template', 'leadgen', 'other'));

-- ---------------------------------------------------------------------
-- Meta pages (Lead Ads)
-- ---------------------------------------------------------------------
create table public.meta_pages (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  page_id           text not null unique check (page_id ~ '^[0-9]{5,30}$'),
  name              text,
  token_secret_id   uuid,
  token_expires_at  timestamptz,
  status            text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  subscribed        boolean not null default false,
  connected_by      uuid references public.profiles(id) on delete set null,
  connected_at      timestamptz not null default now(),
  last_lead_at      timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, id)
);
create trigger meta_pages_updated_at before update on public.meta_pages
  for each row execute function private.set_updated_at();

-- Google Ads lead form webhooks: one URL (token) and one key per form or campaign.
create table public.lead_webhooks (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  provider          text not null default 'google_ads' check (provider in ('google_ads')),
  name              text not null check (length(trim(name)) between 1 and 80),
  url_token_hash    text not null unique,
  secret_hash       text not null,
  is_active         boolean not null default true,
  last_received_at  timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, id)
);
create trigger lead_webhooks_updated_at before update on public.lead_webhooks
  for each row execute function private.set_updated_at();

-- Lead forms seen from Meta or Google, with how their fields map to SCALER.
-- mapping: { "<form field>": "full_name" | "first_name" | "last_name" | "phone" | "email"
--            | "note" | "ignore" | "custom:<lead custom field key>" }
create table public.lead_forms (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  provider          text not null check (provider in ('meta', 'google_ads')),
  external_form_id  text not null,
  name              text,
  fields            text[] not null default '{}',
  mapping           jsonb not null default '{}' check (jsonb_typeof(mapping) = 'object'),
  source_id         uuid,
  branch_id         uuid,
  leads_received    int not null default 0,
  last_lead_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, provider, external_form_id),
  foreign key (business_id, source_id) references public.lead_sources (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id)
);
create trigger lead_forms_updated_at before update on public.lead_forms
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Ad accounts, campaigns and daily spend
-- ---------------------------------------------------------------------
create table public.ad_accounts (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  platform           text not null check (platform in ('meta', 'google')),
  external_id        text not null check (external_id ~ '^[0-9]{3,30}$'),
  name               text,
  currency           char(3),
  login_customer_id  text check (login_customer_id is null or login_customer_id ~ '^[0-9]{10}$'),
  token_secret_id    uuid,
  token_expires_at   timestamptz,
  status             text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  last_synced_at     timestamptz,
  last_error         text,
  connected_by       uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (business_id, platform, external_id),
  unique (business_id, id)
);
create trigger ad_accounts_updated_at before update on public.ad_accounts
  for each row execute function private.set_updated_at();

create table public.ad_campaigns (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null,
  ad_account_id  uuid not null,
  platform       text not null check (platform in ('meta', 'google')),
  external_id    text not null,
  name           text not null,
  status         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ad_account_id, external_id),
  unique (business_id, id),
  foreign key (business_id, ad_account_id) references public.ad_accounts (business_id, id) on delete cascade
);
create index ad_campaigns_external_idx on public.ad_campaigns (business_id, external_id);

create table public.ad_spend_daily (
  business_id      uuid not null,
  ad_campaign_id   uuid not null,
  day              date not null,
  spend            numeric(14,2) not null default 0 check (spend >= 0),
  impressions      bigint not null default 0,
  clicks           bigint not null default 0,
  platform_leads   int not null default 0,
  synced_at        timestamptz not null default now(),
  primary key (ad_campaign_id, day),
  foreign key (business_id, ad_campaign_id) references public.ad_campaigns (business_id, id) on delete cascade
);
create index ad_spend_business_idx on public.ad_spend_daily (business_id, day);

-- ---------------------------------------------------------------------
-- Touchpoints: every way a customer reached us, append-only
-- ---------------------------------------------------------------------
create table public.lead_touchpoints (
  id           bigint generated always as identity primary key,
  business_id  uuid not null,
  lead_id      uuid not null,
  customer_id  uuid not null,
  kind         text not null check (kind in ('first', 'repeat')),
  source_id    uuid,
  campaign     text,
  campaign_id  text,
  adset_id     text,
  ad_id        text,
  form_id      text,
  gclid        text,
  fbclid       text,
  utm_source   text,
  utm_medium   text,
  occurred_at  timestamptz not null,
  foreign key (business_id, lead_id) references public.leads (business_id, id) on delete cascade
);
create index lead_touchpoints_customer_idx on public.lead_touchpoints (customer_id, occurred_at);
create index lead_touchpoints_business_idx on public.lead_touchpoints (business_id, occurred_at);

create table public.attribution_settings (
  business_id    uuid primary key references public.businesses(id) on delete cascade,
  model          text not null default 'last_touch' check (model in ('first_touch', 'last_touch', 'linear')),
  lookback_days  int not null default 90 check (lookback_days between 1 and 365),
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);
create trigger attribution_settings_updated_at before update on public.attribution_settings
  for each row execute function private.set_updated_at();

create or replace function private.add_touchpoint(
  p_business_id uuid, p_lead_id uuid, p_customer_id uuid, p_kind text, p_source_id uuid,
  p_campaign text, p_touch jsonb, p_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.lead_touchpoints (business_id, lead_id, customer_id, kind, source_id, campaign, campaign_id,
                                       adset_id, ad_id, form_id, gclid, fbclid, utm_source, utm_medium, occurred_at)
  values (p_business_id, p_lead_id, p_customer_id, p_kind, p_source_id,
          coalesce(nullif(p_campaign, ''), nullif(p_touch ->> 'utm_campaign', '')),
          nullif(p_touch ->> 'campaign_id', ''), nullif(p_touch ->> 'adset_id', ''), nullif(p_touch ->> 'ad_id', ''),
          nullif(p_touch ->> 'form_id', ''), nullif(p_touch ->> 'gclid', ''), nullif(p_touch ->> 'fbclid', ''),
          nullif(p_touch ->> 'utm_source', ''), nullif(p_touch ->> 'utm_medium', ''), p_at);
$$;

create or replace function private.touchpoint_from_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.add_touchpoint(new.business_id, new.id, new.customer_id, 'first', new.first_source_id,
                                 new.first_campaign, new.first_touch, new.created_at);
  return null;
end;
$$;

create trigger leads_touchpoint after insert on public.leads
  for each row execute function private.touchpoint_from_lead();

-- Repeat enquiries (Sprint 2 'enquiry' activities) are touchpoints too.
create or replace function private.touchpoint_from_enquiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.add_touchpoint(new.business_id, new.lead_id, (select customer_id from public.leads where id = new.lead_id),
                                 'repeat', nullif(new.meta ->> 'source_id', '')::uuid, new.meta ->> 'campaign',
                                 coalesce(new.meta -> 'touch', '{}'), new.occurred_at);
  return null;
end;
$$;

create trigger lead_activities_touchpoint after insert on public.lead_activities
  for each row when (new.type = 'enquiry') execute function private.touchpoint_from_enquiry();

-- Merges keep touchpoints with the surviving file.
create or replace function private.touchpoints_follow_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.lead_touchpoints set customer_id = new.customer_id where lead_id = new.id;
  return null;
end;
$$;

create trigger leads_touchpoints_customer after update of customer_id on public.leads
  for each row execute function private.touchpoints_follow_lead();

-- Backfill from existing leads and enquiries.
insert into public.lead_touchpoints (business_id, lead_id, customer_id, kind, source_id, campaign, campaign_id, adset_id,
                                     ad_id, form_id, gclid, fbclid, utm_source, utm_medium, occurred_at)
select l.business_id, l.id, l.customer_id, 'first', l.first_source_id,
       coalesce(nullif(l.first_campaign, ''), nullif(l.first_touch ->> 'utm_campaign', '')),
       nullif(l.first_touch ->> 'campaign_id', ''), nullif(l.first_touch ->> 'adset_id', ''), nullif(l.first_touch ->> 'ad_id', ''),
       nullif(l.first_touch ->> 'form_id', ''), nullif(l.first_touch ->> 'gclid', ''), nullif(l.first_touch ->> 'fbclid', ''),
       nullif(l.first_touch ->> 'utm_source', ''), nullif(l.first_touch ->> 'utm_medium', ''), l.created_at
  from public.leads l;
insert into public.lead_touchpoints (business_id, lead_id, customer_id, kind, source_id, campaign, campaign_id, adset_id,
                                     ad_id, form_id, gclid, fbclid, utm_source, utm_medium, occurred_at)
select a.business_id, a.lead_id, l.customer_id, 'repeat', nullif(a.meta ->> 'source_id', '')::uuid,
       coalesce(nullif(a.meta ->> 'campaign', ''), nullif(a.meta -> 'touch' ->> 'utm_campaign', '')),
       nullif(a.meta -> 'touch' ->> 'campaign_id', ''), nullif(a.meta -> 'touch' ->> 'adset_id', ''),
       nullif(a.meta -> 'touch' ->> 'ad_id', ''), nullif(a.meta -> 'touch' ->> 'form_id', ''),
       nullif(a.meta -> 'touch' ->> 'gclid', ''), nullif(a.meta -> 'touch' ->> 'fbclid', ''),
       nullif(a.meta -> 'touch' ->> 'utm_source', ''), nullif(a.meta -> 'touch' ->> 'utm_medium', ''), a.occurred_at
  from public.lead_activities a join public.leads l on l.id = a.lead_id
 where a.type = 'enquiry';

-- =====================================================================
-- Connecting (integrations.manage)
-- =====================================================================
create or replace function private.store_secret(p_existing uuid, p_value text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_existing is not null then
    perform vault.update_secret(p_existing, p_value);
    return p_existing;
  end if;
  return vault.create_secret(p_value, p_name || '_' || gen_random_uuid(), p_name);
end;
$$;

create or replace function public.connect_meta_page(p_business_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page text := p_input ->> 'page_id';
  v_existing public.meta_pages;
  v_id uuid;
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage integrations' using errcode = '42501';
  end if;
  if coalesce(length(p_input ->> 'access_token'), 0) < 20 then
    raise exception 'access token missing' using errcode = '22023';
  end if;
  select * into v_existing from public.meta_pages where page_id = v_page for update;
  if v_existing.id is not null and v_existing.business_id <> p_business_id then
    raise exception 'page is connected to another business' using errcode = '23505';
  end if;
  insert into public.meta_pages as m (business_id, page_id, name, token_secret_id, token_expires_at, status, subscribed,
                                      connected_by, connected_at, last_error)
  values (p_business_id, v_page, nullif(p_input ->> 'name', ''),
          private.store_secret(v_existing.token_secret_id, p_input ->> 'access_token', 'meta_page_token'),
          nullif(p_input ->> 'expires_at', '')::timestamptz, 'connected',
          coalesce((p_input ->> 'subscribed')::boolean, false), auth.uid(), now(), null)
  on conflict (page_id) do update
     set name = excluded.name, token_secret_id = excluded.token_secret_id, token_expires_at = excluded.token_expires_at,
         status = 'connected', subscribed = excluded.subscribed, connected_by = excluded.connected_by,
         connected_at = now(), last_error = null
  returning m.id into v_id;
  return v_id;
end;
$$;

create or replace function public.connect_ad_account(p_business_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.ad_accounts;
  v_id uuid;
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage integrations' using errcode = '42501';
  end if;
  if coalesce(length(p_input ->> 'token'), 0) < 20 then
    raise exception 'access token missing' using errcode = '22023';
  end if;
  select * into v_existing from public.ad_accounts
   where business_id = p_business_id and platform = p_input ->> 'platform' and external_id = p_input ->> 'external_id'
   for update;
  insert into public.ad_accounts as a (business_id, platform, external_id, name, currency, login_customer_id,
                                       token_secret_id, token_expires_at, status, connected_by, last_error)
  values (p_business_id, p_input ->> 'platform', p_input ->> 'external_id', nullif(p_input ->> 'name', ''),
          nullif(p_input ->> 'currency', ''), nullif(p_input ->> 'login_customer_id', ''),
          private.store_secret(v_existing.token_secret_id, p_input ->> 'token', 'ads_token'),
          nullif(p_input ->> 'expires_at', '')::timestamptz, 'connected', auth.uid(), null)
  on conflict (business_id, platform, external_id) do update
     set name = excluded.name, currency = excluded.currency, login_customer_id = excluded.login_customer_id,
         token_secret_id = excluded.token_secret_id, token_expires_at = excluded.token_expires_at,
         status = 'connected', connected_by = excluded.connected_by, last_error = null
  returning a.id into v_id;
  return v_id;
end;
$$;

-- Disconnect a page, ad account or lead webhook. History is kept; tokens are wiped.
create or replace function public.disconnect_integration(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_secret uuid;
begin
  if p_kind = 'meta_page' then
    select business_id, token_secret_id into v_business, v_secret from public.meta_pages where id = p_id;
  elsif p_kind = 'ad_account' then
    select business_id, token_secret_id into v_business, v_secret from public.ad_accounts where id = p_id;
  elsif p_kind = 'lead_webhook' then
    select business_id into v_business from public.lead_webhooks where id = p_id;
  end if;
  if v_business is null or not private.has_permission(v_business, 'integrations.manage') then
    raise exception 'not allowed to manage integrations' using errcode = '42501';
  end if;
  if v_secret is not null then
    perform vault.update_secret(v_secret, 'revoked');
  end if;
  if p_kind = 'meta_page' then
    update public.meta_pages set status = 'disconnected', subscribed = false where id = p_id;
  elsif p_kind = 'ad_account' then
    update public.ad_accounts set status = 'disconnected' where id = p_id;
  else
    update public.lead_webhooks set is_active = false where id = p_id;
  end if;
end;
$$;

-- Puts failed events back in the queue (after fixing a token, say).
create or replace function public.retry_failed_events(p_business_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v int;
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage integrations' using errcode = '42501';
  end if;
  update private.webhook_events set status = 'pending', attempts = 0, last_error = null,
         received_at = least(received_at, now() - interval '2 minutes')
   where business_id = p_business_id and status = 'failed';
  get diagnostics v = row_count;
  return v;
end;
$$;

-- One view of every integration's health for the Integrations page.
create or replace function public.integration_health(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage integrations' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'events_24h', (select count(*) from private.webhook_events where business_id = p_business_id and received_at > now() - interval '24 hours'),
    'failed', (select count(*) from private.webhook_events where business_id = p_business_id and status = 'failed'),
    'pending', (select count(*) from private.webhook_events where business_id = p_business_id and status = 'pending'),
    'recent_failures', (select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'provider', x.provider, 'error', x.last_error,
                                                                       'at', x.received_at) order by x.received_at desc), '[]')
                          from (select * from private.webhook_events
                                 where business_id = p_business_id and status = 'failed'
                                 order by received_at desc limit 10) x));
end;
$$;

-- =====================================================================
-- Service role: lead intake from Meta and Google, spend sync
-- =====================================================================
create or replace function public.lead_webhook_by_token(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', w.id, 'business_id', w.business_id, 'secret_hash', w.secret_hash)
    from public.lead_webhooks w
   where w.url_token_hash = p_token_hash and w.is_active;
$$;

-- Stores a Lead Ads / Google lead before acknowledging the webhook.
create or replace function public.record_lead_event(p_provider text, p_external_id text, p_business_id uuid, p_payload jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into private.webhook_events (provider, external_id, kind, business_id, payload, status)
  values (p_provider, p_external_id, 'leadgen', p_business_id, p_payload,
          case when p_business_id is null then 'ignored' else 'pending' end)
  on conflict (provider, external_id) do nothing
  returning id;
$$;

create or replace function public.meta_page_business(p_page_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select business_id from public.meta_pages where page_id = p_page_id and status <> 'disconnected';
$$;

-- What the processor needs for one stored lead: country (phone normalisation),
-- the page token (Meta only) and the form's field mapping.
create or replace function public.lead_event_context(p_event_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'event_id', e.id, 'provider', e.provider, 'business_id', e.business_id, 'payload', e.payload,
           'country_code', b.country_code,
           'page_token', (select s.decrypted_secret from public.meta_pages p join vault.decrypted_secrets s on s.id = p.token_secret_id
                           where p.page_id = e.payload ->> 'page_id' and p.business_id = e.business_id),
           'form', (select jsonb_build_object('mapping', f.mapping, 'source_id', f.source_id, 'branch_id', f.branch_id)
                      from public.lead_forms f
                     where f.business_id = e.business_id
                       and f.provider = case when e.provider = 'google_ads' then 'google_ads' else 'meta' end
                       and f.external_form_id = e.payload ->> 'form_id'))
    from private.webhook_events e join public.businesses b on b.id = e.business_id
   where e.id = p_event_id;
$$;

-- Creates (or adds to) a lead from a mapped Meta / Google lead.
-- Input: phone (E.164 via normalisePhone), email, full_name, description, custom_fields,
-- source (key) or source_id, branch_id, campaign, touch {campaign_id, adset_id, ad_id, form_id, gclid, ...},
-- form {id, name, fields[]}
create or replace function public.ingest_external_lead(p_event_id bigint, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e private.webhook_events;
  v_form public.lead_forms;
  v_provider text;
  v_result jsonb;
begin
  select * into e from private.webhook_events where id = p_event_id for update;
  if e.id is null or e.business_id is null then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if e.status = 'processed' then
    return jsonb_build_object('duplicate', true);
  end if;
  v_provider := case when e.provider = 'google_ads' then 'google_ads' else 'meta' end;

  if p_input -> 'form' ->> 'id' is not null then
    insert into public.lead_forms as f (business_id, provider, external_form_id, name, fields, leads_received, last_lead_at)
    values (e.business_id, v_provider, p_input -> 'form' ->> 'id', nullif(p_input -> 'form' ->> 'name', ''),
            coalesce((select array_agg(x) from jsonb_array_elements_text(p_input -> 'form' -> 'fields') x), '{}'), 1, now())
    on conflict (business_id, provider, external_form_id) do update
       set name = coalesce(excluded.name, f.name),
           fields = (select array_agg(distinct x) from unnest(f.fields || excluded.fields) x),
           leads_received = f.leads_received + 1, last_lead_at = now()
    returning * into v_form;
  end if;

  v_result := private.create_lead_internal(e.business_id,
    jsonb_strip_nulls(jsonb_build_object(
      'phone', p_input ->> 'phone', 'email', p_input ->> 'email', 'full_name', p_input ->> 'full_name',
      'description', p_input ->> 'description', 'campaign', p_input ->> 'campaign',
      'touch', coalesce(p_input -> 'touch', '{}'), 'custom_fields', p_input -> 'custom_fields',
      'source', case when v_form.source_id is null then coalesce(p_input ->> 'source', 'other') end,
      'source_id', v_form.source_id, 'branch_id', v_form.branch_id,
      'reuse_open_lead', true)),
    null);

  if e.provider like 'meta%' then
    update public.meta_pages set last_lead_at = now(), last_error = null where page_id = e.payload ->> 'page_id';
  elsif e.payload ? 'webhook_id' then
    update public.lead_webhooks set last_received_at = now() where id = (e.payload ->> 'webhook_id')::uuid;
  end if;
  perform public.finish_webhook_event(e.id);
  return v_result;
end;
$$;

-- Accounts due a spend sync (every 6 hours), with their decrypted tokens.
create or replace function public.ad_accounts_due(p_limit int default 10)
returns table (id uuid, platform text, external_id text, login_customer_id text, token text, currency char(3))
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.platform, a.external_id, a.login_customer_id, s.decrypted_secret, a.currency
    from public.ad_accounts a join vault.decrypted_secrets s on s.id = a.token_secret_id
   where a.status <> 'disconnected' and (a.last_synced_at is null or a.last_synced_at < now() - interval '6 hours')
   order by a.last_synced_at nulls first
   limit greatest(1, least(p_limit, 50));
$$;

-- Upserts spend rows: [{campaign_id, campaign_name, status, day, spend, impressions, clicks, leads}]
create or replace function public.upsert_ad_spend(p_account_id uuid, p_rows jsonb, p_error text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.ad_accounts;
  v int := 0;
begin
  select * into a from public.ad_accounts where id = p_account_id for update;
  if a.id is null then
    return 0;
  end if;
  if p_error is not null then
    update public.ad_accounts set status = 'error', last_error = left(p_error, 500), last_synced_at = now() where id = a.id;
    return 0;
  end if;

  insert into public.ad_campaigns as c (business_id, ad_account_id, platform, external_id, name, status)
  select distinct on (r ->> 'campaign_id') a.business_id, a.id, a.platform, r ->> 'campaign_id',
         coalesce(nullif(r ->> 'campaign_name', ''), r ->> 'campaign_id'), r ->> 'status'
    from jsonb_array_elements(coalesce(p_rows, '[]')) r
   where coalesce(r ->> 'campaign_id', '') <> ''
  on conflict (ad_account_id, external_id) do update set name = excluded.name, status = coalesce(excluded.status, c.status), updated_at = now();

  insert into public.ad_spend_daily as d (business_id, ad_campaign_id, day, spend, impressions, clicks, platform_leads, synced_at)
  select a.business_id, c.id, (r ->> 'day')::date, coalesce(nullif(r ->> 'spend', '')::numeric(14,2), 0),
         coalesce(nullif(r ->> 'impressions', '')::bigint, 0), coalesce(nullif(r ->> 'clicks', '')::bigint, 0),
         coalesce(nullif(r ->> 'leads', '')::int, 0), now()
    from jsonb_array_elements(coalesce(p_rows, '[]')) r
    join public.ad_campaigns c on c.ad_account_id = a.id and c.external_id = r ->> 'campaign_id'
   where r ->> 'day' is not null
  on conflict (ad_campaign_id, day) do update
     set spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks,
         platform_leads = excluded.platform_leads, synced_at = now();
  get diagnostics v = row_count;
  update public.ad_accounts set status = 'connected', last_error = null, last_synced_at = now() where id = a.id;
  return v;
end;
$$;

create or replace function public.record_integration_error(p_kind text, p_id uuid, p_error text, p_expires_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'meta_page' then
    update public.meta_pages
       set last_error = left(p_error, 500), status = case when p_error is null then 'connected' else 'error' end,
           token_expires_at = coalesce(p_expires_at, token_expires_at)
     where id = p_id and status <> 'disconnected';
  elsif p_kind = 'ad_account' then
    update public.ad_accounts
       set last_error = left(p_error, 500), status = case when p_error is null then 'connected' else 'error' end,
           token_expires_at = coalesce(p_expires_at, token_expires_at)
     where id = p_id and status <> 'disconnected';
  end if;
end;
$$;

create or replace function public.integration_token(p_kind text, p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
    from vault.decrypted_secrets s
   where s.id = case p_kind
                  when 'meta_page' then (select token_secret_id from public.meta_pages where id = p_id and status <> 'disconnected')
                  when 'ad_account' then (select token_secret_id from public.ad_accounts where id = p_id and status <> 'disconnected')
                end;
$$;

-- =====================================================================
-- Attribution
-- =====================================================================
-- Orders created in [p_from, p_to] (not cancelled) are credited to the customer's
-- touchpoints within the lookback window before the order:
--   first_touch: all revenue to the earliest touch; last_touch: to the latest;
--   linear: split evenly; assisted: orders where the row was a middle touch.
-- Grouped by source and campaign, with leads, spend and cost per lead.
create or replace function public.attribution_report(p_business_id uuid, p_from date, p_to date)
returns table (source_id uuid, campaign text, campaign_id text, leads bigint,
               first_orders bigint, first_revenue numeric, last_orders bigint, last_revenue numeric,
               linear_revenue numeric, assisted_orders bigint, spend numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select private.has_permission(p_business_id, 'analytics.marketing') or private.has_permission(p_business_id, 'analytics.view') as ok
  ),
  settings as (
    select coalesce((select lookback_days from public.attribution_settings where business_id = p_business_id), 90) as lookback
  ),
  orders_in as (
    select o.id, o.total, o.created_at, o.customer_id
      from public.orders o join public.order_stages s on s.id = o.stage_id
     where o.business_id = p_business_id and s.category <> 'cancelled'
       and o.created_at >= p_from and o.created_at < p_to + 1
  ),
  tp as (
    select o.id as order_id, o.total, t.id as tp_id, t.source_id, t.campaign, t.campaign_id, t.occurred_at
      from orders_in o, settings
      join public.lead_touchpoints t on true
     where t.customer_id = o.customer_id and t.occurred_at <= o.created_at
       and t.occurred_at >= o.created_at - make_interval(days => settings.lookback)
  ),
  ranked as (
    select tp.*,
           row_number() over (partition by order_id order by occurred_at, tp_id) as rf,
           row_number() over (partition by order_id order by occurred_at desc, tp_id desc) as rl,
           count(*) over (partition by order_id) as n
      from tp
  ),
  credit as (
    select source_id, coalesce(campaign_id, campaign) as key, max(campaign) as campaign, max(campaign_id) as campaign_id,
           count(distinct order_id) filter (where rf = 1) as first_orders,
           coalesce(sum(total) filter (where rf = 1), 0) as first_revenue,
           count(distinct order_id) filter (where rl = 1) as last_orders,
           coalesce(sum(total) filter (where rl = 1), 0) as last_revenue,
           coalesce(round(sum(total / n), 2), 0) as linear_revenue,
           count(distinct order_id) filter (where rf > 1 and rl > 1) as assisted_orders
      from ranked group by 1, 2
  ),
  leads_in as (
    select t.source_id, coalesce(t.campaign_id, t.campaign) as key, max(t.campaign) as campaign, max(t.campaign_id) as campaign_id,
           count(distinct t.lead_id) as leads
      from public.lead_touchpoints t
     where t.business_id = p_business_id and t.kind = 'first'
       and t.occurred_at >= p_from and t.occurred_at < p_to + 1
     group by 1, 2
  ),
  spend as (
    select c.external_id as key, sum(d.spend) as spend
      from public.ad_spend_daily d join public.ad_campaigns c on c.id = d.ad_campaign_id
     where d.business_id = p_business_id and d.day between p_from and p_to
     group by 1
  ),
  keys as (
    select source_id, key from credit union select source_id, key from leads_in
  )
  select k.source_id, coalesce(c.campaign, l.campaign), coalesce(c.campaign_id, l.campaign_id), coalesce(l.leads, 0),
         coalesce(c.first_orders, 0), coalesce(c.first_revenue, 0), coalesce(c.last_orders, 0), coalesce(c.last_revenue, 0),
         coalesce(c.linear_revenue, 0), coalesce(c.assisted_orders, 0),
         (select s.spend from spend s where s.key = coalesce(c.campaign_id, l.campaign_id))
    from keys k
    cross join allowed
    left join credit c on c.source_id is not distinct from k.source_id and c.key is not distinct from k.key
    left join leads_in l on l.source_id is not distinct from k.source_id and l.key is not distinct from k.key
   where allowed.ok
   order by 6 desc, 4 desc;
$$;

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.connect_meta_page(uuid, jsonb) from public, anon;
revoke execute on function public.connect_ad_account(uuid, jsonb) from public, anon;
revoke execute on function public.disconnect_integration(text, uuid) from public, anon;
revoke execute on function public.retry_failed_events(uuid) from public, anon;
revoke execute on function public.integration_health(uuid) from public, anon;
revoke execute on function public.attribution_report(uuid, date, date) from public, anon;
grant execute on function public.connect_meta_page(uuid, jsonb) to authenticated;
grant execute on function public.connect_ad_account(uuid, jsonb) to authenticated;
grant execute on function public.disconnect_integration(text, uuid) to authenticated;
grant execute on function public.retry_failed_events(uuid) to authenticated;
grant execute on function public.integration_health(uuid) to authenticated;
grant execute on function public.attribution_report(uuid, date, date) to authenticated;

revoke execute on function public.lead_webhook_by_token(text) from public, anon, authenticated;
revoke execute on function public.record_lead_event(text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.meta_page_business(text) from public, anon, authenticated;
revoke execute on function public.lead_event_context(bigint) from public, anon, authenticated;
revoke execute on function public.ingest_external_lead(bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.ad_accounts_due(int) from public, anon, authenticated;
revoke execute on function public.upsert_ad_spend(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.record_integration_error(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.integration_token(text, uuid) from public, anon, authenticated;
grant execute on function public.lead_webhook_by_token(text) to service_role;
grant execute on function public.record_lead_event(text, text, uuid, jsonb) to service_role;
grant execute on function public.meta_page_business(text) to service_role;
grant execute on function public.lead_event_context(bigint) to service_role;
grant execute on function public.ingest_external_lead(bigint, jsonb) to service_role;
grant execute on function public.ad_accounts_due(int) to service_role;
grant execute on function public.upsert_ad_spend(uuid, jsonb, text) to service_role;
grant execute on function public.record_integration_error(text, uuid, text, timestamptz) to service_role;
grant execute on function public.integration_token(text, uuid) to service_role;

-- Audit: connections and mappings are configuration.
create trigger audit_meta_pages after insert or update or delete on public.meta_pages
  for each row execute function private.audit_row();
create trigger audit_lead_webhooks after insert or update or delete on public.lead_webhooks
  for each row execute function private.audit_row();
create trigger audit_lead_forms after update or delete on public.lead_forms
  for each row execute function private.audit_row();
create trigger audit_ad_accounts after insert or update or delete on public.ad_accounts
  for each row execute function private.audit_row();
create trigger audit_attribution_settings after insert or update or delete on public.attribution_settings
  for each row execute function private.audit_row();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.meta_pages            enable row level security;
alter table public.lead_webhooks         enable row level security;
alter table public.lead_forms            enable row level security;
alter table public.ad_accounts           enable row level security;
alter table public.ad_campaigns          enable row level security;
alter table public.ad_spend_daily        enable row level security;
alter table public.lead_touchpoints      enable row level security;
alter table public.attribution_settings  enable row level security;

-- Connections: integrations.manage only; tokens never selectable.
create policy meta_pages_select on public.meta_pages for select to authenticated
  using (private.has_permission(business_id, 'integrations.manage'));
revoke all on public.meta_pages from authenticated, anon;
grant select (id, business_id, page_id, name, token_expires_at, status, subscribed, connected_by, connected_at,
              last_lead_at, last_error, created_at) on public.meta_pages to authenticated;

create policy lead_webhooks_select on public.lead_webhooks for select to authenticated
  using (private.has_permission(business_id, 'integrations.manage'));
create policy lead_webhooks_insert on public.lead_webhooks for insert to authenticated
  with check (private.has_permission(business_id, 'integrations.manage') and created_by = auth.uid());
revoke all on public.lead_webhooks from authenticated, anon;
grant select (id, business_id, provider, name, is_active, last_received_at, created_by, created_at) on public.lead_webhooks to authenticated;
grant insert (business_id, provider, name, url_token_hash, secret_hash, created_by) on public.lead_webhooks to authenticated;

create policy lead_forms_select on public.lead_forms for select to authenticated
  using (private.has_permission(business_id, 'integrations.manage'));
create policy lead_forms_update on public.lead_forms for update to authenticated
  using (private.has_permission(business_id, 'integrations.manage'))
  with check (private.has_permission(business_id, 'integrations.manage'));
revoke insert, update, delete on public.lead_forms from authenticated, anon;
grant update (mapping, source_id, branch_id) on public.lead_forms to authenticated;

create policy ad_accounts_select on public.ad_accounts for select to authenticated
  using (private.has_permission(business_id, 'integrations.manage')
         or private.has_permission(business_id, 'analytics.marketing'));
revoke all on public.ad_accounts from authenticated, anon;
grant select (id, business_id, platform, external_id, name, currency, login_customer_id, token_expires_at, status,
              last_synced_at, last_error, created_at) on public.ad_accounts to authenticated;

create policy ad_campaigns_select on public.ad_campaigns for select to authenticated
  using (private.has_permission(business_id, 'analytics.marketing') or private.has_permission(business_id, 'integrations.manage'));
revoke insert, update, delete on public.ad_campaigns from authenticated, anon;
create policy ad_spend_select on public.ad_spend_daily for select to authenticated
  using (private.has_permission(business_id, 'analytics.marketing') or private.has_permission(business_id, 'integrations.manage'));
revoke insert, update, delete on public.ad_spend_daily from authenticated, anon;

-- Touchpoints: visible with the lead; written by triggers only.
create policy touchpoints_select on public.lead_touchpoints for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
revoke insert, update, delete on public.lead_touchpoints from authenticated, anon;

create policy attribution_settings_select on public.attribution_settings for select to authenticated
  using (private.is_member(business_id));
create policy attribution_settings_insert on public.attribution_settings for insert to authenticated
  with check (private.has_permission(business_id, 'analytics.marketing') and updated_by = auth.uid());
create policy attribution_settings_update on public.attribution_settings for update to authenticated
  using (private.has_permission(business_id, 'analytics.marketing'))
  with check (private.has_permission(business_id, 'analytics.marketing') and updated_by = auth.uid());
revoke delete on public.attribution_settings from authenticated, anon;

revoke all on public.meta_pages, public.lead_webhooks, public.lead_forms, public.ad_accounts, public.ad_campaigns,
  public.ad_spend_daily, public.lead_touchpoints, public.attribution_settings from anon;
grant execute on all functions in schema private to authenticated, service_role;
