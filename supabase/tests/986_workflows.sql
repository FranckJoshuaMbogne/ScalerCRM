-- Visual workflows: graph conversion, validation, versions, branches, waits,
-- replies, the new actions, loop guards, dry runs and per-step analytics.
\set ON_ERROR_STOP on
\set QUIET on
set timezone to 'Asia/Kolkata';

\set wia '61000000-0000-0000-0000-000000000001'
\set wes '61000000-0000-0000-0000-000000000002'
\set wro '61000000-0000-0000-0000-000000000003'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'wia', 'wia@omega.test', '{"full_name":"Wia Admin"}'),
  (:'wes', 'wes@omega.test', '{"full_name":"Wes Sales"}'),
  (:'wro', 'wro@psi.test', '{"full_name":"Wro Other"}');

select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
select public.create_business('Omega Outfitters', 'omega-outfitters', 'Main') as biz \gset
reset role;
select set_config('request.jwt.claim.sub', :'wro', false);
set role authenticated;
select public.create_business('Psi Stores', 'psi-stores', 'Main') as other \gset
reset role;
update public.businesses set trial_ends_at = null where id in (:'biz', :'other');
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', :'wes', r.id, 'active', now() from public.roles r where r.key = 'sales_executive' and r.business_id is null;

-- Steps every due run, as the job route does.
create or replace function tests.tick() returns void language sql as $$
  select count(public.step_automation_run(r)) from public.claim_automation_runs(500) r;
$$;
grant execute on function tests.tick() to service_role;

-- ------------------------------------------------------------ the six presets are graphs
select tests.ok((select count(*) = 6 and bool_and(a.current_version_id is not null and v.version = 1
                   and cardinality(private.automation_graph_errors(v.graph)) = 0 and a.actions = '[]')
                   from public.automations a join public.automation_versions v on v.id = a.current_version_id
                  where a.business_id = :'biz'),
                'every preset is a valid graph, version 1');
select tests.ok((select v.graph = private.linear_to_graph('lead_created', '{}', '[{"field":"has_owner","op":"is_true"}]',
                   '[{"type":"create_task","task_type":"call","title":"Call the new lead","due_in_minutes":15,"assignee":"owner"}]')
                   from public.automations a join public.automation_versions v on v.id = a.current_version_id
                  where a.business_id = :'biz' and a.preset_key = 'new_lead_call'),
                'a linear automation becomes trigger, condition, then actions');
select tests.ok((select jsonb_array_length(v.graph -> 'nodes') = 5 and v.graph -> 'nodes' @> '[{"id":"a1","kind":"wait","minutes":10}]'
                   from public.automations a join public.automation_versions v on v.id = a.current_version_id
                  where a.business_id = :'biz' and a.preset_key = 'unassigned_alert'),
                'waits become wait steps');

-- ------------------------------------------------------------ validation
select tests.ok(cardinality(private.automation_graph_errors('{"nodes": []}')) > 0, 'an empty workflow is refused');
select tests.ok('The workflow loops back on itself. Steps can only lead forward.' = any (private.automation_graph_errors(
  '{"nodes": [{"id":"t","kind":"trigger","trigger":"lead_created","next":"a"},
              {"id":"a","kind":"action","action":{"type":"add_tag","tag":"x"},"next":"b"},
              {"id":"b","kind":"wait","minutes":5,"next":"a"}]}')),
  'loops are detected');
select tests.ok('Some steps are not connected to the trigger.' = any (private.automation_graph_errors(
  '{"nodes": [{"id":"t","kind":"trigger","trigger":"lead_created","next":"a"},
              {"id":"a","kind":"action","action":{"type":"add_tag","tag":"x"}},
              {"id":"z","kind":"action","action":{"type":"add_tag","tag":"y"}}]}')),
  'loose steps are found');
select tests.ok('A workflow starts with exactly one trigger.' = any (private.automation_graph_errors(
  '{"nodes": [{"id":"t","kind":"trigger","trigger":"lead_created","next":"a"},
              {"id":"u","kind":"trigger","trigger":"lead_created","next":"a"},
              {"id":"a","kind":"action","action":{"type":"add_tag","tag":"x"}}]}')),
  'one trigger only');
