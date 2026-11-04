-- =====================================================================
-- Sprint 8: automation engine, rule-based lead scoring, analytics with
-- shared metric definitions, saved views, scheduled email reports.
--
-- Automations run in the database: triggers emit events, a run per matching
-- automation is queued, and the job route steps runs (with delays and
-- retries). Every step is logged on the run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Automations
-- ---------------------------------------------------------------------
-- trigger: lead_created | lead_status_changed | lead_assigned | lead_idle |
--          order_created | order_stage_changed | appointment_no_show
-- trigger_config: e.g. {"status_key": "lost"} or {"days": 3} or {"stage_key": "delivered"}
-- conditions: [{field, op, value}]  fields: source_key, status_key, status_category, branch_id,
--             has_owner, expected_value, order_total, stage_key   ops: eq, neq, gte, lte, in, is_true, is_false
-- actions: [{type, ...}]  types: create_task, notify, assign_round_robin, assign_to, change_status,
--          add_tag, wait, send_whatsapp_template
create table public.automations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  description     text check (length(description) <= 500),
  trigger         text not null check (trigger in ('lead_created', 'lead_status_changed', 'lead_assigned', 'lead_idle',
                                                    'order_created', 'order_stage_changed', 'appointment_no_show')),
  trigger_config  jsonb not null default '{}' check (jsonb_typeof(trigger_config) = 'object'),
  conditions      jsonb not null default '[]' check (jsonb_typeof(conditions) = 'array'),
  actions         jsonb not null default '[]' check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 10),
  is_active       boolean not null default false,
  preset_key      text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, preset_key)
);
create index automations_trigger_idx on public.automations (business_id, trigger) where is_active;
create trigger automations_updated_at before update on public.automations
  for each row execute function private.set_updated_at();
create trigger audit_automations after insert or update or delete on public.automations
  for each row execute function private.audit_row();

create table public.automation_runs (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null,
  automation_id  uuid not null,
  entity_type    text not null check (entity_type in ('lead', 'order', 'appointment')),
  entity_id      uuid not null,
  dedupe_key     text,
  status         text not null default 'pending' check (status in ('pending', 'running', 'waiting', 'done', 'skipped', 'failed')),
  step           int not null default 0,
  run_at         timestamptz not null default now(),
  attempts       int not null default 0,
  log            jsonb not null default '[]',
  error          text,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,
  unique (automation_id, entity_id, dedupe_key),
  foreign key (business_id, automation_id) references public.automations (business_id, id) on delete cascade
);
create index automation_runs_due_idx on public.automation_runs (run_at) where status in ('pending', 'waiting');
create index automation_runs_business_idx on public.automation_runs (business_id, created_at desc);

-- ---------------------------------------------------------------------
-- Lead scoring (rule-based v1)
-- ---------------------------------------------------------------------
-- field: source_key | stage | has_email | expected_value_gte | activity_count_gte |
--        has_appointment | active_within_days | branch_id
create table public.lead_scoring_rules (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  label        text not null check (length(trim(label)) between 1 and 80),
  field        text not null check (field in ('source_key', 'stage', 'has_email', 'expected_value_gte', 'activity_count_gte',
                                              'has_appointment', 'active_within_days', 'branch_id')),
  value        text,
  points       int not null check (points between -100 and 100),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index lead_scoring_rules_business_idx on public.lead_scoring_rules (business_id) where is_active;
create trigger lead_scoring_rules_updated_at before update on public.lead_scoring_rules
  for each row execute function private.set_updated_at();
create trigger audit_lead_scoring_rules after insert or update or delete on public.lead_scoring_rules
  for each row execute function private.audit_row();

alter table public.leads add column score int not null default 0;
create index leads_score_idx on public.leads (business_id, score desc) where archived_at is null;

-- ---------------------------------------------------------------------
-- Saved views and scheduled reports
-- ---------------------------------------------------------------------
create table public.saved_views (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  page         text not null check (page in ('leads', 'orders', 'customers', 'analytics')),
  name         text not null check (length(trim(name)) between 1 and 60),
  query        text not null check (length(query) <= 2000),
  shared       boolean not null default false,
  created_at   timestamptz not null default now()
);
create index saved_views_page_idx on public.saved_views (business_id, page);

create table public.report_schedules (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  report        text not null check (report in ('executive', 'marketing', 'sales', 'operations')),
  frequency     text not null check (frequency in ('daily', 'weekly', 'monthly')),
  next_run_at   timestamptz not null,
  last_sent_at  timestamptz,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (business_id, user_id, report, frequency)
);
create index report_schedules_due_idx on public.report_schedules (next_run_at) where is_active;

-- =====================================================================
-- Scoring
-- =====================================================================
create or replace function private.lead_score(p_lead_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.points), 0)::int
    from public.leads l
    join public.lead_scoring_rules r on r.business_id = l.business_id and r.is_active
    left join public.lead_sources src on src.id = l.first_source_id
    left join public.lead_statuses st on st.id = l.status_id
    left join public.customers c on c.id = l.customer_id
   where l.id = p_lead_id
     and case r.field
           when 'source_key' then src.key = r.value
           when 'stage' then st.stage = r.value
           when 'has_email' then c.primary_email is not null
           when 'expected_value_gte' then l.expected_value >= nullif(r.value, '')::numeric
           when 'activity_count_gte' then (select count(*) from public.lead_activities a
                                            where a.lead_id = l.id and a.type in ('note', 'call', 'whatsapp', 'email', 'meeting', 'visit'))
                                          >= nullif(r.value, '')::int
           when 'has_appointment' then exists (select 1 from public.appointments ap
                                                where ap.lead_id = l.id and ap.status in ('scheduled', 'confirmed', 'completed'))
           when 'active_within_days' then l.last_activity_at > now() - make_interval(days => coalesce(nullif(r.value, '')::int, 3))
           when 'branch_id' then l.branch_id::text = r.value
           else false
         end;
