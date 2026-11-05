-- Times the queries behind the busiest screens and jobs against the seeded data.
-- Each query runs as a real signed-in user (RLS applies) and reports the median of 5 runs.
\set ON_ERROR_STOP on
\set QUIET on

create schema if not exists loadtest;
grant usage on schema loadtest to anon, authenticated, service_role;
create table if not exists loadtest.results (label text, role text, median_ms numeric, budget_ms int);
grant insert on loadtest.results to anon, authenticated, service_role;

create or replace function loadtest.bench(p_label text, p_sql text, p_budget_ms int default 300, p_runs int default 5)
returns void language plpgsql as $$
declare
  t timestamptz;
  times numeric[] := '{}';
  i int;
begin
  for i in 1..p_runs loop
    t := clock_timestamp();
    execute p_sql;
    times := times || extract(milliseconds from clock_timestamp() - t)::numeric;
  end loop;
  insert into loadtest.results values (p_label, current_user,
    (select percentile_cont(0.5) within group (order by x) from unnest(times) x)::numeric(10,1), p_budget_ms);
end $$;
grant execute on function loadtest.bench(text, text, int, int) to anon, authenticated, service_role;

\o /dev/null
select id as biz from public.businesses where slug = 'load-test' \gset
select id as camp from public.campaigns where business_id = :'biz' and name = 'Load campaign' \gset
\set admin '50000000-0000-0000-0000-000000000000'
\set rep   '50000000-0000-0000-0000-000000000001'
select set_config('load.biz', :'biz', false), set_config('load.camp', :'camp', false);

-- ------------------------------------------------------------ as the business admin
select set_config('request.jwt.claim.sub', :'admin', false);
set role authenticated;
select loadtest.bench('lead list, page 1 (recent activity)', $q$
  select id, lead_number, title, score, status_id, owner_id, customer_id from public.leads
   where business_id = current_setting('load.biz')::uuid and archived_at is null
   order by last_activity_at desc limit 25 offset 0$q$);
select loadtest.bench('lead list, page 200', $q$
  select id from public.leads where business_id = current_setting('load.biz')::uuid and archived_at is null
   order by last_activity_at desc limit 25 offset 5000$q$);
select loadtest.bench('lead list, hottest first', $q$
  select id, score from public.leads where business_id = current_setting('load.biz')::uuid and archived_at is null
   order by score desc, last_activity_at desc limit 25$q$);
select loadtest.bench('lead list total count', $q$
  select count(*) from public.leads where business_id = current_setting('load.biz')::uuid and archived_at is null$q$, 500);
select loadtest.bench('customer search by phone', $q$
  select c.id from public.customer_contacts cc join public.customers c on c.id = cc.customer_id
   where cc.business_id = current_setting('load.biz')::uuid and cc.kind = 'phone' and cc.value = '+919800054321'$q$, 50);
select loadtest.bench('customer search by name prefix', $q$
  select id, full_name from public.customers
   where business_id = current_setting('load.biz')::uuid and lower(full_name) like 'customer 5432%' limit 25$q$);
select loadtest.bench('customer list, newest', $q$
  select id, full_name from public.customers
   where business_id = current_setting('load.biz')::uuid and merged_into_id is null order by created_at desc limit 25$q$);
select loadtest.bench('customer purchase history', $q$
  select * from public.customer_value where business_id = current_setting('load.biz')::uuid
   and customer_id = (select id from public.customers where cif_number = 'CIF-L4242' and business_id = current_setting('load.biz')::uuid)$q$, 100);
select loadtest.bench('order list, newest with balances', $q$
  select * from public.order_balances where business_id = current_setting('load.biz')::uuid order by order_id limit 25$q$);
select loadtest.bench('analytics summary, 30 days', $q$
  select public.analytics_summary(current_setting('load.biz')::uuid, current_date - 30, current_date)$q$, 1000);
select loadtest.bench('analytics summary, 12 months', $q$
  select public.analytics_summary(current_setting('load.biz')::uuid, current_date - 365, current_date)$q$, 2000);
select loadtest.bench('breakdown by source, 12 months', $q$
  select public.analytics_breakdown(current_setting('load.biz')::uuid, current_date - 365, current_date, 'source')$q$, 2000);
select loadtest.bench('breakdown by owner, 12 months', $q$
  select public.analytics_breakdown(current_setting('load.biz')::uuid, current_date - 365, current_date, 'owner')$q$, 2000);
select loadtest.bench('PIC performance, 90 days', $q$
  select * from public.pic_performance(current_setting('load.biz')::uuid, current_date - 90, current_date)$q$, 2000);
select loadtest.bench('operations summary', $q$
  select public.operations_summary(current_setting('load.biz')::uuid)$q$, 1000);
select loadtest.bench('branch comparison, 12 months', $q$
  select count(*) from public.branch_comparison(current_setting('load.biz')::uuid, current_date - 365, current_date)$q$, 2000);
select loadtest.bench('branch comparison, 30 days', $q$
  select count(*) from public.branch_comparison(current_setting('load.biz')::uuid, current_date - 30, current_date)$q$, 1000);
select loadtest.bench('team report for a branch, 90 days', $q$
  select count(*) from public.team_performance(current_setting('load.biz')::uuid,
    (select id from public.branches where business_id = current_setting('load.biz')::uuid order by name limit 1), current_date - 90, current_date)$q$, 1000);
