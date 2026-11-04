-- =====================================================================
-- Sprint 5: WhatsApp engine (Meta Cloud API) and shared inbox.
--
-- Each business connects its own WhatsApp Business Account (ADR 0002).
-- Access tokens live in Supabase Vault; only the service role can read them.
-- One app-level webhook writes every event to private.webhook_events
-- (deduplicated by external id) before anything else happens.
-- =====================================================================

create type public.whatsapp_account_status as enum ('connected', 'disconnected', 'error');
create type public.conversation_status as enum ('open', 'closed');

-- ---------------------------------------------------------------------
-- Connected numbers
-- ---------------------------------------------------------------------
create table public.whatsapp_accounts (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  waba_id          text not null check (waba_id ~ '^[0-9]{5,30}$'),
  -- Meta's id for the number: globally unique, used to route webhooks to a tenant.
  phone_number_id  text not null unique check (phone_number_id ~ '^[0-9]{5,30}$'),
  display_phone    text,
  verified_name    text,
  quality_rating   text,
  status           public.whatsapp_account_status not null default 'connected',
  connected_via    text not null default 'manual' check (connected_via in ('embedded_signup', 'manual')),
  token_secret_id  uuid,
  connected_by     uuid references public.profiles(id) on delete set null,
  connected_at     timestamptz not null default now(),
  last_checked_at  timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (business_id, id)
);
create index whatsapp_accounts_business_idx on public.whatsapp_accounts (business_id);
create trigger whatsapp_accounts_updated_at before update on public.whatsapp_accounts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Raw webhook events: stored first, processed after the 200 is sent.
-- ---------------------------------------------------------------------
create table private.webhook_events (
  id           bigint generated always as identity primary key,
  provider     text not null,
  external_id  text not null,
  kind         text not null check (kind in ('message', 'status', 'other')),
  business_id  uuid references public.businesses(id) on delete cascade,
  account_id   uuid references public.whatsapp_accounts(id) on delete cascade,
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending', 'processed', 'ignored', 'failed')),
  attempts     int not null default 0,
  last_error   text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_id)
);
create index webhook_events_pending_idx on private.webhook_events (received_at) where status = 'pending';
create index webhook_events_account_idx on private.webhook_events (account_id, received_at desc);
alter table private.webhook_events enable row level security;

-- ---------------------------------------------------------------------
-- Conversations and messages
-- ---------------------------------------------------------------------
-- One thread per customer per connected number, as in WhatsApp itself.
create table public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  account_id            uuid not null,
  customer_id           uuid not null,
  lead_id               uuid,
  assignee_id           uuid references public.profiles(id) on delete set null,
  status                public.conversation_status not null default 'open',
  labels                text[] not null default '{}' check (cardinality(labels) <= 20),
  last_message_at       timestamptz,
  last_message_preview  text,
  last_inbound_at       timestamptz,
  last_outbound_at      timestamptz,
  -- First customer message not yet answered; drives "waiting" and response times.
  awaiting_since        timestamptz,
  unread_count          int not null default 0 check (unread_count >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (account_id, customer_id),
  unique (business_id, id),
  foreign key (business_id, account_id) references public.whatsapp_accounts (business_id, id) on delete cascade,
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, lead_id) references public.leads (business_id, id)
);
create index conversations_inbox_idx on public.conversations (business_id, last_message_at desc);
create index conversations_assignee_idx on public.conversations (business_id, assignee_id, last_message_at desc);
create index conversations_customer_idx on public.conversations (customer_id);
create index conversations_labels_idx on public.conversations using gin (labels);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();

