-- =====================================================================
-- Sprint 3: pipeline rules, lost reasons, PIC assignment (round-robin),
-- tasks and follow-ups, in-app notifications, transactional email outbox.
--
-- No new permission keys: tasks.view_all / tasks.manage, leads.assign and
-- settings.pipeline.manage already exist in the catalogue.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pipeline configuration
-- ---------------------------------------------------------------------

-- Won and lost stages always use their own colour; open stages pick one of the four open colours.
alter table public.lead_statuses
  add column requires_owner boolean not null default false,
  add constraint lead_statuses_stage_matches_category
    check ((category = 'won') = (stage = 'won') and (category = 'lost') = (stage = 'lost'));

-- Allowed next stages. A stage with no rows here can move to any stage.
create table public.lead_status_transitions (
  business_id     uuid not null references public.businesses(id) on delete cascade,
  from_status_id  uuid not null,
  to_status_id    uuid not null,
  created_at      timestamptz not null default now(),
  primary key (from_status_id, to_status_id),
  check (from_status_id <> to_status_id),
  foreign key (business_id, from_status_id) references public.lead_statuses (business_id, id) on delete cascade,
  foreign key (business_id, to_status_id) references public.lead_statuses (business_id, id) on delete cascade
);
create index lead_status_transitions_business_idx on public.lead_status_transitions (business_id);

create table public.lead_lost_reasons (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  position     int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, id)
);
create unique index lead_lost_reasons_name_unique on public.lead_lost_reasons (business_id, lower(name));
create trigger lead_lost_reasons_updated_at before update on public.lead_lost_reasons
  for each row execute function private.set_updated_at();

alter table public.leads
  add column lost_reason_id     uuid,
  add column lost_note          text check (length(lost_note) <= 1000),
  add column closed_at          timestamptz,
  add column next_follow_up_at  timestamptz,
  add constraint leads_lost_reason_fk
    foreign key (business_id, lost_reason_id) references public.lead_lost_reasons (business_id, id);

create index leads_follow_up_idx on public.leads (business_id, next_follow_up_at) where archived_at is null;
create index leads_unassigned_idx on public.leads (business_id, created_at desc)
  where owner_id is null and archived_at is null;

alter table public.lead_status_history
  add column lost_reason_id uuid,
  add column note text;

-- ---------------------------------------------------------------------
-- PIC assignment: round-robin pools per branch, plus a business-wide pool
-- ---------------------------------------------------------------------
create table public.lead_assignment_settings (
  business_id          uuid primary key references public.businesses(id) on delete cascade,
  round_robin_enabled  boolean not null default false,
  updated_by           uuid references public.profiles(id) on delete set null,
  updated_at           timestamptz not null default now()
);
create trigger lead_assignment_settings_updated_at before update on public.lead_assignment_settings
  for each row execute function private.set_updated_at();

-- branch_id null = the business-wide pool, used when a lead has no branch
-- or its branch has nobody in rotation.
create table public.round_robin_members (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  branch_id         uuid,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  is_active         boolean not null default true,
  last_assigned_at  timestamptz,
  created_at        timestamptz not null default now(),
  unique nulls not distinct (business_id, branch_id, user_id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade
);
create index round_robin_members_pool_idx on public.round_robin_members (business_id, branch_id, last_assigned_at);

-- ---------------------------------------------------------------------
-- Tasks and follow-ups
-- ---------------------------------------------------------------------
create type public.task_type as enum ('follow_up', 'call', 'whatsapp', 'visit', 'meeting', 'email', 'other');

create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  lead_id              uuid,
  customer_id          uuid,
  branch_id            uuid,
  type                 public.task_type not null default 'follow_up',
  title                text not null check (length(trim(title)) between 1 and 200),
  notes                text check (length(notes) <= 4000),
  due_at               timestamptz not null,
  assignee_id          uuid references public.profiles(id) on delete set null,
  created_by           uuid references public.profiles(id) on delete set null,
  completed_at         timestamptz,
  completed_by         uuid references public.profiles(id) on delete set null,
  outcome              text check (length(outcome) <= 2000),
  cancelled_at         timestamptz,
  reminder_sent_at     timestamptz,
  overdue_notified_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (business_id, id),
  check (completed_at is null or cancelled_at is null),
  foreign key (business_id, lead_id) references public.leads (business_id, id) on delete cascade,
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id)
);
create index tasks_open_assignee_idx on public.tasks (business_id, assignee_id, due_at)
  where completed_at is null and cancelled_at is null;
create index tasks_open_due_idx on public.tasks (due_at)
  where completed_at is null and cancelled_at is null;
create index tasks_lead_idx on public.tasks (lead_id, due_at);
create index tasks_customer_idx on public.tasks (customer_id);

