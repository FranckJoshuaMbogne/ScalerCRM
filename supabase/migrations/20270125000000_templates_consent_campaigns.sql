-- =====================================================================
-- Sprint 6: WhatsApp templates, consent and opt-outs, suppression list,
-- audiences, campaigns with a throttled send queue, campaign reporting,
-- and a second provider (360dialog) behind the same interface.
--
-- Rule: a campaign only ever sends an APPROVED template to a customer whose
-- latest WhatsApp marketing consent is opted_in and whose number is not
-- suppressed. That is checked when recipients are built and again at send time.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Providers: Meta Cloud API (direct) or 360dialog (BSP)
-- ---------------------------------------------------------------------
alter table public.whatsapp_accounts
  add column provider text not null default 'meta_cloud' check (provider in ('meta_cloud', 'dialog360')),
  -- 360dialog posts to /api/webhooks/whatsapp/d360/<token>; only the hash is kept.
  add column webhook_token_hash text unique;
-- 360dialog accounts may not know Meta's phone number id up front.
alter table public.whatsapp_accounts alter column phone_number_id drop not null;

alter table private.webhook_events drop constraint webhook_events_kind_check;
alter table private.webhook_events add constraint webhook_events_kind_check
  check (kind in ('message', 'status', 'template', 'other'));

-- Connect (Sprint 5) now records the provider and, for 360dialog, the webhook token hash.
create or replace function public.connect_whatsapp_account(p_business_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text := coalesce(nullif(p_input ->> 'provider', ''), 'meta_cloud');
  v_phone text := nullif(p_input ->> 'phone_number_id', '');
  v_token text := p_input ->> 'access_token';
  v_existing public.whatsapp_accounts;
  v_secret uuid;
  v_id uuid;
begin
  if not private.has_permission(p_business_id, 'integrations.manage') then
    raise exception 'not allowed to manage integrations' using errcode = '42501';
  end if;
  if coalesce(length(v_token), 0) < 20 then
    raise exception 'access token missing' using errcode = '22023';
  end if;
  if v_provider = 'meta_cloud' and v_phone is null then
    raise exception 'phone number id missing' using errcode = '22023';
  end if;

  if v_phone is not null then
    select * into v_existing from public.whatsapp_accounts where phone_number_id = v_phone for update;
  elsif p_input ? 'account_id' then
    select * into v_existing from public.whatsapp_accounts where id = (p_input ->> 'account_id')::uuid for update;
  end if;
  if v_existing.id is not null and v_existing.business_id <> p_business_id then
    raise exception 'number is connected to another business' using errcode = '23505';
  end if;

  if v_existing.token_secret_id is not null then
    perform vault.update_secret(v_existing.token_secret_id, v_token);
    v_secret := v_existing.token_secret_id;
  else
    v_secret := vault.create_secret(v_token, 'whatsapp_token_' || gen_random_uuid(), 'WhatsApp access token');
  end if;

  if v_existing.id is not null then
    update public.whatsapp_accounts
       set waba_id = coalesce(nullif(p_input ->> 'waba_id', ''), waba_id), phone_number_id = coalesce(v_phone, phone_number_id),
           display_phone = coalesce(nullif(p_input ->> 'display_phone', ''), display_phone),
           verified_name = coalesce(nullif(p_input ->> 'verified_name', ''), verified_name),
           quality_rating = coalesce(nullif(p_input ->> 'quality_rating', ''), quality_rating),
           provider = v_provider, status = 'connected',
           connected_via = coalesce(nullif(p_input ->> 'connected_via', ''), 'manual'),
           token_secret_id = v_secret, connected_by = auth.uid(), connected_at = now(), last_checked_at = now(), last_error = null,
           webhook_token_hash = coalesce(nullif(p_input ->> 'webhook_token_hash', ''), webhook_token_hash)
     where id = v_existing.id
    returning id into v_id;
  else
    insert into public.whatsapp_accounts (business_id, waba_id, phone_number_id, display_phone, verified_name, quality_rating,
                                          status, connected_via, provider, token_secret_id, connected_by, last_checked_at,
                                          webhook_token_hash)
    values (p_business_id, coalesce(nullif(p_input ->> 'waba_id', ''), '00000'), v_phone, nullif(p_input ->> 'display_phone', ''),
            nullif(p_input ->> 'verified_name', ''), nullif(p_input ->> 'quality_rating', ''), 'connected',
            coalesce(nullif(p_input ->> 'connected_via', ''), 'manual'), v_provider, v_secret, auth.uid(), now(),
            nullif(p_input ->> 'webhook_token_hash', ''))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- The reply sender (Sprint 5) now also needs the provider and WABA.
create or replace function public.whatsapp_send_context(p_message_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'message_id', m.id, 'body', m.body, 'to', cu.primary_phone,
           'provider', a.provider, 'waba_id', a.waba_id,
           'phone_number_id', a.phone_number_id, 'account_status', a.status,
           'token', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = a.token_secret_id))
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.customers cu on cu.id = c.customer_id
    join public.whatsapp_accounts a on a.id = c.account_id
   where m.id = p_message_id and m.status = 'queued';
