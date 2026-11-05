-- Multi-branch reporting: rollups that match live data, branch totals that add up
-- to the business, branch visibility, targets, the leaderboard, transfers and packs.
\set ON_ERROR_STOP on
\set QUIET on
set timezone to 'Asia/Kolkata';

\set own '62000000-0000-0000-0000-000000000001'
\set mga '62000000-0000-0000-0000-000000000002'
\set ra  '62000000-0000-0000-0000-000000000003'
\set rb  '62000000-0000-0000-0000-000000000004'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'own', 'own@sigma-br.test', '{"full_name":"Owen Owner"}'),
  (:'mga', 'mga@sigma-br.test', '{"full_name":"Mona Manager"}'),
  (:'ra',  'ra@sigma-br.test',  '{"full_name":"Asha A"}'),
  (:'rb',  'rb@sigma-br.test',  '{"full_name":"Bala B"}');

select set_config('request.jwt.claim.sub', :'own', false);
set role authenticated;
select public.create_business('Sigma Branches', 'sigma-branches', 'Central') as biz \gset
reset role;
update public.businesses set trial_ends_at = null where id = :'biz';
select id as br_a from public.branches where business_id = :'biz' \gset
insert into public.branches (business_id, name) values (:'biz', 'East') returning id as br_b \gset

-- A store manager limited to Central; one salesperson in each branch.
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at, all_branches)
select :'biz', u.id, r.id, 'active', now(), false
  from (values (:'mga'::uuid, 'store_manager'), (:'ra'::uuid, 'sales_executive'), (:'rb'::uuid, 'sales_executive')) u(id, role)
  join public.roles r on r.key = u.role and r.business_id is null;
insert into public.user_branch_access (membership_id, branch_id)
select m.id, case when m.user_id = :'rb' then :'br_b'::uuid else :'br_a'::uuid end
  from public.business_memberships m where m.business_id = :'biz' and m.user_id in (:'mga', :'ra', :'rb');

select id as walk_in from public.lead_sources where business_id = :'biz' and key = 'walk_in' \gset
select id as website from public.lead_sources where business_id = :'biz' and key = 'website' \gset
select id as st_won from public.lead_statuses where business_id = :'biz' and key = 'won' \gset
select id as st_new from public.lead_statuses where business_id = :'biz' and is_default \gset
select id as stage_open from public.order_stages where business_id = :'biz' and category = 'open' order by position limit 1 \gset

-- 40 leads over the last 400 days: Central gets walk-ins (convert well), East gets website leads.
insert into public.customers (business_id, cif_number, full_name, branch_id, created_by)
select :'biz', 'CIF-BR' || g, 'Customer ' || g, case when g % 2 = 0 then :'br_a'::uuid else :'br_b'::uuid end, :'own'
  from generate_series(1, 40) g;