select tests.ok(cardinality(private.automation_graph_errors(
  '{"nodes": [{"id":"t","kind":"trigger","trigger":"lead_created","next":"c"},
              {"id":"c","kind":"condition","conditions":[{"field":"has_owner","op":"is_true"}],"yes":"a","no":"b"},
              {"id":"a","kind":"action","action":{"type":"add_tag","tag":"x"},"next":"d"},
              {"id":"b","kind":"action","action":{"type":"add_tag","tag":"y"},"next":"d"},
              {"id":"d","kind":"wait","minutes":5}]}')) = 0,
  'branches may join again (a diamond is not a loop)');
select tests.ok(cardinality(private.automation_graph_errors(
  '{"nodes": [{"id":"t","kind":"trigger","trigger":"lead_created","next":"a"},
              {"id":"a","kind":"action","action":{"type":"send_email","to":"customer","subject":"","body":"x"}}]}')) > 0,
  'action settings are checked');

-- ------------------------------------------------------------ building and versions
-- Branch on the source: walk-ins get "VIP", everyone else "Regular"; then wait 30 minutes and tag "Followed".
\set g1 '{"nodes": [{"id":"t","kind":"trigger","trigger":"lead_created","config":{},"next":"c","x":0,"y":0}, {"id":"c","kind":"condition","match":"all","conditions":[{"field":"source_key","op":"eq","value":"walk_in"}],"yes":"vip","no":"reg","x":0,"y":120}, {"id":"vip","kind":"action","action":{"type":"add_tag","tag":"VIP"},"next":"w","x":-150,"y":240}, {"id":"reg","kind":"action","action":{"type":"add_tag","tag":"Regular"},"next":"w","x":150,"y":240}, {"id":"w","kind":"wait","minutes":30,"next":"f","x":0,"y":360}, {"id":"f","kind":"action","action":{"type":"add_tag","tag":"Followed v1"},"next":null,"x":0,"y":480}]}'

select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
select public.create_automation(:'biz', 'Tag by source', :'g1'::jsonb) as wf \gset
select tests.ok((select current_version_id is null and draft_graph is not null and not is_active from public.automations where id = :'wf'),
                'a new workflow starts as an unpublished draft');
select tests.ok((public.publish_automation(:'wf') ->> 'version')::int = 1, 'publishing makes version 1');
update public.automations set is_active = true where id = :'wf';
select tests.fails(format($$select public.publish_automation(%L, %L)$$, :'wf',
  '{"nodes":[{"id":"t","kind":"trigger","trigger":"lead_created","next":"a"},{"id":"a","kind":"wait","minutes":5,"next":"t"}]}'),
  'a looping graph cannot be published');
select public.create_lead(:'biz', '{"phone":"+919844000001","full_name":"Walk In","source":"walk_in"}') ->> 'lead_id' as l1 \gset
select public.create_lead(:'biz', '{"phone":"+919844000002","full_name":"Web Lead","source":"website"}') ->> 'lead_id' as l2 \gset
reset role;
select customer_id as c1 from public.leads where id = :'l1' \gset
select customer_id as c2 from public.leads where id = :'l2' \gset

set role service_role;
select tests.tick();
reset role;
select tests.ok((select string_agg(t.name, ',' order by t.name) = 'VIP' from public.customer_tags ct join public.tags t on t.id = ct.tag_id where ct.customer_id = :'c1'),
                'the yes branch runs for a walk-in');
select tests.ok((select string_agg(t.name, ',' order by t.name) = 'Regular' from public.customer_tags ct join public.tags t on t.id = ct.tag_id where ct.customer_id = :'c2'),
                'the no branch for everyone else');
select tests.ok((select bool_and(status = 'waiting' and node_id = 'f') from public.automation_runs where automation_id = :'wf'),
                'both wait at the shared wait step');

