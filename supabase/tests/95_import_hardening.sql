-- Imports, rate limits, export alerts, push subscriptions, heartbeats and health.
\set ON_ERROR_STOP on
\set QUIET on

\set ivy  '20000000-0000-0000-0000-000000000001'
\set sam  '20000000-0000-0000-0000-000000000002'
\set ora  '20000000-0000-0000-0000-000000000003'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ivy', 'ivy@iota.test', '{"full_name":"Ivy Admin"}'),
  (:'sam', 'sam@iota.test', '{"full_name":"Sam Sales"}'),
  (:'ora', 'ora@omega.test', '{"full_name":"Ora Other"}');

select set_config('request.jwt.claim.sub', :'ivy', false);
set role authenticated;
select public.create_business('Iota Tailors', 'iota-tailors', 'Main') as biz \gset
reset role;
select set_config('request.jwt.claim.sub', :'ora', false);
set role authenticated;
select public.create_business('Omega Store', 'omega-store', 'Pune') as other \gset
reset role;
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', :'sam', r.id, 'active', now() from public.roles r where r.key = 'sales_executive' and r.business_id is null;

select id as won from public.lead_statuses where business_id = :'biz' and key = 'won' \gset
select id as lost from public.lead_statuses where business_id = :'biz' and key = 'lost' \gset
select id as reason from public.lead_lost_reasons where business_id = :'biz' and name = 'Price too high' \gset
select id as src from public.lead_sources where business_id = :'biz' and key = 'walk_in' \gset
select id as delivered from public.order_stages where business_id = :'biz' and key = 'delivered' \gset

-- Make every new lead round-robin to Sam and switch on the "new lead" automation,
-- so the test can show imports skip both.
insert into public.round_robin_members (business_id, user_id) values (:'biz', :'sam');
insert into public.lead_assignment_settings (business_id, round_robin_enabled) values (:'biz', true)
  on conflict (business_id) do update set round_robin_enabled = true;
update public.automations set is_active = true where business_id = :'biz' and preset_key = 'new_lead_call';

-- ------------------------------------------------------------ permission
select set_config('request.jwt.claim.sub', :'sam', false);
set role authenticated;
select tests.fails(format($$select public.start_import(%L, 'customers', 'a.csv', 3)$$, :'biz'),
                   'only people with data.import can start an import');
reset role;

-- ------------------------------------------------------------ customers
select set_config('request.jwt.claim.sub', :'ivy', false);
set role authenticated;
select public.start_import(:'biz', 'customers', 'customers.csv', 4) as cjob \gset
select public.import_rows(:'cjob', jsonb_build_array(
  jsonb_build_object('row', 1, 'full_name', 'Asha Rao', 'phone', '+919800000001', 'email', 'asha@ex.test',
                     'gender', 'female', 'created_at', '2024-03-05T10:00:00+05:30', 'tags', jsonb_build_array('VIP', 'Bridal')),
  jsonb_build_object('row', 2, 'full_name', 'Asha R.', 'phone', '+919800000001'),
  jsonb_build_object('row', 3, 'full_name', 'Bad Number', 'phone', '98000'),
  jsonb_build_object('row', 4, 'full_name', 'Dev Shah', 'email', 'dev@ex.test', 'tags', jsonb_build_array('vip'))
)) as cres \gset
select tests.ok((:'cres'::jsonb ->> 'created')::int = 2 and (:'cres'::jsonb ->> 'matched')::int = 1
                and (:'cres'::jsonb ->> 'failed')::int = 1, 'customer rows are created, matched or failed');
select tests.ok((:'cres'::jsonb -> 'errors' -> 0 ->> 'row')::int = 3, 'the failed row is reported with its number');
select tests.ok((select created_at::date = '2024-03-05' and gender = 'female' from public.customers
                  where business_id = :'biz' and full_name = 'Asha Rao'), 'imported customers keep their original date');
select tests.ok((select count(*) = 1 from public.customers where business_id = :'biz' and full_name like 'Asha%'),
                'a repeated phone number matches the same customer file');
select tests.ok((select count(*) = 2 from public.tags where business_id = :'biz'), 'tags are created once, ignoring case');
select tests.ok((select count(*) = 0 from public.customer_events e join public.customers c on c.id = e.customer_id
                  where c.business_id = :'biz' and e.type = 'updated'), 'back-dating adds no "updated" entries');

select public.import_rows(:'cjob', jsonb_build_array(jsonb_build_object('row', 1, 'full_name', 'Asha Rao', 'phone', '+919800000001'))) as again \gset
select tests.ok((:'again'::jsonb ->> 'created')::int = 0 and (:'again'::jsonb ->> 'matched')::int = 0,
                'retrying a batch skips rows already processed');