-- Imported history (the importer's switch lets leads start in a closed stage).
select set_config('scaler.importing', 'on', false);
insert into public.leads (business_id, lead_number, customer_id, branch_id, status_id, owner_id, first_source_id, latest_source_id,
                          closed_at, created_by, created_at, last_activity_at)
select :'biz', 'L-BR' || g, c.id, c.branch_id,
       case when (c.branch_id = :'br_a' and g % 4 = 0) or (c.branch_id = :'br_b' and g % 10 = 1) then :'st_won'::uuid else :'st_new'::uuid end,
       case when c.branch_id = :'br_a' then :'ra'::uuid else :'rb'::uuid end,
       case when c.branch_id = :'br_a' then :'walk_in'::uuid else :'website'::uuid end,
       case when c.branch_id = :'br_a' then :'walk_in'::uuid else :'website'::uuid end,
       case when (c.branch_id = :'br_a' and g % 4 = 0) or (c.branch_id = :'br_b' and g % 10 = 1) then now() - (g * interval '10 days') + interval '3 days' end,
       :'own', now() - (g * interval '10 days'), now() - (g * interval '10 days')
  from generate_series(1, 40) g join public.customers c on c.business_id = :'biz' and c.cif_number = 'CIF-BR' || g;
select set_config('scaler.importing', '', false);
insert into public.orders (business_id, order_number, customer_id, branch_id, owner_id, stage_id, created_by, created_at)
select :'biz', 'O-BR' || g, c.id, c.branch_id, case when c.branch_id = :'br_a' then :'ra'::uuid else :'rb'::uuid end,
       :'stage_open', :'own', now() - (g * interval '20 days')
  from generate_series(1, 15) g join public.customers c on c.business_id = :'biz' and c.cif_number = 'CIF-BR' || g;
insert into public.order_items (business_id, order_id, position, description, quantity, unit_price)
select business_id, id, 1, 'Suit', 1, 10000 from public.orders where business_id = :'biz';
insert into public.payments (business_id, order_id, customer_id, amount, method, received_at)
select business_id, id, customer_id, 4000, 'upi', created_at + interval '1 day' from public.orders where business_id = :'biz';
insert into public.walk_ins (business_id, branch_id, customer_id, visited_at)
select :'biz', c.branch_id, c.id, now() - (g * interval '15 days')
  from generate_series(1, 20) g join public.customers c on c.business_id = :'biz' and c.cif_number = 'CIF-BR' || g;
insert into public.appointments (business_id, branch_id, customer_id, starts_at, ends_at, status, created_by)
select :'biz', c.branch_id, c.id, now() - (g * interval '25 days'), now() - (g * interval '25 days') + interval '1 hour',
       (case when g % 3 = 0 then 'no_show' else 'completed' end)::public.appointment_status, :'own'
  from generate_series(1, 12) g join public.customers c on c.business_id = :'biz' and c.cif_number = 'CIF-BR' || g;

create temp table snap (k text primary key, v jsonb);
grant all on snap to authenticated;
select set_config('request.jwt.claim.sub', :'own', false);
set role authenticated;
insert into snap select 'live', public.analytics_summary(:'biz', current_date - 400, current_date);
reset role;

-- ------------------------------------------------------------ rollups match live data
set role service_role;
select tests.ok((public.refresh_analytics_rollups(1000) ->> 'days_rolled')::int > 300, 'the nightly refresh rolls up everything older than 90 days');
reset role;
select tests.ok((select rolled_through = current_date - 91 from private.analytics_rollup_state where business_id = :'biz'), 'up to 91 days ago');
select tests.ok((select count(*) > 0 and sum(leads) = 31 from private.analytics_daily where business_id = :'biz'), 'leads older than 90 days are in the rollup');
select set_config('request.jwt.claim.sub', :'own', false);
set role authenticated;
insert into snap select 'rolled', public.analytics_summary(:'biz', current_date - 400, current_date);
reset role;
select tests.ok((select a.v - 'tasks_overdue' - 'outstanding' = b.v - 'tasks_overdue' - 'outstanding' from snap a, snap b where a.k = 'live' and b.k = 'rolled'),
                'the summary is identical with rollups and without');
select tests.ok((select (v ->> 'leads')::int = 40 and (v ->> 'orders')::int = 15 and (v ->> 'collected')::numeric = 60000
                   and (v ->> 'walk_ins')::int = 20 and (v ->> 'appointments')::int = 12 from snap where k = 'rolled'),
                'and counts every record once');

-- A change to an old record is read live until the next refresh.
select id as old_lead from public.leads where business_id = :'biz' and lead_number = 'L-BR30' \gset
update public.leads set status_id = :'st_won', closed_at = now() where id = :'old_lead';
select tests.ok((select count(*) = 1 from private.analytics_dirty_days where business_id = :'biz'), 'its day is marked dirty');
select set_config('request.jwt.claim.sub', :'own', false);
set role authenticated;
select tests.ok((public.analytics_summary(:'biz', current_date - 400, current_date) ->> 'leads_won')::int
                = (select (v ->> 'leads_won')::int + 1 from snap where k = 'rolled'),
                'and counted at once');
reset role;
set role service_role;
select public.refresh_analytics_rollups(1000);
reset role;
select tests.ok((select count(*) = 0 from private.analytics_dirty_days where business_id = :'biz'), 'the refresh re-rolls dirty days');

-- ------------------------------------------------------------ branch totals reconcile with the business
select set_config('request.jwt.claim.sub', :'own', false);
set role authenticated;
select tests.ok((select sum(b.leads) = (s ->> 'leads')::int and sum(b.won) = (s ->> 'leads_won')::int
                   and sum(b.orders) = (s ->> 'orders')::int and sum(b.revenue) = (s ->> 'revenue')::numeric
                   and sum(b.collected) = (s ->> 'collected')::numeric and sum(b.walk_ins) = (s ->> 'walk_ins')::int
                   and sum(b.appointments) = (s ->> 'appointments')::int
                   from public.branch_comparison(:'biz', current_date - 400, current_date) b,
                        (select public.analytics_summary(:'biz', current_date - 400, current_date) s) x
                  group by s),
                'branch totals add up to the business totals');
select tests.ok((select sum(b.leads) = (s ->> 'leads')::int and sum(b.won) = (s ->> 'leads_won')::int
                   from public.branch_comparison(:'biz', current_date - 60, current_date) b,
                        (select public.analytics_summary(:'biz', current_date - 60, current_date) s) x
                  group by s),
                'for recent periods too');
select tests.ok((select abs(sum(expected_won) - sum(won)) < 0.5 from public.branch_comparison(:'biz', current_date - 400, current_date)),
                'normalisation shares the business''s wins out by source mix');
select tests.ok((select count(*) = 2 and bool_and(performance_index is not null) from public.branch_comparison(:'biz', current_date - 400, current_date)),
                'each branch gets a performance index');
reset role;

-- ------------------------------------------------------------ what a branch manager sees
select set_config('request.jwt.claim.sub', :'mga', false);
set role authenticated;
select tests.ok((select count(*) = 1 and bool_and(branch_id = :'br_a') from public.branch_comparison(:'biz', current_date - 400, current_date)),
                'a branch manager compares only their branches');
select tests.ok((select count(*) >= 1 and bool_and(owner_id = :'ra') from public.team_performance(:'biz', :'br_a', current_date - 400, current_date)),
                'and gets the team report for their branch');
select tests.fails(format($$select * from public.team_performance(%L, %L, current_date - 400, current_date)$$, :'biz', :'br_b'),
                   'but not for another branch');
reset role;
select set_config('request.jwt.claim.sub', :'ra', false);
set role authenticated;
select tests.fails(format($$select * from public.branch_comparison(%L, current_date - 30, current_date)$$, :'biz'),
                   'salespeople without analytics cannot compare branches');
reset role;

-- ------------------------------------------------------------ targets
select set_config('request.jwt.claim.sub', :'own', false);
set role authenticated;
insert into public.targets (business_id, scope, period_type, period_start, metric, target, created_by)
values (:'biz', 'business', 'month', date_trunc('month', current_date), 'leads_handled', 100, :'own');
insert into public.targets (business_id, scope, branch_id, period_type, period_start, metric, target, created_by)
values (:'biz', 'branch', :'br_a', 'month', date_trunc('month', current_date), 'conversions', 4, :'own'),
       (:'biz', 'branch', :'br_b', 'quarter', date_trunc('quarter', current_date), 'revenue', 50000, :'own');
insert into public.targets (business_id, scope, user_id, period_type, period_start, metric, target, created_by)
values (:'biz', 'person', :'ra', 'month', date_trunc('month', current_date), 'collections', 20000, :'own'),
       (:'biz', 'person', :'rb', 'month', date_trunc('month', current_date), 'conversions', 3, :'own');
select tests.fails(format($$insert into public.targets (business_id, scope, period_type, period_start, metric, target, created_by)
                             values (%L, 'business', 'month', date_trunc('month', current_date)::date + 14, 'revenue', 5, %L)$$, :'biz', :'own'),
                   'targets start on the first day of a month or quarter');
select tests.fails(format($$insert into public.targets (business_id, scope, user_id, period_type, period_start, metric, target, created_by)
                             values (%L, 'person', %L, 'month', date_trunc('month', current_date), 'revenue', 5, %L)$$, :'biz', '62000000-0000-0000-0000-000000000099', :'own'),
                   'person targets are for members');
reset role;
-- This month: one Central lead won now (L-BR30 above, Central? it's even → Central), and collections for Asha.
insert into public.payments (business_id, order_id, customer_id, amount, method)
select business_id, id, customer_id, 1500, 'cash' from public.orders where business_id = :'biz' and owner_id = :'ra' order by created_at desc limit 1;
select set_config('request.jwt.claim.sub', :'own', false);
set role authenticated;
select tests.ok((select count(*) = 5 from public.target_progress(:'biz')), 'managers see every current target with progress');
select tests.ok((select actual = (select count(*) from public.leads l join public.lead_statuses s on s.id = l.status_id and s.category = 'won'
                                    where l.business_id = :'biz' and l.branch_id = :'br_a'
                                      and l.closed_at >= date_trunc('month', now()))
                   and expected_percent between 0 and 100
                   from public.target_progress(:'biz') where scope = 'branch' and metric = 'conversions'),
                'conversions count leads won in the period, with how far through the period we are');
select tests.ok((select actual >= 1500 from public.target_progress(:'biz') where scope = 'person' and metric = 'collections'),
                'collections count payments received in the period');
reset role;
select set_config('request.jwt.claim.sub', :'ra', false);
set role authenticated;
select tests.ok((select string_agg(scope || ':' || metric, ',' order by scope, metric) = 'branch:conversions,person:collections' from public.target_progress(:'biz')),
                'a salesperson sees their own targets and their branch''s, not East''s or Bala''s');
select tests.ok((select count(*) = 1 from public.target_progress(:'biz', null, true)), 'My day shows just their own');
select tests.fails(format($$insert into public.targets (business_id, scope, user_id, period_type, period_start, metric, target, created_by)
                             values (%L, 'person', %L, 'month', date_trunc('month', current_date), 'conversions', 1, %L)$$, :'biz', :'ra', :'ra'),
                   'and cannot set targets');
reset role;

-- ------------------------------------------------------------ leaderboard
select set_config('request.jwt.claim.sub', :'ra', false);
set role authenticated;
select tests.fails(format($$select * from public.leaderboard(%L, current_date - 30, current_date)$$, :'biz'), 'the leaderboard is off by default');
reset role;
select set_config('request.jwt.claim.sub', :'own', false);
set role authenticated;
select public.set_leaderboard(:'biz', true);
reset role;
select set_config('request.jwt.claim.sub', :'ra', false);
set role authenticated;
select tests.ok((select count(*) = 2 and min(rank_conversions) = 1 from public.leaderboard(:'biz', current_date - 400, current_date)),
                'once switched on, everyone sees the ranking');
reset role;

-- ------------------------------------------------------------ lead transfers
select id as moving from public.leads where business_id = :'biz' and lead_number = 'L-BR2' \gset
select set_config('request.jwt.claim.sub', :'own', false);
set role authenticated;
update public.leads set branch_id = :'br_b', owner_id = :'rb' where id = :'moving';
update public.leads set status_id = :'st_won' where id = :'moving';
select tests.ok((select count(*) = 1 from public.lead_transfers where lead_id = :'moving' and from_branch_id = :'br_a'
                   and to_branch_id = :'br_b' and transferred_by = :'own' and to_owner_id = :'rb'),
                'moving a lead to another branch records the transfer');
select tests.ok((select transfers = 1 and won = 1 and closers = 'Bala B' and senders = 'Owen Owner'
                   from public.transfer_report(:'biz', current_date - 1, current_date)),
                'the transfer report shows who sent it, who closed it');
reset role;
select set_config('request.jwt.claim.sub', :'mga', false);
set role authenticated;
select tests.ok((select count(*) = 1 from public.lead_transfers where lead_id = :'moving'), 'branch managers see transfers out of their branch');
reset role;
select set_config('request.jwt.claim.sub', :'ra', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.lead_transfers), 'salespeople don''t');
reset role;
select tests.fails(format($$update public.lead_transfers set to_branch_id = null where lead_id = %L$$, :'moving'), 'transfers are append-only');

-- ------------------------------------------------------------ report packs
select set_config('request.jwt.claim.sub', :'mga', false);
set role authenticated;
select tests.fails(format($$insert into public.report_schedules (business_id, user_id, report, frequency, branch_id, next_run_at)
                             values (%L, %L, 'pack_branch', 'weekly', %L, now())$$, :'biz', :'mga', :'br_b'),
                   'a branch pack needs access to the branch');
insert into public.report_schedules (business_id, user_id, report, frequency, branch_id, next_run_at)
values (:'biz', :'mga', 'pack_branch', 'weekly', :'br_a', now() - interval '1 minute');
select tests.fails(format($$insert into public.report_schedules (business_id, user_id, report, frequency, next_run_at)
                             values (%L, %L, 'pack_owner', 'daily', now())$$, :'biz', :'mga'),
                   'packs are weekly or monthly');
reset role;
set role service_role;
select id as sched, period_from, period_to, branch_id as sched_branch from public.claim_report_schedules(20) where report = 'pack_branch' \gset
select public.report_pack_for(:'sched', :'period_from', :'period_to') as pack \gset
reset role;
select tests.ok(:'sched_branch' = :'br_a', 'claimed schedules say which branch');
select tests.ok((:'pack'::jsonb -> 'branches') @> jsonb_build_array(jsonb_build_object('branch_id', :'br_a'))
                and jsonb_array_length(:'pack'::jsonb -> 'branches') = 1 and :'pack'::jsonb ? 'team' and :'pack'::jsonb ? 'summary',
                'a branch pack holds that branch, its team and the summary, as the manager would see them');
select set_config('request.jwt.claim.sub', :'own', false);
set role authenticated;
select tests.ok((select p ? 'sources' and p ? 'campaigns' and jsonb_array_length(p -> 'branches') = 2
                   from (select public.report_pack(:'biz', 'pack_owner', null, current_date - 30, current_date) p) x),
                'the owner pack has every branch, sources and campaigns');
reset role;

\echo 'branch reporting and targets: all checks passed'