-- Publish version 2 while they wait: they finish on version 1.
select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
select public.save_automation_draft(:'wf', replace(:'g1', 'Followed v1', 'Followed v2')::jsonb);
select tests.ok((select draft_graph is not null from public.automations where id = :'wf'), 'drafts are saved separately');
select (public.publish_automation(:'wf') ->> 'version_id') as v2 \gset
reset role;
update public.automation_runs set run_at = now() where automation_id = :'wf' and status = 'waiting';
set role service_role;
select tests.tick();
reset role;
select tests.ok((select count(*) = 2 from public.customer_tags ct join public.tags t on t.id = ct.tag_id
                  where t.business_id = :'biz' and t.name = 'Followed v1'),
                'running instances finish on the version they started on');
select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
select public.create_lead(:'biz', '{"phone":"+919844000003","full_name":"Third","source":"website"}') ->> 'lead_id' as l3 \gset
reset role;
select tests.ok((select version_id = :'v2' from public.automation_runs where automation_id = :'wf' and entity_id = :'l3'),
                'new runs start on the new version');
select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
select tests.ok((select (public.rollback_automation(:'wf', (select id from public.automation_versions where automation_id = :'wf' and version = 1)) ->> 'version')::int = 3),
                'rolling back publishes the old graph as version 3');
select tests.ok((select v3.graph = v1.graph from public.automation_versions v1, public.automation_versions v3
                  where v1.automation_id = :'wf' and v1.version = 1 and v3.automation_id = :'wf' and v3.version = 3),
                'with the same steps');
select tests.fails(format($$update public.automation_versions set note = 'x' where automation_id = %L$$, :'wf'),
                   'versions cannot be edited');
reset role;
select tests.fails(format($$update public.automation_versions set note = 'x' where automation_id = %L$$, :'wf'),
                   'not even by the database owner');

-- ------------------------------------------------------------ analytics
select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
select tests.ok((select (s -> 'nodes' -> 'c' ->> 'yes')::int = 1 and (s -> 'nodes' -> 'c' ->> 'no')::int = 1
                   and (s -> 'nodes' -> 'f' ->> 'ok')::int = 2 and (s -> 'nodes' -> 'w' ->> 'reached')::int = 2 and (s ->> 'runs')::int = 2
                   from (select public.automation_step_stats(:'wf', (select id from public.automation_versions where automation_id = :'wf' and version = 1)) s) x),
                'per-step analytics count each step and branch');
reset role;
select set_config('request.jwt.claim.sub', :'wes', false);
set role authenticated;
select tests.fails(format($$select public.automation_step_stats(%L)$$, :'wf'), 'sales staff cannot read automation analytics');
select tests.fails(format($$select public.publish_automation(%L)$$, :'wf'), 'or publish');
select tests.ok((select count(*) = 0 from public.automation_versions), 'or see versions');
reset role;
select set_config('request.jwt.claim.sub', :'wro', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.automation_versions where business_id = :'biz'), 'other businesses see no versions');
select tests.fails(format($$select public.automation_dry_run(%L, 'lead', %L)$$, :'wf', :'l1'), 'or dry-run them');
reset role;

-- ------------------------------------------------------------ dry runs never write
create temp table counts as
select (select count(*) from public.tasks) t, (select count(*) from public.notifications) n,
       (select count(*) from public.automation_runs) r, (select count(*) from public.automation_run_steps) s,
       (select count(*) from public.customer_tags) ct, (select count(*) from private.email_outbox) e,
       (select count(*) from public.webhook_events) w, (select count(*) from public.audit_logs) a,
       (select count(*) from public.leads where owner_id is not null) o;
select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
select public.automation_dry_run(:'wf', 'lead', :'l1') as dry \gset
select tests.ok((:'dry'::jsonb -> 'steps' -> 0 ->> 'outcome') = 'yes'
                and (:'dry'::jsonb -> 'steps' -> 1 ->> 'summary') = 'Would tag the customer “VIP”.'
                and jsonb_array_length(:'dry'::jsonb -> 'steps') = 4,
                'a dry run shows the path and what each step would do');
