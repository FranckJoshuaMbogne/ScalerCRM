-- Sprint 14: visual workflow editor (ADR 0015).
--
--   * An automation is now a graph of steps (trigger, conditions with yes/no
--     branches, waits, wait-until, wait-for-reply, actions). Sprint 8's
--     linear automations convert automatically, and so does anything still
--     written in the old format.
--   * Publishing creates an immutable version. Runs carry the version they
--     started on and finish on it. Rolling back publishes an old graph again.
--   * New actions: send email, update a custom field, call a webhook (Sprint 13).
--   * Dry runs walk the graph for a real lead in a read-only function.
--   * Per-step analytics from an append-only step log.
--   * Guard-rails: graphs must be acyclic, a run takes at most 100 steps,
--     automations can't trigger themselves (or chains deeper than 5), and
--     automation emails count against the plan's message allowance.

-- =====================================================================
-- Graph format
-- =====================================================================
-- { "nodes": [ { "id": "n1", "kind": "trigger", "trigger": "lead_created", "config": {}, "next": "n2", "x": 0, "y": 0 },
--              { "id": "n2", "kind": "condition", "match": "all", "conditions": [{field, op, value}], "yes": "n3", "no": null },
--              { "id": "n3", "kind": "wait", "minutes": 60, "next": "n4" },
--              { "id": "n4", "kind": "wait_until", "mode": "time" | "business_hours", "time": "10:00",
--                "open": "10:00", "close": "20:00", "days": [1,2,3,4,5,6], "next": … },
--              { "id": "n5", "kind": "wait_for_reply", "timeout_minutes": 1440, "replied": …, "timeout": … },
--              { "id": "n6", "kind": "action", "action": { "type": "create_task", … }, "next": null } ] }
-- Edges are the next / yes / no / replied / timeout fields. x and y are canvas positions.