select tests.fails(format($$select public.import_rows(%L, '[{"row": 9}]')$$, :'cjob'), 'row numbers beyond the file are refused');
select (public.finish_import(:'cjob')).status as cstatus \gset
select tests.ok(:'cstatus' = 'done', 'finishing marks the job done');
select tests.fails(format($$select public.import_rows(%L, '[{"row": 1}]')$$, :'cjob'), 'a finished job takes no more rows');
reset role;
select tests.ok((select count(*) = 1 from public.audit_logs where business_id = :'biz' and action = 'import'
                  and (changes ->> 'created')::int = 2), 'the import is in the audit log');

-- ------------------------------------------------------------ leads
select set_config('request.jwt.claim.sub', :'ivy', false);
set role authenticated;
select public.start_import(:'biz', 'leads', 'leads.csv', 4) as ljob \gset
select public.import_rows(:'ljob', jsonb_build_array(
  jsonb_build_object('row', 1, 'external_ref', 'MPF-L1', 'full_name', 'Kiran', 'phone', '+919800000011',
                     'status_id', :'won', 'source_id', :'src', 'owner_id', :'sam', 'expected_value', '12500.50',
                     'created_at', '2024-01-10', 'closed_at', '2024-02-01'),
  jsonb_build_object('row', 2, 'external_ref', 'MPF-L2', 'full_name', 'Lata', 'phone', '+919800000012',
                     'status_id', :'lost', 'lost_reason_id', :'reason', 'created_at', '2024-01-11'),
  jsonb_build_object('row', 3, 'full_name', 'Open One', 'phone', '+919800000013', 'created_at', '2024-01-12'),
  jsonb_build_object('row', 4, 'full_name', 'Wrong Owner', 'phone', '+919800000014', 'owner_id', :'ora')
)) as lres \gset
select tests.ok((:'lres'::jsonb ->> 'created')::int = 3 and (:'lres'::jsonb ->> 'failed')::int = 1,
                'leads import, and an owner from another business is refused');
reset role;
select tests.ok((select l.closed_at::date = '2024-02-01' and l.created_at::date = '2024-01-10' and l.expected_value = 12500.50
                   and l.owner_id = :'sam'
                   from public.leads l where l.business_id = :'biz' and l.external_ref = 'MPF-L1'),
                'won leads keep their dates, value and owner');
select tests.ok((select lost_reason_id = :'reason' from public.leads where business_id = :'biz' and external_ref = 'MPF-L2'),
                'lost leads keep their reason');
select tests.ok((select l.owner_id is null from public.leads l join public.customers c on c.id = l.customer_id
                  where l.business_id = :'biz' and c.full_name = 'Open One'), 'imported leads are not round-robined');
select tests.ok((select count(*) = 0 from public.automation_runs where business_id = :'biz'), 'imports start no automations');
select tests.ok((select count(*) = 0 from public.notifications where business_id = :'biz' and type = 'lead_assigned'),
                'or owner notifications');

select set_config('request.jwt.claim.sub', :'ivy', false);
set role authenticated;
select public.start_import(:'biz', 'leads', 'leads-again.csv', 1) as ljob2 \gset
select public.import_rows(:'ljob2', jsonb_build_array(jsonb_build_object('row', 1, 'external_ref', 'MPF-L1', 'phone', '+919800000011'))) as l2 \gset
select tests.ok((:'l2'::jsonb ->> 'skipped')::int = 1, 'a lead already imported (same reference) is skipped');
reset role;

-- Normal lead creation still round-robins and runs automations.
select set_config('request.jwt.claim.sub', :'ivy', false);
set role authenticated;
select public.create_lead(:'biz', '{"full_name": "Live Lead", "phone": "+919800000099"}') ->> 'lead_id' as live \gset
reset role;
select tests.ok((select owner_id = :'sam' from public.leads where id = :'live'), 'live leads are still round-robined');
select tests.ok((select count(*) > 0 from public.automation_runs where entity_id = :'live'), 'and still start automations');

-- ------------------------------------------------------------ orders
select set_config('request.jwt.claim.sub', :'ivy', false);
set role authenticated;
select public.start_import(:'biz', 'orders', 'orders.csv', 3) as ojob \gset
select public.import_rows(:'ojob', jsonb_build_array(
  jsonb_build_object('row', 1, 'external_ref', 'MPF-O1', 'full_name', 'Asha Rao', 'phone', '+919800000001',
                     'description', 'Bridal lehenga', 'total', '45000', 'paid', '45000', 'payment_method', 'upi',
                     'stage_id', :'delivered', 'created_at', '2024-04-01', 'closed_at', '2024-05-02'),
  jsonb_build_object('row', 2, 'external_ref', 'MPF-O2', 'phone', '+919800000021', 'total', '8000', 'paid', '3000',
                     'created_at', '2024-06-01'),
  jsonb_build_object('row', 3, 'phone', '+919800000022', 'total', '100', 'paid', '500')
)) as ores \gset
select tests.ok((:'ores'::jsonb ->> 'created')::int = 2 and (:'ores'::jsonb ->> 'failed')::int = 1,
                'orders import; paying more than the total is refused');