create table public.messages (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null,
  conversation_id   uuid not null,
  direction         text not null check (direction in ('inbound', 'outbound', 'note')),
  wamid             text unique,
  type              text not null default 'text' check (type ~ '^[a-z_]+$'),
  body              text check (length(body) <= 4096),
  media             jsonb check (media is null or jsonb_typeof(media) = 'object'),
  status            text not null check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed', 'note')),
  error             jsonb,
  sent_by           uuid references public.profiles(id) on delete set null,
  response_seconds  int check (response_seconds >= 0),
  sent_at           timestamptz not null default now(),
  status_at         timestamptz,
  created_at        timestamptz not null default now(),
  foreign key (business_id, conversation_id) references public.conversations (business_id, id) on delete cascade,
  check ((direction = 'note') = (status = 'note'))
);
create index messages_conversation_idx on public.messages (conversation_id, sent_at);

-- =====================================================================
-- Access
-- =====================================================================
create or replace function private.can_see_conversation(p_business_id uuid, p_assignee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_business_id, 'inbox.view_all')
      or (private.has_permission(p_business_id, 'inbox.view_assigned') and p_assignee_id = auth.uid());
$$;

-- Assignment rules: taking a conversation yourself is fine; giving it to
-- someone else needs inbox.view_all, and they must be able to open the inbox.
create or replace function private.guard_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    -- Webhook processing (no signed-in user) only routes to people who can open the inbox.
    if auth.uid() is null and not exists (
      select 1 from public.business_memberships m
        join public.role_permissions rp on rp.role_id = m.role_id
       where m.business_id = new.business_id and m.user_id = new.assignee_id and m.status = 'active'
         and rp.permission_key in ('inbox.view_all', 'inbox.view_assigned')) then
      new.assignee_id := old.assignee_id;
      return new;
    end if;
    if not exists (
      select 1 from public.business_memberships m
        join public.role_permissions rp on rp.role_id = m.role_id
       where m.business_id = new.business_id and m.user_id = new.assignee_id and m.status = 'active'
         and rp.permission_key in ('inbox.view_all', 'inbox.view_assigned')) then
      raise exception 'assignee cannot use the inbox' using errcode = '23514';
    end if;
    if auth.uid() is not null and new.assignee_id <> auth.uid()
       and not private.has_permission(new.business_id, 'inbox.view_all') then
      raise exception 'not allowed to assign conversations' using errcode = '42501';
    end if;
  end if;
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null
     and auth.uid() is not null and new.assignee_id <> auth.uid() then
    perform private.notify(new.business_id, new.assignee_id, 'conversation_assigned',
      'WhatsApp conversation assigned to you',
      (select full_name from public.customers where id = new.customer_id) || coalesce(' · ' || new.last_message_preview, ''),
      '/inbox?c=' || new.id);
  end if;
  return new;
end;
$$;

create trigger conversations_guard before update on public.conversations
  for each row execute function private.guard_conversation();