create or replace function private.graph_node(p_graph jsonb, p_id text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select n from jsonb_array_elements(coalesce(p_graph -> 'nodes', '[]')) n where n ->> 'id' = p_id limit 1;
$$;

create or replace function private.graph_start(p_graph jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select n from jsonb_array_elements(coalesce(p_graph -> 'nodes', '[]')) n where n ->> 'kind' = 'trigger' limit 1;
$$;

create or replace function private.graph_edges(p_node jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_remove(array[p_node ->> 'next', p_node ->> 'yes', p_node ->> 'no', p_node ->> 'replied', p_node ->> 'timeout'], null);
$$;

-- Why a graph can't be published, in plain words. Empty when it can.
create or replace function private.automation_graph_errors(p_graph jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  e text[] := '{}';
  n jsonb;
  a jsonb;
  v_ids text[];
  v_kind text;
  v_count int;
  v_reached text[];
  v_frontier text[];
  v_next text[];
  v_cyclic boolean;
begin
  if jsonb_typeof(p_graph) is distinct from 'object' or jsonb_typeof(p_graph -> 'nodes') is distinct from 'array' then
    return array['The workflow is empty.'];
  end if;
  v_count := jsonb_array_length(p_graph -> 'nodes');
  if v_count > 50 then
    e := e || 'Use at most 50 steps.'::text;
  end if;
  select array_agg(x ->> 'id') into v_ids from jsonb_array_elements(p_graph -> 'nodes') x;
  if exists (select 1 from unnest(v_ids) i where i is null or i !~ '^[A-Za-z0-9_-]{1,40}$')
     or (select count(distinct i) from unnest(v_ids) i) <> v_count then
    e := e || 'Every step needs its own id.'::text;
  end if;
  if (select count(*) from jsonb_array_elements(p_graph -> 'nodes') x where x ->> 'kind' = 'trigger') <> 1 then
    return e || 'A workflow starts with exactly one trigger.'::text;
  end if;

  for n in select x from jsonb_array_elements(p_graph -> 'nodes') x loop
    v_kind := n ->> 'kind';
    if v_kind not in ('trigger', 'condition', 'wait', 'wait_until', 'wait_for_reply', 'action') then
      e := e || format('Unknown step type %s.', coalesce(v_kind, 'missing'));
      continue;
    end if;
    if exists (select 1 from unnest(private.graph_edges(n)) t where not t = any (v_ids)) then
      e := e || 'A connection points at a step that no longer exists.'::text;
    end if;
    if exists (select 1 from unnest(private.graph_edges(n)) t where t = n ->> 'id') then
      e := e || 'A step cannot lead to itself.'::text;
    end if;
    case v_kind
      when 'trigger' then
        if coalesce(n ->> 'trigger', '') not in ('lead_created', 'lead_status_changed', 'lead_assigned', 'lead_idle',
                                                 'order_created', 'order_stage_changed', 'appointment_no_show') then
          e := e || 'Choose what starts the workflow.'::text;
        end if;
        if n ->> 'trigger' = 'lead_idle' and coalesce((n -> 'config' ->> 'days')::numeric, 0) not between 1 and 90 then
          e := e || 'Idle days must be between 1 and 90.'::text;
        end if;
        if n ->> 'next' is null then
          e := e || 'Connect the trigger to a first step.'::text;
        end if;
      when 'condition' then
        if jsonb_typeof(n -> 'conditions') is distinct from 'array' or jsonb_array_length(n -> 'conditions') = 0 then
          e := e || 'A condition needs at least one check.'::text;
        end if;
        if n ->> 'yes' is null and n ->> 'no' is null then
          e := e || 'Connect at least one branch of each condition.'::text;
        end if;
      when 'wait' then
        if coalesce((n ->> 'minutes')::numeric, 0) not between 1 and 86400 then
          e := e || 'Waits are between 1 minute and 60 days.'::text;
        end if;
      when 'wait_until' then
        if coalesce(n ->> 'mode', '') not in ('time', 'business_hours')
           or (n ->> 'mode' = 'time' and coalesce(n ->> 'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
           or (n ->> 'mode' = 'business_hours' and (coalesce(n ->> 'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                                                    or coalesce(n ->> 'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                                                    or n ->> 'open' >= n ->> 'close')) then
          e := e || 'Set the time (or opening hours) to wait for.'::text;
        end if;
      when 'wait_for_reply' then
        if coalesce((n ->> 'timeout_minutes')::numeric, 0) not between 5 and 43200 then
          e := e || 'Wait for a reply for between 5 minutes and 30 days.'::text;
        end if;
      when 'action' then
        a := n -> 'action';
        case coalesce(a ->> 'type', '')
          when 'create_task' then
            if coalesce(trim(a ->> 'title'), '') = '' then e := e || 'Tasks need a title.'::text; end if;
          when 'notify' then
            if coalesce(trim(a ->> 'title'), '') = '' then e := e || 'Notifications need a title.'::text; end if;
          when 'assign_round_robin' then null;
          when 'assign_to' then
            if coalesce(a ->> 'user_id', '') !~ '^[0-9a-f-]{36}$' then e := e || 'Choose who gets the lead.'::text; end if;
          when 'change_status' then
            if coalesce(a ->> 'status_key', '') !~ '^[a-z0-9_]+$' then e := e || 'Choose the stage to move to.'::text; end if;
          when 'add_tag' then
            if coalesce(trim(a ->> 'tag'), '') = '' then e := e || 'Name the tag.'::text; end if;
          when 'send_whatsapp_template' then
            if coalesce(a ->> 'template_id', '') !~ '^[0-9a-f-]{36}$' then e := e || 'Choose an approved template.'::text; end if;
          when 'send_email' then
            if coalesce(a ->> 'to', '') not in ('customer', 'owner') or coalesce(trim(a ->> 'subject'), '') = ''
               or coalesce(trim(a ->> 'body'), '') = '' then
              e := e || 'Emails need a recipient, a subject and a message.'::text;
            end if;
          when 'set_custom_field' then
            if coalesce(a ->> 'entity', '') not in ('lead', 'customer', 'order') or coalesce(a ->> 'key', '') !~ '^[a-z0-9_]+$' then
              e := e || 'Choose the field to update.'::text;
            end if;
          when 'call_webhook' then
            if coalesce(a ->> 'endpoint_id', '') !~ '^[0-9a-f-]{36}$' then e := e || 'Choose the webhook endpoint to call.'::text; end if;
          else
            e := e || format('Unknown action %s.', coalesce(a ->> 'type', 'missing'));
        end case;
    end case;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_graph -> 'nodes') x where x ->> 'kind' = 'trigger')
     and (select count(*) from jsonb_array_elements(p_graph -> 'nodes') x where x ->> 'kind' = 'action') = 0 then
    e := e || 'Add at least one action.'::text;
  end if;

  -- Reachability and loops: walk from the trigger, at most one step deeper per round.
  v_frontier := array[private.graph_start(p_graph) ->> 'id'];
  v_reached := v_frontier;
  v_cyclic := false;
  for i in 1..v_count + 1 loop
    select coalesce(array_agg(distinct t), '{}') into v_next
      from unnest(v_frontier) f, unnest(private.graph_edges(private.graph_node(p_graph, f))) t;
    exit when cardinality(v_next) = 0;
    v_reached := array(select distinct x from unnest(v_reached || v_next) x);
    v_frontier := v_next;
    if i = v_count + 1 then
      v_cyclic := true;  -- still moving after every step was visited: there is a loop
    end if;
  end loop;
  if v_cyclic then
    e := e || 'The workflow loops back on itself. Steps can only lead forward.'::text;
  end if;
  if exists (select 1 from unnest(v_ids) i where not i = any (v_reached)) then
    e := e || 'Some steps are not connected to the trigger.'::text;
  end if;
  return array(select distinct x from unnest(e) x);
end;
$$;

-- Sprint 8's linear format → a graph: trigger → (condition → yes) → each action in turn.
create or replace function private.linear_to_graph(p_trigger text, p_config jsonb, p_conditions jsonb, p_actions jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nodes jsonb := '[]';
  v_n int := coalesce(jsonb_array_length(p_actions), 0);
  v_first text := case when v_n > 0 then 'a1' end;
  v_has_cond boolean := jsonb_array_length(coalesce(p_conditions, '[]')) > 0;
  i int;
  a jsonb;
  v_next text;
  v_y int := 1;
begin
  v_nodes := v_nodes || jsonb_build_array(jsonb_build_object(
    'id', 't', 'kind', 'trigger', 'trigger', p_trigger, 'config', coalesce(p_config, '{}'),
    'next', case when v_has_cond then 'c' else v_first end, 'x', 0, 'y', 0));
  if v_has_cond then
    v_nodes := v_nodes || jsonb_build_array(jsonb_build_object(
      'id', 'c', 'kind', 'condition', 'match', 'all', 'conditions', p_conditions, 'yes', v_first, 'no', null, 'x', 0, 'y', 120));
    v_y := 2;
  end if;
  for i in 1..v_n loop
    a := p_actions -> (i - 1);
    v_next := case when i < v_n then 'a' || (i + 1) end;
    if a ->> 'type' = 'wait' then
      v_nodes := v_nodes || jsonb_build_array(jsonb_build_object(
        'id', 'a' || i, 'kind', 'wait', 'minutes', greatest(1, coalesce((a ->> 'minutes')::int, 60)),
        'next', v_next, 'x', 0, 'y', (v_y + i - 1) * 120));
    else
      v_nodes := v_nodes || jsonb_build_array(jsonb_build_object(
        'id', 'a' || i, 'kind', 'action', 'action', a, 'next', v_next, 'x', 0, 'y', (v_y + i - 1) * 120));
    end if;
  end loop;
  return jsonb_build_object('nodes', v_nodes);
end;
$$;

-- =====================================================================
-- Versions
-- =====================================================================
alter table public.automations drop constraint automations_actions_check;
alter table public.automations add constraint automations_actions_check check (jsonb_typeof(actions) = 'array');
alter table public.automations add column draft_graph jsonb check (draft_graph is null or jsonb_typeof(draft_graph) = 'object');
alter table public.automations add column current_version_id uuid;

create table public.automation_versions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null,
  automation_id   uuid not null,
  version         int not null check (version > 0),
  graph           jsonb not null check (jsonb_typeof(graph) = 'object'),
  trigger         text not null,
  trigger_config  jsonb not null default '{}',
  note            text check (length(note) <= 200),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (automation_id, version),
  unique (business_id, id),
  foreign key (business_id, automation_id) references public.automations (business_id, id) on delete cascade
);

-- Published versions never change (runs depend on them).
create or replace function private.automation_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'published versions cannot be changed' using errcode = '42501';
end;
$$;
create trigger automation_versions_immutable before update on public.automation_versions
  for each row execute function private.automation_versions_immutable();

alter table public.automations
  add constraint automations_current_version_fk foreign key (business_id, current_version_id)
  references public.automation_versions (business_id, id) deferrable initially deferred;

-- Publishes a graph as the next version and makes it current.
create or replace function private.publish_graph(p_automation_id uuid, p_graph jsonb, p_note text, p_actor uuid)
returns public.automation_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_errors text[] := private.automation_graph_errors(p_graph);
  v_auto public.automations;
  v_start jsonb := private.graph_start(p_graph);
  v_version public.automation_versions;
begin
  if cardinality(v_errors) > 0 then
    raise exception '%', array_to_string(v_errors, ' ') using errcode = '23514';
  end if;
  select * into v_auto from public.automations where id = p_automation_id for update;
  insert into public.automation_versions (business_id, automation_id, version, graph, trigger, trigger_config, note, created_by)
  values (v_auto.business_id, v_auto.id,
          coalesce((select max(version) from public.automation_versions where automation_id = v_auto.id), 0) + 1,
          p_graph, v_start ->> 'trigger', coalesce(v_start -> 'config', '{}'), nullif(trim(p_note), ''), p_actor)
  returning * into v_version;
  perform set_config('scaler.automation_publishing', 'on', true);
  update public.automations
     set current_version_id = v_version.id, trigger = v_version.trigger, trigger_config = v_version.trigger_config,
         draft_graph = null, conditions = '[]', actions = '[]'
   where id = v_auto.id;
  perform set_config('scaler.automation_publishing', '', true);
  return v_version;
end;
$$;

-- Anything still written in the Sprint 8 format (inserts and updates of
-- conditions/actions) is converted and published, so it keeps working.
create or replace function private.automation_legacy_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('scaler.automation_publishing', true) = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' and new.current_version_id is null and jsonb_array_length(new.actions) > 0 then
    perform private.publish_graph(new.id, private.linear_to_graph(new.trigger, new.trigger_config, new.conditions, new.actions),
                                  'Converted from a list of steps', new.created_by);
  elsif tg_op = 'UPDATE' and jsonb_array_length(new.actions) > 0
        and (new.conditions is distinct from old.conditions or new.actions is distinct from old.actions
             or new.trigger_config is distinct from old.trigger_config) then
    perform private.publish_graph(new.id, private.linear_to_graph(new.trigger, new.trigger_config, new.conditions, new.actions),
                                  'Converted from a list of steps', auth.uid());
  end if;
  return null;
end;
$$;
create trigger automations_legacy_publish after insert or update of conditions, actions, trigger_config on public.automations
  for each row execute function private.automation_legacy_publish();

-- Convert every existing automation.
select private.publish_graph(a.id, private.linear_to_graph(a.trigger, a.trigger_config, a.conditions, a.actions),
                             'Converted from a list of steps', a.created_by)
  from public.automations a where a.current_version_id is null;

-- =====================================================================
-- Runs walk a version's graph
-- =====================================================================
alter table public.automation_runs
  add column version_id uuid,
  add column node_id text,
  add column steps_taken int not null default 0,
  add column waiting_for text check (waiting_for in ('reply')),
  add column waiting_since timestamptz,
  add column waiting_customer_id uuid,
  add column chain uuid[] not null default '{}',
  add constraint automation_runs_version_fk foreign key (business_id, version_id)
    references public.automation_versions (business_id, id) on delete cascade;
create index automation_runs_reply_idx on public.automation_runs (waiting_customer_id) where waiting_for = 'reply';

-- Runs already queued or waiting continue on the converted graph, at the same step
-- (Sprint 8's step n is action node a<n+1>).
update public.automation_runs r
   set version_id = a.current_version_id,
       node_id = case when r.step = 0 and r.status = 'pending' then null
                      when private.graph_node(v.graph, 'a' || (r.step + 1)) is not null then 'a' || (r.step + 1) end,
       steps_taken = case when r.step = 0 and r.status = 'pending' then 0 else greatest(r.step, 1) end
  from public.automations a, public.automation_versions v
 where a.id = r.automation_id and v.id = a.current_version_id;

-- Every step a run takes, for per-step analytics. Append-only.
create table public.automation_run_steps (
  id             bigint generated always as identity primary key,
  business_id    uuid not null,
  automation_id  uuid not null,
  version_id     uuid not null,
  run_id         uuid not null,
  node_id        text not null,
  outcome        text not null check (outcome in ('ok', 'error', 'yes', 'no', 'replied', 'timeout', 'waiting', 'skipped')),
  created_at     timestamptz not null default now(),
  foreign key (business_id, automation_id) references public.automations (business_id, id) on delete cascade
);
create index automation_run_steps_version_idx on public.automation_run_steps (version_id, node_id);
create index automation_run_steps_run_idx on public.automation_run_steps (run_id);

create or replace function private.automation_run_steps_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the step log is append-only' using errcode = '42501';
end;
$$;
create trigger automation_run_steps_append_only before update on public.automation_run_steps
  for each row execute function private.automation_run_steps_append_only();

-- ---------------------------------------------------------------- loop guard
-- The automations whose steps caused the current change (set while a run steps).
-- A run started by an automation can't start that same automation again, and
-- chains stop at 5 automations deep.
create or replace function private.automation_chain()
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(string_to_array(nullif(current_setting('scaler.automation_chain', true), ''), ',')::uuid[], '{}');
$$;

create or replace function private.queue_automation_runs(
  p_business_id uuid, p_trigger text, p_entity_type text, p_entity_id uuid, p_context jsonb, p_dedupe text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.automation_runs (business_id, automation_id, entity_type, entity_id, dedupe_key, version_id, chain)
  select p_business_id, a.id, p_entity_type, p_entity_id, coalesce(p_dedupe, gen_random_uuid()::text),
         a.current_version_id, private.automation_chain()
    from public.automations a
   where a.business_id = p_business_id and a.is_active and a.trigger = p_trigger
     and a.current_version_id is not null
     and (a.trigger_config ->> 'status_key' is null or a.trigger_config ->> 'status_key' = p_context ->> 'status_key')
     and (a.trigger_config ->> 'stage_key' is null or a.trigger_config ->> 'stage_key' = p_context ->> 'stage_key')
     and not a.id = any (private.automation_chain())
     and cardinality(private.automation_chain()) < 5
  on conflict do nothing;
$$;

-- A reply wakes runs waiting for one.
create or replace function private.automation_wake_on_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'inbound' then
    update public.automation_runs r set run_at = now()
      from public.conversations c
     where c.id = new.conversation_id and r.waiting_customer_id = c.customer_id
       and r.waiting_for = 'reply' and r.status = 'waiting' and r.run_at > now();
  end if;
  return null;
end;
$$;
create trigger messages_automation_reply after insert on public.messages
  for each row execute function private.automation_wake_on_reply();

-- ---------------------------------------------------------------- facts and conditions
-- More facts for conditions: customer contact and consent, tags, replies, order balance.
create or replace function private.run_facts(p_run public.automation_runs)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'source_key', src.key, 'status_key', st.key, 'status_category', st.category, 'branch_id', coalesce(l.branch_id, c.branch_id),
    'has_owner', l.owner_id is not null, 'expected_value', l.expected_value, 'score', l.score,
    'order_total', o.total, 'stage_key', os.key,
    'order_balance', case when o.id is not null then (select o.total - (t.paid - t.refunded) from private.order_payment_totals(o.id) t) end,
    'has_email', c.primary_email is not null, 'has_phone', c.primary_phone is not null,
    'whatsapp_opt_in', case when c.id is not null then private.has_marketing_consent(c.id) else false end,
    'customer_tags', (select coalesce(jsonb_agg(lower(t.name)), '[]') from public.customer_tags ct join public.tags t on t.id = ct.tag_id
                       where ct.customer_id = c.id),
    'replied', exists (select 1 from public.messages m join public.conversations cv on cv.id = m.conversation_id
                        where cv.customer_id = c.id and m.direction = 'inbound' and m.sent_at >= p_run.created_at))
    from (select private.run_lead(p_run) as lead_id, private.run_customer(p_run) as customer_id) x
    left join public.leads l on l.id = x.lead_id
    left join public.customers c on c.id = x.customer_id
    left join public.lead_sources src on src.id = l.first_source_id
    left join public.lead_statuses st on st.id = l.status_id
    left join public.orders o on p_run.entity_type = 'order' and o.id = p_run.entity_id
    left join public.order_stages os on os.id = o.stage_id;
$$;

create or replace function private.condition_holds(c jsonb, p_facts jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case c ->> 'op'
      when 'eq' then p_facts ->> (c ->> 'field') = c ->> 'value'
      when 'neq' then (p_facts ->> (c ->> 'field')) is distinct from (c ->> 'value')
      when 'gte' then (p_facts ->> (c ->> 'field'))::numeric >= (c ->> 'value')::numeric
      when 'lte' then (p_facts ->> (c ->> 'field'))::numeric <= (c ->> 'value')::numeric
      when 'in' then p_facts ->> (c ->> 'field') in (select jsonb_array_elements_text(c -> 'value'))
      when 'is_true' then (p_facts ->> (c ->> 'field'))::boolean is true
      when 'is_false' then (p_facts ->> (c ->> 'field'))::boolean is not true
      when 'contains' then coalesce(p_facts -> (c ->> 'field'), '[]') ? lower(c ->> 'value')
      when 'not_contains' then not (coalesce(p_facts -> (c ->> 'field'), '[]') ? lower(c ->> 'value'))
      else false
    end, false);
$$;

create or replace function private.condition_node_holds(p_node jsonb, p_facts jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p_node ->> 'match' = 'any'
              then coalesce(bool_or(private.condition_holds(c, p_facts)), false)
              else coalesce(bool_and(private.condition_holds(c, p_facts)), true) end
    from jsonb_array_elements(coalesce(p_node -> 'conditions', '[]')) c;
$$;

-- When a wait-until step ends, in the business's time zone.
create or replace function private.wait_until_at(p_node jsonb, p_tz text, p_from timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_from at time zone p_tz;
  v_days int[] := coalesce(array(select jsonb_array_elements_text(p_node -> 'days')::int), '{1,2,3,4,5,6,7}');
  v_day date;
  v_at timestamp;
  i int;
begin
  if cardinality(v_days) = 0 then
    v_days := '{1,2,3,4,5,6,7}';
  end if;
  for i in 0..7 loop
    v_day := v_local::date + i;
    continue when not extract(isodow from v_day)::int = any (v_days);
    if p_node ->> 'mode' = 'business_hours' then
      v_at := v_day + (p_node ->> 'open')::time;
      if i = 0 and v_local >= v_at and v_local < v_day + (p_node ->> 'close')::time then
        return p_from;  -- open now
      end if;
    else
      v_at := v_day + (p_node ->> 'time')::time;
    end if;
    if v_at > v_local then
      return v_at at time zone p_tz;
    end if;
  end loop;
  return p_from;
end;
$$;

-- Replaces {{customer_name}}, {{business_name}}, {{lead_number}} and {{owner_name}}.
create or replace function private.automation_text(p_text text, p_lead uuid, p_customer uuid, p_business uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select replace(replace(replace(replace(coalesce(p_text, ''),
           '{{customer_name}}', coalesce((select full_name from public.customers where id = p_customer), '')),
           '{{business_name}}', coalesce((select name from public.businesses where id = p_business), '')),
           '{{lead_number}}', coalesce((select lead_number from public.leads where id = p_lead), '')),
           '{{owner_name}}', coalesce((select p.full_name from public.leads l join public.profiles p on p.id = l.owner_id where l.id = p_lead), ''));
$$;

-- ---------------------------------------------------------------- the engine
create or replace function private.run_step_log(r public.automation_runs, p_node text, p_outcome text, p_entry jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.automation_run_steps (business_id, automation_id, version_id, run_id, node_id, outcome)
  values (r.business_id, r.automation_id, r.version_id, r.id, p_node, p_outcome);
  perform private.run_log(r.id, jsonb_build_object('node', p_node) || p_entry);
end;
$$;

-- Executes one action node. Returns null when done, or 'external' when the app must send it.
-- Problems that retrying can't fix are logged and the run moves on.
create or replace function private.run_action(r public.automation_runs, a public.automations, p_node jsonb,
                                              v_lead uuid, v_customer uuid, inout v_owner uuid, out v_result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action jsonb := p_node -> 'action';
  v_business uuid := r.business_id;
  v_target uuid;
  v_limit int;
  v_email text;
  v_event bigint;
begin
  v_result := null;
  case v_action ->> 'type'
    when 'create_task' then
      v_target := case when v_action ->> 'assignee' = 'owner' or v_action ->> 'assignee' is null then v_owner
                       else nullif(v_action ->> 'assignee', '')::uuid end;
      if v_target is null then
        raise exception 'nobody to give the task to (the lead has no owner)';
      end if;
      insert into public.tasks (business_id, lead_id, customer_id, type, title, due_at, assignee_id, created_by)
      values (v_business, v_lead, case when v_lead is null then v_customer end,
              coalesce(nullif(v_action ->> 'task_type', ''), 'follow_up')::public.task_type,
              coalesce(nullif(v_action ->> 'title', ''), a.name),
              now() + make_interval(mins => coalesce((v_action ->> 'due_in_minutes')::int, 60)),
              v_target, null);

    when 'notify' then
      for v_target in
        select case when v_action ->> 'to' = 'owner' then v_owner
                    when v_action ->> 'to' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_action ->> 'to')::uuid end
         where v_action ->> 'to' <> 'managers'
        union
        select m.user_id from public.business_memberships m
          join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'leads.assign'
         where v_action ->> 'to' = 'managers' and m.business_id = v_business and m.status = 'active'
      loop
        if v_target is not null then
          perform private.notify(v_business, v_target, 'automation',
            coalesce(nullif(v_action ->> 'title', ''), a.name),
            (select concat_ws(' · ', l.lead_number, c.full_name) from public.leads l join public.customers c on c.id = l.customer_id where l.id = v_lead),
            case when v_lead is not null then '/leads/' || v_lead
                 when r.entity_type = 'order' then '/orders/' || r.entity_id else null end);
        end if;
      end loop;

    when 'assign_round_robin' then
      if v_lead is not null and v_owner is null then
        v_owner := private.pick_round_robin(v_business, (select branch_id from public.leads where id = v_lead));
        if v_owner is not null then
          update public.leads set owner_id = v_owner where id = v_lead;
        end if;
      end if;

    when 'assign_to' then
      if v_lead is not null then
        update public.leads set owner_id = (v_action ->> 'user_id')::uuid where id = v_lead;
        v_owner := (v_action ->> 'user_id')::uuid;
      end if;

    when 'change_status' then
      if v_lead is not null then
        update public.leads set status_id = (select id from public.lead_statuses where business_id = v_business and key = v_action ->> 'status_key')
         where id = v_lead;
      end if;

    when 'add_tag' then
      if v_customer is not null then
        insert into public.tags (business_id, name) values (v_business, left(v_action ->> 'tag', 40)) on conflict do nothing;
        insert into public.customer_tags (business_id, customer_id, tag_id)
        select v_business, v_customer, t.id from public.tags t where t.business_id = v_business and lower(t.name) = lower(v_action ->> 'tag')
        on conflict do nothing;
      end if;

    when 'send_whatsapp_template' then
      v_result := 'external';

    when 'send_email' then
      v_email := case v_action ->> 'to'
                   when 'customer' then (select primary_email::text from public.customers where id = v_customer)
                   when 'owner' then (select email from public.profiles where id = v_owner) end;
      if v_email is null then
        v_result := 'skip:' || case when v_action ->> 'to' = 'owner' then 'nobody owns the lead' else 'the customer has no email address' end;
        return;
      end if;
      -- Automation emails count as messages for the plan.
      v_limit := private.plan_limit(v_business, 'monthly_messages');
      if v_limit is not null and private.usage_count(v_business, 'messages') >= v_limit then
        v_result := 'skip:monthly message limit reached';
        return;
      end if;
      insert into private.email_outbox (business_id, to_email, template, payload)
      values (v_business, v_email, 'automation_email', jsonb_build_object(
        'subject', left(private.automation_text(v_action ->> 'subject', v_lead, v_customer, v_business), 200),
        'body', left(private.automation_text(v_action ->> 'body', v_lead, v_customer, v_business), 5000),
        'business_name', (select name from public.businesses where id = v_business),
        'to', v_action ->> 'to'));
      perform private.bump_usage(v_business, 'messages');

    when 'set_custom_field' then
      if not exists (select 1 from public.custom_field_definitions d
                      where d.business_id = v_business and d.entity::text = v_action ->> 'entity'
                        and d.key = v_action ->> 'key' and d.is_active) then
        v_result := 'skip:the custom field no longer exists';
        return;
      end if;
      case v_action ->> 'entity'
        when 'lead' then
          update public.leads set custom_fields = custom_fields || jsonb_build_object(v_action ->> 'key', v_action -> 'value') where id = v_lead;
        when 'customer' then
          update public.customers set custom_fields = custom_fields || jsonb_build_object(v_action ->> 'key', v_action -> 'value') where id = v_customer;
        when 'order' then
          if r.entity_type = 'order' then
            update public.orders set custom_fields = custom_fields || jsonb_build_object(v_action ->> 'key', v_action -> 'value') where id = r.entity_id;
          end if;
      end case;

    when 'call_webhook' then
      if not exists (select 1 from public.webhook_endpoints e
                      where e.id = (v_action ->> 'endpoint_id')::uuid and e.business_id = v_business and e.is_active) then
        v_result := 'skip:the webhook endpoint is off or deleted';
        return;
      end if;
      insert into public.webhook_events (business_id, type, data)
      values (v_business, 'automation.called', jsonb_build_object(
        'automation', jsonb_build_object('id', a.id, 'name', a.name),
        'label', nullif(trim(v_action ->> 'label'), ''),
        'lead', (select private.api_lead_json(l) from public.leads l where l.id = v_lead),
        'customer', (select private.api_customer_json(c) from public.customers c where c.id = v_customer),
        'order', (select private.api_order_json(o) from public.orders o where r.entity_type = 'order' and o.id = r.entity_id)))
      returning id into v_event;
      insert into public.webhook_deliveries (business_id, endpoint_id, event_id)
      values (v_business, (v_action ->> 'endpoint_id')::uuid, v_event);

    else
      raise exception 'unknown action %', v_action ->> 'type';
  end case;
end;
$$;

-- Walks a run from its current step until it finishes, waits, or needs the
-- app (WhatsApp sends). Returns {status, external?}.
create or replace function private.step_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.automation_runs;
  a public.automations;
  v_graph jsonb;
  v_node jsonb;
  v_node_id text;
  v_lead uuid;
  v_customer uuid;
  v_owner uuid;
  v_result text;
  v_holds boolean;
  v_until timestamptz;
  v_acted boolean := false;
  v_err text;
begin
  select * into r from public.automation_runs where id = p_run_id for update;
  if r.id is null or r.status not in ('pending', 'waiting', 'running') then
    return jsonb_build_object('status', coalesce(r.status, 'missing'));
  end if;
  select * into a from public.automations where id = r.automation_id;
  if r.version_id is null then
    r.version_id := a.current_version_id;
    update public.automation_runs set version_id = r.version_id where id = r.id;
  end if;
  select graph into v_graph from public.automation_versions where id = r.version_id;

  if r.steps_taken = 0 and r.node_id is null then
    if not a.is_active then
      update public.automation_runs set status = 'skipped', finished_at = now() where id = r.id;
      perform private.run_log(r.id, '{"event":"skipped","reason":"automation turned off"}');
      return jsonb_build_object('status', 'skipped');
    end if;
    r.node_id := private.graph_start(v_graph) ->> 'next';
    update public.automation_runs set node_id = r.node_id where id = r.id;
  else
    -- Resuming after a step that already ran (a wait, a send): anything before counts as acted.
    v_acted := r.step > 0 or r.steps_taken > 0;
  end if;

  perform set_config('scaler.automation_chain', array_to_string(r.chain || a.id, ','), true);
  update public.automation_runs set status = 'running' where id = r.id;

  v_lead := private.run_lead(r);
  v_customer := private.run_customer(r);
  select owner_id into v_owner from public.leads where id = v_lead;

  loop
    v_node_id := r.node_id;
    exit when v_node_id is null;
    v_node := private.graph_node(v_graph, v_node_id);
    if v_node is null then
      raise exception 'step % is missing from version', v_node_id;
    end if;
    r.steps_taken := r.steps_taken + 1;
    if r.steps_taken > 100 then
      update public.automation_runs set status = 'failed', error = 'stopped after 100 steps', finished_at = now(),
                                        steps_taken = r.steps_taken where id = r.id;
      perform private.run_step_log(r, v_node_id, 'error', '{"ok": false, "error": "stopped after 100 steps"}');
      return jsonb_build_object('status', 'failed');
    end if;

    case v_node ->> 'kind'
      when 'condition' then
        v_holds := private.condition_node_holds(v_node, private.run_facts(r));
        perform private.run_step_log(r, v_node_id, case when v_holds then 'yes' else 'no' end,
                                     jsonb_build_object('kind', 'condition', 'result', v_holds, 'ok', true));
        if not v_holds and v_node ->> 'no' is null and not v_acted then
          update public.automation_runs set status = 'skipped', finished_at = now(), steps_taken = r.steps_taken where id = r.id;
          perform private.run_log(r.id, '{"event":"skipped","reason":"conditions not met"}');
          return jsonb_build_object('status', 'skipped');
        end if;
        r.node_id := case when v_holds then v_node ->> 'yes' else v_node ->> 'no' end;

      when 'wait' then
        r.node_id := v_node ->> 'next';
        r.step := r.step + 1;
        update public.automation_runs
           set status = 'waiting', node_id = r.node_id, step = r.step, steps_taken = r.steps_taken,
               run_at = now() + make_interval(mins => greatest(1, coalesce((v_node ->> 'minutes')::int, 60)))
         where id = r.id;
        perform private.run_step_log(r, v_node_id, 'waiting', jsonb_build_object('step', r.step - 1, 'action', 'wait', 'minutes', v_node ->> 'minutes'));
        return jsonb_build_object('status', 'waiting');

      when 'wait_until' then
        v_until := private.wait_until_at(v_node, (select timezone from public.businesses where id = r.business_id), now());
        r.node_id := v_node ->> 'next';
        if v_until > now() then
          update public.automation_runs set status = 'waiting', node_id = r.node_id, steps_taken = r.steps_taken, run_at = v_until
           where id = r.id;
          perform private.run_step_log(r, v_node_id, 'waiting', jsonb_build_object('action', 'wait_until', 'until', v_until));
          return jsonb_build_object('status', 'waiting');
        end if;
        perform private.run_step_log(r, v_node_id, 'ok', jsonb_build_object('action', 'wait_until', 'ok', true));

      when 'wait_for_reply' then
        if r.waiting_for = 'reply' then
          if exists (select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
                      where c.customer_id = r.waiting_customer_id and m.direction = 'inbound' and m.sent_at >= r.waiting_since) then
            perform private.run_step_log(r, v_node_id, 'replied', jsonb_build_object('action', 'wait_for_reply', 'result', 'replied', 'ok', true));
            r.node_id := v_node ->> 'replied';
          elsif now() >= r.run_at then
            perform private.run_step_log(r, v_node_id, 'timeout', jsonb_build_object('action', 'wait_for_reply', 'result', 'timeout', 'ok', true));
            r.node_id := v_node ->> 'timeout';
          else
            update public.automation_runs set status = 'waiting', steps_taken = r.steps_taken - 1 where id = r.id;
            return jsonb_build_object('status', 'waiting');
          end if;
          r.waiting_for := null;
          update public.automation_runs set waiting_for = null, waiting_since = null, waiting_customer_id = null where id = r.id;
        else
          update public.automation_runs
             set status = 'waiting', waiting_for = 'reply', waiting_since = now(), waiting_customer_id = v_customer,
                 run_at = now() + make_interval(mins => coalesce((v_node ->> 'timeout_minutes')::int, 1440)),
                 steps_taken = r.steps_taken - 1
           where id = r.id;
          perform private.run_log(r.id, jsonb_build_object('node', v_node_id, 'action', 'wait_for_reply', 'waiting', true));
          return jsonb_build_object('status', 'waiting');
        end if;

      when 'action' then
        begin
          select x.v_owner, x.v_result into v_owner, v_result
            from private.run_action(r, a, v_node, v_lead, v_customer, v_owner) x;
        exception when others then
          v_err := sqlerrm;
          update public.automation_runs
             set attempts = attempts + 1, error = left(v_err, 500), steps_taken = r.steps_taken - 1,
                 status = case when attempts + 1 >= 3 then 'failed' else 'waiting' end,
                 run_at = now() + make_interval(mins => 5 * (attempts + 1)),
                 finished_at = case when attempts + 1 >= 3 then now() end
           where id = r.id;
          perform private.run_step_log(r, v_node_id, 'error',
            jsonb_build_object('step', r.step, 'action', v_node -> 'action' ->> 'type', 'ok', false, 'error', v_err));
          return jsonb_build_object('status', 'error', 'error', v_err);
        end;
        if v_result = 'external' then
          update public.automation_runs set step = r.step, steps_taken = r.steps_taken - 1 where id = r.id;
          return jsonb_build_object('status', 'external', 'action', v_node -> 'action', 'customer_id', v_customer, 'step', r.step);
        elsif v_result like 'skip:%' then
          perform private.run_step_log(r, v_node_id, 'error',
            jsonb_build_object('step', r.step, 'action', v_node -> 'action' ->> 'type', 'ok', false, 'error', substr(v_result, 6)));
        else
          perform private.run_step_log(r, v_node_id, 'ok', jsonb_build_object('step', r.step, 'action', v_node -> 'action' ->> 'type', 'ok', true));
        end if;
        v_acted := true;
        r.step := r.step + 1;
        r.node_id := v_node ->> 'next';

      else
        raise exception 'unknown step type %', v_node ->> 'kind';
    end case;
    update public.automation_runs set node_id = r.node_id, step = r.step, steps_taken = r.steps_taken where id = r.id;
  end loop;

  update public.automation_runs set status = 'done', finished_at = now(), error = null where id = r.id;
  return jsonb_build_object('status', 'done');
end;
$$;

create or replace function public.step_automation_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := private.step_run(p_run_id);
  perform set_config('scaler.automation_chain', '', true);
  return v;
end;
$$;

-- The node a run is on (for the WhatsApp hand-off).
create or replace function private.run_node(r public.automation_runs)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.graph_node(v.graph, r.node_id) from public.automation_versions v where v.id = r.version_id;
$$;

create or replace function public.finish_automation_external(p_run_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.automation_runs;
  v_node jsonb;
begin
  select * into r from public.automation_runs where id = p_run_id for update;
  if r.id is null then
    return;
  end if;
  v_node := private.run_node(r);
  r.steps_taken := r.steps_taken + 1;
  if p_error is null then
    perform private.run_step_log(r, r.node_id, 'ok', jsonb_build_object('step', r.step, 'action', v_node -> 'action' ->> 'type', 'ok', true));
    update public.automation_runs set step = step + 1, node_id = v_node ->> 'next', steps_taken = r.steps_taken, status = 'running'
     where id = r.id;
  else
    perform private.run_step_log(r, r.node_id, 'error',
      jsonb_build_object('step', r.step, 'action', v_node -> 'action' ->> 'type', 'ok', false, 'error', p_error));
    -- A missing opt-in or closed window is final for this step; skip it rather than retry forever.
    update public.automation_runs set step = step + 1, node_id = v_node ->> 'next', steps_taken = r.steps_taken, status = 'running',
                                      error = left(p_error, 500)
     where id = r.id;
  end if;
end;
$$;

-- Same as Sprint 10, reading the action from the run's version.
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
  v_action := private.run_node(r) -> 'action';
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

-- Idle leads start runs on the current version, as other triggers do.
create or replace function public.claim_automation_runs(p_limit int default 100)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.automation_runs (business_id, automation_id, entity_type, entity_id, dedupe_key, version_id)
  select a.business_id, a.id, 'lead', l.id, 'idle:' || l.last_activity_at::text, a.current_version_id
    from public.automations a
    join public.leads l on l.business_id = a.business_id and l.archived_at is null
    join public.lead_statuses s on s.id = l.status_id and s.category = 'open'
   where a.is_active and a.trigger = 'lead_idle' and a.current_version_id is not null
     and l.last_activity_at < now() - make_interval(days => greatest(1, coalesce((a.trigger_config ->> 'days')::int, 3)))
  on conflict do nothing;

  update public.automation_runs set status = 'waiting' where status = 'running' and run_at < now() - interval '10 minutes';

  return query
  select r.id from public.automation_runs r
   where r.status in ('pending', 'waiting') and r.run_at <= now()
   order by r.run_at
   limit greatest(1, least(p_limit, 500));
end;
$$;

-- Automations can call a webhook endpoint (Sprint 13) with an "automation.called" event.
alter table public.webhook_events drop constraint webhook_events_type_check;
alter table public.webhook_events add constraint webhook_events_type_check
  check (type in ('ping', 'automation.called', 'lead.created', 'lead.stage_changed', 'order.created', 'order.stage_changed',
                  'payment.recorded', 'customer.merged'));

-- =====================================================================
-- Editing, publishing and rolling back (automation.manage)
-- =====================================================================
create or replace function private.require_automation(p_automation_id uuid)
returns public.automations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.automations;
begin
  select * into v from public.automations where id = p_automation_id;
  if v.id is null or not private.has_permission(v.business_id, 'automation.manage') then
    raise exception 'automation not found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

create or replace function public.create_automation(p_business_id uuid, p_name text, p_graph jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_start jsonb := private.graph_start(p_graph);
begin
  if not private.has_permission(p_business_id, 'automation.manage') then
    raise exception 'not allowed to manage automation' using errcode = '42501';
  end if;
  if v_start is null then
    raise exception 'A workflow starts with exactly one trigger.' using errcode = '23514';
  end if;
  perform set_config('scaler.automation_publishing', 'on', true);
  insert into public.automations (business_id, name, trigger, trigger_config, actions, is_active, created_by, draft_graph)
  values (p_business_id, trim(p_name), coalesce(v_start ->> 'trigger', 'lead_created'), '{}', '[]', false, auth.uid(), p_graph)
  returning id into v_id;
  perform set_config('scaler.automation_publishing', '', true);
  return v_id;
end;
$$;

-- Saves work in progress. Nothing changes for running workflows until it is published.
create or replace function public.save_automation_draft(p_automation_id uuid, p_graph jsonb, p_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.automations := private.require_automation(p_automation_id);
begin
  if jsonb_typeof(p_graph) is distinct from 'object' or jsonb_array_length(coalesce(p_graph -> 'nodes', '[]')) > 50
     or length(p_graph::text) > 200000 then
    raise exception 'the workflow is too large' using errcode = '23514';
  end if;
  update public.automations
     set draft_graph = p_graph, name = coalesce(nullif(trim(p_name), ''), name)
   where id = v.id;
end;
$$;

create or replace function public.publish_automation(p_automation_id uuid, p_graph jsonb default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.automations := private.require_automation(p_automation_id);
  v_version public.automation_versions;
begin
  v_version := private.publish_graph(v.id, coalesce(p_graph, v.draft_graph,
    (select graph from public.automation_versions where id = v.current_version_id)), p_note, auth.uid());
  return jsonb_build_object('version_id', v_version.id, 'version', v_version.version);
end;
$$;

-- Publishes an earlier version's graph again, as a new version.
create or replace function public.rollback_automation(p_automation_id uuid, p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.automations := private.require_automation(p_automation_id);
  v_old public.automation_versions;
  v_version public.automation_versions;
begin
  select * into v_old from public.automation_versions where id = p_version_id and automation_id = v.id;
  if v_old.id is null then
    raise exception 'version not found' using errcode = 'P0002';
  end if;
  v_version := private.publish_graph(v.id, v_old.graph, format('Rolled back to version %s', v_old.version), auth.uid());
  return jsonb_build_object('version_id', v_version.id, 'version', v_version.version);
end;
$$;

-- What a version's runs did at each step: reached, ok, failed, branches taken,
-- and how many leads on each branch are won now.
create or replace function public.automation_step_stats(p_automation_id uuid, p_version_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.automations := private.require_automation(p_automation_id);
  v_version uuid := coalesce(p_version_id, v.current_version_id);
begin
  return jsonb_build_object(
    'version_id', v_version,
    'runs', (select count(*) from public.automation_runs where version_id = v_version),
    'failed_runs', (select count(*) from public.automation_runs where version_id = v_version and status = 'failed'),
    'nodes', (select coalesce(jsonb_object_agg(node_id, stats), '{}') from (
      select s.node_id, jsonb_build_object(
        'reached', count(distinct s.run_id),
        'ok', count(*) filter (where s.outcome = 'ok'),
        'failed', count(*) filter (where s.outcome = 'error'),
        'waiting', count(*) filter (where s.outcome = 'waiting'),
        'yes', count(*) filter (where s.outcome = 'yes'),
        'no', count(*) filter (where s.outcome = 'no'),
        'replied', count(*) filter (where s.outcome = 'replied'),
        'timeout', count(*) filter (where s.outcome = 'timeout'),
        'won_after_yes', count(distinct s.run_id) filter (where s.outcome in ('yes', 'replied') and st.category = 'won'),
        'won_after_no', count(distinct s.run_id) filter (where s.outcome in ('no', 'timeout') and st.category = 'won')) as stats
        from public.automation_run_steps s
        join public.automation_runs r on r.id = s.run_id
        left join public.leads l on l.id = private.run_lead(r)
        left join public.lead_statuses st on st.id = l.status_id
       where s.version_id = v_version
       group by s.node_id) x));
end;
$$;

-- =====================================================================
-- Dry run: what would happen for a real lead or order. Read-only: the
-- function is stable, so Postgres refuses any write it tried to make.
-- =====================================================================
create or replace function public.automation_dry_run(p_automation_id uuid, p_entity_type text, p_entity_id uuid, p_graph jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.automations := private.require_automation(p_automation_id);
  v_graph jsonb := coalesce(p_graph, v.draft_graph, (select graph from public.automation_versions where id = v.current_version_id));
  v_run public.automation_runs;
  v_facts jsonb;
  v_node jsonb;
  v_node_id text;
  v_steps jsonb := '[]';
  v_holds boolean;
  v_owner uuid;
  v_owner_name text;
  v_action jsonb;
  v_text text;
  v_n int := 0;
  v_tz text;
  v_ended text := 'done';
  v_errors text[] := private.automation_graph_errors(v_graph);
begin
  if p_entity_type not in ('lead', 'order') then
    raise exception 'dry runs take a lead or an order' using errcode = '22023';
  end if;
  if (p_entity_type = 'lead' and not exists (select 1 from public.leads where id = p_entity_id and business_id = v.business_id))
     or (p_entity_type = 'order' and not exists (select 1 from public.orders where id = p_entity_id and business_id = v.business_id)) then
    raise exception 'not found in this business' using errcode = 'P0002';
  end if;
  if cardinality(v_errors) > 0 then
    return jsonb_build_object('errors', to_jsonb(v_errors), 'steps', '[]');
  end if;
  select timezone into v_tz from public.businesses where id = v.business_id;
  -- A pretend run: never inserted.
  v_run.id := gen_random_uuid();
  v_run.business_id := v.business_id;
  v_run.automation_id := v.id;
  v_run.entity_type := p_entity_type;
  v_run.entity_id := p_entity_id;
  v_run.created_at := now();
  v_facts := private.run_facts(v_run);
  select l.owner_id, p.full_name into v_owner, v_owner_name
    from public.leads l left join public.profiles p on p.id = l.owner_id where l.id = private.run_lead(v_run);

  v_node_id := private.graph_start(v_graph) ->> 'next';
  while v_node_id is not null loop
    v_n := v_n + 1;
    exit when v_n > 100;
    v_node := private.graph_node(v_graph, v_node_id);
    case v_node ->> 'kind'
      when 'condition' then
        v_holds := private.condition_node_holds(v_node, v_facts);
        v_steps := v_steps || jsonb_build_array(jsonb_build_object('node', v_node_id, 'kind', 'condition',
          'outcome', case when v_holds then 'yes' else 'no' end,
          'summary', case when v_holds then 'The conditions hold: takes the yes branch.' else 'The conditions don''t hold: takes the no branch.' end));
        if not v_holds and v_node ->> 'no' is null and v_n = 1 then
          v_ended := 'skipped';
        end if;
        v_node_id := case when v_holds then v_node ->> 'yes' else v_node ->> 'no' end;
      when 'wait' then
        v_steps := v_steps || jsonb_build_array(jsonb_build_object('node', v_node_id, 'kind', 'wait', 'outcome', 'wait',
          'summary', format('Would wait %s minutes.', v_node ->> 'minutes')));
        v_node_id := v_node ->> 'next';
      when 'wait_until' then
        v_steps := v_steps || jsonb_build_array(jsonb_build_object('node', v_node_id, 'kind', 'wait_until', 'outcome', 'wait',
          'summary', format('Would wait until %s.', to_char(private.wait_until_at(v_node, v_tz, now()) at time zone v_tz, 'Dy DD Mon, HH24:MI'))));
        v_node_id := v_node ->> 'next';
      when 'wait_for_reply' then
        v_holds := (v_facts ->> 'replied')::boolean;
        v_steps := v_steps || jsonb_build_array(jsonb_build_object('node', v_node_id, 'kind', 'wait_for_reply',
          'outcome', 'timeout',
          'summary', format('Would wait up to %s minutes for a reply. Shown as if no reply comes.', v_node ->> 'timeout_minutes')));
        v_node_id := v_node ->> 'timeout';
      when 'action' then
        v_action := v_node -> 'action';
        v_text := case v_action ->> 'type'
          when 'create_task' then format('Would create the task “%s” for %s.', v_action ->> 'title',
            case when coalesce(v_action ->> 'assignee', 'owner') = 'owner'
                 then coalesce(v_owner_name, 'the owner (nobody owns this lead yet, so the step would fail and be retried)')
                 else coalesce((select full_name from public.profiles where id = nullif(v_action ->> 'assignee', '')::uuid), 'someone') end)
          when 'notify' then format('Would notify %s: “%s”.',
            case v_action ->> 'to' when 'owner' then coalesce(v_owner_name, 'the owner (none yet)') when 'managers' then 'the managers'
                 else coalesce((select full_name from public.profiles where id = nullif(v_action ->> 'to', '')::uuid), 'someone') end,
            v_action ->> 'title')
          when 'assign_round_robin' then case when v_owner is null then 'Would hand the lead to the next person in the rotation.'
                                              else 'Would do nothing: the lead already has an owner.' end
          when 'assign_to' then format('Would assign the lead to %s.',
            coalesce((select full_name from public.profiles where id = (v_action ->> 'user_id')::uuid), 'someone'))
          when 'change_status' then format('Would move the lead to %s.',
            coalesce((select name from public.lead_statuses where business_id = v.business_id and key = v_action ->> 'status_key'), v_action ->> 'status_key'))
          when 'add_tag' then format('Would tag the customer “%s”.', v_action ->> 'tag')
          when 'send_whatsapp_template' then 'Would send a WhatsApp template (only to customers who opted in, for marketing templates).'
          when 'send_email' then case
            when v_action ->> 'to' = 'customer' and not (v_facts ->> 'has_email')::boolean then 'Would skip the email: the customer has no email address.'
            else format('Would email %s: “%s”.', case when v_action ->> 'to' = 'owner' then coalesce(v_owner_name, 'the owner') else 'the customer' end,
                        private.automation_text(v_action ->> 'subject', private.run_lead(v_run), private.run_customer(v_run), v.business_id)) end
          when 'set_custom_field' then format('Would set the %s field “%s” to %s.', v_action ->> 'entity', v_action ->> 'key', v_action -> 'value')
          when 'call_webhook' then format('Would call the webhook %s.',
            coalesce((select url from public.webhook_endpoints where id = (v_action ->> 'endpoint_id')::uuid and business_id = v.business_id), '(deleted endpoint)'))
          else 'Unknown action.' end;
        v_steps := v_steps || jsonb_build_array(jsonb_build_object('node', v_node_id, 'kind', 'action', 'action', v_action ->> 'type',
          'outcome', 'would_run', 'summary', v_text));
        -- Later conditions see what earlier steps would have changed.
        if v_action ->> 'type' = 'change_status' then
          v_facts := v_facts || jsonb_build_object('status_key', v_action ->> 'status_key',
            'status_category', (select category from public.lead_statuses where business_id = v.business_id and key = v_action ->> 'status_key'));
        elsif v_action ->> 'type' in ('assign_to', 'assign_round_robin') then
          v_facts := v_facts || '{"has_owner": true}';
        elsif v_action ->> 'type' = 'add_tag' then
          v_facts := jsonb_set(v_facts, '{customer_tags}', coalesce(v_facts -> 'customer_tags', '[]') || to_jsonb(lower(v_action ->> 'tag')));
        end if;
        v_node_id := v_node ->> 'next';
      else
        v_node_id := null;
    end case;
  end loop;
  return jsonb_build_object('steps', v_steps, 'ended', v_ended, 'facts', v_facts, 'errors', '[]'::jsonb);
end;
$$;

-- =====================================================================
-- Access
-- =====================================================================
alter table public.automation_versions  enable row level security;
alter table public.automation_run_steps enable row level security;
create policy automation_versions_select on public.automation_versions for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('automation.manage'))::uuid[]));
create policy automation_run_steps_select on public.automation_run_steps for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('automation.manage'))::uuid[]));
revoke all on public.automation_versions, public.automation_run_steps from anon, authenticated;
grant select on public.automation_versions, public.automation_run_steps to authenticated;
-- The old builder's columns stay writable (they convert on save); the graph is written through the functions above.
grant update (name, description, trigger_config, conditions, actions, is_active) on public.automations to authenticated;

revoke execute on function public.create_automation(uuid, text, jsonb) from public, anon;
revoke execute on function public.save_automation_draft(uuid, jsonb, text) from public, anon;
revoke execute on function public.publish_automation(uuid, jsonb, text) from public, anon;
revoke execute on function public.rollback_automation(uuid, uuid) from public, anon;
revoke execute on function public.automation_step_stats(uuid, uuid) from public, anon;
revoke execute on function public.automation_dry_run(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.create_automation(uuid, text, jsonb) to authenticated;
grant execute on function public.save_automation_draft(uuid, jsonb, text) to authenticated;
grant execute on function public.publish_automation(uuid, jsonb, text) to authenticated;
grant execute on function public.rollback_automation(uuid, uuid) to authenticated;
grant execute on function public.automation_step_stats(uuid, uuid) to authenticated;
grant execute on function public.automation_dry_run(uuid, text, uuid, jsonb) to authenticated;

revoke execute on function public.step_automation_run(uuid) from public, anon, authenticated;
revoke execute on function public.finish_automation_external(uuid, text) from public, anon, authenticated;
revoke execute on function public.claim_automation_runs(int) from public, anon, authenticated;
revoke execute on function public.automation_whatsapp_context(uuid) from public, anon, authenticated;
grant execute on function public.step_automation_run(uuid) to service_role;
grant execute on function public.finish_automation_external(uuid, text) to service_role;
grant execute on function public.claim_automation_runs(int) to service_role;
grant execute on function public.automation_whatsapp_context(uuid) to service_role;

grant execute on all functions in schema private to authenticated, service_role;
