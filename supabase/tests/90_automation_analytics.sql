-- Automations, lead scoring, analytics definitions, saved views and scheduled reports.
\set ON_ERROR_STOP on
-- Analytics periods are business days in IST; current_date below must be the IST date.
set timezone to 'Asia/Kolkata';
\set QUIET on
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

\set pia  '10000000-0000-0000-0000-000000000001'
\set sven '10000000-0000-0000-0000-000000000002'
\set rho  '10000000-0000-0000-0000-000000000003'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'pia',  'pia@pi.test',  '{"full_name":"Pia Admin"}'),
  (:'sven', 'sven@pi.test', '{"full_name":"Sven Sales"}'),
  (:'rho',  'rho@rho.test', '{"full_name":"Rho Other"}');

select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select public.create_business('Pi Couture', 'pi-couture', 'Main') as biz \gset
reset role;
select set_config('request.jwt.claim.sub', :'rho', false);
set role authenticated;
select public.create_business('Rho Store', 'rho-store', 'Delhi') as other \gset
-- Established businesses (set up by Springs 360, not self-serve trials): no WhatsApp review.
reset role;
update public.businesses set trial_ends_at = null where id in (:'biz', :'other');
set role authenticated;
reset role;
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', :'sven', r.id, 'active', now() from public.roles r where r.key = 'sales_executive' and r.business_id is null;
select set_config('t.biz', :'biz', false);

-- ------------------------------------------------------------ presets
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select tests.ok((select count(*) = 6 and bool_and(not is_active) from public.automations where business_id = :'biz'),
                'every business gets six preset automations, switched off');
select tests.ok((select count(*) = 8 from public.lead_scoring_rules where business_id = :'biz'), 'and default scoring rules');
update public.automations set is_active = true where business_id = :'biz' and preset_key in ('new_lead_call', 'unassigned_alert', 'won_tag', 'no_show_followup');
insert into public.round_robin_members (business_id, user_id) values (:'biz', :'sven');
reset role;

-- ------------------------------------------------------------ lead created → task
select set_config('request.jwt.claim.sub', :'sven', false);
set role authenticated;
select public.create_lead(current_setting('t.biz')::uuid, '{"phone":"+919833000001","full_name":"Asha","source":"walk_in"}') as l1 \gset
select tests.ok((select count(*) = 0 from public.automations), 'sales staff cannot see automations');
reset role;
select (:'l1'::jsonb ->> 'lead_id') as lead1, (:'l1'::jsonb ->> 'customer_id') as cust1 \gset

set role service_role;
select count(*) as due from public.claim_automation_runs(100) \gset
select public.step_automation_run(r) from public.claim_automation_runs(100) r;
reset role;
select tests.ok((select count(*) = 1 from public.tasks where lead_id = :'lead1' and assignee_id = :'sven'
                   and title = 'Call the new lead' and due_at between now() + interval '14 minutes' and now() + interval '16 minutes'),
                'a new lead with an owner gets a call task due in 15 minutes');
select tests.ok((select count(*) = 1 from public.automation_runs r join public.automations a on a.id = r.automation_id
                  where r.entity_id = :'lead1' and a.preset_key = 'unassigned_alert' and r.status = 'skipped'),
                'automations whose conditions don''t match are skipped, and say why');
select tests.ok((select log -> 0 ->> 'ok' = 'true' from public.automation_runs r join public.automations a on a.id = r.automation_id
                  where r.entity_id = :'lead1' and a.preset_key = 'new_lead_call'),
                'each step is logged');

-- ------------------------------------------------------------ unassigned lead → wait → round-robin → notify
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select (public.create_lead(:'biz', '{"phone":"+919833000002","full_name":"Bina"}') ->> 'lead_id') as lead2 \gset
reset role;
set role service_role;
select public.step_automation_run(r) from public.claim_automation_runs(100) r;
reset role;
select tests.ok((select r.status = 'waiting' and r.run_at > now() + interval '9 minutes' from public.automation_runs r
                   join public.automations a on a.id = r.automation_id where r.entity_id = :'lead2' and a.preset_key = 'unassigned_alert'),
                'a wait step pauses the run');