-- =====================================================================
-- Connecting numbers (integrations.manage). Tokens go straight to Vault.
-- =====================================================================
create or replace function public.connect_whatsapp_account(p_business_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := p_input ->> 'phone_number_id';
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

  select * into v_existing from public.whatsapp_accounts where phone_number_id = v_phone for update;
  if v_existing.id is not null and v_existing.business_id <> p_business_id then
    raise exception 'number is connected to another business' using errcode = '23505';
  end if;

  if v_existing.token_secret_id is not null then
    perform vault.update_secret(v_existing.token_secret_id, v_token);
    v_secret := v_existing.token_secret_id;
  else
    v_secret := vault.create_secret(v_token, 'whatsapp_token_' || v_phone, 'WhatsApp access token for phone number ' || v_phone);
  end if;

  insert into public.whatsapp_accounts as a (business_id, waba_id, phone_number_id, display_phone, verified_name,
                                             quality_rating, status, connected_via, token_secret_id, connected_by,
                                             connected_at, last_checked_at, last_error)
  values (p_business_id, p_input ->> 'waba_id', v_phone, nullif(p_input ->> 'display_phone', ''),
          nullif(p_input ->> 'verified_name', ''), nullif(p_input ->> 'quality_rating', ''), 'connected',
          coalesce(nullif(p_input ->> 'connected_via', ''), 'manual'), v_secret, auth.uid(), now(), now(), null)
  on conflict (phone_number_id) do update
     set waba_id = excluded.waba_id, display_phone = excluded.display_phone, verified_name = excluded.verified_name,
         quality_rating = excluded.quality_rating, status = 'connected', connected_via = excluded.connected_via,
         token_secret_id = excluded.token_secret_id, connected_by = excluded.connected_by,
         connected_at = now(), last_checked_at = now(), last_error = null
  returning a.id into v_id;
  return v_id;
end;
$$;

-- Disconnecting keeps conversations and history; the token is wiped.
create or replace function public.disconnect_whatsapp_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.whatsapp_accounts;
begin
  select * into v from public.whatsapp_accounts where id = p_account_id for update;
  if v.id is null or not private.has_permission(v.business_id, 'integrations.manage') then
    raise exception 'not allowed to manage integrations' using errcode = '42501';
  end if;
  if v.token_secret_id is not null then
    perform vault.update_secret(v.token_secret_id, 'revoked');
  end if;
  update public.whatsapp_accounts set status = 'disconnected', last_error = null where id = v.id;
end;
$$;

-- =====================================================================
-- Inbox actions for signed-in members
-- =====================================================================

-- Queues a free-form reply. Only inside the 24-hour customer service window;
-- outside it, an approved template is needed (Sprint 6).
create or replace function public.queue_whatsapp_reply(p_conversation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations;
  v_id uuid;
  v_now timestamptz := now();
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if c.id is null or not private.can_see_conversation(c.business_id, c.assignee_id)
     or not private.has_permission(c.business_id, 'inbox.reply') then
    raise exception 'not allowed to reply' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_body)), 0) = 0 or length(p_body) > 4096 then
    raise exception 'message must be between 1 and 4096 characters' using errcode = '22023';
  end if;
  if c.last_inbound_at is null or c.last_inbound_at < v_now - interval '24 hours' then
    raise exception 'outside the 24-hour window' using errcode = '23514';
  end if;
  if not exists (select 1 from public.whatsapp_accounts a where a.id = c.account_id and a.status = 'connected') then
    raise exception 'whatsapp number is not connected' using errcode = '23514';
  end if;

  insert into public.messages (business_id, conversation_id, direction, type, body, status, sent_by, response_seconds, sent_at)
  values (c.business_id, c.id, 'outbound', 'text', p_body, 'queued', auth.uid(),
          case when c.awaiting_since is not null then greatest(0, extract(epoch from v_now - c.awaiting_since))::int end,
          v_now)
  returning id into v_id;

  update public.conversations
     set last_message_at = v_now, last_message_preview = left(p_body, 140), last_outbound_at = v_now,
         awaiting_since = null, unread_count = 0,
         assignee_id = coalesce(assignee_id, auth.uid())
   where id = c.id;
  return v_id;
end;
$$;

-- =====================================================================
-- Service-role functions: webhook ingestion and sending
-- =====================================================================