$$;

-- The score is derived data: keep it off the lead timeline (Sprint 3 function, plus 'score').
create or replace function private.log_lead_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  diff jsonb;
  skip text[] := array['updated_at', 'last_activity_at', 'status_id', 'closed_at', 'next_follow_up_at', 'score',
                       'latest_source_id', 'latest_campaign', 'latest_touch'];
begin
  if tg_op = 'INSERT' then
    insert into public.lead_status_history (business_id, lead_id, from_status_id, to_status_id, changed_by)
    values (new.business_id, new.id, null, new.status_id, auth.uid());
    insert into public.lead_activities (business_id, lead_id, type, meta, actor_id)
    values (new.business_id, new.id, 'created',
            jsonb_build_object('source_id', new.first_source_id, 'campaign', new.first_campaign,
                               'status_id', new.status_id, 'owner_id', new.owner_id),
            auth.uid());
    return null;
  end if;

  if new.status_id is distinct from old.status_id then
    insert into public.lead_status_history
      (business_id, lead_id, from_status_id, to_status_id, changed_by, lost_reason_id, note)
    values (new.business_id, new.id, old.status_id, new.status_id, auth.uid(), new.lost_reason_id, new.lost_note);
    insert into public.lead_activities (business_id, lead_id, type, body, meta, actor_id)
    values (new.business_id, new.id, 'status_changed', new.lost_note,
            jsonb_strip_nulls(jsonb_build_object('from', old.status_id, 'to', new.status_id,
                                                 'lost_reason_id', new.lost_reason_id)),
            auth.uid());
    -- The lost reason and note belong to the move, not to a separate edit.
    skip := skip || array['lost_reason_id', 'lost_note'];
  end if;

  select jsonb_object_agg(n.key, jsonb_build_object('from', to_jsonb(old) -> n.key, 'to', n.value))
    into diff
    from jsonb_each(to_jsonb(new)) n
   where n.value is distinct from to_jsonb(old) -> n.key
     and n.key <> all (skip);
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

