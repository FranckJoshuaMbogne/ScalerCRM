-- Pipeline rules, lost reasons, round-robin assignment, tasks, notifications and the email outbox.
-- Uses its own users and businesses (runs after 30_customers_leads in the same database).
\set ON_ERROR_STOP on
\set QUIET on

\set lena '0b000000-0000-0000-0000-000000000001'
\set mo   '0b000000-0000-0000-0000-000000000002'
\set nia  '0b000000-0000-0000-0000-000000000003'
\set oz   '0b000000-0000-0000-0000-000000000004'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'lena', 'lena@zeta.test', '{"full_name":"Lena Admin"}'),
  (:'mo',   'mo@zeta.test',   '{"full_name":"Mo Sales"}'),
  (:'nia',  'nia@zeta.test',  '{"full_name":"Nia North"}'),
  (:'oz',   'oz@omega.test',  '{"full_name":"Oz Other"}');

-- Zeta (Lena) with Main and North branches; Omega (Oz) is a separate tenant.
select set_config('request.jwt.claim.sub', :'lena', false);
set role authenticated;
select public.create_business('Zeta Suits', 'zeta-suits', 'Main') as biz \gset
select id as main from public.branches where business_id = :'biz' \gset
insert into public.branches (business_id, name) values (:'biz', 'North') returning id as north \gset
reset role;

select set_config('request.jwt.claim.sub', :'oz', false);
set role authenticated;
select public.create_business('Omega Shoes', 'omega-shoes', 'Delhi') as other \gset
reset role;

-- Mo: sales executive (assigned only). Nia: sales manager restricted to North.
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', :'mo', id, 'active', now() from public.roles where key = 'sales_executive' and business_id is null;
insert into public.business_memberships (business_id, user_id, role_id, all_branches, status, joined_at)
select :'biz', :'nia', id, false, 'active', now() from public.roles where key = 'sales_manager' and business_id is null
returning id as nia_m \gset
insert into public.user_branch_access (membership_id, branch_id) values (:'nia_m', :'north');

select id as st_new from public.lead_statuses where business_id = :'biz' and key = 'new' \gset
select id as st_contacted from public.lead_statuses where business_id = :'biz' and key = 'contacted' \gset
select id as st_qualified from public.lead_statuses where business_id = :'biz' and key = 'qualified' \gset
select id as st_won from public.lead_statuses where business_id = :'biz' and key = 'won' \gset
select id as st_lost from public.lead_statuses where business_id = :'biz' and key = 'lost' \gset
select id as reason from public.lead_lost_reasons where business_id = :'biz' and name = 'Price too high' \gset
select set_config('t.biz', :'biz', false), set_config('t.main', :'main', false), set_config('t.north', :'north', false),
       set_config('t.st_new', :'st_new', false), set_config('t.st_won', :'st_won', false),
       set_config('t.st_lost', :'st_lost', false), set_config('t.st_qualified', :'st_qualified', false);

-- ------------------------------------------------------------ pipeline settings
select set_config('request.jwt.claim.sub', :'lena', false);
set role authenticated;

select tests.ok((select count(*) = 7 from public.lead_lost_reasons where business_id = :'biz'),
                'new business gets default lost reasons');
select tests.fails(format('update public.lead_statuses set is_default = true where id = %L', :'st_contacted'),
                   'is_default cannot be written directly');
select tests.fails(format('select public.set_default_lead_status(%L)', :'st_won'),
                   'a won stage cannot be the default');
select public.set_default_lead_status(:'st_contacted');
select tests.ok((select count(*) = 1 and bool_and(id = :'st_contacted') from public.lead_statuses
                  where business_id = :'biz' and is_default), 'default stage can be moved, and stays unique');
select public.set_default_lead_status(:'st_new');
select tests.fails(format('update public.lead_statuses set requires_owner = true where id = %L', :'st_new'),
                   'the default stage cannot require an owner (unassigned API leads land there)');
select tests.fails(format('update public.lead_statuses set stage = %L where id = %L', 'new', :'st_lost'),
                   'a lost stage must use the lost colour');
insert into public.lead_statuses (business_id, key, name, category, stage, position)
values (:'biz', 'fitting', 'Fitting booked', 'open', 'qualified', 20) returning id as st_fitting \gset
select tests.ok((select count(*) = 1 from public.audit_logs where entity_type = 'lead_statuses' and entity_id = :'st_fitting'),
                'adding a stage is audited');