select tests.ok((public.automation_dry_run(:'wf', 'lead', :'l2', jsonb_set(:'g1'::jsonb, '{nodes,1,conditions,0,value}', '"website"')) -> 'steps' -> 0 ->> 'outcome') = 'yes',
                'and can try an unsaved graph');
select public.automation_dry_run(a.id, 'lead', :'l2') from public.automations a where a.business_id = :'biz';
reset role;
select tests.ok((select (select count(*) from public.tasks) = t and (select count(*) from public.notifications) = n
                   and (select count(*) from public.automation_runs) = r and (select count(*) from public.automation_run_steps) = s
                   and (select count(*) from public.customer_tags) = ct and (select count(*) from private.email_outbox) = e
                   and (select count(*) from public.webhook_events) = w and (select count(*) from public.audit_logs) = a
                   and (select count(*) from public.leads where owner_id is not null) = o
                   from counts),
                'dry runs never write (tasks, notifications, runs, tags, email, webhooks, audit, owners)');

-- ------------------------------------------------------------ new steps: email, custom field, webhook, wait until
insert into public.custom_field_definitions (business_id, entity, key, label, field_type) values (:'biz', 'lead', 'stage_note', 'Stage note', 'text');
select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
select x -> 'endpoint' ->> 'id' as ep from (select public.create_webhook_endpoint(:'biz', 'https://hooks.omega.test/in', '{lead.created}') x) s \gset
update public.automations set is_active = false where business_id = :'biz';
select public.create_automation(:'biz', 'New steps', jsonb_build_object('nodes', jsonb_build_array(
  '{"id":"t","kind":"trigger","trigger":"lead_created","config":{},"next":"e"}'::jsonb,
  '{"id":"e","kind":"action","action":{"type":"send_email","to":"customer","subject":"Welcome to {{business_name}}, {{customer_name}}","body":"Your enquiry {{lead_number}} is with us."},"next":"cf"}'::jsonb,
  '{"id":"cf","kind":"action","action":{"type":"set_custom_field","entity":"lead","key":"stage_note","value":"emailed"},"next":"wh"}'::jsonb,
  jsonb_build_object('id', 'wh', 'kind', 'action', 'action', jsonb_build_object('type', 'call_webhook', 'endpoint_id', :'ep', 'label', 'New enquiry'), 'next', 'wu'),
  '{"id":"wu","kind":"wait_until","mode":"time","time":"23:59","next":"done"}'::jsonb,
  '{"id":"done","kind":"action","action":{"type":"add_tag","tag":"After wait-until"}}'::jsonb))) as wf2 \gset
select public.publish_automation(:'wf2');
update public.automations set is_active = true where id = :'wf2';
select public.create_lead(:'biz', '{"phone":"+919844000004","email":"neha@omega.test","full_name":"Neha"}') ->> 'lead_id' as l4 \gset
reset role;
set role service_role;
select tests.tick();
reset role;
select tests.ok((select payload ->> 'subject' = 'Welcome to Omega Outfitters, Neha' and to_email = 'neha@omega.test'
                   from private.email_outbox where template = 'automation_email'),
                'send email fills in the names and queues it');
select tests.ok((select (public.business_plan(:'biz') -> 'usage' ->> 'monthly_messages')::int >= 1
                   from (select set_config('request.jwt.claim.sub', :'wia', false)) x),
                'and counts it as a message for the plan');
select set_config('request.jwt.claim.sub', '', false);
select tests.ok((select custom_fields ->> 'stage_note' = 'emailed' from public.leads where id = :'l4'), 'update a custom field');
select tests.ok((select e.data ->> 'label' = 'New enquiry' and e.data -> 'lead' ->> 'id' = :'l4' and d.endpoint_id = :'ep'
                   from public.webhook_events e join public.webhook_deliveries d on d.event_id = e.id where e.type = 'automation.called'),
                'call a webhook sends a signed automation.called event to that endpoint');
