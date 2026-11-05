-- Sprint 15: multi-branch reporting and targets (ADR 0016).
--
--   * Daily rollups (private.analytics_daily) for history older than 90 days,
--     kept exact: a change to an old record marks its day dirty, and dirty or
--     not-yet-rolled days are read live until the nightly refresh.
--   * One metrics source (private.metric_rows) behind the summary, the branch
--     comparison and the report packs, so branch totals add up to the business.
--   * Branch comparison with source-mix normalisation, targets per business,
--     branch and person, an opt-in leaderboard, team reports for branch
--     managers, lead transfers between branches, and report packs.

insert into public.permissions (key, module, description) values
-- BEGIN permissions
  ('targets.manage', 'analytics', 'Set monthly and quarterly targets for branches and people')
-- END permissions
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'targets.manage' from public.roles r
 where r.business_id is null and r.key in ('business_admin', 'sales_manager')
on conflict do nothing;

-- =====================================================================
-- Daily rollups
-- =====================================================================
create table private.analytics_daily (
  business_id   uuid not null references public.businesses(id) on delete cascade,
  day           date not null,
  branch_id     uuid,
  owner_id      uuid,
  source_id     uuid,
  leads         int not null default 0,
  won           int not null default 0,
  lost          int not null default 0,
  won_days      numeric(14,2) not null default 0,
  orders        int not null default 0,
  revenue       numeric(14,2) not null default 0,
  collected     numeric(14,2) not null default 0,
  walk_ins      int not null default 0,
  appointments  int not null default 0,
  no_shows      int not null default 0,
  attended      int not null default 0
);
create index analytics_daily_idx on private.analytics_daily (business_id, day);

-- Every day up to rolled_through is in the rollup, except the dirty ones.
create table private.analytics_rollup_state (
  business_id     uuid primary key references public.businesses(id) on delete cascade,
  rolled_through  date not null,
  refreshed_at    timestamptz not null default now()
);

create table private.analytics_dirty_days (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  day          date not null,
  primary key (business_id, day)
);