-- Stores one webhook item. Returns null for a duplicate (already stored).
create or replace function public.record_webhook_event(
  p_provider text, p_external_id text, p_kind text, p_phone_number_id text, p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.whatsapp_accounts;
  v_id bigint;
begin
  select * into v_account from public.whatsapp_accounts where phone_number_id = p_phone_number_id;
  insert into private.webhook_events (provider, external_id, kind, business_id, account_id, payload, status)
  values (p_provider, p_external_id, p_kind, v_account.business_id, v_account.id, p_payload,
          -- Events for numbers nobody connected are kept for diagnosis but never processed.
          case when v_account.id is null then 'ignored' else 'pending' end)
  on conflict (provider, external_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finish_webhook_event(p_event_id bigint, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.webhook_events
     set attempts = attempts + 1,
         status = case when p_error is null then 'processed' when attempts + 1 >= 5 then 'failed' else 'pending' end,
         last_error = left(p_error, 1000),
         processed_at = case when p_error is null then now() end
   where id = p_event_id;
$$;

-- Events still pending a minute after arrival (the first attempt failed or never ran).
create or replace function public.pending_webhook_events(p_limit int default 50)
returns table (id bigint, kind text, payload jsonb)
language sql
security definer
set search_path = ''
as $$
  select e.id, e.kind, e.payload from private.webhook_events e
   where e.status = 'pending' and e.received_at < now() - interval '1 minute'
   order by e.received_at
   limit greatest(1, least(p_limit, 200));
$$;

-- One inbound message → customer file → open lead → conversation → message.
-- Input is normalised by the app: phone (E.164, via normalisePhone), wamid,
-- profile_name, type, body, media, sent_at.
create or replace function public.ingest_whatsapp_message(p_event_id bigint, p_message jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e private.webhook_events;
  v_customer uuid;
  v_conv public.conversations;
  v_lead jsonb;
  v_lead_id uuid;
  v_at timestamptz := coalesce(nullif(p_message ->> 'sent_at', '')::timestamptz, now());
  v_preview text;
  v_was_waiting boolean;
begin
  select * into e from private.webhook_events where id = p_event_id;
  if e.id is null or e.account_id is null then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.messages where wamid = p_message ->> 'wamid') then
    perform public.finish_webhook_event(e.id);
    return jsonb_build_object('duplicate', true);
  end if;

  select m.customer_id into v_customer
    from private.match_or_create_customer(e.business_id, p_message ->> 'phone', null,
                                          coalesce(nullif(p_message ->> 'profile_name', ''), p_message ->> 'phone'),
                                          null, null) m;

  insert into public.conversations (business_id, account_id, customer_id)
  values (e.business_id, e.account_id, v_customer)
  on conflict (account_id, customer_id) do nothing;
  select * into v_conv from public.conversations
   where account_id = e.account_id and customer_id = v_customer for update;

  -- Keep the conversation on an open lead; start one (source WhatsApp) when there is none.
  v_lead_id := v_conv.lead_id;
  if v_lead_id is null or not exists (
       select 1 from public.leads l join public.lead_statuses s on s.id = l.status_id
        where l.id = v_lead_id and s.category = 'open' and l.archived_at is null) then
    select l.id into v_lead_id
      from public.leads l join public.lead_statuses s on s.id = l.status_id
     where l.customer_id = v_customer and s.category = 'open' and l.archived_at is null
     order by l.created_at desc limit 1;
    if v_lead_id is null then
      v_lead := private.create_lead_internal(e.business_id,
        jsonb_build_object('customer_id', v_customer, 'source', 'whatsapp',
                           'description', left(p_message ->> 'body', 1000)),
        null);
      v_lead_id := (v_lead ->> 'lead_id')::uuid;
    end if;
  end if;

  v_preview := left(coalesce(nullif(p_message ->> 'body', ''), '[' || coalesce(p_message ->> 'type', 'message') || ']'), 140);
  insert into public.messages (business_id, conversation_id, direction, wamid, type, body, media, status, sent_at)
  values (e.business_id, v_conv.id, 'inbound', p_message ->> 'wamid', coalesce(nullif(p_message ->> 'type', ''), 'text'),
          nullif(p_message ->> 'body', ''), p_message -> 'media', 'received', v_at);

  v_was_waiting := v_conv.awaiting_since is not null;
  update public.conversations c
     set lead_id = v_lead_id,
         -- New conversations go to the lead's owner.
         assignee_id = coalesce(c.assignee_id, (select owner_id from public.leads where id = v_lead_id)),
         status = 'open',
         last_message_at = greatest(coalesce(c.last_message_at, v_at), v_at),
         last_message_preview = v_preview,
         last_inbound_at = greatest(coalesce(c.last_inbound_at, v_at), v_at),
         awaiting_since = coalesce(c.awaiting_since, v_at),
         unread_count = c.unread_count + 1
   where c.id = v_conv.id
  returning * into v_conv;

  update public.leads set last_activity_at = greatest(last_activity_at, v_at) where id = v_lead_id;

  -- Notify once per unanswered burst, not per message.
  if not v_was_waiting and v_conv.assignee_id is not null then
    perform private.notify(e.business_id, v_conv.assignee_id, 'whatsapp_message',
      'WhatsApp from ' || (select full_name from public.customers where id = v_customer),
      v_preview, '/inbox?c=' || v_conv.id);
  end if;

  perform public.finish_webhook_event(e.id);
  return jsonb_build_object('conversation_id', v_conv.id, 'customer_id', v_customer, 'lead_id', v_lead_id,
                            'lead_created', v_lead is not null);
end;
$$;

-- Delivery receipts. Status only moves forward (sent → delivered → read); failed always lands.
create or replace function public.apply_whatsapp_status(p_event_id bigint, p_status jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank jsonb := '{"queued":0,"sent":1,"delivered":2,"read":3}';
  v_new text := p_status ->> 'status';
begin
  update public.messages m
     set status = v_new,
         status_at = coalesce(nullif(p_status ->> 'at', '')::timestamptz, now()),
         error = case when v_new = 'failed' then p_status -> 'errors' else m.error end
   where m.wamid = p_status ->> 'wamid'
     and m.direction = 'outbound'
     and v_new in ('sent', 'delivered', 'read', 'failed')
     and (v_new = 'failed' or coalesce((v_rank ->> m.status)::int, -1) < (v_rank ->> v_new)::int);
  perform public.finish_webhook_event(p_event_id);
end;
$$;

-- What the sender needs for one queued message, including the decrypted token.
create or replace function public.whatsapp_send_context(p_message_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'message_id', m.id, 'body', m.body, 'to', cu.primary_phone,
           'phone_number_id', a.phone_number_id, 'account_status', a.status,
           'token', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = a.token_secret_id))
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.customers cu on cu.id = c.customer_id
    join public.whatsapp_accounts a on a.id = c.account_id
   where m.id = p_message_id and m.status = 'queued';
$$;

create or replace function public.record_whatsapp_send(p_message_id uuid, p_wamid text, p_error jsonb default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages
     set wamid = coalesce(p_wamid, wamid),
         status = case when p_error is null then 'sent' else 'failed' end,
         error = p_error,
         status_at = now()
   where id = p_message_id and status = 'queued';
$$;

-- Token for a connection test or a media download (server only).
create or replace function public.whatsapp_account_token(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from public.whatsapp_accounts a
    join vault.decrypted_secrets s on s.id = a.token_secret_id
   where a.id = p_account_id and a.status <> 'disconnected';
$$;

create or replace function public.record_whatsapp_check(p_account_id uuid, p_result jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_accounts
     set last_checked_at = now(),
         status = (case when p_result ? 'error' then 'error' else 'connected' end)::public.whatsapp_account_status,
         last_error = left(p_result ->> 'error', 500),
         display_phone = coalesce(nullif(p_result ->> 'display_phone', ''), display_phone),
         verified_name = coalesce(nullif(p_result ->> 'verified_name', ''), verified_name),
         quality_rating = coalesce(nullif(p_result ->> 'quality_rating', ''), quality_rating)
   where id = p_account_id and status <> 'disconnected';
$$;

-- Webhook health per number, for the Integrations page.
create or replace function public.whatsapp_health(p_business_id uuid)
returns table (account_id uuid, last_event_at timestamptz, events_24h bigint, failed_24h bigint, pending bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         (select max(e.received_at) from private.webhook_events e where e.account_id = a.id),
         (select count(*) from private.webhook_events e where e.account_id = a.id and e.received_at > now() - interval '24 hours'),
         (select count(*) from private.webhook_events e where e.account_id = a.id and e.status = 'failed' and e.received_at > now() - interval '24 hours'),
         (select count(*) from private.webhook_events e where e.account_id = a.id and e.status = 'pending')
    from public.whatsapp_accounts a
   where a.business_id = p_business_id and private.has_permission(p_business_id, 'integrations.manage');
$$;

revoke execute on function public.connect_whatsapp_account(uuid, jsonb) from public, anon;
revoke execute on function public.disconnect_whatsapp_account(uuid) from public, anon;
revoke execute on function public.queue_whatsapp_reply(uuid, text) from public, anon;
revoke execute on function public.whatsapp_health(uuid) from public, anon;
grant execute on function public.connect_whatsapp_account(uuid, jsonb) to authenticated;
grant execute on function public.disconnect_whatsapp_account(uuid) to authenticated;
grant execute on function public.queue_whatsapp_reply(uuid, text) to authenticated;
grant execute on function public.whatsapp_health(uuid) to authenticated;

revoke execute on function public.record_webhook_event(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.finish_webhook_event(bigint, text) from public, anon, authenticated;
revoke execute on function public.pending_webhook_events(int) from public, anon, authenticated;
revoke execute on function public.ingest_whatsapp_message(bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_whatsapp_status(bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.whatsapp_send_context(uuid) from public, anon, authenticated;
revoke execute on function public.record_whatsapp_send(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.whatsapp_account_token(uuid) from public, anon, authenticated;
revoke execute on function public.record_whatsapp_check(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_webhook_event(text, text, text, text, jsonb) to service_role;
grant execute on function public.finish_webhook_event(bigint, text) to service_role;
grant execute on function public.pending_webhook_events(int) to service_role;
grant execute on function public.ingest_whatsapp_message(bigint, jsonb) to service_role;
grant execute on function public.apply_whatsapp_status(bigint, jsonb) to service_role;
grant execute on function public.whatsapp_send_context(uuid) to service_role;
grant execute on function public.record_whatsapp_send(uuid, text, jsonb) to service_role;
grant execute on function public.whatsapp_account_token(uuid) to service_role;
grant execute on function public.record_whatsapp_check(uuid, jsonb) to service_role;

-- Audit: connecting numbers is configuration.
create trigger audit_whatsapp_accounts after insert or update or delete on public.whatsapp_accounts
  for each row execute function private.audit_row();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.whatsapp_accounts enable row level security;
alter table public.conversations     enable row level security;
alter table public.messages          enable row level security;

-- Members see which numbers are connected (the inbox shows them); only RPCs write.
create policy wa_accounts_select on public.whatsapp_accounts for select to authenticated
  using (private.is_member(business_id));
revoke all on public.whatsapp_accounts from authenticated, anon;
grant select (id, business_id, waba_id, phone_number_id, display_phone, verified_name, quality_rating, status,
              connected_via, connected_by, connected_at, last_checked_at, last_error, created_at)
  on public.whatsapp_accounts to authenticated;

create policy conversations_select on public.conversations for select to authenticated
  using (private.is_member(business_id) and private.can_see_conversation(business_id, assignee_id));
create policy conversations_update on public.conversations for update to authenticated
  using (private.is_member(business_id) and private.can_see_conversation(business_id, assignee_id))
  with check (private.is_member(business_id));
revoke insert, update, delete on public.conversations from authenticated, anon;
grant update (assignee_id, status, labels, unread_count) on public.conversations to authenticated;

create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
-- Members add internal notes directly; replies go through queue_whatsapp_reply().
create policy messages_insert_note on public.messages for insert to authenticated
  with check (direction = 'note' and status = 'note' and sent_by = auth.uid()
              and exists (select 1 from public.conversations c
                           where c.id = conversation_id and c.business_id = messages.business_id));
revoke insert, update, delete on public.messages from authenticated, anon;
grant insert (business_id, conversation_id, direction, type, body, status, sent_by) on public.messages to authenticated;

revoke all on public.whatsapp_accounts, public.conversations, public.messages from anon;
grant execute on all functions in schema private to authenticated, service_role;

-- Live inbox over Supabase Realtime (skipped on plain Postgres).
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.conversations, public.messages;
  else
    raise notice 'supabase_realtime publication not present; skipping';
  end if;
end
$realtime$;
