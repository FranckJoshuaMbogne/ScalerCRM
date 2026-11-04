-- Load-test data: one business with 100k customers, 150k leads, 60k orders,
-- 50k tasks and 60k WhatsApp opt-ins. Run on a DISPOSABLE database only
-- (scripts/load-test.sh creates one). Never point this at production.
\set ON_ERROR_STOP on
\set QUIET on
\timing off

\set admin '50000000-0000-0000-0000-000000000000'
insert into auth.users (id, email, raw_user_meta_data) values (:'admin', 'admin@load.test', '{"full_name":"Load Admin"}');
insert into auth.users (id, email, raw_user_meta_data)
select ('50000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'rep' || g || '@load.test',
       jsonb_build_object('full_name', 'Rep ' || g)
  from generate_series(1, 10) g;

select set_config('request.jwt.claim.sub', :'admin', false) \gset
set role authenticated;
select public.create_business('Load Test Tailors', 'load-test', 'Main') as biz \gset
reset role;
select set_config('load.biz', :'biz', false) \gset
-- No plan limits in the load test (Sprint 10): it sends a 60,000-message campaign.
update public.businesses set plan_key = 'enterprise', trial_ends_at = null where id = :'biz';
select id as branch from public.branches where business_id = :'biz' limit 1 \gset

insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', ('50000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, r.id, 'active', now()
  from generate_series(1, 10) g
  join public.roles r on r.key = 'sales_executive' and r.business_id is null;

\echo 'customers…'
insert into public.customers (business_id, cif_number, full_name, primary_phone, branch_id, created_by, created_at)
select :'biz', 'CIF-L' || g, 'Customer ' || g, '+9198' || lpad(g::text, 8, '0'), :'branch', :'admin',
       now() - (random() * interval '730 days')
  from generate_series(1, 100000) g;
insert into public.customer_contacts (business_id, customer_id, kind, value, is_primary, created_by)
select business_id, id, 'phone', primary_phone, true, :'admin' from public.customers where business_id = :'biz';

create temp table load_customers as
select row_number() over () as n, id from public.customers where business_id = :'biz';
create index on load_customers (n);

\echo 'leads…'
-- Seeding only: per-row lead triggers (scoring, timeline, touchpoints) cost about 3 ms a lead,
-- which is fine live but makes 150k rows slow to seed. They're switched off for this one
-- statement and the score is filled in afterwards in one pass. Needs a superuser.
begin;
set local session_replication_role = replica;
insert into public.leads (business_id, lead_number, customer_id, branch_id, status_id, owner_id, title, expected_value,
                          first_source_id, latest_source_id, closed_at, created_by, created_at, last_activity_at)
select :'biz', 'L-L' || t.g, c.id, :'branch', s.id,
       ('50000000-0000-0000-0000-0000000000' || lpad((1 + t.g % 10)::text, 2, '0'))::uuid,
       'Enquiry ' || t.g, round((random() * 50000)::numeric, 2), src.id, src.id,
       case when s.category <> 'open' then t.created + interval '10 days' end, :'admin', t.created, t.created
  from (select g, now() - (random() * interval '730 days') as created from generate_series(1, 150000) g) t
  join load_customers c on c.n = 1 + (t.g * 7919) % 100000
  join lateral (select id, category from public.lead_statuses where business_id = :'biz' and t.g > 0
                order by id offset (t.g % 12) limit 1) s on true
  join lateral (select id from public.lead_sources where business_id = :'biz' and t.g > 0
                order by id offset (t.g % 9) limit 1) src on true;
commit;

\echo 'orders…'
select id as open_stage from public.order_stages where business_id = :'biz' and category = 'open' order by position limit 1 \gset
select id as delivered from public.order_stages where business_id = :'biz' and key = 'delivered' \gset
insert into public.orders (business_id, order_number, customer_id, branch_id, owner_id, stage_id, created_by, created_at)
select :'biz', 'O-L' || g, c.id, :'branch',
       ('50000000-0000-0000-0000-0000000000' || lpad((1 + g % 10)::text, 2, '0'))::uuid, :'open_stage', :'admin',
       now() - (random() * interval '700 days')
  from generate_series(1, 60000) g
  join load_customers c on c.n = 1 + (g::bigint * 104729) % 100000;
insert into public.order_items (business_id, order_id, position, description, quantity, unit_price)
select business_id, id, 1, 'Suit', 1, 5000 + (random() * 40000)::int from public.orders where business_id = :'biz';
select set_config('request.jwt.claim.sub', :'admin', false) \gset
insert into public.payments (business_id, order_id, customer_id, kind, amount, method, received_at)
select business_id, id, customer_id, 'payment', round(total * 0.6, 2), 'upi', created_at from public.orders where business_id = :'biz';
update public.orders set stage_id = :'delivered' where business_id = :'biz' and random() < 0.7;

\echo 'tasks…'
-- Each task also updates (and rescores) its lead, about 10 ms a task; bulk-load with triggers off.
begin;
set local session_replication_role = replica;
insert into public.tasks (business_id, lead_id, customer_id, branch_id, title, due_at, assignee_id, created_by)
select l.business_id, l.id, l.customer_id, l.branch_id, 'Follow up', now() + ((random() * 20) - 10) * interval '1 day', l.owner_id, :'admin'
  from public.leads l where l.business_id = :'biz' and random() < 0.34;
commit;

\echo 'whatsapp opt-ins and a campaign…'
insert into public.customer_consents (business_id, customer_id, channel, purpose, status, source, captured_by)
select :'biz', id, 'whatsapp', 'marketing', 'opted_in', 'manual', :'admin' from load_customers where n <= 60000;
set role authenticated;
select public.connect_whatsapp_account(:'biz', '{"waba_id":"900800700","phone_number_id":"990000111","access_token":"EAAG-load-token-0123456789"}') as acct \gset
insert into public.whatsapp_templates (business_id, waba_id, name, language, category, components, variable_count, created_by)
values (:'biz', '900800700', 'load_offer', 'en', 'MARKETING', '{"body":{"text":"Hi {{1}}, new arrivals are in."}}', 1, :'admin')
returning id as tpl \gset
reset role;
update public.whatsapp_templates set status = 'approved' where id = :'tpl';
set role authenticated;
insert into public.campaigns (business_id, name, account_id, template_id, variables, rate_per_minute, created_by)
values (:'biz', 'Load campaign', :'acct', :'tpl', '[{"source":"first_name"}]', 1000, :'admin') returning id as camp \gset
reset role;
select set_config('load.camp', :'camp', false) \gset

analyze;
select format('seeded: %s customers, %s leads, %s orders, %s tasks',
  (select count(*) from public.customers where business_id = :'biz'),
  (select count(*) from public.leads where business_id = :'biz'),
  (select count(*) from public.orders where business_id = :'biz'),
  (select count(*) from public.tasks where business_id = :'biz')) as summary \gset
\echo :summary