-- Rolls up [p_from, p_to] (business-local days) from the live tables.
create or replace function private.rollup_days(p_business_id uuid, p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text := (select timezone from public.businesses where id = p_business_id);
  v_lo timestamptz := (p_from::timestamp) at time zone v_tz;
  v_hi timestamptz := ((p_to + 1)::timestamp) at time zone v_tz;
begin
  delete from private.analytics_daily where business_id = p_business_id and day between p_from and p_to;
  insert into private.analytics_daily (business_id, day, branch_id, owner_id, source_id, leads, won, lost, won_days,
                                       orders, revenue, collected, walk_ins, appointments, no_shows, attended)
  select p_business_id, x.day, x.branch_id, x.owner_id, x.source_id,
         sum(x.leads), sum(x.won), sum(x.lost), sum(x.won_days), sum(x.orders), sum(x.revenue), sum(x.collected),
         sum(x.walk_ins), sum(x.appointments), sum(x.no_shows), sum(x.attended)
    from (
      select (l.created_at at time zone v_tz)::date as day, l.branch_id, l.owner_id, l.first_source_id as source_id,
             count(*) as leads, count(*) filter (where s.category = 'won') as won, count(*) filter (where s.category = 'lost') as lost,
             coalesce(sum(extract(epoch from l.closed_at - l.created_at) / 86400) filter (where s.category = 'won'), 0) as won_days,
             0 as orders, 0 as revenue, 0 as collected, 0 as walk_ins, 0 as appointments, 0 as no_shows, 0 as attended
        from public.leads l join public.lead_statuses s on s.id = l.status_id
       where l.business_id = p_business_id and l.created_at >= v_lo and l.created_at < v_hi
       group by 1, 2, 3, 4
      union all
      select (o.created_at at time zone v_tz)::date, o.branch_id, o.owner_id, null,
             0, 0, 0, 0, count(*), sum(o.total), 0, 0, 0, 0, 0
        from public.orders o join public.order_stages s on s.id = o.stage_id and s.category <> 'cancelled'
       where o.business_id = p_business_id and o.created_at >= v_lo and o.created_at < v_hi
       group by 1, 2, 3
      union all
      select (p.received_at at time zone v_tz)::date, o.branch_id, o.owner_id, null,
             0, 0, 0, 0, 0, 0, sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0, 0, 0, 0
        from public.payments p join public.orders o on o.id = p.order_id
       where p.business_id = p_business_id and p.received_at >= v_lo and p.received_at < v_hi
       group by 1, 2, 3
      union all
      select (w.visited_at at time zone v_tz)::date, w.branch_id, null, null, 0, 0, 0, 0, 0, 0, 0, count(*), 0, 0, 0
        from public.walk_ins w
       where w.business_id = p_business_id and w.visited_at >= v_lo and w.visited_at < v_hi
       group by 1, 2
      union all
      select (a.starts_at at time zone v_tz)::date, a.branch_id, null, null, 0, 0, 0, 0, 0, 0, 0, 0,
             count(*) filter (where a.status <> 'cancelled'), count(*) filter (where a.status = 'no_show'),
             count(*) filter (where a.status = 'completed')
        from public.appointments a
       where a.business_id = p_business_id and a.starts_at >= v_lo and a.starts_at < v_hi
       group by 1, 2
    ) x
   group by x.day, x.branch_id, x.owner_id, x.source_id;
end;
$$;

-- Marks the day of an old record dirty when it changes, so reads use live data for it.
create or replace function private.rollup_touch(p_business_id uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
begin
  if p_at is null then
    return;
  end if;
  select (p_at at time zone b.timezone)::date into v_day
    from private.analytics_rollup_state s join public.businesses b on b.id = s.business_id
   where s.business_id = p_business_id and (p_at at time zone b.timezone)::date <= s.rolled_through;
  if v_day is not null then
    insert into private.analytics_dirty_days (business_id, day) values (p_business_id, v_day) on conflict do nothing;
  end if;
end;
$$;

create or replace function private.rollup_touch_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_col text := tg_argv[0];
begin
  if v_old is not null then
    perform private.rollup_touch((v_old ->> 'business_id')::uuid, (v_old ->> v_col)::timestamptz);
  end if;
  if v_new is not null then
    perform private.rollup_touch((v_new ->> 'business_id')::uuid, (v_new ->> v_col)::timestamptz);
  end if;
  -- Payments are credited to their order's branch and owner: re-roll their days too.
  if tg_table_name = 'orders' and tg_op = 'UPDATE' then
    if (v_new ->> 'branch_id', v_new ->> 'owner_id') is distinct from (v_old ->> 'branch_id', v_old ->> 'owner_id') then
      perform private.rollup_touch((v_new ->> 'business_id')::uuid, p.received_at)
         from public.payments p where p.order_id = (v_new ->> 'id')::uuid;
    end if;
  end if;
  return null;
end;
$$;

create trigger leads_rollup after insert or delete or update of status_id, branch_id, owner_id, first_source_id, created_at, closed_at
  on public.leads for each row execute function private.rollup_touch_row('created_at');
create trigger orders_rollup after insert or delete or update of stage_id, total, branch_id, owner_id, created_at
  on public.orders for each row execute function private.rollup_touch_row('created_at');
create trigger payments_rollup after insert or delete or update
  on public.payments for each row execute function private.rollup_touch_row('received_at');
create trigger walk_ins_rollup after insert or delete or update
  on public.walk_ins for each row execute function private.rollup_touch_row('visited_at');
create trigger appointments_rollup after insert or delete or update of status, starts_at, branch_id
  on public.appointments for each row execute function private.rollup_touch_row('starts_at');

-- Nightly (job route): re-roll dirty days, then extend each business's rollup
-- up to 91 days ago, at most p_max_days days a business per run.
create or replace function public.refresh_analytics_rollups(p_max_days int default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
  d record;
  v_target date;
  v_start date;
  v_end date;
  v_dirty int := 0;
  v_rolled int := 0;
begin
  for b in select x.id, x.timezone, s.rolled_through from public.businesses x
             left join private.analytics_rollup_state s on s.business_id = x.id
            where x.status in ('active', 'suspended') loop
    v_target := (now() at time zone b.timezone)::date - 91;
    for d in delete from private.analytics_dirty_days where business_id = b.id returning day loop
      perform private.rollup_days(b.id, d.day, d.day);
      v_dirty := v_dirty + 1;
    end loop;
    v_start := coalesce(b.rolled_through + 1,
      (select (min(l.created_at) at time zone b.timezone)::date from public.leads l where l.business_id = b.id),
      v_target);
    -- Orders, payments and visits can be older than the first lead (imports).
    if b.rolled_through is null then
      v_start := least(v_start,
        coalesce((select (min(o.created_at) at time zone b.timezone)::date from public.orders o where o.business_id = b.id), v_start),
        coalesce((select (min(p.received_at) at time zone b.timezone)::date from public.payments p where p.business_id = b.id), v_start),
        coalesce((select (min(w.visited_at) at time zone b.timezone)::date from public.walk_ins w where w.business_id = b.id), v_start),
        coalesce((select (min(a.starts_at) at time zone b.timezone)::date from public.appointments a where a.business_id = b.id), v_start));
    end if;
    if v_start <= v_target then
      v_end := least(v_target, v_start + greatest(p_max_days, 1) - 1);
      perform private.rollup_days(b.id, v_start, v_end);
      v_rolled := v_rolled + (v_end - v_start + 1);
    else
      v_end := greatest(coalesce(b.rolled_through, v_target), v_start - 1);
    end if;
    insert into private.analytics_rollup_state (business_id, rolled_through, refreshed_at)
    values (b.id, v_end, now())
    on conflict (business_id) do update set rolled_through = excluded.rolled_through, refreshed_at = now();
  end loop;
  return jsonb_build_object('dirty_days', v_dirty, 'days_rolled', v_rolled);
end;
$$;

-- =====================================================================
-- One metrics source: rollups where they are exact, live tables elsewhere.
-- Definitions match Sprint 8 (cohort conversion on leads created in the period).
-- =====================================================================
create or replace function private.metric_rows(p_business_id uuid, p_from date, p_to date)
returns table (branch_id uuid, owner_id uuid, source_id uuid, leads bigint, won bigint, lost bigint, won_days numeric,
               orders bigint, revenue numeric, collected numeric, walk_ins bigint, appointments bigint,
               no_shows bigint, attended bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text;
  v_through date;
  v_lo timestamptz;
  v_hi timestamptz;
  v_live tstzmultirange;
  v_live_lo timestamptz;
begin
  select b.timezone, s.rolled_through into v_tz, v_through
    from public.businesses b left join private.analytics_rollup_state s on s.business_id = b.id
   where b.id = p_business_id;
  v_hi := ((p_to + 1)::timestamp) at time zone v_tz;
  -- Live: days after the rollup, plus dirty days inside the period.
  v_lo := ((greatest(p_from, coalesce(v_through + 1, p_from)))::timestamp) at time zone v_tz;
  v_live := tstzmultirange(tstzrange(v_lo, v_hi, '[)'))
            + coalesce((select range_agg(tstzrange((d.day::timestamp) at time zone v_tz, ((d.day + 1)::timestamp) at time zone v_tz, '[)'))
                          from private.analytics_dirty_days d
                         where d.business_id = p_business_id and d.day between p_from and p_to), '{}'::tstzmultirange);
  v_live_lo := lower(v_live);
  if v_live_lo is null then
    v_live_lo := v_hi;
  end if;

  return query
  select r.branch_id, r.owner_id, r.source_id, sum(r.leads)::bigint, sum(r.won)::bigint, sum(r.lost)::bigint, sum(r.won_days),
         sum(r.orders)::bigint, sum(r.revenue), sum(r.collected), sum(r.walk_ins)::bigint, sum(r.appointments)::bigint,
         sum(r.no_shows)::bigint, sum(r.attended)::bigint
    from private.analytics_daily r
   where r.business_id = p_business_id and r.day between p_from and least(p_to, v_through)
     and not exists (select 1 from private.analytics_dirty_days d where d.business_id = p_business_id and d.day = r.day)
   group by r.branch_id, r.owner_id, r.source_id
  union all
  select l.branch_id, l.owner_id, l.first_source_id, count(*), count(*) filter (where s.category = 'won'),
         count(*) filter (where s.category = 'lost'),
         coalesce(sum(extract(epoch from l.closed_at - l.created_at) / 86400) filter (where s.category = 'won'), 0)::numeric,
         0::bigint, 0::numeric, 0::numeric, 0::bigint, 0::bigint, 0::bigint, 0::bigint
    from public.leads l join public.lead_statuses s on s.id = l.status_id
   where l.business_id = p_business_id and l.created_at >= v_live_lo and l.created_at < v_hi and l.created_at <@ v_live
   group by 1, 2, 3
  union all
  select o.branch_id, o.owner_id, null::uuid, 0::bigint, 0::bigint, 0::bigint, 0::numeric, count(*), sum(o.total),
         0::numeric, 0::bigint, 0::bigint, 0::bigint, 0::bigint
    from public.orders o join public.order_stages s on s.id = o.stage_id and s.category <> 'cancelled'
   where o.business_id = p_business_id and o.created_at >= v_live_lo and o.created_at < v_hi and o.created_at <@ v_live
   group by 1, 2
  union all
  select o.branch_id, o.owner_id, null::uuid, 0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::bigint, 0::numeric,
         sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0::bigint, 0::bigint, 0::bigint, 0::bigint
    from public.payments p join public.orders o on o.id = p.order_id
   where p.business_id = p_business_id and p.received_at >= v_live_lo and p.received_at < v_hi and p.received_at <@ v_live
   group by 1, 2
  union all
  select w.branch_id, null::uuid, null::uuid, 0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::bigint, 0::numeric, 0::numeric,
         count(*), 0::bigint, 0::bigint, 0::bigint
    from public.walk_ins w
   where w.business_id = p_business_id and w.visited_at >= v_live_lo and w.visited_at < v_hi and w.visited_at <@ v_live
   group by 1
  union all
  select a.branch_id, null::uuid, null::uuid, 0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::bigint, 0::numeric, 0::numeric,
         0::bigint, count(*) filter (where a.status <> 'cancelled'), count(*) filter (where a.status = 'no_show'),
         count(*) filter (where a.status = 'completed')
    from public.appointments a
   where a.business_id = p_business_id and a.starts_at >= v_live_lo and a.starts_at < v_hi and a.starts_at <@ v_live
   group by 1;
end;
$$;

-- Payments are found by received date (no index existed for that per business).
create index if not exists walk_ins_business_visited_idx on public.walk_ins (business_id, visited_at);
create index if not exists appointments_business_starts_idx on public.appointments (business_id, starts_at);

-- The Sprint 8 summary, reading counts and money through metric_rows.
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
  v_money boolean;
  m record;
begin
  if not (private.has_permission(p_business_id, 'analytics.view') or private.has_permission(p_business_id, 'dashboard.view')) then
    raise exception 'not allowed to view analytics' using errcode = '42501';
  end if;
  select timezone into v_tz from public.businesses where id = p_business_id;
  v_from := (p_from::timestamp) at time zone v_tz;
  v_to := ((p_to + 1)::timestamp) at time zone v_tz;
  v_money := private.has_permission(p_business_id, 'analytics.financial') or private.has_permission(p_business_id, 'analytics.sales');

  select coalesce(sum(r.leads), 0) as leads, coalesce(sum(r.won), 0) as won, coalesce(sum(r.lost), 0) as lost,
         coalesce(sum(r.orders), 0) as orders, coalesce(sum(r.revenue), 0) as revenue, coalesce(sum(r.collected), 0) as collected,
         coalesce(sum(r.walk_ins), 0) as walk_ins, coalesce(sum(r.appointments), 0) as appointments,
         coalesce(sum(r.no_shows), 0) as no_shows, coalesce(sum(r.attended), 0) as attended
    into m from private.metric_rows(p_business_id, p_from, p_to) r;

  return jsonb_build_object(
    'leads', m.leads,
    'leads_won', m.won,
    'leads_lost', m.lost,
    'conversion_rate', round(100.0 * m.won / nullif(m.leads, 0), 1),
    'walk_ins', m.walk_ins,
    'appointments', m.appointments,
    'no_show_rate', round(100.0 * m.no_shows / nullif(m.no_shows + m.attended, 0), 1),
    'orders', m.orders,
    'revenue', case when v_money then m.revenue end,
    'average_order_value', case when v_money then round(m.revenue / nullif(m.orders, 0), 2) end,
    'collected', case when v_money then m.collected end,
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
                        and cancelled_at is null and due_at < now()));
end;
$$;

-- Branches the caller can see in reports: all of them (and "no branch") with all-branch access.
create or replace function private.report_branches(p_business_id uuid)
returns table (branch_id uuid, all_branches boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, m.all_branches
    from public.branches b
    join public.business_memberships m on m.business_id = b.business_id and m.user_id = auth.uid() and m.status = 'active'
   where b.business_id = p_business_id and (m.all_branches or b.id = any (private.my_branch_ids()));
$$;

-- =====================================================================
-- Branch comparison: every summary metric per branch, plus a source-mix
-- normalised performance index (won ÷ what the business converts on the
-- same sources), as for salespeople.
-- =====================================================================
create or replace function public.branch_comparison(p_business_id uuid, p_from date, p_to date)
returns table (branch_id uuid, branch_name text, leads bigint, won bigint, lost bigint, conversion_rate numeric,
               expected_won numeric, performance_index numeric, median_days_to_win numeric,
               orders bigint, revenue numeric, average_order_value numeric, collected numeric, outstanding numeric,
               walk_ins bigint, appointments bigint, no_show_rate numeric, tasks_overdue bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_money boolean;
  v_all boolean;
begin
  if not private.has_permission(p_business_id, 'analytics.view') then
    raise exception 'not allowed to view analytics' using errcode = '42501';
  end if;
  v_money := private.has_permission(p_business_id, 'analytics.financial') or private.has_permission(p_business_id, 'analytics.sales');
  select coalesce(bool_or(m.all_branches), false) into v_all
    from public.business_memberships m where m.business_id = p_business_id and m.user_id = auth.uid() and m.status = 'active';

  return query
  with rows as (
    select * from private.metric_rows(p_business_id, p_from, p_to)
  ), source_rate as (
    select r.source_id, sum(r.won)::numeric / nullif(sum(r.leads), 0) as rate
      from rows r where r.leads > 0 group by r.source_id
  ), per_branch as (
    select r.branch_id, sum(r.leads) as leads, sum(r.won) as won, sum(r.lost) as lost, sum(r.won_days) as won_days,
           sum(r.orders) as orders, sum(r.revenue) as revenue, sum(r.collected) as collected,
           sum(r.walk_ins) as walk_ins, sum(r.appointments) as appointments, sum(r.no_shows) as no_shows, sum(r.attended) as attended,
           sum(r.leads * coalesce(sr.rate, 0)) as expected
      from rows r left join source_rate sr on sr.source_id is not distinct from r.source_id
     group by r.branch_id
  ), visible as (
    select b.id, b.name from public.branches b
     where b.business_id = p_business_id and (v_all or b.id in (select x.branch_id from private.report_branches(p_business_id) x))
    union all
    select null::uuid, 'No branch' where v_all
  )
  select v.id, v.name,
         coalesce(pb.leads, 0)::bigint, coalesce(pb.won, 0)::bigint, coalesce(pb.lost, 0)::bigint,
         round(100.0 * pb.won / nullif(pb.leads, 0), 1),
         round(pb.expected, 1), round(pb.won / nullif(pb.expected, 0), 2),
         round(pb.won_days / nullif(pb.won, 0), 1),
         coalesce(pb.orders, 0)::bigint,
         case when v_money then coalesce(pb.revenue, 0) end,
         case when v_money then round(pb.revenue / nullif(pb.orders, 0), 2) end,
         case when v_money then coalesce(pb.collected, 0) end,
         case when v_money then (select coalesce(sum(ob.balance), 0) from public.order_balances ob
                                   join public.orders o on o.id = ob.order_id
                                   join public.order_stages s on s.id = o.stage_id and s.category = 'open'
                                  where ob.business_id = p_business_id and ob.balance > 0 and o.branch_id is not distinct from v.id) end,
         coalesce(pb.walk_ins, 0)::bigint, coalesce(pb.appointments, 0)::bigint,
         round(100.0 * pb.no_shows / nullif(pb.no_shows + pb.attended, 0), 1),
         (select count(*) from public.tasks t where t.business_id = p_business_id and t.branch_id is not distinct from v.id
            and t.completed_at is null and t.cancelled_at is null and t.due_at < now())
    from visible v
    left join per_branch pb on pb.branch_id is not distinct from v.id
   where v.id is not null or pb.branch_id is null and (pb.leads > 0 or pb.orders > 0 or pb.collected <> 0 or pb.walk_ins > 0 or pb.appointments > 0)
   order by v.id is null, v.name;
end;
$$;

-- =====================================================================
-- Team performance for a branch manager: the Sprint 8 PIC report limited to
-- one branch's leads, normalised against the business's source rates.
-- =====================================================================
create or replace function public.team_performance(p_business_id uuid, p_branch_id uuid, p_from date, p_to date, p_min_age_days int default 7)
returns table (owner_id uuid, owner_name text, leads bigint, won bigint, conversion_rate numeric,
               expected_won numeric, performance_index numeric, open_overdue_tasks bigint, median_days_to_win numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_from timestamptz;
  v_to timestamptz;
  v_tz text;
begin
  if not (private.has_permission(p_business_id, 'analytics.sales') or private.has_permission(p_business_id, 'analytics.view'))
     or not exists (select 1 from private.report_branches(p_business_id) x where x.branch_id = p_branch_id) then
    raise exception 'not allowed to view this branch' using errcode = '42501';
  end if;
  select timezone into v_tz from public.businesses where id = p_business_id;
  v_from := (p_from::timestamp) at time zone v_tz;
  v_to := ((p_to + 1)::timestamp) at time zone v_tz;

  return query
  with cohort as (
    select l.id, l.owner_id, l.branch_id, l.first_source_id, l.created_at, l.closed_at, s.category
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
   where c.branch_id = p_branch_id
   group by c.owner_id
   order by 7 desc nulls last, 3 desc;
end;
$$;

-- =====================================================================
-- Targets
-- =====================================================================
create table public.targets (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  scope         text not null check (scope in ('business', 'branch', 'person')),
  branch_id     uuid,
  user_id       uuid references public.profiles(id) on delete cascade,
  period_type   text not null check (period_type in ('month', 'quarter')),
  period_start  date not null,
  metric        text not null check (metric in ('leads_handled', 'conversions', 'revenue', 'collections')),
  target        numeric(14,2) not null check (target > 0),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((scope = 'branch') = (branch_id is not null)),
  check ((scope = 'person') = (user_id is not null)),
  check (period_start = date_trunc(period_type, period_start)::date),
  check (metric in ('revenue', 'collections') or target = round(target)),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade
);
create unique index targets_unique on public.targets
  (business_id, scope, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'),
   coalesce(user_id, '00000000-0000-0000-0000-000000000000'), period_type, period_start, metric);
create index targets_period_idx on public.targets (business_id, period_start);
create trigger targets_updated_at before update on public.targets
  for each row execute function private.set_updated_at();
create trigger audit_targets after insert or update or delete on public.targets
  for each row execute function private.audit_row();

-- A person target is for someone in the business.
create or replace function private.check_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null and not exists (select 1 from public.business_memberships m
      where m.business_id = new.business_id and m.user_id = new.user_id and m.status = 'active') then
    raise exception 'targets are for members of the business' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger targets_check before insert or update on public.targets
  for each row execute function private.check_target();

alter table public.targets enable row level security;
-- Managers see every target; people see their own and their branches'.
create policy targets_select on public.targets for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('targets.manage'))::uuid[])
         or business_id = any ((select private.permitted_business_ids('analytics.view'))::uuid[])
         or (user_id = (select auth.uid()) and private.is_member(business_id))
         or (scope = 'branch' and branch_id = any ((select private.my_branch_ids())::uuid[])));
create policy targets_insert on public.targets for insert to authenticated
  with check (business_id = any ((select private.permitted_business_ids('targets.manage'))::uuid[]) and created_by = auth.uid());
create policy targets_update on public.targets for update to authenticated
  using (business_id = any ((select private.permitted_business_ids('targets.manage'))::uuid[]))
  with check (business_id = any ((select private.permitted_business_ids('targets.manage'))::uuid[]));
create policy targets_delete on public.targets for delete to authenticated
  using (business_id = any ((select private.permitted_business_ids('targets.manage'))::uuid[]));
revoke all on public.targets from anon;
revoke update on public.targets from authenticated;
grant update (target) on public.targets to authenticated;

-- What a target's owner has achieved in [p_lo, p_hi).
--   leads_handled: leads created in the period (owned by the person / in the branch)
--   conversions:   leads won (closed) in the period
--   revenue:       orders created in the period, not cancelled
--   collections:   payments less refunds received in the period
create or replace function private.target_actual(t public.targets, p_lo timestamptz, p_hi timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case t.metric
    when 'leads_handled' then (select count(*)::numeric from public.leads l
       where l.business_id = t.business_id and l.created_at >= p_lo and l.created_at < p_hi
         and (t.scope <> 'person' or l.owner_id = t.user_id) and (t.scope <> 'branch' or l.branch_id = t.branch_id))
    when 'conversions' then (select count(*)::numeric from public.leads l join public.lead_statuses s on s.id = l.status_id and s.category = 'won'
       where l.business_id = t.business_id and l.closed_at >= p_lo and l.closed_at < p_hi
         and (t.scope <> 'person' or l.owner_id = t.user_id) and (t.scope <> 'branch' or l.branch_id = t.branch_id))
    when 'revenue' then (select coalesce(sum(o.total), 0) from public.orders o join public.order_stages s on s.id = o.stage_id and s.category <> 'cancelled'
       where o.business_id = t.business_id and o.created_at >= p_lo and o.created_at < p_hi
         and (t.scope <> 'person' or o.owner_id = t.user_id) and (t.scope <> 'branch' or o.branch_id = t.branch_id))
    when 'collections' then (select coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0)
       from public.payments p join public.orders o on o.id = p.order_id
       where p.business_id = t.business_id and p.received_at >= p_lo and p.received_at < p_hi
         and (t.scope <> 'person' or o.owner_id = t.user_id) and (t.scope <> 'branch' or o.branch_id = t.branch_id))
  end;
$$;

-- Targets whose period includes p_on that the caller may see, with progress
-- and where they should be by now (share of the period gone).
create or replace function public.target_progress(p_business_id uuid, p_on date default null, p_mine_only boolean default false)
returns table (id uuid, scope text, branch_id uuid, branch_name text, user_id uuid, person_name text,
               period_type text, period_start date, period_end date, metric text, target numeric, actual numeric,
               percent numeric, expected_percent numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := (select timezone from public.businesses where id = p_business_id);
  v_on date := coalesce(p_on, (now() at time zone v_tz)::date);
  v_money boolean := private.has_permission(p_business_id, 'analytics.financial') or private.has_permission(p_business_id, 'analytics.sales')
                     or private.has_permission(p_business_id, 'targets.manage');
begin
  if not private.is_member(p_business_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
  select t.id, t.scope, t.branch_id, b.name, t.user_id, coalesce(p.full_name, p.email), t.period_type, t.period_start,
         (t.period_start + case t.period_type when 'month' then interval '1 month' else interval '3 months' end)::date - 1,
         t.metric, t.target, a.actual, round(100 * a.actual / t.target, 1),
         round(100 * least(1, greatest(0, extract(epoch from now() - ((t.period_start::timestamp) at time zone v_tz))
                  / extract(epoch from ((t.period_start + case t.period_type when 'month' then interval '1 month' else interval '3 months' end)::timestamp at time zone v_tz)
                                       - ((t.period_start::timestamp) at time zone v_tz)))), 1)
    from public.targets t
    left join public.branches b on b.id = t.branch_id
    left join public.profiles p on p.id = t.user_id
    cross join lateral (select private.target_actual(t, (t.period_start::timestamp) at time zone v_tz,
        ((t.period_start + case t.period_type when 'month' then interval '1 month' else interval '3 months' end)::timestamp) at time zone v_tz) as actual) a
   where t.business_id = p_business_id
     and v_on >= t.period_start
     and v_on < (t.period_start + case t.period_type when 'month' then interval '1 month' else interval '3 months' end)::date
     and (not p_mine_only or t.user_id = auth.uid())
     -- Same visibility as the table, and money targets only for those who see money (or their own).
     and (private.has_permission(p_business_id, 'targets.manage') or private.has_permission(p_business_id, 'analytics.view')
          or t.user_id = auth.uid() or (t.scope = 'branch' and t.branch_id = any (private.my_branch_ids())))
     and (t.metric not in ('revenue', 'collections') or v_money or t.user_id = auth.uid())
   order by case t.scope when 'business' then 0 when 'branch' then 1 else 2 end, b.name, p.full_name, t.metric;
end;
$$;

-- =====================================================================
-- Leaderboard (opt-in per business)
-- =====================================================================
alter table public.businesses add column leaderboard_enabled boolean not null default false;

create or replace function public.set_leaderboard(p_business_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_business_id, 'settings.business.manage') then
    raise exception 'not allowed to change business settings' using errcode = '42501';
  end if;
  update public.businesses set leaderboard_enabled = p_enabled where id = p_business_id;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (p_business_id, auth.uid(), 'update', 'businesses', p_business_id, jsonb_build_object('leaderboard_enabled', p_enabled));
end;
$$;

-- Everyone in the business sees it when switched on; sales managers always can.
create or replace function public.leaderboard(p_business_id uuid, p_from date, p_to date)
returns table (user_id uuid, name text, branch_name text, conversions bigint, revenue numeric, collections numeric,
               leads_handled bigint, rank_conversions bigint, rank_revenue bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := (select timezone from public.businesses where id = p_business_id);
  v_lo timestamptz := (p_from::timestamp) at time zone v_tz;
  v_hi timestamptz := ((p_to + 1)::timestamp) at time zone v_tz;
begin
  if not (private.has_permission(p_business_id, 'analytics.sales')
          or (private.is_member(p_business_id) and (select leaderboard_enabled from public.businesses where id = p_business_id))) then
    raise exception 'the leaderboard is off for this business' using errcode = '42501';
  end if;
  return query
  with people as (
    select m.user_id from public.business_memberships m
      join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'leads.create'
     where m.business_id = p_business_id and m.status = 'active'
  ), stats as (
    select pe.user_id,
      (select count(*) from public.leads l join public.lead_statuses s on s.id = l.status_id and s.category = 'won'
        where l.business_id = p_business_id and l.owner_id = pe.user_id and l.closed_at >= v_lo and l.closed_at < v_hi) as conversions,
      (select coalesce(sum(o.total), 0) from public.orders o join public.order_stages s on s.id = o.stage_id and s.category <> 'cancelled'
        where o.business_id = p_business_id and o.owner_id = pe.user_id and o.created_at >= v_lo and o.created_at < v_hi) as revenue,
      (select coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0)
         from public.payments p join public.orders o on o.id = p.order_id
        where p.business_id = p_business_id and o.owner_id = pe.user_id and p.received_at >= v_lo and p.received_at < v_hi) as collections,
      (select count(*) from public.leads l where l.business_id = p_business_id and l.owner_id = pe.user_id
          and l.created_at >= v_lo and l.created_at < v_hi) as leads_handled
      from people pe
  )
  select s.user_id, coalesce(pr.full_name, pr.email),
         (select string_agg(b.name, ', ' order by b.name) from public.business_memberships m
            join public.user_branch_access uba on uba.membership_id = m.id join public.branches b on b.id = uba.branch_id
           where m.business_id = p_business_id and m.user_id = s.user_id),
         s.conversions, s.revenue, s.collections, s.leads_handled,
         rank() over (order by s.conversions desc), rank() over (order by s.revenue desc)
    from stats s join public.profiles pr on pr.id = s.user_id
   where s.conversions > 0 or s.revenue > 0 or s.leads_handled > 0
   order by s.conversions desc, s.revenue desc;
end;
$$;

-- =====================================================================
-- Lead transfers between branches
-- =====================================================================
create table public.lead_transfers (
  id               bigint generated always as identity primary key,
  business_id      uuid not null,
  lead_id          uuid not null,
  from_branch_id   uuid,
  to_branch_id     uuid,
  from_owner_id    uuid references public.profiles(id) on delete set null,
  to_owner_id      uuid references public.profiles(id) on delete set null,
  transferred_by   uuid references public.profiles(id) on delete set null,
  transferred_at   timestamptz not null default now(),
  foreign key (business_id, lead_id) references public.leads (business_id, id) on delete cascade
);
create index lead_transfers_business_idx on public.lead_transfers (business_id, transferred_at);
create index lead_transfers_lead_idx on public.lead_transfers (lead_id);

create or replace function private.lead_transfers_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'lead transfers are append-only' using errcode = '42501';
end;
$$;
create trigger lead_transfers_append_only before update on public.lead_transfers
  for each row execute function private.lead_transfers_append_only();

create or replace function private.record_lead_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_transfers (business_id, lead_id, from_branch_id, to_branch_id, from_owner_id, to_owner_id, transferred_by)
  values (new.business_id, new.id, old.branch_id, new.branch_id, old.owner_id, new.owner_id, auth.uid());
  return null;
end;
$$;
create trigger leads_transfer after update of branch_id on public.leads
  for each row when (old.branch_id is distinct from new.branch_id and current_setting('scaler.importing', true) is distinct from 'on')
  execute function private.record_lead_transfer();

alter table public.lead_transfers enable row level security;
create policy lead_transfers_select on public.lead_transfers for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('analytics.view'))::uuid[])
         and (from_branch_id = any ((select private.my_branch_ids())::uuid[]) or to_branch_id = any ((select private.my_branch_ids())::uuid[])));
revoke all on public.lead_transfers from anon;
revoke insert, update, delete on public.lead_transfers from authenticated;

-- Per route (from → to): transfers, how many were won afterwards, median days
-- from transfer to win, who sent them and who closed them.
create or replace function public.transfer_report(p_business_id uuid, p_from date, p_to date)
returns table (from_branch_id uuid, from_branch text, to_branch_id uuid, to_branch text, transfers bigint, won bigint,
               median_days_to_close numeric, senders text, closers text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := (select timezone from public.businesses where id = p_business_id);
  v_lo timestamptz := (p_from::timestamp) at time zone v_tz;
  v_hi timestamptz := ((p_to + 1)::timestamp) at time zone v_tz;
begin
  if not private.has_permission(p_business_id, 'analytics.view') then
    raise exception 'not allowed to view analytics' using errcode = '42501';
  end if;
  return query
  with t as (
    select lt.*, s.category, l.closed_at, l.owner_id as current_owner
      from public.lead_transfers lt
      join public.leads l on l.id = lt.lead_id
      join public.lead_statuses s on s.id = l.status_id
     where lt.business_id = p_business_id and lt.transferred_at >= v_lo and lt.transferred_at < v_hi
       and (exists (select 1 from private.report_branches(p_business_id) x where x.all_branches)
            or lt.from_branch_id = any (private.my_branch_ids()) or lt.to_branch_id = any (private.my_branch_ids()))
  )
  select t.from_branch_id, coalesce(fb.name, 'No branch'), t.to_branch_id, coalesce(tb.name, 'No branch'),
         count(*), count(*) filter (where t.category = 'won' and t.closed_at >= t.transferred_at),
         round((percentile_cont(0.5) within group (order by extract(epoch from t.closed_at - t.transferred_at) / 86400)
                filter (where t.category = 'won' and t.closed_at >= t.transferred_at))::numeric, 1),
         (select string_agg(distinct coalesce(p.full_name, p.email), ', ') from public.profiles p
           where p.id in (select x.transferred_by from t x where x.from_branch_id is not distinct from t.from_branch_id
                            and x.to_branch_id is not distinct from t.to_branch_id)),
         (select string_agg(distinct coalesce(p.full_name, p.email), ', ') from public.profiles p
           where p.id in (select x.current_owner from t x where x.from_branch_id is not distinct from t.from_branch_id
                            and x.to_branch_id is not distinct from t.to_branch_id and x.category = 'won'))
    from t
    left join public.branches fb on fb.id = t.from_branch_id
    left join public.branches tb on tb.id = t.to_branch_id
   group by t.from_branch_id, fb.name, t.to_branch_id, tb.name
   order by 5 desc;
end;
$$;

-- =====================================================================
-- Report packs: weekly or monthly bundles per role, on the Sprint 8 scheduler
-- =====================================================================
alter table public.report_schedules drop constraint report_schedules_report_check;
alter table public.report_schedules add constraint report_schedules_report_check
  check (report in ('executive', 'marketing', 'sales', 'operations', 'pack_owner', 'pack_branch', 'pack_marketing'));
alter table public.report_schedules add column branch_id uuid;
alter table public.report_schedules
  add constraint report_schedules_branch_fk foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade,
  add constraint report_schedules_pack_branch check ((report = 'pack_branch') = (branch_id is not null)),
  add constraint report_schedules_pack_frequency check (report not like 'pack_%' or frequency in ('weekly', 'monthly'));
alter table public.report_schedules drop constraint report_schedules_business_id_user_id_report_frequency_key;
create unique index report_schedules_unique on public.report_schedules
  (business_id, user_id, report, frequency, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'));

-- The claim now also says which branch a branch pack is for.
drop function public.claim_report_schedules(int);
create or replace function public.claim_report_schedules(p_limit int default 20)
returns table (id uuid, business_id uuid, user_id uuid, email text, report text, frequency text, business_name text,
               timezone text, currency char(3), period_from date, period_to date, branch_id uuid)
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
         ((now() at time zone b.timezone)::date - 1), d.branch_id
    from due d
    join moved m on m.id = d.id
    join public.businesses b on b.id = d.business_id and b.status = 'active'
    join public.profiles p on p.id = d.user_id and p.email is not null
    join public.business_memberships bm on bm.business_id = d.business_id and bm.user_id = d.user_id and bm.status = 'active';
end;
$$;

-- Everything a pack holds, computed with the recipient's permissions (so a
-- branch manager's pack holds only what they could see in the app).
create or replace function private.report_pack(p_business_id uuid, p_kind text, p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to,
                                'summary', public.analytics_summary(p_business_id, p_from, p_to));
begin
  if p_kind in ('pack_owner', 'pack_branch') then
    v := v || jsonb_build_object('branches', (select coalesce(jsonb_agg(to_jsonb(b)), '[]')
                                                from public.branch_comparison(p_business_id, p_from, p_to) b
                                               where p_branch_id is null or b.branch_id = p_branch_id));
    v := v || jsonb_build_object('targets', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
                                               from public.target_progress(p_business_id, p_to) t
                                              where p_branch_id is null or t.branch_id = p_branch_id or t.scope = 'person'));
    v := v || jsonb_build_object('transfers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
                                                 from public.transfer_report(p_business_id, p_from, p_to) t
                                                where p_branch_id is null or p_branch_id in (t.from_branch_id, t.to_branch_id)));
  end if;
  if p_kind = 'pack_branch' then
    v := v || jsonb_build_object('team', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
                                            from public.team_performance(p_business_id, p_branch_id, p_from, p_to) t));
  elsif p_kind = 'pack_owner' then
    v := v || jsonb_build_object('team', (select coalesce(jsonb_agg(to_jsonb(t)), '[]')
                                            from public.pic_performance(p_business_id, p_from, p_to) t));
  end if;
  if p_kind in ('pack_marketing', 'pack_owner') then
    v := v || jsonb_build_object('sources', (select coalesce(jsonb_agg(to_jsonb(b)), '[]')
                                               from public.analytics_breakdown(p_business_id, p_from, p_to, 'source') b),
                                 'campaigns', (select coalesce(jsonb_agg(to_jsonb(b)), '[]')
                                                 from public.analytics_breakdown(p_business_id, p_from, p_to, 'campaign') b));
  end if;
  return v;
end;
$$;

create or replace function public.report_pack_for(p_schedule_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.report_schedules;
begin
  select * into s from public.report_schedules where id = p_schedule_id;
  perform set_config('request.jwt.claim.sub', s.user_id::text, true);
  return private.report_pack(s.business_id, s.report, s.branch_id, p_from, p_to);
exception when insufficient_privilege then
  return null;
end;
$$;

-- The same pack on screen (printable as PDF) for a signed-in user.
create or replace function public.report_pack(p_business_id uuid, p_kind text, p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('pack_owner', 'pack_branch', 'pack_marketing') then
    raise exception 'unknown pack' using errcode = '22023';
  end if;
  if not private.has_permission(p_business_id, 'analytics.view') then
    raise exception 'not allowed to view analytics' using errcode = '42501';
  end if;
  if p_kind = 'pack_branch' and (p_branch_id is null
      or not exists (select 1 from private.report_branches(p_business_id) x where x.branch_id = p_branch_id)) then
    raise exception 'not allowed to view this branch' using errcode = '42501';
  end if;
  return private.report_pack(p_business_id, p_kind, case when p_kind = 'pack_branch' then p_branch_id end, p_from, p_to);
end;
$$;

-- Branch packs need access to the branch; owner and marketing packs need analytics.
create or replace function private.check_report_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report = 'pack_branch' and auth.uid() is not null
     and not exists (select 1 from private.report_branches(new.business_id) x where x.branch_id = new.branch_id) then
    raise exception 'not allowed to view this branch' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger report_schedules_check before insert on public.report_schedules
  for each row execute function private.check_report_schedule();

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.branch_comparison(uuid, date, date) from public, anon;
revoke execute on function public.team_performance(uuid, uuid, date, date, int) from public, anon;
revoke execute on function public.target_progress(uuid, date, boolean) from public, anon;
revoke execute on function public.set_leaderboard(uuid, boolean) from public, anon;
revoke execute on function public.leaderboard(uuid, date, date) from public, anon;
revoke execute on function public.transfer_report(uuid, date, date) from public, anon;
revoke execute on function public.report_pack(uuid, text, uuid, date, date) from public, anon;
grant execute on function public.branch_comparison(uuid, date, date) to authenticated;
grant execute on function public.team_performance(uuid, uuid, date, date, int) to authenticated;
grant execute on function public.target_progress(uuid, date, boolean) to authenticated;
grant execute on function public.set_leaderboard(uuid, boolean) to authenticated;
grant execute on function public.leaderboard(uuid, date, date) to authenticated;
grant execute on function public.transfer_report(uuid, date, date) to authenticated;
grant execute on function public.report_pack(uuid, text, uuid, date, date) to authenticated;

revoke execute on function public.refresh_analytics_rollups(int) from public, anon, authenticated;
revoke execute on function public.report_pack_for(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.claim_report_schedules(int) from public, anon, authenticated;
grant execute on function public.refresh_analytics_rollups(int) to service_role;
grant execute on function public.report_pack_for(uuid, date, date) to service_role;
grant execute on function public.claim_report_schedules(int) to service_role;

grant select (leaderboard_enabled) on public.businesses to authenticated;
grant insert (branch_id) on public.report_schedules to authenticated;
grant execute on all functions in schema private to authenticated, service_role;