$$;

-- 360dialog webhooks carry the account in the URL token, not a signature.
create or replace function public.record_webhook_event_for_account(
  p_provider text, p_external_id text, p_kind text, p_account_id uuid, p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into private.webhook_events (provider, external_id, kind, business_id, account_id, payload, status)
  select p_provider, p_external_id, p_kind, a.business_id, a.id, p_payload, 'pending'
    from public.whatsapp_accounts a where a.id = p_account_id and a.status <> 'disconnected'
  on conflict (provider, external_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.whatsapp_account_by_webhook_token(p_token_hash text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.whatsapp_accounts
   where webhook_token_hash = p_token_hash and provider = 'dialog360' and status <> 'disconnected';
$$;

-- ---------------------------------------------------------------------
-- Templates (per WhatsApp Business Account, as Meta stores them)
-- ---------------------------------------------------------------------
create type public.template_status as enum ('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled');

create table public.whatsapp_templates (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  waba_id               text not null,
  name                  text not null check (name ~ '^[a-z0-9_]{1,250}$'),
  language              text not null default 'en' check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  category              text not null default 'MARKETING' check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  -- { header: {format: TEXT|IMAGE|VIDEO|DOCUMENT, text?, example?}, body: {text, examples[]},
  --   footer?: {text}, buttons?: [{type: QUICK_REPLY|URL|PHONE_NUMBER, text, url?, phone_number?}] }
  components            jsonb not null check (jsonb_typeof(components) = 'object'),
  variable_count        int not null default 0 check (variable_count between 0 and 20),
  status                public.template_status not null default 'draft',
  provider_template_id  text,
  rejected_reason       text,
  submitted_at          timestamptz,
  synced_at             timestamptz,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (business_id, waba_id, name, language),
  unique (business_id, id)
);
create index whatsapp_templates_business_idx on public.whatsapp_templates (business_id, status);
create trigger whatsapp_templates_updated_at before update on public.whatsapp_templates
  for each row execute function private.set_updated_at();
create trigger audit_whatsapp_templates after insert or update or delete on public.whatsapp_templates
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- Suppression list: numbers that must never receive marketing
-- ---------------------------------------------------------------------
create table public.suppressions (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  channel      public.consent_channel not null default 'whatsapp',
  phone        text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  reason       text not null check (reason in ('opt_out', 'undeliverable', 'blocked_marketing', 'manual')),
  note         text check (length(note) <= 500),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (business_id, channel, phone)
);

create or replace function private.is_suppressed(p_business_id uuid, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.suppressions s
                  where s.business_id = p_business_id and s.channel = 'whatsapp' and s.phone = p_phone);
$$;

-- Latest WhatsApp marketing consent is an explicit opt-in.
create or replace function private.has_marketing_consent(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.status = 'opted_in' from public.customer_consents c
                    where c.customer_id = p_customer_id and c.channel = 'whatsapp' and c.purpose = 'marketing'
                    order by c.captured_at desc, c.id desc limit 1), false);
$$;

-- ---------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------
create type public.campaign_status as enum ('draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled');

create table public.campaigns (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  name              text not null check (length(trim(name)) between 1 and 120),
  account_id        uuid,
  template_id       uuid,
  -- One entry per template variable: {source: first_name|full_name|business_name|static, value?}
  variables         jsonb not null default '[]' check (jsonb_typeof(variables) = 'array'),
  header_media_url  text check (header_media_url is null or header_media_url ~ '^https://'),
  -- Audience filter; see private.audience()
  filter            jsonb not null default '{}' check (jsonb_typeof(filter) = 'object'),
  rate_per_minute   int not null default 60 check (rate_per_minute between 1 and 1000),
  status            public.campaign_status not null default 'draft',
  scheduled_at      timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, account_id) references public.whatsapp_accounts (business_id, id),
  foreign key (business_id, template_id) references public.whatsapp_templates (business_id, id)
);
create index campaigns_business_idx on public.campaigns (business_id, created_at desc);
create index campaigns_due_idx on public.campaigns (scheduled_at) where status = 'scheduled';
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function private.set_updated_at();

create table public.campaign_recipients (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  campaign_id      uuid not null,
  customer_id      uuid not null,
  phone            text not null,
  params           jsonb not null default '[]',
  status           text not null default 'pending'
                     check (status in ('pending', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  message_id       uuid references public.messages(id) on delete set null,
  wamid            text,
  attempts         int not null default 0,
  last_error       text,
  next_attempt_at  timestamptz not null default now(),
  locked_at        timestamptz,
  sent_at          timestamptz,
  delivered_at     timestamptz,
  read_at          timestamptz,
  failed_at        timestamptz,
  replied_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (campaign_id, customer_id),
  unique (campaign_id, phone),
  foreign key (business_id, campaign_id) references public.campaigns (business_id, id) on delete cascade,
  foreign key (business_id, customer_id) references public.customers (business_id, id)
);
create index campaign_recipients_queue_idx on public.campaign_recipients (campaign_id, next_attempt_at) where status = 'pending';
create index campaign_recipients_customer_idx on public.campaign_recipients (customer_id, sent_at desc);
create index campaign_recipients_wamid_idx on public.campaign_recipients (wamid) where wamid is not null;

create table public.campaign_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null,
  campaign_id  uuid not null,
  type         text not null check (type ~ '^[a-z_]+$'),
  detail       jsonb,
  actor_id     uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (business_id, campaign_id) references public.campaigns (business_id, id) on delete cascade
);
create index campaign_events_campaign_idx on public.campaign_events (campaign_id, created_at);

-- =====================================================================
-- Audience: customers matching a filter, with why each is or isn't eligible.
-- Filter keys (all optional): branch_id, tag_ids[], lead_source_ids[],
-- lead_status_ids[], owner_id, has_orders (bool), no_order_days (int),
-- min_lifetime_value (numeric), created_within_days (int), birthday_month (1-12)
-- =====================================================================
create or replace function private.audience(p_business_id uuid, p_filter jsonb)
returns table (customer_id uuid, phone text, full_name text, consent boolean, suppressed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with f as (select coalesce(p_filter, '{}') as j)
  select c.id, c.primary_phone, c.full_name,
         private.has_marketing_consent(c.id),
         c.primary_phone is not null and private.is_suppressed(p_business_id, c.primary_phone)
    from public.customers c, f
   where c.business_id = p_business_id
     and c.merged_into_id is null
     and (f.j ->> 'branch_id' is null or c.branch_id = (f.j ->> 'branch_id')::uuid)
     and (f.j -> 'tag_ids' is null or jsonb_array_length(f.j -> 'tag_ids') = 0
          or exists (select 1 from public.customer_tags ct
                      where ct.customer_id = c.id
                        and ct.tag_id in (select (x)::uuid from jsonb_array_elements_text(f.j -> 'tag_ids') x)))
     and (f.j -> 'lead_source_ids' is null or jsonb_array_length(f.j -> 'lead_source_ids') = 0
          or exists (select 1 from public.leads l
                      where l.customer_id = c.id
                        and l.first_source_id in (select (x)::uuid from jsonb_array_elements_text(f.j -> 'lead_source_ids') x)))
     and (f.j -> 'lead_status_ids' is null or jsonb_array_length(f.j -> 'lead_status_ids') = 0
          or exists (select 1 from public.leads l
                      where l.customer_id = c.id and l.archived_at is null
                        and l.status_id in (select (x)::uuid from jsonb_array_elements_text(f.j -> 'lead_status_ids') x)))
     and (f.j ->> 'owner_id' is null
          or c.owner_id = (f.j ->> 'owner_id')::uuid
          or exists (select 1 from public.leads l where l.customer_id = c.id and l.owner_id = (f.j ->> 'owner_id')::uuid))
     and (f.j ->> 'has_orders' is null
          or (f.j ->> 'has_orders')::boolean = exists (
               select 1 from public.orders o join public.order_stages s on s.id = o.stage_id
                where o.customer_id = c.id and s.category <> 'cancelled'))
     and (f.j ->> 'no_order_days' is null
          or not exists (select 1 from public.orders o
                          where o.customer_id = c.id
                            and o.created_at > now() - make_interval(days => (f.j ->> 'no_order_days')::int)))
     and (f.j ->> 'min_lifetime_value' is null
          or coalesce((select sum(o.total) from public.orders o join public.order_stages s on s.id = o.stage_id
                        where o.customer_id = c.id and s.category <> 'cancelled'), 0)
             >= (f.j ->> 'min_lifetime_value')::numeric)
     and (f.j ->> 'created_within_days' is null
          or c.created_at > now() - make_interval(days => (f.j ->> 'created_within_days')::int))
     and (f.j ->> 'birthday_month' is null
          or extract(month from c.date_of_birth) = (f.j ->> 'birthday_month')::int);
$$;

-- Live estimate for the audience builder.
create or replace function public.audience_estimate(p_business_id uuid, p_filter jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not (private.has_permission(p_business_id, 'campaigns.manage') or private.has_permission(p_business_id, 'campaigns.view')) then
    raise exception 'not allowed to view campaigns' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'matching', count(*),
           'eligible', count(*) filter (where a.phone is not null and a.consent and not a.suppressed),
           'no_phone', count(*) filter (where a.phone is null),
           'no_consent', count(*) filter (where a.phone is not null and not a.consent and not a.suppressed),
           'suppressed', count(*) filter (where a.suppressed))
    into v
    from private.audience(p_business_id, p_filter) a;
  return v;
end;
$$;

-- Fills a template's variables for one customer.
create or replace function private.resolve_params(p_variables jsonb, p_full_name text, p_business_name text)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(
           case v ->> 'source'
             when 'first_name' then to_jsonb(coalesce(nullif(split_part(trim(p_full_name), ' ', 1), ''), 'there'))
             when 'full_name' then to_jsonb(coalesce(nullif(trim(p_full_name), ''), 'there'))
             when 'business_name' then to_jsonb(p_business_name)
             else to_jsonb(coalesce(v ->> 'value', ''))
           end order by n), '[]')
    from jsonb_array_elements(coalesce(p_variables, '[]')) with ordinality t(v, n);
$$;

-- =====================================================================
-- Campaign lifecycle
-- =====================================================================
create or replace function private.campaign_event(p_campaign public.campaigns, p_type text, p_detail jsonb default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.campaign_events (business_id, campaign_id, type, detail, actor_id)
  values (p_campaign.business_id, p_campaign.id, p_type, p_detail, auth.uid());
$$;

-- Builds the recipient list (consent and suppression enforced) and starts sending.
create or replace function private.start_campaign(p_campaign_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  v_count int;
  v_skipped jsonb;
begin
  select * into c from public.campaigns where id = p_campaign_id for update;
  insert into public.campaign_recipients (business_id, campaign_id, customer_id, phone, params)
  select distinct on (a.phone) c.business_id, c.id, a.customer_id, a.phone,
         private.resolve_params(c.variables, a.full_name, (select name from public.businesses where id = c.business_id))
    from private.audience(c.business_id, c.filter) a
   where a.phone is not null and a.consent and not a.suppressed
   order by a.phone, a.customer_id
  on conflict do nothing;
  get diagnostics v_count = row_count;

  select jsonb_build_object(
           'no_phone', count(*) filter (where a.phone is null),
           'no_consent', count(*) filter (where a.phone is not null and not a.consent and not a.suppressed),
           'suppressed', count(*) filter (where a.suppressed))
    into v_skipped
    from private.audience(c.business_id, c.filter) a;

  update public.campaigns
     set status = case when v_count = 0 then 'completed'::public.campaign_status else 'sending' end,
         started_at = now(), completed_at = case when v_count = 0 then now() end
   where id = c.id;
  perform private.campaign_event(c, 'started', jsonb_build_object('recipients', v_count) || v_skipped);
  return v_count;
end;
$$;

-- Launch now or at scheduled_at. Approved template, connected number, same WABA.
create or replace function public.launch_campaign(p_campaign_id uuid, p_scheduled_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  t public.whatsapp_templates;
  a public.whatsapp_accounts;
  v_count int;
begin
  select * into c from public.campaigns where id = p_campaign_id for update;
  if c.id is null or not private.has_permission(c.business_id, 'campaigns.send') then
    raise exception 'not allowed to send campaigns' using errcode = '42501';
  end if;
  if c.status <> 'draft' then
    raise exception 'campaign was already launched' using errcode = '23514';
  end if;
  select * into t from public.whatsapp_templates where id = c.template_id;
  select * into a from public.whatsapp_accounts where id = c.account_id;
  if t.id is null or t.status <> 'approved' then
    raise exception 'template is not approved' using errcode = '23514';
  end if;
  if a.id is null or a.status <> 'connected' then
    raise exception 'whatsapp number is not connected' using errcode = '23514';
  end if;
  if a.waba_id <> t.waba_id then
    raise exception 'template belongs to another WhatsApp account' using errcode = '23514';
  end if;
  if jsonb_array_length(c.variables) <> t.variable_count then
    raise exception 'every template variable needs a value' using errcode = '23514';
  end if;

  if p_scheduled_at is not null and p_scheduled_at > now() + interval '1 minute' then
    update public.campaigns set status = 'scheduled', scheduled_at = p_scheduled_at where id = c.id;
    perform private.campaign_event(c, 'scheduled', jsonb_build_object('at', p_scheduled_at));
    return jsonb_build_object('status', 'scheduled');
  end if;
  v_count := private.start_campaign(c.id);
  return jsonb_build_object('status', case when v_count = 0 then 'completed' else 'sending' end, 'recipients', v_count);
end;
$$;

create or replace function public.set_campaign_state(p_campaign_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  select * into c from public.campaigns where id = p_campaign_id for update;
  if c.id is null or not private.has_permission(c.business_id, 'campaigns.send') then
    raise exception 'not allowed to send campaigns' using errcode = '42501';
  end if;
  if p_action = 'pause' and c.status = 'sending' then
    update public.campaigns set status = 'paused' where id = c.id;
  elsif p_action = 'resume' and c.status = 'paused' then
    update public.campaigns set status = 'sending' where id = c.id;
  elsif p_action = 'cancel' and c.status in ('scheduled', 'sending', 'paused') then
    update public.campaign_recipients set status = 'skipped', last_error = 'campaign cancelled'
     where campaign_id = c.id and status = 'pending';
    update public.campaigns set status = 'cancelled', completed_at = now() where id = c.id;
  elsif p_action = 'unschedule' and c.status = 'scheduled' then
    update public.campaigns set status = 'draft', scheduled_at = null where id = c.id;
  else
    raise exception 'cannot % a % campaign', p_action, c.status using errcode = '23514';
  end if;
  perform private.campaign_event(c, case p_action when 'pause' then 'paused' when 'resume' then 'resumed'
                                                  when 'cancel' then 'cancelled' else 'unscheduled' end);
end;
$$;

create or replace function public.duplicate_campaign(p_campaign_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  v_id uuid;
begin
  select * into c from public.campaigns where id = p_campaign_id;
  if c.id is null or not private.has_permission(c.business_id, 'campaigns.manage') then
    raise exception 'not allowed to manage campaigns' using errcode = '42501';
  end if;
  insert into public.campaigns (business_id, name, account_id, template_id, variables, header_media_url, filter,
                                rate_per_minute, created_by)
  values (c.business_id, left('Copy of ' || c.name, 120), c.account_id, c.template_id, c.variables, c.header_media_url,
          c.filter, c.rate_per_minute, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- =====================================================================
-- Send queue (service role): due schedules, throttled claims, results
-- =====================================================================

-- Starts scheduled campaigns that are due and frees claims left by a crashed sender.
create or replace function public.campaign_tick()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_started int := 0;
begin
  for v_id in select id from public.campaigns where status = 'scheduled' and scheduled_at <= now() for update skip locked loop
    perform private.start_campaign(v_id);
    v_started := v_started + 1;
  end loop;
  update public.campaign_recipients set status = 'pending', locked_at = null
   where status = 'sending' and locked_at < now() - interval '10 minutes';
  -- Campaigns whose last recipients were skipped (opt-outs) finish here.
  with done as (
    update public.campaigns c set status = 'completed', completed_at = now()
     where c.status = 'sending'
       and not exists (select 1 from public.campaign_recipients x where x.campaign_id = c.id and x.status in ('pending', 'sending'))
    returning c.business_id, c.id
  )
  insert into public.campaign_events (business_id, campaign_id, type)
  select business_id, id, 'completed' from done;
  return v_started;
end;
$$;

-- Claims up to p_limit due recipients, at most rate_per_minute × p_minutes per campaign
-- counting what was already sent in that span. Consent and suppression are re-checked:
-- someone who opted out after launch is skipped, not sent to.
create or replace function public.claim_campaign_batch(p_limit int default 200, p_minutes int default 5)
returns table (recipient_id uuid, campaign_id uuid, phone text, params jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c record;
  v_budget int;
  v_left int := greatest(1, least(p_limit, 1000));
begin
  for c in select id, business_id, rate_per_minute from public.campaigns where status = 'sending' order by started_at loop
    exit when v_left <= 0;
    select greatest(0, c.rate_per_minute * p_minutes - count(*))::int into v_budget
      from public.campaign_recipients r
     where r.campaign_id = c.id and r.sent_at > now() - make_interval(mins => p_minutes);

    update public.campaign_recipients r
       set status = 'skipped', last_error = case when private.is_suppressed(c.business_id, r.phone) then 'suppressed' else 'no consent' end
     where r.campaign_id = c.id and r.status = 'pending'
       and (private.is_suppressed(c.business_id, r.phone) or not private.has_marketing_consent(r.customer_id));

    return query
    update public.campaign_recipients r
       set status = 'sending', attempts = r.attempts + 1, locked_at = now()
     where r.id in (select x.id from public.campaign_recipients x
                     where x.campaign_id = c.id and x.status = 'pending' and x.next_attempt_at <= now()
                     order by x.next_attempt_at, x.id
                     limit least(v_budget, v_left)
                     for update skip locked)
    returning r.id, r.campaign_id, r.phone, r.params;
    get diagnostics v_budget = row_count;
    v_left := v_left - v_budget;
  end loop;
end;
$$;

-- Everything the sender needs for one campaign, including the decrypted token.
create or replace function public.campaign_send_context(p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'campaign_id', c.id, 'provider', a.provider, 'phone_number_id', a.phone_number_id, 'waba_id', a.waba_id,
           'template_name', t.name, 'language', t.language, 'components', t.components,
           'header_media_url', c.header_media_url,
           'token', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = a.token_secret_id))
    from public.campaigns c
    join public.whatsapp_accounts a on a.id = c.account_id and a.status = 'connected'
    join public.whatsapp_templates t on t.id = c.template_id
   where c.id = p_campaign_id;
$$;

-- Records one send. Success puts the message in the customer's conversation, so
-- replies have context and receipts flow through the normal status path.
-- p_retry: a temporary error (rate limit, network) tries again with back-off.
-- Meta 131026 (not on WhatsApp) and 131050 (stopped marketing) suppress the number.
create or replace function public.record_campaign_send(p_recipient_id uuid, p_wamid text, p_body text,
                                                       p_error jsonb default null, p_retry boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.campaign_recipients;
  c public.campaigns;
  v_conv uuid;
  v_msg uuid;
  v_code text := p_error ->> 'code';
begin
  select * into r from public.campaign_recipients where id = p_recipient_id and status = 'sending' for update;
  if r.id is null then
    return;
  end if;
  select * into c from public.campaigns where id = r.campaign_id;

  if p_error is null then
    insert into public.conversations (business_id, account_id, customer_id)
    values (r.business_id, c.account_id, r.customer_id)
    on conflict (account_id, customer_id) do nothing;
    select id into v_conv from public.conversations where account_id = c.account_id and customer_id = r.customer_id;
    insert into public.messages (business_id, conversation_id, direction, wamid, type, body, status, sent_at, status_at)
    values (r.business_id, v_conv, 'outbound', p_wamid, 'template', left(p_body, 4096), 'sent', now(), now())
    returning id into v_msg;
    update public.conversations
       set last_message_at = now(), last_message_preview = left(p_body, 140), last_outbound_at = now()
     where id = v_conv;
    update public.campaign_recipients
       set status = 'sent', wamid = p_wamid, message_id = v_msg, sent_at = now(), locked_at = null, last_error = null
     where id = r.id;
  elsif p_retry and r.attempts < 3 then
    update public.campaign_recipients
       set status = 'pending', locked_at = null, last_error = left(p_error ->> 'message', 500),
           next_attempt_at = now() + make_interval(mins => (2 ^ r.attempts)::int)
     where id = r.id;
  else
    update public.campaign_recipients
       set status = 'failed', failed_at = now(), locked_at = null, last_error = left(p_error ->> 'message', 500)
     where id = r.id;
    if v_code in ('131026', '131050') then
      insert into public.suppressions (business_id, channel, phone, reason, note)
      values (r.business_id, 'whatsapp', r.phone,
              case when v_code = '131050' then 'blocked_marketing' else 'undeliverable' end,
              'From campaign ' || c.name)
      on conflict do nothing;
    end if;
  end if;

  -- Done when nothing is waiting or in flight.
  if c.status = 'sending' and not exists (
       select 1 from public.campaign_recipients x where x.campaign_id = c.id and x.status in ('pending', 'sending')) then
    update public.campaigns set status = 'completed', completed_at = now() where id = c.id and status = 'sending';
    perform private.campaign_event(c, 'completed');
  end if;
end;
$$;

-- Test send to a staff number: logged as an event, never counted as a recipient.
create or replace function public.log_campaign_test(p_campaign_id uuid, p_phone text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  select * into c from public.campaigns where id = p_campaign_id;
  if c.id is null or not private.has_permission(c.business_id, 'campaigns.manage') then
    raise exception 'not allowed to manage campaigns' using errcode = '42501';
  end if;
  perform private.campaign_event(c, case when p_error is null then 'test_sent' else 'test_failed' end,
                                 jsonb_build_object('phone', p_phone, 'error', p_error));
end;
$$;

-- Template status from Meta's message_template_status_update webhook (or a sync).
create or replace function public.apply_template_status(p_waba_id text, p_payload jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.template_status := case upper(p_payload ->> 'status')
    when 'APPROVED' then 'approved' when 'REJECTED' then 'rejected' when 'PAUSED' then 'paused'
    when 'DISABLED' then 'disabled' when 'PENDING' then 'pending' when 'IN_APPEAL' then 'pending'
    when 'PENDING_DELETION' then 'disabled' when 'DELETED' then 'disabled' else null end;
  v_n int;
begin
  if v_status is null then
    return 0;
  end if;
  update public.whatsapp_templates t
     set status = v_status, synced_at = now(),
         provider_template_id = coalesce(nullif(p_payload ->> 'id', ''), t.provider_template_id),
         rejected_reason = case when v_status = 'rejected' then nullif(p_payload ->> 'reason', '') end
   where t.waba_id = p_waba_id
     and ((p_payload ->> 'id' is not null and t.provider_template_id = p_payload ->> 'id')
          or (t.name = p_payload ->> 'name' and t.language = coalesce(p_payload ->> 'language', t.language)));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- =====================================================================
-- Message triggers: receipts → campaign recipients; keywords → consent;
-- replies → campaign attribution
-- =====================================================================
create or replace function private.sync_campaign_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.campaign_recipients r
     set status = case when new.status in ('delivered', 'read', 'failed') and r.status not in ('read')
                       then new.status else r.status end,
         delivered_at = case when new.status in ('delivered', 'read') then coalesce(r.delivered_at, new.status_at, now()) else r.delivered_at end,
         read_at = case when new.status = 'read' then coalesce(r.read_at, new.status_at, now()) else r.read_at end,
         failed_at = case when new.status = 'failed' then coalesce(r.failed_at, now()) else r.failed_at end,
         last_error = case when new.status = 'failed' then left(new.error::text, 500) else r.last_error end
   where r.message_id = new.id;
  return null;
end;
$$;

create trigger messages_campaign_receipt after update of status on public.messages
  for each row when (new.direction = 'outbound') execute function private.sync_campaign_receipt();

create or replace function private.on_inbound_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_phone text;
  v_word text := upper(regexp_replace(trim(coalesce(new.body, '')), '[^A-Za-z ]', '', 'g'));
begin
  select c.customer_id, cu.primary_phone into v_customer, v_phone
    from public.conversations c join public.customers cu on cu.id = c.customer_id
   where c.id = new.conversation_id;

  -- STOP / START keywords, including Meta's marketing opt-out quick reply.
  if v_word in ('STOP', 'STOP PROMOTIONS', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT', 'STOP ALL') then
    insert into public.customer_consents (business_id, customer_id, channel, purpose, status, source, evidence)
    values (new.business_id, v_customer, 'whatsapp', 'marketing', 'opted_out', 'whatsapp_keyword', left(new.body, 200));
    if v_phone is not null then
      insert into public.suppressions (business_id, channel, phone, reason, note)
      values (new.business_id, 'whatsapp', v_phone, 'opt_out', 'Replied ' || left(new.body, 40))
      on conflict (business_id, channel, phone) do update set reason = 'opt_out', note = excluded.note;
    end if;
  elsif v_word in ('START', 'SUBSCRIBE', 'OPT IN', 'OPTIN', 'UNSTOP') then
    insert into public.customer_consents (business_id, customer_id, channel, purpose, status, source, evidence)
    values (new.business_id, v_customer, 'whatsapp', 'marketing', 'opted_in', 'whatsapp_keyword', left(new.body, 200));
    delete from public.suppressions
     where business_id = new.business_id and channel = 'whatsapp' and phone = v_phone and reason = 'opt_out';
  end if;

  -- Credit the reply to the latest campaign sent to this customer in the last 7 days.
  update public.campaign_recipients r
     set replied_at = new.sent_at
   where r.id = (select x.id from public.campaign_recipients x
                  where x.customer_id = v_customer and x.sent_at > new.sent_at - interval '7 days'
                    and x.sent_at <= new.sent_at and x.replied_at is null
                  order by x.sent_at desc limit 1);
  return null;
end;
$$;

create trigger messages_inbound_effects after insert on public.messages
  for each row when (new.direction = 'inbound') execute function private.on_inbound_message();

-- =====================================================================
-- Report
-- =====================================================================
-- Delivery funnel plus outcomes from recipients: leads created within 7 days
-- and orders (with revenue) within 30 days of the send.
create or replace function public.campaign_report(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  v jsonb;
begin
  select * into c from public.campaigns where id = p_campaign_id;
  if c.id is null or not private.has_permission(c.business_id, 'campaigns.view') then
    raise exception 'not allowed to view campaigns' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'recipients', count(*),
    'pending', count(*) filter (where r.status in ('pending', 'sending')),
    'sent', count(*) filter (where r.sent_at is not null),
    'delivered', count(*) filter (where r.delivered_at is not null),
    'read', count(*) filter (where r.read_at is not null),
    'failed', count(*) filter (where r.status = 'failed'),
    'skipped', count(*) filter (where r.status = 'skipped'),
    'replied', count(*) filter (where r.replied_at is not null),
    'leads', (select count(distinct l.id) from public.leads l join public.campaign_recipients x on x.customer_id = l.customer_id
               where x.campaign_id = c.id and x.sent_at is not null
                 and l.created_at between x.sent_at and x.sent_at + interval '7 days'),
    'orders', (select count(distinct o.id) from public.orders o
                 join public.order_stages s on s.id = o.stage_id and s.category <> 'cancelled'
                 join public.campaign_recipients x on x.customer_id = o.customer_id
               where x.campaign_id = c.id and x.sent_at is not null
                 and o.created_at between x.sent_at and x.sent_at + interval '30 days'),
    'revenue', (select coalesce(sum(t.total), 0) from (
                  select distinct o.id, o.total from public.orders o
                    join public.order_stages s on s.id = o.stage_id and s.category <> 'cancelled'
                    join public.campaign_recipients x on x.customer_id = o.customer_id
                   where x.campaign_id = c.id and x.sent_at is not null
                     and o.created_at between x.sent_at and x.sent_at + interval '30 days') t))
    into v
    from public.campaign_recipients r where r.campaign_id = c.id;
  return v;
end;
$$;

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.audience_estimate(uuid, jsonb) from public, anon;
revoke execute on function public.launch_campaign(uuid, timestamptz) from public, anon;
revoke execute on function public.set_campaign_state(uuid, text) from public, anon;
revoke execute on function public.duplicate_campaign(uuid) from public, anon;
revoke execute on function public.log_campaign_test(uuid, text, text) from public, anon;
revoke execute on function public.campaign_report(uuid) from public, anon;
grant execute on function public.audience_estimate(uuid, jsonb) to authenticated;
grant execute on function public.launch_campaign(uuid, timestamptz) to authenticated;
grant execute on function public.set_campaign_state(uuid, text) to authenticated;
grant execute on function public.duplicate_campaign(uuid) to authenticated;
grant execute on function public.log_campaign_test(uuid, text, text) to authenticated;
grant execute on function public.campaign_report(uuid) to authenticated;

revoke execute on function public.record_webhook_event_for_account(text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.whatsapp_account_by_webhook_token(text) from public, anon, authenticated;
revoke execute on function public.campaign_tick() from public, anon, authenticated;
revoke execute on function public.claim_campaign_batch(int, int) from public, anon, authenticated;
revoke execute on function public.campaign_send_context(uuid) from public, anon, authenticated;
revoke execute on function public.record_campaign_send(uuid, text, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.apply_template_status(text, jsonb) from public, anon, authenticated;
grant execute on function public.record_webhook_event_for_account(text, text, text, uuid, jsonb) to service_role;
grant execute on function public.whatsapp_account_by_webhook_token(text) to service_role;
grant execute on function public.campaign_tick() to service_role;
grant execute on function public.claim_campaign_batch(int, int) to service_role;
grant execute on function public.campaign_send_context(uuid) to service_role;
grant execute on function public.record_campaign_send(uuid, text, text, jsonb, boolean) to service_role;
grant execute on function public.apply_template_status(text, jsonb) to service_role;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.whatsapp_templates  enable row level security;
alter table public.suppressions        enable row level security;
alter table public.campaigns           enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.campaign_events     enable row level security;

grant select (provider) on public.whatsapp_accounts to authenticated;

-- Templates: members can read (the inbox and campaigns list them); templates.manage writes drafts.
-- Status and provider ids are only set by the server after Meta answers.
create policy templates_select on public.whatsapp_templates for select to authenticated
  using (private.is_member(business_id));
create policy templates_insert on public.whatsapp_templates for insert to authenticated
  with check (private.has_permission(business_id, 'templates.manage') and status = 'draft' and created_by = auth.uid()
              and exists (select 1 from public.whatsapp_accounts a where a.business_id = whatsapp_templates.business_id
                                                                    and a.waba_id = whatsapp_templates.waba_id));
create policy templates_update on public.whatsapp_templates for update to authenticated
  using (private.has_permission(business_id, 'templates.manage') and status in ('draft', 'rejected'))
  with check (private.has_permission(business_id, 'templates.manage'));
create policy templates_delete on public.whatsapp_templates for delete to authenticated
  using (private.has_permission(business_id, 'templates.manage') and status in ('draft', 'rejected')
         and not exists (select 1 from public.campaigns c where c.template_id = whatsapp_templates.id));
revoke insert, update on public.whatsapp_templates from authenticated, anon;
grant insert (business_id, waba_id, name, language, category, components, variable_count, status, created_by)
  on public.whatsapp_templates to authenticated;
grant update (name, language, category, components, variable_count) on public.whatsapp_templates to authenticated;

-- Suppressions: campaign staff see and manage; opt-outs are recorded by the database.
create policy suppressions_select on public.suppressions for select to authenticated
  using (private.has_permission(business_id, 'campaigns.view') or private.has_permission(business_id, 'campaigns.manage'));
create policy suppressions_insert on public.suppressions for insert to authenticated
  with check (private.has_permission(business_id, 'campaigns.manage') and reason = 'manual' and created_by = auth.uid());
create policy suppressions_delete on public.suppressions for delete to authenticated
  using (private.has_permission(business_id, 'campaigns.manage') and reason in ('manual', 'undeliverable'));
revoke update on public.suppressions from authenticated, anon;

create policy campaigns_select on public.campaigns for select to authenticated
  using (private.has_permission(business_id, 'campaigns.view') or private.has_permission(business_id, 'campaigns.manage'));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (private.has_permission(business_id, 'campaigns.manage') and status = 'draft' and created_by = auth.uid());
create policy campaigns_update on public.campaigns for update to authenticated
  using (private.has_permission(business_id, 'campaigns.manage') and status = 'draft')
  with check (private.has_permission(business_id, 'campaigns.manage') and status = 'draft');
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (private.has_permission(business_id, 'campaigns.manage') and status = 'draft');
revoke insert, update on public.campaigns from authenticated, anon;
grant insert (business_id, name, account_id, template_id, variables, header_media_url, filter, rate_per_minute, status, created_by)
  on public.campaigns to authenticated;
grant update (name, account_id, template_id, variables, header_media_url, filter, rate_per_minute) on public.campaigns to authenticated;

create policy recipients_select on public.campaign_recipients for select to authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id));
revoke insert, update, delete on public.campaign_recipients from authenticated, anon;

create policy campaign_events_select on public.campaign_events for select to authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id));
revoke insert, update, delete on public.campaign_events from authenticated, anon;

revoke all on public.whatsapp_templates, public.suppressions, public.campaigns, public.campaign_recipients,
  public.campaign_events from anon;
grant execute on all functions in schema private to authenticated, service_role;