select tests.fails(format('delete from public.lead_statuses where id = %L', :'st_fitting'),
                   'stages cannot be deleted, only hidden');
select public.reorder_lead_config(:'biz', 'statuses', array[:'st_fitting', :'st_new']::uuid[]);
select tests.ok((select position = 1 from public.lead_statuses where id = :'st_fitting'), 'stages can be reordered');

-- ------------------------------------------------------------ status rules
select public.create_lead(:'biz', jsonb_build_object('phone', '+919900000001', 'full_name', 'Asha', 'branch_id', :'main')) as l1 \gset
select (:'l1'::jsonb ->> 'lead_id') as lead1 \gset
select set_config('t.lead1', :'lead1', false);

select tests.fails(format('select public.create_lead(%L, %L)', :'biz',
                          jsonb_build_object('phone', '+919900000002', 'full_name', 'X', 'status_id', :'st_won')),
                   'a new lead cannot start in a won stage');
select tests.fails(format('update public.leads set status_id = %L where id = %L', :'st_lost', :'lead1'),
                   'moving to a lost stage needs a lost reason');
update public.leads set status_id = :'st_lost', lost_reason_id = :'reason', lost_note = 'Quoted 40k, wants 30k'
 where id = :'lead1';
select tests.ok((select closed_at is not null and lost_reason_id = :'reason' from public.leads where id = :'lead1'),
                'lost lead records its reason and closing time');
select tests.ok((select lost_reason_id = :'reason' and note = 'Quoted 40k, wants 30k' from public.lead_status_history
                  where lead_id = :'lead1' and to_status_id = :'st_lost'),
                'status history keeps the lost reason and note');
select tests.ok((select count(*) = 0 from public.lead_activities where lead_id = :'lead1' and type = 'updated'),
                'lost reason is part of the move, not a separate edit');
select tests.fails(format('update public.leads set lost_reason_id = null where id = %L', :'lead1'),
                   'a lost lead cannot drop its reason');
update public.leads set status_id = :'st_contacted' where id = :'lead1';
select tests.ok((select closed_at is null and lost_reason_id is null and lost_note is null from public.leads where id = :'lead1'),
                'reopening clears the lost reason and closing time');
select tests.fails(format('update public.lead_statuses set category = %L, stage = %L where id = %L', 'won', 'won', :'st_contacted'),
                   'a stage in use cannot change type');
select tests.fails(format('update public.lead_statuses set is_active = false where id = %L', :'st_contacted'),
                   'a stage with open leads cannot be hidden');

-- Transition rules
select public.set_lead_status_transitions(:'st_contacted', array[:'st_lost', :'st_qualified']::uuid[]);
select tests.ok((select count(*) = 2 from public.lead_status_transitions where from_status_id = :'st_contacted'),
                'allowed next stages are saved');
select tests.fails(format('update public.leads set status_id = %L where id = %L', :'st_won', :'lead1'),
                   'a move outside the allowed next stages is refused');
-- requires_owner
update public.lead_statuses set requires_owner = true where id = :'st_qualified';
select tests.fails(format('update public.leads set status_id = %L where id = %L', :'st_qualified', :'lead1'),
                   'a stage that needs an owner refuses an unassigned lead');
update public.leads set owner_id = :'lena' where id = :'lead1';
update public.leads set status_id = :'st_qualified' where id = :'lead1';
select tests.ok((select status_id = :'st_qualified' from public.leads where id = :'lead1'), 'allowed move succeeds');
select tests.fails(format('update public.leads set owner_id = null where id = %L', :'lead1'),
                   'cannot unassign a lead in a stage that needs an owner');
select public.set_lead_status_transitions(:'st_contacted', '{}');
update public.lead_statuses set requires_owner = false where id = :'st_qualified';

-- Owners must be able to see the lead
select tests.fails(format('update public.leads set owner_id = %L where id = %L', :'nia', :'lead1'),
                   'cannot give a Main lead to someone who only sees North');
reset role;

-- Leads lost before reasons existed still accept notes and edits.
alter table public.leads disable trigger leads_status_rules;
update public.leads set status_id = :'st_lost' where id = :'lead1';
alter table public.leads enable trigger leads_status_rules;
select set_config('request.jwt.claim.sub', :'lena', false);
set role authenticated;
insert into public.lead_activities (business_id, lead_id, type, body, actor_id)
values (:'biz', :'lead1', 'note', 'Called back', :'lena');
update public.leads set title = 'Suit' where id = :'lead1';
select tests.ok((select title = 'Suit' from public.leads where id = :'lead1'), 'legacy lost leads without a reason stay editable');