create or replace function private.rescore_lead(p_lead_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.leads l set score = s.v
    from (select private.lead_score(p_lead_id) as v) s
   where l.id = p_lead_id and l.score is distinct from s.v;
$$;

create or replace function private.rescore_from_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.rescore_lead(new.id);
  return null;
end;
$$;

create trigger leads_rescore after insert or update of status_id, first_source_id, expected_value, branch_id, last_activity_at
  on public.leads for each row execute function private.rescore_from_lead();

create or replace function private.rescore_from_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null then
    perform private.rescore_lead(new.lead_id);
  end if;
  return null;
end;
$$;

create trigger appointments_rescore after insert or update of status on public.appointments
  for each row execute function private.rescore_from_child();

-- Rescoring everything (after rule changes, and nightly for time-based rules).
create or replace function public.rescore_leads(p_business_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v int;
begin
  if auth.uid() is not null and not private.has_permission(p_business_id, 'automation.manage') then
    raise exception 'not allowed to manage automation' using errcode = '42501';
  end if;
  update public.leads l set score = private.lead_score(l.id)
   where l.business_id = p_business_id and l.archived_at is null and l.score is distinct from private.lead_score(l.id);
  get diagnostics v = row_count;
  return v;
end;
$$;

-- =====================================================================
-- Automation events: triggers on leads, orders and appointments queue runs
-- =====================================================================
create or replace function private.queue_automation_runs(
  p_business_id uuid, p_trigger text, p_entity_type text, p_entity_id uuid, p_context jsonb, p_dedupe text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.automation_runs (business_id, automation_id, entity_type, entity_id, dedupe_key)
  select p_business_id, a.id, p_entity_type, p_entity_id, coalesce(p_dedupe, gen_random_uuid()::text)
    from public.automations a
   where a.business_id = p_business_id and a.is_active and a.trigger = p_trigger
     -- Trigger filters: a specific status or stage, when configured.
     and (a.trigger_config ->> 'status_key' is null or a.trigger_config ->> 'status_key' = p_context ->> 'status_key')
     and (a.trigger_config ->> 'stage_key' is null or a.trigger_config ->> 'stage_key' = p_context ->> 'stage_key')
  on conflict do nothing;
$$;

create or replace function private.automation_lead_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select key into v_key from public.lead_statuses where id = new.status_id;
  if tg_op = 'INSERT' then
    perform private.queue_automation_runs(new.business_id, 'lead_created', 'lead', new.id, jsonb_build_object('status_key', v_key));
    if new.owner_id is not null then
      perform private.queue_automation_runs(new.business_id, 'lead_assigned', 'lead', new.id, '{}');
    end if;
    return null;
  end if;
  if new.status_id is distinct from old.status_id then
    perform private.queue_automation_runs(new.business_id, 'lead_status_changed', 'lead', new.id, jsonb_build_object('status_key', v_key));
  end if;
  if new.owner_id is not null and new.owner_id is distinct from old.owner_id then
    perform private.queue_automation_runs(new.business_id, 'lead_assigned', 'lead', new.id, '{}');
  end if;
  return null;
end;
$$;

create trigger leads_automation after insert or update of status_id, owner_id on public.leads
  for each row execute function private.automation_lead_events();

create or replace function private.automation_order_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select key into v_key from public.order_stages where id = new.stage_id;
  if tg_op = 'INSERT' then
    perform private.queue_automation_runs(new.business_id, 'order_created', 'order', new.id, jsonb_build_object('stage_key', v_key));
  elsif new.stage_id is distinct from old.stage_id then
    perform private.queue_automation_runs(new.business_id, 'order_stage_changed', 'order', new.id, jsonb_build_object('stage_key', v_key));
  end if;
  return null;
end;
$$;

create trigger orders_automation after insert or update of stage_id on public.orders
  for each row execute function private.automation_order_events();

create or replace function private.automation_appointment_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'no_show' and old.status is distinct from 'no_show' then
    perform private.queue_automation_runs(new.business_id, 'appointment_no_show', 'appointment', new.id, '{}');
  end if;
  return null;
end;
$$;

create trigger appointments_automation after update of status on public.appointments
  for each row execute function private.automation_appointment_events();

-- =====================================================================
-- Running automations
-- =====================================================================

-- The lead a run is about (directly, or through its order or appointment).
create or replace function private.run_lead(p_run public.automation_runs)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_run.entity_type
           when 'lead' then p_run.entity_id
           when 'order' then (select lead_id from public.orders where id = p_run.entity_id)
           when 'appointment' then (select lead_id from public.appointments where id = p_run.entity_id)
         end;
$$;

create or replace function private.run_customer(p_run public.automation_runs)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_run.entity_type
           when 'lead' then (select customer_id from public.leads where id = p_run.entity_id)
           when 'order' then (select customer_id from public.orders where id = p_run.entity_id)
           when 'appointment' then (select customer_id from public.appointments where id = p_run.entity_id)
         end;
$$;

-- Facts conditions can test, read fresh when the run executes.
create or replace function private.run_facts(p_run public.automation_runs)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'source_key', src.key, 'status_key', st.key, 'status_category', st.category, 'branch_id', l.branch_id,
    'has_owner', l.owner_id is not null, 'expected_value', l.expected_value, 'score', l.score,
    'order_total', o.total, 'stage_key', os.key)
    from (select private.run_lead(p_run) as lead_id) x
    left join public.leads l on l.id = x.lead_id
    left join public.lead_sources src on src.id = l.first_source_id
    left join public.lead_statuses st on st.id = l.status_id
    left join public.orders o on p_run.entity_type = 'order' and o.id = p_run.entity_id
    left join public.order_stages os on os.id = o.stage_id;
$$;

create or replace function private.conditions_match(p_conditions jsonb, p_facts jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(
    case c ->> 'op'
      when 'eq' then p_facts ->> (c ->> 'field') = c ->> 'value'
      when 'neq' then (p_facts ->> (c ->> 'field')) is distinct from (c ->> 'value')
      when 'gte' then (p_facts ->> (c ->> 'field'))::numeric >= (c ->> 'value')::numeric
      when 'lte' then (p_facts ->> (c ->> 'field'))::numeric <= (c ->> 'value')::numeric
      when 'in' then p_facts ->> (c ->> 'field') in (select jsonb_array_elements_text(c -> 'value'))
      when 'is_true' then (p_facts ->> (c ->> 'field'))::boolean is true
      when 'is_false' then (p_facts ->> (c ->> 'field'))::boolean is not true
      else false
    end), true)
    from jsonb_array_elements(coalesce(p_conditions, '[]')) c;
$$;

create or replace function private.run_log(p_run_id uuid, p_entry jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.automation_runs
     set log = log || jsonb_build_array(jsonb_build_object('at', now()) || p_entry)
   where id = p_run_id;
$$;

-- Executes a run from its current step until it finishes, waits, or needs the app
-- (WhatsApp sends). Returns {status, external?}. Called by the job route (service role).
create or replace function public.step_automation_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.automation_runs;
  a public.automations;
  v_action jsonb;
  v_lead uuid;
  v_customer uuid;
  v_owner uuid;
  v_business uuid;
  v_target uuid;
  v_n int;
begin
  select * into r from public.automation_runs where id = p_run_id for update;
  if r.id is null or r.status not in ('pending', 'waiting', 'running') then
    return jsonb_build_object('status', coalesce(r.status, 'missing'));
  end if;
  select * into a from public.automations where id = r.automation_id;
  v_business := r.business_id;

  if r.step = 0 and r.status = 'pending' then
    if not a.is_active then
      update public.automation_runs set status = 'skipped', finished_at = now() where id = r.id;
      perform private.run_log(r.id, '{"event":"skipped","reason":"automation turned off"}');
      return jsonb_build_object('status', 'skipped');
    end if;
    if not private.conditions_match(a.conditions, private.run_facts(r)) then
      update public.automation_runs set status = 'skipped', finished_at = now() where id = r.id;
      perform private.run_log(r.id, '{"event":"skipped","reason":"conditions not met"}');
      return jsonb_build_object('status', 'skipped');
    end if;
  end if;
  update public.automation_runs set status = 'running' where id = r.id;

  v_lead := private.run_lead(r);
  v_customer := private.run_customer(r);
  select owner_id into v_owner from public.leads where id = v_lead;

  while r.step < jsonb_array_length(a.actions) loop
    v_action := a.actions -> r.step;
    begin
      case v_action ->> 'type'
        when 'wait' then
          update public.automation_runs
             set status = 'waiting', step = r.step + 1,
                 run_at = now() + make_interval(mins => greatest(1, coalesce((v_action ->> 'minutes')::int, 60)))
           where id = r.id;
          perform private.run_log(r.id, jsonb_build_object('step', r.step, 'action', 'wait', 'minutes', v_action ->> 'minutes'));
          return jsonb_build_object('status', 'waiting');

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
          -- The app sends it (provider call), then calls finish_automation_external().
          update public.automation_runs set step = r.step where id = r.id;
          return jsonb_build_object('status', 'external', 'action', v_action, 'customer_id', v_customer, 'step', r.step);

        else
          raise exception 'unknown action %', v_action ->> 'type';
      end case;
      perform private.run_log(r.id, jsonb_build_object('step', r.step, 'action', v_action ->> 'type', 'ok', true));
    exception when others then
      get diagnostics v_n = row_count;
      update public.automation_runs
         set attempts = attempts + 1, error = left(sqlerrm, 500),
             status = case when attempts + 1 >= 3 then 'failed' else 'waiting' end,
             run_at = now() + make_interval(mins => 5 * (attempts + 1)),
             finished_at = case when attempts + 1 >= 3 then now() end
       where id = r.id;
      perform private.run_log(r.id, jsonb_build_object('step', r.step, 'action', v_action ->> 'type', 'ok', false, 'error', sqlerrm));
      return jsonb_build_object('status', 'error', 'error', sqlerrm);
    end;
    r.step := r.step + 1;
    update public.automation_runs set step = r.step where id = r.id;
  end loop;

  update public.automation_runs set status = 'done', finished_at = now(), error = null where id = r.id;
  return jsonb_build_object('status', 'done');
end;
$$;

-- After the app performed an external step (a WhatsApp template), record it and move on.
create or replace function public.finish_automation_external(p_run_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.automation_runs;
  v_action text;
begin
  select * into r from public.automation_runs where id = p_run_id for update;
  if r.id is null then
    return;
  end if;
  select a.actions -> r.step ->> 'type' into v_action from public.automations a where a.id = r.automation_id;
  if p_error is null then
    perform private.run_log(r.id, jsonb_build_object('step', r.step, 'action', v_action, 'ok', true));
    update public.automation_runs set step = step + 1, status = 'running' where id = r.id;
  else
    perform private.run_log(r.id, jsonb_build_object('step', r.step, 'action', v_action, 'ok', false, 'error', p_error));
    -- A missing opt-in or closed window is final for this step; skip it rather than retry forever.
    update public.automation_runs set step = step + 1, status = 'running', error = left(p_error, 500) where id = r.id;
  end if;
end;
$$;

-- Due runs, plus "lead idle" events found by scanning open leads.
create or replace function public.claim_automation_runs(p_limit int default 100)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lead idle: open leads with no activity for the configured number of days,
  -- once per period of inactivity (the dedupe key is the last activity time).
  insert into public.automation_runs (business_id, automation_id, entity_type, entity_id, dedupe_key)
  select a.business_id, a.id, 'lead', l.id, 'idle:' || l.last_activity_at::text
    from public.automations a
    join public.leads l on l.business_id = a.business_id and l.archived_at is null
    join public.lead_statuses s on s.id = l.status_id and s.category = 'open'
   where a.is_active and a.trigger = 'lead_idle'
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

-- What the app needs to send a template from an automation; consent and suppression enforced.
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
begin
  select * into r from public.automation_runs where id = p_run_id;
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

-- Puts the sent template into the customer's conversation.
create or replace function public.record_automation_message(p_account_id uuid, p_customer_id uuid, p_wamid text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv uuid;
  v_business uuid;
begin
  select business_id into v_business from public.whatsapp_accounts where id = p_account_id;
  insert into public.conversations (business_id, account_id, customer_id) values (v_business, p_account_id, p_customer_id)
  on conflict (account_id, customer_id) do nothing;
  select id into v_conv from public.conversations where account_id = p_account_id and customer_id = p_customer_id;
  insert into public.messages (business_id, conversation_id, direction, wamid, type, body, status, sent_at, status_at)
  values (v_business, v_conv, 'outbound', p_wamid, 'template', left(p_body, 4096), 'sent', now(), now());
  update public.conversations set last_message_at = now(), last_message_preview = left(p_body, 140), last_outbound_at = now()
   where id = v_conv;
end;
$$;

-- Lets an admin retry failed runs after fixing the cause.
create or replace function public.retry_automation_runs(p_business_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v int;
begin
  if not private.has_permission(p_business_id, 'automation.manage') then
    raise exception 'not allowed to manage automation' using errcode = '42501';
  end if;
  update public.automation_runs set status = 'waiting', attempts = 0, run_at = now(), finished_at = null
   where business_id = p_business_id and status = 'failed';
  get diagnostics v = row_count;
  return v;
end;
$$;

-- =====================================================================
-- Presets and default scoring rules (seeded inactive / active)
-- =====================================================================
create or replace function private.seed_automation_defaults(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.automations (business_id, preset_key, name, description, trigger, trigger_config, conditions, actions) values
    (p_business_id, 'new_lead_call', 'Call new leads within 15 minutes',
     'Every new lead gets a call task for its owner, due in 15 minutes.',
     'lead_created', '{}', '[{"field":"has_owner","op":"is_true"}]',
     '[{"type":"create_task","task_type":"call","title":"Call the new lead","due_in_minutes":15,"assignee":"owner"}]'),
    (p_business_id, 'unassigned_alert', 'Tell managers about unassigned leads',
     'If a new lead still has no owner, managers are notified.',
     'lead_created', '{}', '[{"field":"has_owner","op":"is_false"}]',
     '[{"type":"wait","minutes":10},{"type":"assign_round_robin"},{"type":"notify","to":"managers","title":"A new lead is waiting for an owner"}]'),
    (p_business_id, 'idle_lead', 'Chase leads that have gone quiet',
     'After 3 days without activity on an open lead, its owner gets a follow-up task.',
     'lead_idle', '{"days":3}', '[]',
     '[{"type":"create_task","task_type":"follow_up","title":"No activity for 3 days: follow up","due_in_minutes":60,"assignee":"owner"},{"type":"notify","to":"owner","title":"A lead has gone quiet"}]'),
    (p_business_id, 'no_show_followup', 'Follow up on no-shows',
     'When a customer misses an appointment, the lead owner is asked to rebook the next day.',
     'appointment_no_show', '{}', '[]',
     '[{"type":"create_task","task_type":"call","title":"Missed appointment: call to rebook","due_in_minutes":1080,"assignee":"owner"}]'),
    (p_business_id, 'won_tag', 'Tag customers who buy',
     'When a lead is converted, the customer is tagged "Customer".',
     'lead_status_changed', '{"status_key":"won"}', '[]',
     '[{"type":"add_tag","tag":"Customer"}]'),
    (p_business_id, 'delivered_feedback', 'Ask for feedback after delivery',
     'Three days after an order is delivered, its salesperson gets a task to ask how it went.',
     'order_stage_changed', '{"stage_key":"delivered"}', '[]',
     '[{"type":"wait","minutes":4320},{"type":"create_task","task_type":"call","title":"Ask how the order fits and for a review","due_in_minutes":60,"assignee":"owner"}]')
  on conflict (business_id, preset_key) do nothing;

  if not exists (select 1 from public.lead_scoring_rules where business_id = p_business_id) then
    insert into public.lead_scoring_rules (business_id, label, field, value, points) values
      (p_business_id, 'Walked into the store', 'source_key', 'walk_in', 20),
      (p_business_id, 'Referred by a customer', 'source_key', 'referral', 15),
      (p_business_id, 'Qualified stage', 'stage', 'qualified', 15),
      (p_business_id, 'Negotiating', 'stage', 'negotiation', 25),
      (p_business_id, 'Expected value of 25,000 or more', 'expected_value_gte', '25000', 15),
      (p_business_id, 'Gave an email address', 'has_email', null, 5),
      (p_business_id, 'Has a booked or attended appointment', 'has_appointment', null, 15),
      (p_business_id, 'Active in the last 3 days', 'active_within_days', '3', 10);
  end if;
end;
$$;

create or replace function private.on_business_created_automation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_automation_defaults(new.id);
  return new;
end;
$$;

create trigger businesses_seed_automation after insert on public.businesses
  for each row execute function private.on_business_created_automation();

select private.seed_automation_defaults(id) from public.businesses;
update public.leads l set score = private.lead_score(l.id) where l.archived_at is null;

-- =====================================================================
-- Analytics: one set of metric definitions used by every screen
-- (see src/modules/analytics/metrics.ts for the written definitions)
-- =====================================================================

-- Period figures. Cohort rule: conversion is measured on leads CREATED in the
-- period, counting those that are won by now (not leads won in the period).
create or replace function public.analytics_summary(p_business_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_tz text;
  v jsonb;
  v_money boolean;
begin
  if not (private.has_permission(p_business_id, 'analytics.view') or private.has_permission(p_business_id, 'dashboard.view')) then
    raise exception 'not allowed to view analytics' using errcode = '42501';
  end if;
  select timezone into v_tz from public.businesses where id = p_business_id;
  v_from := (p_from::timestamp) at time zone v_tz;
  v_to := ((p_to + 1)::timestamp) at time zone v_tz;
  v_money := private.has_permission(p_business_id, 'analytics.financial') or private.has_permission(p_business_id, 'analytics.sales');

  with leads_in as (
    select l.*, s.category from public.leads l join public.lead_statuses s on s.id = l.status_id
     where l.business_id = p_business_id and l.created_at >= v_from and l.created_at < v_to
  ), orders_in as (
    select o.* from public.orders o join public.order_stages s on s.id = o.stage_id
     where o.business_id = p_business_id and o.created_at >= v_from and o.created_at < v_to and s.category <> 'cancelled'
  ), appts as (
    select * from public.appointments
     where business_id = p_business_id and starts_at >= v_from and starts_at < v_to
  ), pay as (
    select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) as net
      from public.payments where business_id = p_business_id and received_at >= v_from and received_at < v_to
  )
  select jsonb_build_object(
    'leads', (select count(*) from leads_in),
    'leads_won', (select count(*) from leads_in where category = 'won'),
    'leads_lost', (select count(*) from leads_in where category = 'lost'),
    'conversion_rate', (select round(100.0 * count(*) filter (where category = 'won') / nullif(count(*), 0), 1) from leads_in),
    'walk_ins', (select count(*) from public.walk_ins where business_id = p_business_id and visited_at >= v_from and visited_at < v_to),
    'appointments', (select count(*) from appts where status <> 'cancelled'),
    'no_show_rate', (select round(100.0 * count(*) filter (where status = 'no_show') / nullif(count(*) filter (where status in ('completed', 'no_show')), 0), 1) from appts),
    'orders', (select count(*) from orders_in),
    'revenue', case when v_money then (select coalesce(sum(total), 0) from orders_in) end,
    'average_order_value', case when v_money then (select round(avg(total), 2) from orders_in) end,
    'collected', case when v_money then (select net from pay) end,
    'outstanding', case when v_money then (select coalesce(sum(b.balance), 0) from public.order_balances b
                                            join public.orders o on o.id = b.order_id
                                            join public.order_stages s on s.id = o.stage_id and s.category = 'open'
                                           where b.business_id = p_business_id and b.balance > 0) end,
    'spend', case when v_money or private.has_permission(p_business_id, 'analytics.marketing') then
               (select coalesce(sum(spend), 0) from public.ad_spend_daily where business_id = p_business_id and day between p_from and p_to) end,
    'median_first_reply_seconds', (select percentile_cont(0.5) within group (order by response_seconds)
                                     from public.messages where business_id = p_business_id and response_seconds is not null
                                      and sent_at >= v_from and sent_at < v_to),
    'tasks_overdue', (select count(*) from public.tasks where business_id = p_business_id and completed_at is null
                        and cancelled_at is null and due_at < now()))
    into v;
  return v;
end;
$$;

-- Breakdown by one dimension, with the same definitions as the summary.
-- dimension: source | branch | owner | campaign | product | stage
create or replace function public.analytics_breakdown(p_business_id uuid, p_from date, p_to date, p_dimension text)
returns table (key text, label text, leads bigint, won bigint, conversion_rate numeric, orders bigint, revenue numeric, spend numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_tz text;
  v_money boolean;
begin
  if not private.has_permission(p_business_id, 'analytics.view') then
    raise exception 'not allowed to view analytics' using errcode = '42501';
  end if;
  select timezone into v_tz from public.businesses where id = p_business_id;
  v_from := (p_from::timestamp) at time zone v_tz;
  v_to := ((p_to + 1)::timestamp) at time zone v_tz;
  v_money := private.has_permission(p_business_id, 'analytics.financial') or private.has_permission(p_business_id, 'analytics.sales')
             or private.has_permission(p_business_id, 'analytics.marketing');

  if p_dimension = 'product' then
    return query
    select coalesce(i.catalog_item_id::text, lower(i.description)), max(coalesce(ci.name, i.description)),
           null::bigint, null::bigint, null::numeric, count(distinct o.id),
           case when v_money then sum(i.line_total) end, null::numeric
      from public.order_items i
      join public.orders o on o.id = i.order_id
      join public.order_stages s on s.id = o.stage_id and s.category <> 'cancelled'
      left join public.catalog_items ci on ci.id = i.catalog_item_id
     where o.business_id = p_business_id and o.created_at >= v_from and o.created_at < v_to
     group by 1 order by 7 desc nulls last limit 50;
    return;
  end if;

  return query
  with lead_rows as (
    select case p_dimension
             when 'source' then l.first_source_id::text
             when 'branch' then l.branch_id::text
             when 'owner' then l.owner_id::text
             when 'campaign' then coalesce(l.first_touch ->> 'campaign_id', l.first_campaign)
             when 'stage' then l.status_id::text
           end as k,
           case p_dimension
             when 'source' then src.name
             when 'branch' then b.name
             when 'owner' then coalesce(p.full_name, p.email)
             when 'campaign' then coalesce(l.first_campaign, l.first_touch ->> 'campaign_id')
             when 'stage' then st.name
           end as lbl,
           st.category, l.id, l.customer_id, l.created_at
      from public.leads l
      join public.lead_statuses st on st.id = l.status_id
      left join public.lead_sources src on src.id = l.first_source_id
      left join public.branches b on b.id = l.branch_id
      left join public.profiles p on p.id = l.owner_id
     where l.business_id = p_business_id and l.created_at >= v_from and l.created_at < v_to
  ), order_rows as (
    -- Orders credited to the lead cohort: orders on those leads (or their customer) since the lead was created.
    select lr.k, o.id, o.total
      from lead_rows lr
      join public.orders o on o.customer_id = lr.customer_id and o.created_at >= lr.created_at
      join public.order_stages s on s.id = o.stage_id and s.category <> 'cancelled'
  ), spend_rows as (
    select c.external_id as k, sum(d.spend) as spend
      from public.ad_spend_daily d join public.ad_campaigns c on c.id = d.ad_campaign_id
     where d.business_id = p_business_id and d.day between p_from and p_to
     group by 1
  )
  select coalesce(lr.k, '(none)'), coalesce(max(lr.lbl), 'Not set'), count(distinct lr.id),
         count(distinct lr.id) filter (where lr.category = 'won'),
         round(100.0 * count(distinct lr.id) filter (where lr.category = 'won') / nullif(count(distinct lr.id), 0), 1),
         (select count(distinct x.id) from order_rows x where x.k is not distinct from lr.k),
         case when v_money then (select coalesce(sum(t.total), 0) from (select distinct x.id, x.total from order_rows x where x.k is not distinct from lr.k) t) end,
         case when p_dimension = 'campaign' and v_money then (select s.spend from spend_rows s where s.k = lr.k) end
    from lead_rows lr
   group by lr.k
   order by 3 desc
   limit 100;
end;
$$;

-- PIC performance, normalised: each person's conversion is compared with what the
-- business converts on leads from the same sources (their "expected"), using only
-- leads at least p_min_age_days old so recent leads don't drag anyone down.
create or replace function public.pic_performance(p_business_id uuid, p_from date, p_to date, p_min_age_days int default 7)
returns table (owner_id uuid, owner_name text, leads bigint, won bigint, conversion_rate numeric,
               expected_won numeric, performance_index numeric, open_overdue_tasks bigint, median_days_to_win numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_tz text;
begin
  if not (private.has_permission(p_business_id, 'analytics.sales') or private.has_permission(p_business_id, 'analytics.view')) then
    raise exception 'not allowed to view analytics' using errcode = '42501';
  end if;
  select timezone into v_tz from public.businesses where id = p_business_id;
  v_from := (p_from::timestamp) at time zone v_tz;
  v_to := ((p_to + 1)::timestamp) at time zone v_tz;

  return query
  with cohort as (
    select l.id, l.owner_id, l.first_source_id, l.created_at, l.closed_at, s.category
      from public.leads l join public.lead_statuses s on s.id = l.status_id
     where l.business_id = p_business_id and l.created_at >= v_from and l.created_at < v_to
       and l.created_at < now() - make_interval(days => p_min_age_days) and l.archived_at is null
  ), source_rate as (
    select first_source_id, avg(case when category = 'won' then 1.0 else 0 end) as rate
      from cohort group by first_source_id
  )
  select c.owner_id, coalesce(max(p.full_name), max(p.email), 'Unassigned'), count(*),
         count(*) filter (where c.category = 'won'),
         round(100.0 * count(*) filter (where c.category = 'won') / nullif(count(*), 0), 1),
         round(sum(sr.rate), 1),
         round(count(*) filter (where c.category = 'won') / nullif(sum(sr.rate), 0), 2),
         (select count(*) from public.tasks t where t.business_id = p_business_id and t.assignee_id = c.owner_id
             and t.completed_at is null and t.cancelled_at is null and t.due_at < now()),
         round((percentile_cont(0.5) within group (order by extract(epoch from c.closed_at - c.created_at) / 86400)
                filter (where c.category = 'won'))::numeric, 1)
    from cohort c
    left join source_rate sr on sr.first_source_id is not distinct from c.first_source_id
    left join public.profiles p on p.id = c.owner_id
   group by c.owner_id
   order by 7 desc nulls last, 3 desc;
end;
$$;

-- Operations: where orders sit, overdue deliveries, time to deliver.
create or replace function public.operations_summary(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_business_id, 'analytics.view') then
    raise exception 'not allowed to view analytics' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'by_stage', (select coalesce(jsonb_agg(jsonb_build_object('stage', s.name, 'category', s.category, 'orders', x.n) order by s.position), '[]')
                   from public.order_stages s
                   join lateral (select count(*) as n from public.orders o where o.stage_id = s.id) x on true
                  where s.business_id = p_business_id and s.category = 'open'),
    'overdue_deliveries', (select count(*) from public.orders o join public.order_stages s on s.id = o.stage_id
                            where o.business_id = p_business_id and s.category = 'open' and o.due_date < current_date),
    'median_days_to_deliver', (select round((percentile_cont(0.5) within group (order by extract(epoch from o.closed_at - o.created_at) / 86400))::numeric, 1)
                                 from public.orders o join public.order_stages s on s.id = o.stage_id
                                where o.business_id = p_business_id and s.category = 'done' and o.closed_at > now() - interval '90 days'),
    'appointments_today', (select count(*) from public.appointments a join public.businesses b on b.id = a.business_id
                            where a.business_id = p_business_id and a.status in ('scheduled', 'confirmed')
                              and (a.starts_at at time zone b.timezone)::date = (now() at time zone b.timezone)::date));
end;
$$;

-- =====================================================================
-- Scheduled reports (service role): claim due schedules for the email job.
-- =====================================================================
create or replace function public.claim_report_schedules(p_limit int default 20)
returns table (id uuid, business_id uuid, user_id uuid, email text, report text, frequency text, business_name text,
               timezone text, currency char(3), period_from date, period_to date)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select s.* from public.report_schedules s
     where s.is_active and s.next_run_at <= now()
     order by s.next_run_at limit greatest(1, least(p_limit, 100))
     for update skip locked
  ), moved as (
    update public.report_schedules s
       set last_sent_at = now(),
           next_run_at = s.next_run_at + case s.frequency when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end
      from due where s.id = due.id
    returning s.id
  )
  select d.id, d.business_id, d.user_id, p.email, d.report, d.frequency, b.name, b.timezone, b.currency,
         ((now() at time zone b.timezone)::date - case d.frequency when 'daily' then 1 when 'weekly' then 7 else 30 end),
         ((now() at time zone b.timezone)::date - 1)
    from due d
    join moved m on m.id = d.id
    join public.businesses b on b.id = d.business_id and b.status = 'active'
    join public.profiles p on p.id = d.user_id and p.email is not null
    join public.business_memberships bm on bm.business_id = d.business_id and bm.user_id = d.user_id and bm.status = 'active';
end;
$$;

-- The summary for a scheduled report, computed as the schedule's owner would see it.
create or replace function public.report_summary_for(p_schedule_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.report_schedules;
  v jsonb;
begin
  select * into s from public.report_schedules where id = p_schedule_id;
  -- Run the definitions with the recipient's permissions.
  perform set_config('request.jwt.claim.sub', s.user_id::text, true);
  v := public.analytics_summary(s.business_id, p_from, p_to);
  return v;
exception when insufficient_privilege then
  return null;
end;
$$;

-- Exports are recorded in the audit log (who took which data, how many rows).
create or replace function public.log_export(p_business_id uuid, p_kind text, p_rows int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_business_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (p_business_id, auth.uid(), 'export', left(p_kind, 40), null, jsonb_build_object('rows', p_rows));
end;
$$;
revoke execute on function public.log_export(uuid, text, int) from public, anon;
grant execute on function public.log_export(uuid, text, int) to authenticated;

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.rescore_leads(uuid) from public, anon;
revoke execute on function public.retry_automation_runs(uuid) from public, anon;
revoke execute on function public.analytics_summary(uuid, date, date) from public, anon;
revoke execute on function public.analytics_breakdown(uuid, date, date, text) from public, anon;
revoke execute on function public.pic_performance(uuid, date, date, int) from public, anon;
revoke execute on function public.operations_summary(uuid) from public, anon;
grant execute on function public.rescore_leads(uuid) to authenticated, service_role;
grant execute on function public.retry_automation_runs(uuid) to authenticated;
grant execute on function public.analytics_summary(uuid, date, date) to authenticated;
grant execute on function public.analytics_breakdown(uuid, date, date, text) to authenticated;
grant execute on function public.pic_performance(uuid, date, date, int) to authenticated;
grant execute on function public.operations_summary(uuid) to authenticated;

revoke execute on function public.step_automation_run(uuid) from public, anon, authenticated;
revoke execute on function public.finish_automation_external(uuid, text) from public, anon, authenticated;
revoke execute on function public.claim_automation_runs(int) from public, anon, authenticated;
revoke execute on function public.automation_whatsapp_context(uuid) from public, anon, authenticated;
revoke execute on function public.record_automation_message(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.claim_report_schedules(int) from public, anon, authenticated;
revoke execute on function public.report_summary_for(uuid, date, date) from public, anon, authenticated;
grant execute on function public.step_automation_run(uuid) to service_role;
grant execute on function public.finish_automation_external(uuid, text) to service_role;
grant execute on function public.claim_automation_runs(int) to service_role;
grant execute on function public.automation_whatsapp_context(uuid) to service_role;
grant execute on function public.record_automation_message(uuid, uuid, text, text) to service_role;
grant execute on function public.claim_report_schedules(int) to service_role;
grant execute on function public.report_summary_for(uuid, date, date) to service_role;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.automations         enable row level security;
alter table public.automation_runs     enable row level security;
alter table public.lead_scoring_rules  enable row level security;
alter table public.saved_views         enable row level security;
alter table public.report_schedules    enable row level security;

create policy automations_select on public.automations for select to authenticated
  using (private.has_permission(business_id, 'automation.manage'));
create policy automations_insert on public.automations for insert to authenticated
  with check (private.has_permission(business_id, 'automation.manage') and created_by = auth.uid());
create policy automations_update on public.automations for update to authenticated
  using (private.has_permission(business_id, 'automation.manage'))
  with check (private.has_permission(business_id, 'automation.manage'));
create policy automations_delete on public.automations for delete to authenticated
  using (private.has_permission(business_id, 'automation.manage') and preset_key is null);
revoke update on public.automations from authenticated, anon;
grant update (name, description, trigger_config, conditions, actions, is_active) on public.automations to authenticated;

create policy runs_select on public.automation_runs for select to authenticated
  using (private.has_permission(business_id, 'automation.manage'));
revoke insert, update, delete on public.automation_runs from authenticated, anon;

create policy scoring_select on public.lead_scoring_rules for select to authenticated
  using (private.is_member(business_id));
create policy scoring_write on public.lead_scoring_rules for all to authenticated
  using (private.has_permission(business_id, 'automation.manage'))
  with check (private.has_permission(business_id, 'automation.manage'));

-- Leads: score is written by the database only.
revoke update (score) on public.leads from authenticated;

create policy views_select on public.saved_views for select to authenticated
  using (private.is_member(business_id) and (user_id = auth.uid() or shared));
create policy views_insert on public.saved_views for insert to authenticated
  with check (private.is_member(business_id) and user_id = auth.uid());
create policy views_delete on public.saved_views for delete to authenticated
  using (user_id = auth.uid());
revoke update on public.saved_views from authenticated, anon;

create policy schedules_select on public.report_schedules for select to authenticated
  using (user_id = auth.uid() and private.is_member(business_id));
create policy schedules_insert on public.report_schedules for insert to authenticated
  with check (user_id = auth.uid() and private.has_permission(business_id, 'analytics.view'));
create policy schedules_update on public.report_schedules for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy schedules_delete on public.report_schedules for delete to authenticated
  using (user_id = auth.uid());
revoke update on public.report_schedules from authenticated;
grant update (is_active) on public.report_schedules to authenticated;

revoke all on public.automations, public.automation_runs, public.lead_scoring_rules, public.saved_views,
  public.report_schedules from anon;
grant execute on all functions in schema private to authenticated, service_role;