select tests.ok((select status = 'waiting' and node_id = 'done' and run_at > now() from public.automation_runs where automation_id = :'wf2'),
                'wait until pauses until the time of day');
select tests.ok(private.wait_until_at('{"mode":"time","time":"10:00"}', 'Asia/Kolkata', '2027-06-01 09:00+05:30') = '2027-06-01 10:00+05:30'
                and private.wait_until_at('{"mode":"time","time":"10:00"}', 'Asia/Kolkata', '2027-06-01 11:00+05:30') = '2027-06-02 10:00+05:30',
                'later today, or tomorrow');
select tests.ok(private.wait_until_at('{"mode":"business_hours","open":"10:00","close":"20:00","days":[1,2,3,4,5,6]}', 'Asia/Kolkata', '2027-06-05 21:00+05:30') = '2027-06-07 10:00+05:30'
                and private.wait_until_at('{"mode":"business_hours","open":"10:00","close":"20:00","days":[1,2,3,4,5,6]}', 'Asia/Kolkata', '2027-06-04 12:00+05:30') = '2027-06-04 12:00+05:30',
                'business hours: now if open, otherwise the next opening (Saturday night → Monday)');

-- The plan's message allowance stops automation emails.
update public.businesses set plan_overrides = '{"monthly_messages": 1}' where id = :'biz';
select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
select public.create_lead(:'biz', '{"phone":"+919844000005","email":"om@omega.test","full_name":"Om"}') ->> 'lead_id' as l5 \gset
reset role;
set role service_role;
select tests.tick();
reset role;
select tests.ok((select count(*) = 0 from private.email_outbox where to_email = 'om@omega.test'), 'at the message limit, emails are not sent');
select tests.ok((select log @> '[{"node":"e","ok":false,"error":"monthly message limit reached"}]' and node_id = 'done'
                   from public.automation_runs where automation_id = :'wf2' and entity_id = :'l5'),
                'the step says why and the workflow carries on');
update public.businesses set plan_overrides = '{}' where id = :'biz';

-- ------------------------------------------------------------ wait for a reply
select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
update public.automations set is_active = false where business_id = :'biz';
select public.create_automation(:'biz', 'Reply or chase', '{"nodes": [
  {"id":"t","kind":"trigger","trigger":"lead_created","config":{},"next":"r"},
  {"id":"r","kind":"wait_for_reply","timeout_minutes":60,"replied":"yes","timeout":"no"},
  {"id":"yes","kind":"action","action":{"type":"add_tag","tag":"Replied"}},
  {"id":"no","kind":"action","action":{"type":"add_tag","tag":"Silent"}}]}') as wf3 \gset
select public.publish_automation(:'wf3');
update public.automations set is_active = true where id = :'wf3';
select public.create_lead(:'biz', '{"phone":"+919844000006","full_name":"Replier"}') ->> 'lead_id' as l6 \gset
select public.create_lead(:'biz', '{"phone":"+919844000007","full_name":"Silent"}') ->> 'lead_id' as l7 \gset
reset role;
select customer_id as c6 from public.leads where id = :'l6' \gset
select customer_id as c7 from public.leads where id = :'l7' \gset
set role service_role;
select tests.tick();
reset role;
select tests.ok((select bool_and(status = 'waiting' and waiting_for = 'reply' and run_at > now() + interval '59 minutes')
                   from public.automation_runs where automation_id = :'wf3'),
                'a run waits for the customer to reply');
insert into public.whatsapp_accounts (business_id, waba_id, phone_number_id) values (:'biz', '986000001', '986000002') returning id as acct \gset
insert into public.conversations (business_id, account_id, customer_id) values (:'biz', :'acct', :'c6') returning id as conv \gset
insert into public.messages (business_id, conversation_id, direction, type, body, status) values (:'biz', :'conv', 'inbound', 'text', 'Yes please', 'received');
select tests.ok((select run_at <= now() from public.automation_runs where automation_id = :'wf3' and entity_id = :'l6'),
                'a reply wakes it at once');