-- ------------------------------------------------------------ round-robin
insert into public.lead_assignment_settings (business_id, round_robin_enabled, updated_by) values (:'biz', true, :'lena');
insert into public.round_robin_members (business_id, branch_id, user_id) values (:'biz', null, :'mo');
insert into public.round_robin_members (business_id, branch_id, user_id) values (:'biz', null, :'lena');
insert into public.round_robin_members (business_id, branch_id, user_id) values (:'biz', :'north', :'nia');
select tests.fails(format('insert into public.round_robin_members (business_id, branch_id, user_id) values (%L, %L, %L)',
                          :'biz', :'main', :'nia'),
                   'cannot add someone to a branch pool they cannot see');

select (public.create_lead(:'biz', jsonb_build_object('phone', '+919900000011', 'full_name', 'R1')) ->> 'lead_id') as rr1 \gset
select (public.create_lead(:'biz', jsonb_build_object('phone', '+919900000012', 'full_name', 'R2')) ->> 'lead_id') as rr2 \gset
select (public.create_lead(:'biz', jsonb_build_object('phone', '+919900000013', 'full_name', 'R3')) ->> 'lead_id') as rr3 \gset
select (public.create_lead(:'biz', jsonb_build_object('phone', '+919900000014', 'full_name', 'R4', 'branch_id', :'north')) ->> 'lead_id') as rr4 \gset
select tests.ok((select array_agg(owner_id order by created_at) = array[:'mo', :'lena', :'mo']::uuid[]
                   from public.leads where id in (:'rr1', :'rr2', :'rr3')),
                'unassigned leads are handed out in turn');
select tests.ok((select owner_id = :'nia' from public.leads where id = :'rr4'),
                'a North lead goes to the North pool first');
select tests.ok((select count(*) = 1 from public.lead_activities where lead_id = :'rr1' and type = 'created'
                    and meta ->> 'owner_id' = :'mo'),
                'the timeline records who the lead was assigned to on creation');
select tests.ok((select count(*) = 0 from public.audit_logs
                  where entity_type = 'round_robin_members' and action = 'update'),
                'rotation turns are not written to the audit log');

-- Manual round-robin over the unassigned queue
update public.lead_assignment_settings set round_robin_enabled = false, updated_by = :'lena' where business_id = :'biz';
select (public.create_lead(:'biz', jsonb_build_object('phone', '+919900000015', 'full_name', 'Q1')) ->> 'lead_id') as q1 \gset
select tests.ok((select owner_id is null from public.leads where id = :'q1'), 'with round-robin off, leads wait unassigned');
select tests.ok(public.assign_leads_round_robin(:'biz', array[:'q1']::uuid[]) = 1, 'the queue can be assigned in rotation');
select tests.ok((select owner_id = :'lena' from public.leads where id = :'q1'), 'rotation continues where it left off');
reset role;

select set_config('request.jwt.claim.sub', :'mo', false);
set role authenticated;
select tests.ok((select count(*) = 2 from public.leads), 'the sales executive sees the two leads given to them');
select tests.ok((select count(*) = 2 from public.notifications where type = 'lead_assigned'),
                'and was notified about both');
select tests.fails(format('select public.assign_leads_round_robin(%L, %L)', current_setting('t.biz'), '{}'),
                   'cannot run round-robin without leads.assign');
select tests.fails(format('insert into public.round_robin_members (business_id, user_id) values (%L, %L)',
                          current_setting('t.biz'), :'mo'),
                   'cannot change the rotation without leads.assign');
select tests.fails(format('insert into public.notifications (business_id, user_id, type, title) values (%L, %L, %L, %L)',
                          current_setting('t.biz'), :'mo', 'x', 'x'),
                   'notifications cannot be written by members');
reset role;
select set_config('request.jwt.claim.sub', :'lena', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.notifications where type = 'lead_assigned'),
                'taking a lead yourself sends no notification');
reset role;