reset role;
select tests.ok((select o.total = 45000 and o.closed_at::date = '2024-05-02' and o.created_at::date = '2024-04-01'
                        and c.full_name = 'Asha Rao'
                   from public.orders o join public.customers c on c.id = o.customer_id
                  where o.business_id = :'biz' and o.external_ref = 'MPF-O1'),
                'delivered orders keep their total and dates, on the matched customer');
select tests.ok((select b.balance = 5000 from public.order_balances b join public.orders o on o.id = b.order_id
                  where o.external_ref = 'MPF-O2'), 'part-paid orders show the balance due');
select tests.ok((select p.received_at::date = '2024-06-01' and p.method = 'other' from public.payments p
                   join public.orders o on o.id = p.order_id where o.external_ref = 'MPF-O2'),
                'payments are dated with the order');

-- ------------------------------------------------------------ isolation
select set_config('request.jwt.claim.sub', :'ora', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.import_jobs where business_id = :'biz'), 'other businesses see no import jobs');
select tests.fails(format($$select public.import_rows(%L, '[{"row": 1, "phone": "+919800000077"}]')$$, :'ljob2'),
                   'or add rows to them');
reset role;

-- ------------------------------------------------------------ rate limits
select set_config('request.jwt.claim.sub', :'sam', false);
set role authenticated;
select tests.ok((select bool_and(public.export_allowed(:'biz')) from generate_series(1, 20)), 'twenty exports an hour are allowed');
select tests.ok(not public.export_allowed(:'biz'), 'the twenty-first is refused');
reset role;
select set_config('request.jwt.claim.sub', :'ivy', false);
set role authenticated;
select tests.ok(public.export_allowed(:'biz'), 'limits are per person');
select public.create_api_key(:'biz', 'Website') as apikey \gset
reset role;
set role anon;
-- Per plan since Sprint 13 (Growth, the trial plan: 300 a minute).
select tests.ok((select bool_and(public.api_rate_limit(:'apikey')) from generate_series(1, 300)), 'an API key gets its plan''s calls a minute');
select tests.ok(not public.api_rate_limit(:'apikey'), 'then is throttled');
select tests.ok(public.api_rate_limit('sk_unknown'), 'unknown keys are left to the API to refuse');
reset role;

-- ------------------------------------------------------------ large export alert
select set_config('request.jwt.claim.sub', :'sam', false);
set role authenticated;
select public.log_export(:'biz', 'customers', 50);
select public.log_export(:'biz', 'customers', 2500);
reset role;
select tests.ok((select count(*) = 1 from public.notifications where business_id = :'biz' and type = 'large_export'
                  and user_id = :'ivy'), 'a large export alerts the people who read the audit log, once');

-- ------------------------------------------------------------ push subscriptions
select set_config('request.jwt.claim.sub', :'sam', false);
set role authenticated;
select public.save_push_subscription('https://push.example.test/sam-phone', repeat('k', 87), repeat('a', 22), 'Android') as sub \gset
select tests.fails($$select public.save_push_subscription('http://insecure.test/x', repeat('k', 87), repeat('a', 22))$$,
                   'push endpoints must be https');
reset role;
select set_config('request.jwt.claim.sub', :'ivy', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.push_subscriptions), 'people only see their own devices');
reset role;

insert into public.notifications (business_id, user_id, type, title) values (:'biz', :'sam', 'test', 'Hello');
insert into public.notifications (business_id, user_id, type, title, created_at) values (:'biz', :'sam', 'test', 'Old', now() - interval '3 hours');
set role service_role;
select tests.ok((select count(*) = 1 from public.claim_push_batch(500) where subscription_id = :'sub'),
                'new notifications wake each device once');
select tests.ok((select count(*) = 0 from public.claim_push_batch(500)), 'and are not pushed twice');
select public.record_push_result(:'sub', 'gone');
reset role;
select tests.ok((select count(*) = 0 from public.push_subscriptions where id = :'sub'), 'devices the browser dropped are removed');
set role authenticated;
select tests.fails($$select * from public.claim_push_batch(10)$$, 'only the job runner claims pushes');
reset role;

-- ------------------------------------------------------------ heartbeats and health
set role anon;
select tests.ok((public.health() ->> 'jobs_ok')::boolean is false, 'health says jobs are not running before the first run');
reset role;
set role service_role;
select public.record_job_heartbeat('task_jobs', null, '{"mail": 0}');
select public.housekeeping();
reset role;
set role anon;
select tests.ok((public.health() ->> 'jobs_ok')::boolean and public.health() ->> 'database' = 'ok', 'health reports a recent job run');
select tests.ok(not (public.health() ? 'last_error'), 'health shows no error details to the public');
select tests.fails($$select public.record_job_heartbeat('x')$$, 'the public cannot record heartbeats');
reset role;

\echo 'imports and hardening: all checks passed'