set role service_role;
select tests.tick();
reset role;
select tests.ok((select count(*) = 1 from public.customer_tags ct join public.tags t on t.id = ct.tag_id where ct.customer_id = :'c6' and t.name = 'Replied'),
                'and it takes the replied branch');
select tests.ok((select status = 'waiting' from public.automation_runs where automation_id = :'wf3' and entity_id = :'l7'),
                'without a reply it keeps waiting');
update public.automation_runs set run_at = now() - interval '1 second' where automation_id = :'wf3' and entity_id = :'l7';
set role service_role;
select tests.tick();
reset role;
select tests.ok((select count(*) = 1 from public.customer_tags ct join public.tags t on t.id = ct.tag_id where ct.customer_id = :'c7' and t.name = 'Silent'),
                'until the timeout branch');
select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
select tests.ok((select (s -> 'nodes' -> 'r' ->> 'replied')::int = 1 and (s -> 'nodes' -> 'r' ->> 'timeout')::int = 1
                   from (select public.automation_step_stats(:'wf3') s) x),
                'replies and timeouts are counted');
reset role;

-- ------------------------------------------------------------ loop guards
select set_config('request.jwt.claim.sub', :'wia', false);
set role authenticated;
update public.automations set is_active = false where business_id = :'biz';
-- A: any stage change → contacted. B: contacted → qualified. Each would re-trigger the other forever.
select public.create_automation(:'biz', 'Ping', '{"nodes": [
  {"id":"t","kind":"trigger","trigger":"lead_status_changed","config":{},"next":"a"},
  {"id":"a","kind":"action","action":{"type":"change_status","status_key":"contacted"}}]}') as wa \gset
select public.create_automation(:'biz', 'Pong', '{"nodes": [
  {"id":"t","kind":"trigger","trigger":"lead_status_changed","config":{"status_key":"contacted"},"next":"a"},
  {"id":"a","kind":"action","action":{"type":"change_status","status_key":"qualified"}}]}') as wb \gset
select public.publish_automation(:'wa'), public.publish_automation(:'wb');
update public.automations set is_active = true where id in (:'wa', :'wb');
update public.leads set status_id = (select id from public.lead_statuses where business_id = :'biz' and key = 'interested') where id = :'l1';
reset role;
set role service_role;
select tests.tick();
select tests.tick();
select tests.tick();
reset role;
select tests.ok((select count(*) = 1 from public.automation_runs where automation_id = :'wa' and entity_id = :'l1')
                and (select count(*) = 1 from public.automation_runs where automation_id = :'wb' and entity_id = :'l1'),
                'automations triggered by an automation cannot start it again (no ping-pong)');
select tests.ok((select chain = array[:'wa'::uuid] from public.automation_runs where automation_id = :'wb' and entity_id = :'l1'),
                'the run records which automation started it');
update public.automations set is_active = false where id in (:'wa', :'wb');

-- A graph that loops (only possible by bypassing validation) stops after 100 steps.
insert into public.automation_versions (business_id, automation_id, version, graph, trigger)
values (:'biz', :'wa', 99, '{"nodes": [
  {"id":"t","kind":"trigger","trigger":"lead_created","next":"x"},
  {"id":"x","kind":"condition","conditions":[{"field":"has_phone","op":"is_true"}],"yes":"y"},
  {"id":"y","kind":"condition","conditions":[{"field":"has_phone","op":"is_true"}],"yes":"x"}]}', 'lead_created')
returning id as loopv \gset
insert into public.automation_runs (business_id, automation_id, entity_type, entity_id, version_id)
values (:'biz', :'wa', 'lead', :'l2', :'loopv') returning id as looprun \gset
update public.automations set is_active = true where id = :'wa';
set role service_role;
select public.step_automation_run(:'looprun');
reset role;
update public.automations set is_active = false where id = :'wa';
select tests.ok((select status = 'failed' and error = 'stopped after 100 steps' from public.automation_runs where id = :'looprun'),
                'a run takes at most 100 steps');

\echo 'workflows: all checks passed'