update public.automation_runs set run_at = now() where entity_id = :'lead2' and status = 'waiting';
set role service_role;
select public.step_automation_run(r) from public.claim_automation_runs(100) r;
reset role;
select tests.ok((select owner_id = :'sven' from public.leads where id = :'lead2'), 'then it hands the lead out by round-robin');
select tests.ok((select count(*) = 1 from public.notifications where user_id = :'pia' and type = 'automation'),
                'and notifies managers');

-- ------------------------------------------------------------ status → tag; no-show → task
select id as won from public.lead_statuses where business_id = :'biz' and key = 'won' \gset
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
update public.leads set status_id = :'won' where id = :'lead1';
insert into public.appointments (business_id, customer_id, lead_id, kind, starts_at, ends_at, staff_id, created_by)
values (:'biz', :'cust1', :'lead1', 'trial', now() - interval '2 hours', now() - interval '1 hour', :'sven', :'pia') returning id as appt \gset
update public.appointments set status = 'no_show' where id = :'appt';
reset role;
set role service_role;
select public.step_automation_run(r) from public.claim_automation_runs(100) r;
reset role;
select tests.ok((select count(*) = 1 from public.customer_tags ct join public.tags t on t.id = ct.tag_id
                  where ct.customer_id = :'cust1' and t.name = 'Customer'),
                'converting a lead tags the customer');
select tests.ok((select count(*) = 1 from public.tasks where lead_id = :'lead1' and title = 'Missed appointment: call to rebook'),
                'a no-show creates a rebooking task');

-- ------------------------------------------------------------ idle leads, deduplicated
update public.automations set is_active = true where business_id = :'biz' and preset_key = 'idle_lead';
update public.leads set last_activity_at = now() - interval '5 days' where id = :'lead2';
set role service_role;
select public.step_automation_run(r) from public.claim_automation_runs(100) r;
select count(*) as again from public.claim_automation_runs(100) \gset
reset role;
select tests.ok((select count(*) = 1 from public.automation_runs r join public.automations a on a.id = r.automation_id
                  where a.preset_key = 'idle_lead' and r.entity_id = :'lead2'),
                'a quiet lead triggers the idle automation once per quiet spell');

-- ------------------------------------------------------------ failures, retries, external steps
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
insert into public.automations (business_id, name, trigger, actions, is_active, created_by)
values (:'biz', 'Task without owner', 'lead_created', '[{"type":"create_task","title":"x","assignee":"owner"}]', true, :'pia');
insert into public.automations (business_id, name, trigger, actions, is_active, created_by)
values (:'biz', 'Send template', 'lead_created', '[{"type":"send_whatsapp_template","template_id":"00000000-0000-0000-0000-000000000000"}]', true, :'pia');
update public.automations set is_active = false where business_id = :'biz' and preset_key = 'unassigned_alert';
select (public.create_lead(:'biz', '{"phone":"+919833000003","full_name":"Chitra"}') ->> 'lead_id') as lead3 \gset
reset role;
select r.id as ext_run from public.automation_runs r join public.automations a on a.id = r.automation_id
 where r.entity_id = :'lead3' and a.name = 'Send template' \gset
select r.id as bad_run from public.automation_runs r join public.automations a on a.id = r.automation_id
 where r.entity_id = :'lead3' and a.name = 'Task without owner' \gset
set role service_role;
select tests.ok((public.step_automation_run(:'ext_run') ->> 'status') = 'external', 'WhatsApp steps are handed to the app');
select tests.ok((public.automation_whatsapp_context(:'ext_run') ->> 'error') = 'template is not approved',
                'and only approved templates are sent');
select public.finish_automation_external(:'ext_run', 'template is not approved');
select public.step_automation_run(:'ext_run');
select public.step_automation_run(:'bad_run');
reset role;
select tests.ok((select status = 'done' from public.automation_runs where id = :'ext_run'), 'a failed send is logged and the run finishes');
select tests.ok((select status = 'waiting' and attempts = 1 and error like '%nobody to give the task to%' from public.automation_runs where id = :'bad_run'),
                'a failing step is retried later');