-- ------------------------------------------------------------ tasks
select set_config('request.jwt.claim.sub', :'mo', false);
set role authenticated;
insert into public.tasks (business_id, lead_id, type, title, due_at, assignee_id, created_by)
values (:'biz', :'rr1', 'call', 'Call about fabric', now() + interval '2 days', :'mo', :'mo') returning id as t1 \gset
insert into public.tasks (business_id, lead_id, type, title, due_at, assignee_id, created_by)
values (:'biz', :'rr1', 'whatsapp', 'Send photos', now() + interval '1 day', :'mo', :'mo') returning id as t2 \gset
select tests.ok((select next_follow_up_at = (select due_at from public.tasks where id = :'t2') from public.leads where id = :'rr1'),
                'the lead shows its earliest open follow-up');
select tests.ok((select t.customer_id is not null and t.branch_id is not distinct from l.branch_id
                   from public.tasks t join public.leads l on l.id = t.lead_id where t.id = :'t1'),
                'tasks take the customer and branch from their lead');
select tests.ok((select count(*) = 2 from public.lead_activities where lead_id = :'rr1' and type = 'task_created'),
                'new tasks appear on the lead timeline');
select tests.fails(format('insert into public.tasks (business_id, lead_id, title, due_at, assignee_id, created_by) values (%L, %L, %L, now(), %L, %L)',
                          current_setting('t.biz'), :'rr1', 'x', :'lena', :'mo'),
                   'a sales executive cannot give tasks to someone else');
select tests.fails(format('insert into public.tasks (business_id, lead_id, title, due_at, assignee_id, created_by) values (%L, %L, %L, now(), %L, %L)',
                          current_setting('t.biz'), :'rr2', 'x', :'mo', :'mo'),
                   'cannot add a task to a lead you cannot see');
update public.tasks set completed_at = now(), outcome = 'Sent 4 photos' where id = :'t2';
select tests.ok((select completed_by = :'mo' from public.tasks where id = :'t2'), 'completing a task records who did it');
select tests.ok((select next_follow_up_at = (select due_at from public.tasks where id = :'t1') from public.leads where id = :'rr1'),
                'the next follow-up moves on when one is done');
select tests.ok((select count(*) = 1 from public.lead_activities where lead_id = :'rr1' and type = 'task_completed'
                    and body = 'Sent 4 photos'),
                'the outcome lands on the lead timeline');
select tests.fails(format('delete from public.tasks where id = %L', :'t1'), 'tasks are cancelled, never deleted');
select tests.fails(format('update public.tasks set completed_by = %L where id = %L', :'lena', :'t1'),
                   'completed_by is set by the database');
reset role;

select set_config('request.jwt.claim.sub', :'lena', false);
set role authenticated;
update public.leads set branch_id = :'main' where id = :'rr3';
insert into public.tasks (business_id, lead_id, type, title, due_at, assignee_id, created_by)
values (:'biz', :'rr3', 'visit', 'Fitting reminder', now() - interval '1 hour', :'mo', :'lena') returning id as t3 \gset
insert into public.tasks (business_id, lead_id, title, due_at, assignee_id, created_by)
values (:'biz', :'rr2', 'Lena''s own follow-up', now() + interval '3 days', :'lena', :'lena') returning id as t4 \gset
insert into public.tasks (business_id, lead_id, title, due_at, assignee_id, created_by)
values (:'biz', :'rr4', 'North follow-up', now() + interval '10 minutes', :'nia', :'lena') returning id as t5 \gset
insert into public.tasks (business_id, lead_id, title, due_at, assignee_id, created_by)
values (:'biz', :'lead1', 'Main follow-up', now() + interval '4 days', :'lena', :'lena');
select set_config('t.t4', :'t4', false), set_config('t.t5', :'t5', false), set_config('t.t3', :'t3', false);
reset role;

select set_config('request.jwt.claim.sub', :'mo', false);
set role authenticated;
select tests.ok((select count(*) = 1 from public.notifications where type = 'task_assigned'),
                'the assignee is told when a manager gives them a task');
select tests.ok((select count(*) = 3 from public.tasks), 'a sales executive sees only their own tasks');
select tests.affects_none(format('update public.tasks set title = %L where id = %L', 'x', current_setting('t.t4')),
                          'and cannot edit other people''s');
reset role;

select set_config('request.jwt.claim.sub', :'nia', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.tasks where branch_id = current_setting('t.main')::uuid)
                and (select count(*) = 1 from public.tasks where branch_id = current_setting('t.north')::uuid),
                'a North-only manager sees North tasks, not Main ones');