create trigger tasks_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- In-app notifications (delivered live through Supabase Realtime)
-- ---------------------------------------------------------------------
create table public.notifications (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  type         text not null check (type ~ '^[a-z_]+$'),
  title        text not null,
  body         text,
  link         text check (link is null or link ~ '^/[^/]'),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, business_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id, business_id) where read_at is null;

-- ---------------------------------------------------------------------
-- Transactional email outbox. Rows are written by the database (reminders)
-- and sent by the app's job route, which renders the template.
-- Lives in the private schema: never exposed through the API.
-- ---------------------------------------------------------------------
create table private.email_outbox (
  id           bigint generated always as identity primary key,
  business_id  uuid references public.businesses(id) on delete cascade,
  to_email     text not null,
  template     text not null check (template ~ '^[a-z_]+$'),
  payload      jsonb not null default '{}',
  status       text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'expired')),
  attempts     int not null default 0,
  last_error   text,
  locked_at    timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index email_outbox_pending_idx on private.email_outbox (id) where status in ('pending', 'sending');
alter table private.email_outbox enable row level security;

-- =====================================================================
-- Defaults: lost reasons for every business
-- =====================================================================
create or replace function private.seed_business_defaults(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_statuses (business_id, key, name, category, stage, position, is_default) values
  -- BEGIN lead_statuses
    (p_business_id, 'new', 'New', 'open', 'new', 1, true),
    (p_business_id, 'contacted', 'Contacted', 'open', 'contacted', 2, false),
    (p_business_id, 'no_response', 'No response', 'open', 'contacted', 3, false),
    (p_business_id, 'interested', 'Interested', 'open', 'contacted', 4, false),
    (p_business_id, 'qualified', 'Qualified', 'open', 'qualified', 5, false),
    (p_business_id, 'appointment_booked', 'Appointment booked', 'open', 'qualified', 6, false),
    (p_business_id, 'visited', 'Visited store', 'open', 'qualified', 7, false),
    (p_business_id, 'quotation_sent', 'Quotation sent', 'open', 'negotiation', 8, false),
    (p_business_id, 'negotiation', 'Negotiation', 'open', 'negotiation', 9, false),
    (p_business_id, 'won', 'Converted', 'won', 'won', 10, false),
    (p_business_id, 'lost', 'Lost', 'lost', 'lost', 11, false),
    (p_business_id, 'invalid', 'Invalid or junk', 'lost', 'lost', 12, false)
  -- END lead_statuses
  on conflict (business_id, key) do nothing;

  insert into public.lead_sources (business_id, key, name, channel, position) values
    (p_business_id, 'meta_ads', 'Meta ads', 'meta', 1),
    (p_business_id, 'google_ads', 'Google ads', 'google', 2),
    (p_business_id, 'whatsapp', 'WhatsApp', 'whatsapp', 3),
    (p_business_id, 'website', 'Website', 'website', 4),
    (p_business_id, 'walk_in', 'Walk-in', 'walk_in', 5),
    (p_business_id, 'referral', 'Referral', 'referral', 6),
    (p_business_id, 'phone_call', 'Phone call', 'phone', 7),
    (p_business_id, 'instagram', 'Instagram', 'meta', 8),
    (p_business_id, 'other', 'Other', 'other', 9)
  on conflict (business_id, key) do nothing;

  insert into public.lead_lost_reasons (business_id, name, position) values
    (p_business_id, 'Price too high', 1),
    (p_business_id, 'Bought elsewhere', 2),
    (p_business_id, 'Not reachable', 3),
    (p_business_id, 'Not interested any more', 4),
    (p_business_id, 'Timing — maybe later', 5),
    (p_business_id, 'Duplicate or junk enquiry', 6),
    (p_business_id, 'Other', 7)
  on conflict do nothing;
end;
$$;

select private.seed_business_defaults(id) from public.businesses;

-- =====================================================================
-- Helpers
-- =====================================================================

-- Could this member see a lead in this branch if it were theirs?
-- Mirrors private.can_see_lead() but for any user, not just the caller.
create or replace function private.member_can_own_lead(p_business_id uuid, p_user_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.business_memberships m
      join public.businesses b on b.id = m.business_id and b.status = 'active'
      join public.role_permissions rp on rp.role_id = m.role_id
     where m.business_id = p_business_id
       and m.user_id = p_user_id
       and m.status = 'active'
       and (rp.permission_key = 'leads.view_assigned'
            or (rp.permission_key = 'leads.view_all'
                and (p_branch_id is null or m.all_branches
                     or exists (select 1 from public.user_branch_access a
                                 where a.membership_id = m.id and a.branch_id = p_branch_id))))
  );
$$;

create or replace function private.notify(
  p_business_id uuid, p_user_id uuid, p_type text, p_title text, p_body text, p_link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (business_id, user_id, type, title, body, link)
  values (p_business_id, p_user_id, p_type, left(p_title, 200), left(p_body, 500), p_link);
$$;

-- Next person in rotation: the branch pool first, then the business-wide pool.
-- Skips people who have left or who could not see the lead.
create or replace function private.pick_round_robin(p_business_id uuid, p_branch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row uuid;
  v_user uuid;
  v_pool uuid;
begin
  foreach v_pool in array case when p_branch_id is null then array[null::uuid] else array[p_branch_id, null] end loop
    select r.id, r.user_id into v_row, v_user
      from public.round_robin_members r
     where r.business_id = p_business_id
       and r.branch_id is not distinct from v_pool
       and r.is_active
       and private.member_can_own_lead(p_business_id, r.user_id, p_branch_id)
     order by r.last_assigned_at nulls first, r.created_at
     limit 1
     for update of r skip locked;
    if v_row is not null then
      update public.round_robin_members set last_assigned_at = clock_timestamp() where id = v_row;
      return v_user;
    end if;
  end loop;
  return null;
end;
$$;

-- =====================================================================
-- Pipeline guards
-- =====================================================================

-- Stage configuration rules. is_default only changes through set_default_lead_status().
create or replace function private.guard_lead_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_default and (not new.is_active or new.category <> 'open') then
    raise exception 'the default stage must be an active open stage' using errcode = '23514';
  end if;
  -- Website and API leads arrive unassigned into the default stage.
  if new.is_default and new.requires_owner then
    raise exception 'the default stage cannot require an owner' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.category is distinct from old.category
       and exists (select 1 from public.leads l where l.status_id = new.id) then
      raise exception 'stage type cannot change while leads use this stage' using errcode = '23514';
    end if;
    if old.is_active and not new.is_active
       and exists (select 1 from public.leads l where l.status_id = new.id and l.archived_at is null) then
      raise exception 'move the leads out of this stage before hiding it' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger lead_statuses_guard before insert or update on public.lead_statuses
  for each row execute function private.guard_lead_status();

-- Round-robin for new leads that arrive without an owner.
create or replace function private.auto_assign_new_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is null
     and exists (select 1 from public.lead_assignment_settings s
                  where s.business_id = new.business_id and s.round_robin_enabled) then
    new.owner_id := private.pick_round_robin(new.business_id, new.branch_id);
  end if;
  return new;
end;
$$;

-- Fires before leads_status_rules (triggers run in name order).
create trigger leads_assign_round_robin before insert on public.leads
  for each row execute function private.auto_assign_new_lead();

-- Transition rules, lost reasons, owner requirements and closed_at.
create or replace function private.apply_lead_status_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to public.lead_statuses;
begin
  select * into v_to from public.lead_statuses where id = new.status_id;

  if new.owner_id is not null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id
          or new.branch_id is distinct from old.branch_id)
     and not private.member_can_own_lead(new.business_id, new.owner_id, new.branch_id) then
    raise exception 'owner cannot see leads in this branch' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_to.category <> 'open' or not v_to.is_active then
      raise exception 'new leads start in an active open stage' using errcode = '23514';
    end if;
    if v_to.requires_owner and new.owner_id is null then
      raise exception 'this stage needs an owner' using errcode = '23514';
    end if;
    new.lost_reason_id := null;
    new.lost_note := null;
    new.closed_at := null;
    return new;
  end if;

  if new.status_id is not distinct from old.status_id then
    if v_to.requires_owner and new.owner_id is null and old.owner_id is not null then
      raise exception 'this stage needs an owner' using errcode = '23514';
    end if;
    if v_to.category = 'lost' then
      -- Leads lost before reasons existed keep working; a reason, once set, can change but not go away.
      if new.lost_reason_id is distinct from old.lost_reason_id then
        if new.lost_reason_id is null then
          raise exception 'lost reason required' using errcode = '23514';
        end if;
        if not exists (select 1 from public.lead_lost_reasons r
                        where r.id = new.lost_reason_id and r.business_id = new.business_id and r.is_active) then
          raise exception 'unknown lost reason' using errcode = '23514';
        end if;
      end if;
    else
      new.lost_reason_id := null;
      new.lost_note := null;
    end if;
    return new;
  end if;

  if not v_to.is_active then
    raise exception 'that stage is no longer in use' using errcode = '23514';
  end if;
  if exists (select 1 from public.lead_status_transitions t where t.from_status_id = old.status_id)
     and not exists (select 1 from public.lead_status_transitions t
                      where t.from_status_id = old.status_id and t.to_status_id = new.status_id) then
    raise exception 'stage transition not allowed' using errcode = '23514';
  end if;
  if v_to.requires_owner and new.owner_id is null then
    raise exception 'this stage needs an owner' using errcode = '23514';
  end if;

  if v_to.category = 'lost' then
    if new.lost_reason_id is null then
      raise exception 'lost reason required' using errcode = '23514';
    end if;
    if not exists (select 1 from public.lead_lost_reasons r
                    where r.id = new.lost_reason_id and r.business_id = new.business_id and r.is_active) then
      raise exception 'unknown lost reason' using errcode = '23514';
    end if;
  else
    new.lost_reason_id := null;
    new.lost_note := null;
  end if;

  new.closed_at := case when v_to.category = 'open' then null else now() end;
  return new;
end;
$$;

create trigger leads_status_rules before insert or update on public.leads
  for each row execute function private.apply_lead_status_rules();

-- Status history now records the lost reason and note.
create or replace function private.log_lead_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  diff jsonb;
  skip text[] := array['updated_at', 'last_activity_at', 'status_id', 'closed_at', 'next_follow_up_at',
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

-- Closed leads get a closed_at for later reporting (no history row: this is a backfill).
update public.leads l set closed_at = l.updated_at
  from public.lead_statuses s
 where s.id = l.status_id and s.category <> 'open' and l.closed_at is null;

-- Tell the new owner when a lead lands with them (not when they take it themselves).
create or replace function private.notify_lead_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer text;
begin
  if new.owner_id is null or new.owner_id is not distinct from auth.uid() then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id then
    return null;
  end if;
  select full_name into v_customer from public.customers where id = new.customer_id;
  perform private.notify(new.business_id, new.owner_id, 'lead_assigned',
    format('%s assigned to you', new.lead_number),
    concat_ws(' · ', v_customer, new.title),
    '/leads/' || new.id);
  return null;
end;
$$;

create trigger leads_notify_owner after insert or update of owner_id on public.leads
  for each row execute function private.notify_lead_owner();

-- Keep tasks pointing at the lead's current customer and branch.
create or replace function private.sync_lead_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks
     set customer_id = new.customer_id, branch_id = new.branch_id
   where lead_id = new.id
     and (customer_id is distinct from new.customer_id or branch_id is distinct from new.branch_id);
  return null;
end;
$$;

create trigger leads_sync_tasks after update of customer_id, branch_id on public.leads
  for each row execute function private.sync_lead_tasks();

-- Customer-only tasks follow a merge to the surviving file.
create or replace function private.move_tasks_on_merge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.merged_into_id is not null and old.merged_into_id is null then
    update public.tasks set customer_id = new.merged_into_id where customer_id = new.id;
  end if;
  return null;
end;
$$;

create trigger customers_move_tasks after update of merged_into_id on public.customers
  for each row execute function private.move_tasks_on_merge();

-- =====================================================================
-- Tasks: preparation, lead follow-up date, timeline, notifications
-- =====================================================================
create or replace function private.prepare_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if new.lead_id is not null then
      select l.customer_id, l.branch_id into new.customer_id, new.branch_id
        from public.leads l where l.id = new.lead_id and l.business_id = new.business_id;
    elsif new.customer_id is not null then
      select c.branch_id into new.branch_id
        from public.customers c where c.id = new.customer_id and c.business_id = new.business_id;
    end if;
    new.completed_at := null;
    new.completed_by := null;
    new.cancelled_at := null;
    new.reminder_sent_at := null;
    new.overdue_notified_at := null;
  else
    if new.completed_at is distinct from old.completed_at then
      new.completed_by := case when new.completed_at is null then null else v_uid end;
    end if;
    if new.due_at is distinct from old.due_at then
      new.reminder_sent_at := null;
      new.overdue_notified_at := null;
    end if;
  end if;

  if new.assignee_id is null then
    raise exception 'task needs an assignee' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    if not exists (select 1 from public.business_memberships m
                    where m.business_id = new.business_id and m.user_id = new.assignee_id
                      and m.status = 'active') then
      raise exception 'assignee must be an active member of the business' using errcode = '23514';
    end if;
    -- Giving a task to someone else is a manager's job.
    if v_uid is not null and new.assignee_id <> v_uid
       and not private.has_permission(new.business_id, 'tasks.view_all') then
      raise exception 'not allowed to assign tasks to others' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_prepare before insert or update on public.tasks
  for each row execute function private.prepare_task();

create or replace function private.refresh_lead_follow_up(p_lead_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.leads l
     set next_follow_up_at = n.due
    from (select min(t.due_at) as due from public.tasks t
           where t.lead_id = p_lead_id and t.completed_at is null and t.cancelled_at is null) n
   where l.id = p_lead_id and l.next_follow_up_at is distinct from n.due;
$$;

create or replace function private.on_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  -- lead_id never changes after insert (no column grant), so one refresh per row is enough.
  if tg_op = 'DELETE' then
    if old.lead_id is not null then
      perform private.refresh_lead_follow_up(old.lead_id);
    end if;
    return null;
  end if;
  if new.lead_id is not null then
    perform private.refresh_lead_follow_up(new.lead_id);
  end if;

  -- Lead timeline
  if new.lead_id is not null then
    if tg_op = 'INSERT' then
      insert into public.lead_activities (business_id, lead_id, type, meta, actor_id)
      values (new.business_id, new.lead_id, 'task_created',
              jsonb_build_object('task_id', new.id, 'task_type', new.type, 'title', new.title,
                                 'due_at', new.due_at, 'assignee_id', new.assignee_id),
              auth.uid());
    elsif new.completed_at is not null and old.completed_at is null then
      insert into public.lead_activities (business_id, lead_id, type, body, meta, actor_id)
      values (new.business_id, new.lead_id, 'task_completed', new.outcome,
              jsonb_build_object('task_id', new.id, 'task_type', new.type, 'title', new.title),
              auth.uid());
    elsif new.cancelled_at is not null and old.cancelled_at is null then
      insert into public.lead_activities (business_id, lead_id, type, meta, actor_id)
      values (new.business_id, new.lead_id, 'task_cancelled',
              jsonb_build_object('task_id', new.id, 'task_type', new.type, 'title', new.title),
              auth.uid());
    end if;
  end if;

  -- Tell the assignee when someone else gives them a task.
  if new.assignee_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.completed_at is null and new.cancelled_at is null then
    select timezone into v_tz from public.businesses where id = new.business_id;
    perform private.notify(new.business_id, new.assignee_id, 'task_assigned',
      'New task: ' || new.title,
      'Due ' || to_char(new.due_at at time zone coalesce(v_tz, 'UTC'), 'DD Mon, HH24:MI'),
      coalesce('/leads/' || new.lead_id, '/tasks'));
  end if;
  return null;
end;
$$;

create trigger tasks_after_change
  after insert or delete or update of due_at, completed_at, cancelled_at, assignee_id on public.tasks
  for each row execute function private.on_task_change();

-- =====================================================================
-- Audit: configuration tables. Round-robin rotation is not configuration.
-- =====================================================================
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token_hash' - 'key_hash' end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token_hash' - 'key_hash' end;
  row_data jsonb := coalesce(new_row, old_row);
  biz uuid;
  diff jsonb;
begin
  biz := case
    when tg_table_name = 'businesses' then (row_data ->> 'id')::uuid
    else (row_data ->> 'business_id')::uuid
  end;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('from', old_row -> n.key, 'to', n.value))
      into diff
      from jsonb_each(new_row) n
     where n.value is distinct from old_row -> n.key
       and n.key not in ('updated_at', 'last_used_at', 'last_assigned_at');
    if diff is null then
      return new;
    end if;
  else
    diff := row_data;
  end if;

  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (biz, auth.uid(), lower(tg_op), tg_table_name,
          coalesce(row_data ->> 'id', row_data ->> 'from_status_id', row_data ->> 'business_id'), diff);

  return coalesce(new, old);
end;
$$;

create trigger audit_lead_status_transitions after insert or update or delete on public.lead_status_transitions
  for each row execute function private.audit_row();
create trigger audit_lead_lost_reasons after insert or update or delete on public.lead_lost_reasons
  for each row execute function private.audit_row();
create trigger audit_lead_assignment_settings after insert or update or delete on public.lead_assignment_settings
  for each row execute function private.audit_row();
create trigger audit_round_robin_members after insert or update or delete on public.round_robin_members
  for each row execute function private.audit_row();

-- =====================================================================
-- RPCs: pipeline settings
-- =====================================================================
create or replace function public.set_default_lead_status(p_status_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.lead_statuses;
begin
  select * into v from public.lead_statuses where id = p_status_id;
  if v.id is null or not private.has_permission(v.business_id, 'settings.pipeline.manage') then
    raise exception 'not allowed to change the pipeline' using errcode = '42501';
  end if;
  if not v.is_active or v.category <> 'open' then
    raise exception 'the default stage must be an active open stage' using errcode = '23514';
  end if;
  if v.requires_owner then
    raise exception 'the default stage cannot require an owner' using errcode = '23514';
  end if;
  update public.lead_statuses set is_default = false
   where business_id = v.business_id and is_default and id <> v.id;
  update public.lead_statuses set is_default = true where id = v.id and not is_default;
end;
$$;

-- Rewrites positions in the given order. Ids from other businesses are ignored.
create or replace function public.reorder_lead_config(p_business_id uuid, p_table text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_business_id, 'settings.pipeline.manage') then
    raise exception 'not allowed to change the pipeline' using errcode = '42501';
  end if;
  if p_table = 'statuses' then
    update public.lead_statuses s set position = o.n
      from unnest(p_ids) with ordinality o(id, n)
     where s.id = o.id and s.business_id = p_business_id and s.position <> o.n;
  elsif p_table = 'sources' then
    update public.lead_sources s set position = o.n
      from unnest(p_ids) with ordinality o(id, n)
     where s.id = o.id and s.business_id = p_business_id and s.position <> o.n;
  elsif p_table = 'lost_reasons' then
    update public.lead_lost_reasons s set position = o.n
      from unnest(p_ids) with ordinality o(id, n)
     where s.id = o.id and s.business_id = p_business_id and s.position <> o.n;
  else
    raise exception 'unknown list %', p_table using errcode = '22023';
  end if;
end;
$$;

-- Replaces the allowed next stages of one stage. An empty list means "any stage".
create or replace function public.set_lead_status_transitions(p_status_id uuid, p_to_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.lead_statuses where id = p_status_id;
  if v_business is null or not private.has_permission(v_business, 'settings.pipeline.manage') then
    raise exception 'not allowed to change the pipeline' using errcode = '42501';
  end if;
  delete from public.lead_status_transitions t
   where t.from_status_id = p_status_id and not (t.to_status_id = any (coalesce(p_to_ids, '{}')));
  insert into public.lead_status_transitions (business_id, from_status_id, to_status_id)
  select v_business, p_status_id, s.id
    from public.lead_statuses s
   where s.business_id = v_business and s.id = any (coalesce(p_to_ids, '{}')) and s.id <> p_status_id
  on conflict do nothing;
end;
$$;

-- =====================================================================
-- RPCs: assignment
-- =====================================================================

-- Hands the given unassigned leads out in rotation. Returns how many were assigned.
create or replace function public.assign_leads_round_robin(p_business_id uuid, p_lead_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_owner uuid;
  v_count int := 0;
begin
  if not private.has_permission(p_business_id, 'leads.assign') then
    raise exception 'not allowed to assign leads' using errcode = '42501';
  end if;
  for v_lead in
    select l.id, l.branch_id from public.leads l
     where l.business_id = p_business_id and l.id = any (p_lead_ids)
       and l.owner_id is null and l.archived_at is null
       and private.can_see_lead(l.business_id, l.branch_id, l.owner_id)
     order by l.created_at
     for update
  loop
    v_owner := private.pick_round_robin(p_business_id, v_lead.branch_id);
    if v_owner is not null then
      update public.leads set owner_id = v_owner where id = v_lead.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- =====================================================================
-- Background jobs (called by the app's job route with the service role)
-- =====================================================================

-- Marks newly overdue tasks, tells the assignee and their managers,
-- and queues reminder emails for tasks coming due.
create or replace function public.run_task_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_overdue uuid[];
  v_reminders int;
begin
  with upd as (
    update public.tasks t set overdue_notified_at = now()
     where t.completed_at is null and t.cancelled_at is null
       and t.overdue_notified_at is null and t.due_at <= now()
    returning t.id
  )
  select coalesce(array_agg(id), '{}') into v_overdue from upd;

  insert into public.notifications (business_id, user_id, type, title, body, link)
  select t.business_id, t.assignee_id, 'task_overdue', left('Overdue: ' || t.title, 200),
         (select concat_ws(' · ', l.lead_number, c.full_name)
            from public.leads l left join public.customers c on c.id = l.customer_id
           where l.id = t.lead_id),
         coalesce('/leads/' || t.lead_id, '/tasks')
    from public.tasks t
    join public.business_memberships m
      on m.business_id = t.business_id and m.user_id = t.assignee_id and m.status = 'active'
   where t.id = any (v_overdue);

  -- One summary per manager per run, for other people's tasks in branches they cover.
  insert into public.notifications (business_id, user_id, type, title, link)
  select t.business_id, m.user_id, 'team_tasks_overdue',
         case when count(*) = 1 then '1 follow-up is overdue in your team'
              else count(*) || ' follow-ups are overdue in your team' end,
         '/tasks?who=team'
    from public.tasks t
    join public.business_memberships m on m.business_id = t.business_id and m.status = 'active'
    join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'tasks.view_all'
   where t.id = any (v_overdue)
     and t.assignee_id is distinct from m.user_id
     and (t.branch_id is null or m.all_branches
          or exists (select 1 from public.user_branch_access a
                      where a.membership_id = m.id and a.branch_id = t.branch_id))
   group by t.business_id, m.user_id;

  -- Reminder emails 15 minutes before a task is due. Tasks that slipped past
  -- by more than six hours (e.g. the job was down) are marked without an email.
  with due as (
    update public.tasks t set reminder_sent_at = now()
     where t.completed_at is null and t.cancelled_at is null
       and t.reminder_sent_at is null and t.due_at <= now() + interval '15 minutes'
    returning t.*
  ), queued as (
    insert into private.email_outbox (business_id, to_email, template, payload)
    select d.business_id, p.email, 'task_reminder',
           jsonb_build_object(
             'business_name', b.name, 'timezone', b.timezone,
             'assignee_name', p.full_name,
             'task_title', d.title, 'task_type', d.type, 'notes', d.notes, 'due_at', d.due_at,
             'lead_number', l.lead_number, 'customer_name', c.full_name, 'customer_phone', c.primary_phone,
             'path', coalesce('/leads/' || d.lead_id, '/tasks'))
      from due d
      join public.businesses b on b.id = d.business_id and b.status = 'active'
      join public.profiles p on p.id = d.assignee_id and p.email is not null
      join public.business_memberships m
        on m.business_id = d.business_id and m.user_id = d.assignee_id and m.status = 'active'
      left join public.leads l on l.id = d.lead_id
      left join public.customers c on c.id = d.customer_id
     where d.due_at > now() - interval '6 hours'
    returning 1
  )
  select count(*) into v_reminders from queued;

  return jsonb_build_object('overdue', coalesce(array_length(v_overdue, 1), 0), 'reminders_queued', v_reminders);
end;
$$;

-- Claims a batch of emails to send. Stale claims (a crashed sender) are retried;
-- anything a day old is given up on.
create or replace function public.claim_emails(p_limit int default 20)
returns table (id bigint, to_email text, template text, payload jsonb, attempts int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update private.email_outbox o set status = 'expired'
   where o.status in ('pending', 'sending') and o.created_at < now() - interval '1 day';
  update private.email_outbox o set status = 'pending'
   where o.status = 'sending' and o.locked_at < now() - interval '10 minutes';

  return query
  update private.email_outbox o
     set status = 'sending', attempts = o.attempts + 1, locked_at = now()
   where o.id in (select x.id from private.email_outbox x
                   where x.status = 'pending'
                   order by x.id
                   limit greatest(1, least(p_limit, 100))
                   for update skip locked)
  returning o.id, o.to_email, o.template, o.payload, o.attempts;
end;
$$;

-- Records the result of one send. Three failed attempts and it stops.
create or replace function public.finish_email(p_id bigint, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.email_outbox
     set status = case when p_error is null then 'sent' when attempts >= 3 then 'failed' else 'pending' end,
         sent_at = case when p_error is null then now() end,
         last_error = left(p_error, 1000),
         locked_at = null
   where id = p_id and status = 'sending';
$$;

revoke execute on function public.set_default_lead_status(uuid) from public, anon;
revoke execute on function public.reorder_lead_config(uuid, text, uuid[]) from public, anon;
revoke execute on function public.set_lead_status_transitions(uuid, uuid[]) from public, anon;
revoke execute on function public.assign_leads_round_robin(uuid, uuid[]) from public, anon;
revoke execute on function public.run_task_jobs() from public, anon, authenticated;
revoke execute on function public.claim_emails(int) from public, anon, authenticated;
revoke execute on function public.finish_email(bigint, text) from public, anon, authenticated;
grant execute on function public.set_default_lead_status(uuid) to authenticated;
grant execute on function public.reorder_lead_config(uuid, text, uuid[]) to authenticated;
grant execute on function public.set_lead_status_transitions(uuid, uuid[]) to authenticated;
grant execute on function public.assign_leads_round_robin(uuid, uuid[]) to authenticated;
grant execute on function public.run_task_jobs() to service_role;
grant execute on function public.claim_emails(int) to service_role;
grant execute on function public.finish_email(bigint, text) to service_role;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.lead_status_transitions   enable row level security;
alter table public.lead_lost_reasons         enable row level security;
alter table public.lead_assignment_settings  enable row level security;
alter table public.round_robin_members       enable row level security;
alter table public.tasks                     enable row level security;
alter table public.notifications             enable row level security;

-- Stages and sources: no deletes (leads reference them); is_default via set_default_lead_status().
revoke insert, update, delete on public.lead_statuses from authenticated, anon;
grant insert (business_id, key, name, category, stage, position, is_active, requires_owner)
  on public.lead_statuses to authenticated;
grant update (name, category, stage, position, is_active, requires_owner) on public.lead_statuses to authenticated;
revoke insert, update, delete on public.lead_sources from authenticated, anon;
grant insert (business_id, key, name, channel, position, is_active) on public.lead_sources to authenticated;
grant update (name, channel, position, is_active) on public.lead_sources to authenticated;

create policy lst_select on public.lead_status_transitions for select to authenticated
  using (private.is_member(business_id));
revoke insert, update, delete on public.lead_status_transitions from authenticated, anon;

create policy lost_reasons_select on public.lead_lost_reasons for select to authenticated
  using (private.is_member(business_id));
create policy lost_reasons_insert on public.lead_lost_reasons for insert to authenticated
  with check (private.has_permission(business_id, 'settings.pipeline.manage'));
create policy lost_reasons_update on public.lead_lost_reasons for update to authenticated
  using (private.has_permission(business_id, 'settings.pipeline.manage'))
  with check (private.has_permission(business_id, 'settings.pipeline.manage'));
revoke delete on public.lead_lost_reasons from authenticated, anon;
revoke update on public.lead_lost_reasons from authenticated;
grant update (name, position, is_active) on public.lead_lost_reasons to authenticated;

create policy assignment_settings_select on public.lead_assignment_settings for select to authenticated
  using (private.is_member(business_id));
create policy assignment_settings_insert on public.lead_assignment_settings for insert to authenticated
  with check (private.has_permission(business_id, 'leads.assign') and updated_by = auth.uid());
create policy assignment_settings_update on public.lead_assignment_settings for update to authenticated
  using (private.has_permission(business_id, 'leads.assign'))
  with check (private.has_permission(business_id, 'leads.assign') and updated_by = auth.uid());
revoke delete on public.lead_assignment_settings from authenticated, anon;

create policy rr_select on public.round_robin_members for select to authenticated
  using (private.is_member(business_id));
create policy rr_insert on public.round_robin_members for insert to authenticated
  with check (private.has_permission(business_id, 'leads.assign')
              and private.branch_visible(business_id, branch_id)
              and private.member_can_own_lead(business_id, user_id, branch_id));
create policy rr_update on public.round_robin_members for update to authenticated
  using (private.has_permission(business_id, 'leads.assign') and private.branch_visible(business_id, branch_id))
  with check (private.has_permission(business_id, 'leads.assign'));
create policy rr_delete on public.round_robin_members for delete to authenticated
  using (private.has_permission(business_id, 'leads.assign') and private.branch_visible(business_id, branch_id));
revoke update on public.round_robin_members from authenticated;
grant update (is_active) on public.round_robin_members to authenticated;

-- Lost reason and note are written together with the stage move.
grant update (lost_reason_id, lost_note) on public.leads to authenticated;

-- Tasks: mine, ones I created, ones on leads I can see, or everyone's in my branches for managers.
create policy tasks_select on public.tasks for select to authenticated
  using (private.is_member(business_id)
         and (assignee_id = auth.uid() or created_by = auth.uid()
              or (private.has_permission(business_id, 'tasks.view_all')
                  and private.branch_visible(business_id, branch_id))
              or (lead_id is not null and exists (select 1 from public.leads l where l.id = lead_id))));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (private.has_permission(business_id, 'tasks.manage')
              and created_by = auth.uid()
              and (lead_id is null
                   or exists (select 1 from public.leads l where l.id = lead_id and l.business_id = tasks.business_id))
              and (lead_id is not null or customer_id is null or private.can_see_customer(customer_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (private.has_permission(business_id, 'tasks.manage')
         and (assignee_id = auth.uid() or created_by = auth.uid()
              or (private.has_permission(business_id, 'tasks.view_all')
                  and private.branch_visible(business_id, branch_id))))
  with check (private.has_permission(business_id, 'tasks.manage'));
revoke insert, update, delete on public.tasks from authenticated, anon;
grant insert (business_id, lead_id, customer_id, type, title, notes, due_at, assignee_id, created_by)
  on public.tasks to authenticated;
grant update (type, title, notes, due_at, assignee_id, completed_at, outcome, cancelled_at)
  on public.tasks to authenticated;

-- Notifications: each person reads and marks their own. Written by triggers only.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and private.is_member(business_id));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
revoke insert, update, delete on public.notifications from authenticated, anon;
grant update (read_at) on public.notifications to authenticated;

revoke all on public.lead_status_transitions, public.lead_lost_reasons, public.lead_assignment_settings,
  public.round_robin_members, public.tasks, public.notifications
  from anon;

grant execute on all functions in schema private to authenticated, service_role;

-- Live notifications over Supabase Realtime (skipped on plain Postgres).
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  else
    raise notice 'supabase_realtime publication not present; skipping';
  end if;
end
$realtime$;