update public.automation_runs set attempts = 2, run_at = now() where id = :'bad_run';
set role service_role;
select public.step_automation_run(:'bad_run');
reset role;
select tests.ok((select status = 'failed' from public.automation_runs where id = :'bad_run'), 'and fails after three attempts');
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select tests.ok(public.retry_automation_runs(:'biz') >= 1, 'failed runs can be retried');
reset role;

-- ------------------------------------------------------------ scoring
select tests.ok((select score >= 20 from public.leads where id = :'lead1'), 'a walk-in scores points');
select score as s_before from public.leads where id = :'lead2' \gset
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
update public.leads set status_id = (select id from public.lead_statuses where business_id = :'biz' and key = 'negotiation') where id = :'lead2';
reset role;
select tests.ok((select score = :'s_before'::int + 25 from public.leads where id = :'lead2'), 'moving to negotiation adds its points');
select tests.ok((select count(*) = 0 from public.lead_activities where lead_id = :'lead2' and type = 'updated' and meta -> 'changes' ? 'score'),
                'score changes stay off the timeline');
select set_config('request.jwt.claim.sub', :'sven', false);
set role authenticated;
select tests.fails(format('update public.leads set score = 99 where id = %L', :'lead2'), 'the score cannot be set by hand');
reset role;

-- ------------------------------------------------------------ analytics
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select public.analytics_summary(:'biz', current_date - 1, current_date) as summary \gset
select tests.ok((:'summary'::jsonb ->> 'leads')::int = 3 and (:'summary'::jsonb ->> 'leads_won')::int = 1
                and (:'summary'::jsonb ->> 'conversion_rate')::numeric = 33.3,
                'conversion counts leads created in the period that are won');
select tests.ok((select sum(leads) = 3 from public.analytics_breakdown(:'biz', current_date - 1, current_date, 'source')),
                'the breakdown reconciles with the summary');
select tests.ok((select leads = 2 from public.pic_performance(:'biz', current_date - 1, current_date, 0) where owner_id = :'sven'),
                'PIC performance counts each person''s leads');
select tests.ok((public.operations_summary(:'biz') ? 'overdue_deliveries'), 'operations figures are available');
insert into public.saved_views (business_id, user_id, page, name, query, shared) values (:'biz', :'pia', 'leads', 'Hot', 'status=x', true);
insert into public.saved_views (business_id, user_id, page, name, query) values (:'biz', :'pia', 'leads', 'Mine only', 'owner=me');
insert into public.report_schedules (business_id, user_id, report, frequency, next_run_at)
values (:'biz', :'pia', 'executive', 'weekly', now() - interval '1 minute');
reset role;

select set_config('request.jwt.claim.sub', :'sven', false);
set role authenticated;
select tests.ok((public.analytics_summary(current_setting('t.biz')::uuid, current_date - 1, current_date) ->> 'revenue') is null,
                'people without sales or financial analytics don''t see money');
select tests.fails(format('select * from public.analytics_breakdown(%L, current_date, current_date, %L)', current_setting('t.biz'), 'source'),
                   'breakdowns need analytics access');
select tests.ok((select count(*) = 1 from public.saved_views), 'shared views are visible to the team, private ones are not');
reset role;

set role service_role;
select count(*) as claimed from public.claim_report_schedules(10) \gset
select count(*) as claimed_again from public.claim_report_schedules(10) \gset
reset role;
select tests.ok(:'claimed' = 1 and :'claimed_again' = 0, 'a due report is claimed once and rescheduled');

select set_config('request.jwt.claim.sub', :'rho', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.automation_runs), 'other tenant sees no automation runs');
select tests.ok((select count(*) = 0 from public.lead_scoring_rules where business_id = current_setting('t.biz')::uuid), 'or scoring rules');
select tests.fails(format('select public.analytics_summary(%L, current_date, current_date)', current_setting('t.biz')),
                   'or another business''s analytics');
reset role;

\echo 'automation and analytics: all checks passed'