reset role;

select set_config('request.jwt.claim.sub', :'oz', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.tasks), 'other tenant sees no tasks');
select tests.ok((select count(*) = 0 from public.notifications), 'other tenant sees no notifications');
select tests.ok((select count(*) = 0 from public.round_robin_members), 'other tenant sees no rotation');
select tests.ok((select count(*) = 0 from public.lead_lost_reasons where business_id = current_setting('t.biz')::uuid),
                'other tenant sees no lost reasons');
reset role;

-- ------------------------------------------------------------ jobs
select set_config('request.jwt.claim.sub', :'lena', false);
set role authenticated;
select tests.fails('select public.run_task_jobs()', 'members cannot run background jobs');
select tests.fails('select * from public.claim_emails(5)', 'members cannot read the email outbox');
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.run_task_jobs() as jobs \gset
reset role;
select tests.ok((:'jobs'::jsonb ->> 'overdue')::int = 1, 'one task became overdue');
select tests.ok((select count(*) = 1 from public.notifications where user_id = :'mo' and type = 'task_overdue'),
                'the assignee is told about the overdue task');
select tests.ok((select count(*) = 1 from public.notifications where user_id = :'lena' and type = 'team_tasks_overdue'),
                'the manager gets a team summary');
select tests.ok((select count(*) = 0 from public.notifications where user_id = :'nia' and type = 'team_tasks_overdue'),
                'a manager for another branch does not');
select tests.ok((select branch_id = current_setting('t.main')::uuid from public.tasks where id = current_setting('t.t3')::uuid),
                'moving a lead to another branch moves its tasks');
select tests.ok((select count(*) = 2 from private.email_outbox where template = 'task_reminder'),
                'reminder emails are queued for tasks coming due');
set role service_role;
select public.run_task_jobs() as jobs2 \gset
reset role;
select tests.ok((:'jobs2'::jsonb ->> 'overdue')::int = 0 and (:'jobs2'::jsonb ->> 'reminders_queued')::int = 0,
                'running the jobs again sends nothing twice');

set role service_role;
select id as mail1 from public.claim_emails(1) \gset
select public.finish_email(:'mail1', 'smtp down');
reset role;
select tests.ok((select status = 'pending' and attempts = 1 from private.email_outbox where id = :'mail1'),
                'a failed send is retried');
set role service_role;
select array_agg(id) as ids, count(*) as claimed from public.claim_emails(10) \gset
select public.finish_email(x) from unnest(:'ids'::bigint[]) x;
reset role;
select tests.ok(:'claimed' = 2 and (select count(*) = 2 from private.email_outbox where status = 'sent'),
                'claimed emails are marked sent');

-- Moving the due date re-arms the reminder.
select set_config('request.jwt.claim.sub', :'lena', false);
set role authenticated;
update public.tasks set due_at = now() + interval '1 day' where id = current_setting('t.t3')::uuid;
select tests.ok((select reminder_sent_at is null and overdue_notified_at is null from public.tasks
                  where id = current_setting('t.t3')::uuid), 'rescheduling a task re-arms its reminders');
reset role;

-- ------------------------------------------------------------ notifications
select set_config('request.jwt.claim.sub', :'mo', false);
set role authenticated;
update public.notifications set read_at = now() where read_at is null;
select tests.ok((select count(*) = 0 from public.notifications where read_at is null), 'notifications can be marked read');
select tests.fails(format('update public.notifications set user_id = %L', :'lena'), 'notifications cannot be handed to someone else');
reset role;

-- ------------------------------------------------------------ merge keeps tasks
select set_config('request.jwt.claim.sub', :'lena', false);
set role authenticated;
select (public.find_or_create_customer(:'biz', '+919900000021', null, 'Keep', null) ->> 'customer_id') as keep \gset
select (public.find_or_create_customer(:'biz', '+919900000022', null, 'Dup', null) ->> 'customer_id') as dup \gset
insert into public.tasks (business_id, customer_id, title, due_at, assignee_id, created_by)
values (:'biz', :'dup', 'Birthday call', now() + interval '5 days', :'lena', :'lena') returning id as t6 \gset
select public.merge_customers(:'keep', :'dup');
select tests.ok((select customer_id = :'keep' from public.tasks where id = :'t6'), 'tasks follow a customer merge');
reset role;

\echo 'pipeline, assignment and tasks: all checks passed'