select loadtest.bench('lead transfers, 12 months', $q$
  select count(*) from public.transfer_report(current_setting('load.biz')::uuid, current_date - 365, current_date)$q$, 1000);
select loadtest.bench('leaderboard, this month', $q$
  select count(*) from public.leaderboard(current_setting('load.biz')::uuid, date_trunc('month', current_date)::date, current_date)$q$, 1000);
insert into public.targets (business_id, scope, branch_id, period_type, period_start, metric, target, created_by)
select current_setting('load.biz')::uuid, 'branch', b.id, 'month', date_trunc('month', current_date), m, 100, auth.uid()
  from public.branches b cross join unnest(array['leads_handled', 'conversions', 'revenue', 'collections']) m
 where b.business_id = current_setting('load.biz')::uuid
on conflict do nothing;
select loadtest.bench('targets: 40 branch targets with progress', $q$
  select count(*) from public.target_progress(current_setting('load.biz')::uuid)$q$, 1000);
select loadtest.bench('campaign audience estimate (all)', $q$
  select public.audience_estimate(current_setting('load.biz')::uuid, '{}')$q$, 2000);
select loadtest.bench('launch a 60k-recipient campaign', $q$
  select public.launch_campaign(current_setting('load.camp')::uuid)$q$, 30000, 1);
reset role;

-- ------------------------------------------------------------ as a sales executive (own leads only)
select set_config('request.jwt.claim.sub', :'rep', false);
set role authenticated;
select loadtest.bench('rep: my leads, page 1', $q$
  select id from public.leads where business_id = current_setting('load.biz')::uuid and archived_at is null
   order by last_activity_at desc limit 25$q$);
select loadtest.bench('rep: my lead count', $q$
  select count(*) from public.leads where business_id = current_setting('load.biz')::uuid and archived_at is null$q$, 500);
select loadtest.bench('rep: today''s tasks', $q$
  select id, title, due_at from public.tasks where business_id = current_setting('load.biz')::uuid
   and assignee_id = auth.uid() and completed_at is null and cancelled_at is null and due_at < current_date + 1
   order by due_at limit 100$q$, 100);
reset role;

-- ------------------------------------------------------------ public API (a partner's key) and webhooks
select set_config('request.jwt.claim.sub', :'admin', false);
set role authenticated;
select public.create_api_key(:'biz', 'Load', '{leads:read,leads:write,customers:read,orders:read}') as loadkey \gset
select public.create_webhook_endpoint(:'biz', 'https://hooks.load.test/in', '{lead.created,lead.stage_changed,order.created}');
reset role;
select set_config('load.key', :'loadkey', false);
select set_config('load.cursor_t', updated_at::text, false), set_config('load.cursor_id', id::text, false)
  from public.leads where business_id = :'biz' order by updated_at, id offset 75000 limit 1;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select loadtest.bench('api: leads, first page of 100', $q$
  select public.api_list(current_setting('load.key'), 'leads', p_limit => 100)$q$, 300);
select loadtest.bench('api: leads, page 750 by cursor', $q$
  select public.api_list(current_setting('load.key'), 'leads', current_setting('load.cursor_t')::timestamptz,
                         current_setting('load.cursor_id')::uuid, p_limit => 100)$q$, 300);
select loadtest.bench('api: customers changed in the last day', $q$
  select public.api_list(current_setting('load.key'), 'customers', p_updated_since => now() - interval '1 day', p_limit => 100)$q$, 300);
select loadtest.bench('api: orders, page of 100 with lines', $q$
  select public.api_list(current_setting('load.key'), 'orders', p_limit => 100)$q$, 500);
select loadtest.bench('api: 20 leads in, webhook listening', $q$
  select count(public.api_submit_lead(current_setting('load.key'), null, 'h' || g,
           jsonb_build_object('phone', '+9197' || lpad((random() * 99999999)::int::text, 8, '0'), 'full_name', 'API ' || g)))
    from generate_series(1, 20) g$q$, 2000, 3);
reset role;
set role service_role;
select loadtest.bench('webhooks: claim 50 deliveries', $q$
  select count(*) from public.claim_webhook_deliveries(50)$q$, 500, 3);
reset role;

-- ------------------------------------------------------------ campaign send queue (job runner)
set role service_role;
select loadtest.bench('claim 1,000 campaign recipients', $q$
  select count(*) from public.claim_campaign_batch(1000, 5)$q$, 2000, 5);
select loadtest.bench('record 200 campaign sends', $q$
  select public.record_campaign_send(r.id, 'wamid.L' || r.id, 'Hi')
    from public.campaign_recipients r
   where r.campaign_id = current_setting('load.camp')::uuid and r.status = 'sending' limit 200$q$, 5000, 3);
reset role;

\o
\echo 'Load test results (median of runs, ms):'
select rpad(label, 40) || lpad(median_ms::text, 9) || '  / ' || budget_ms || case when median_ms > budget_ms then '  OVER' else '' end as result
  from loadtest.results order by ctid;
select count(*) filter (where median_ms > budget_ms) as over_budget from loadtest.results \gset
\echo 'queries over budget:' :over_budget
