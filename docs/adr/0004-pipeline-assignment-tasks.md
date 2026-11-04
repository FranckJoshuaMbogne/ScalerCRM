# ADR 0004 — Pipeline rules, lead assignment, tasks, notifications and email

**Date:** 14 December 2026 · **Status:** accepted

## 1. Pipeline rules live in the database
Every write path goes through the `leads_status_rules` trigger (`private.apply_lead_status_rules()`): the board, the lead page, the API and any future integration. The board mirrors the same checks in `src/modules/pipeline/board.ts` (`checkMove`) so it can refuse a drop without a round trip, but the database decides.

- **Allowed next stages.** `lead_status_transitions` lists the stages a stage may move to. A stage with no rows can move anywhere. That way the default pipeline has no rules and a business opts in stage by stage.
- **Lost needs a reason.** Moving into a lost-type stage needs a `lost_reason_id` from the business's `lead_lost_reasons`, plus an optional note. Both go into `lead_status_history` with the move. Reopening clears them. Leads lost before Sprint 3 keep working without a reason, because the rule only fires on a move or when the reason is changed.
- **Stages that need an owner.** With `requires_owner`, a lead can't enter the stage unassigned, and can't be unassigned while it's there.
- **New leads start open.** A lead can't be created directly in a won or lost stage.
- `closed_at` is set when a lead enters a won or lost stage and cleared on reopen, for later reporting.

Stage configuration is guarded too. The default stage must be an active open stage, and it changes only through `set_default_lead_status()`; `is_default` has no column grant. A stage's type can't change while leads use it, and it can't be hidden while open leads sit in it. Stages and sources are never deleted. The stage colour has to match its type.

## 2. Owners must be able to see their leads
`private.member_can_own_lead()` checks that a would-be owner either has `leads.view_assigned` (which lets owners see their own leads) or has `leads.view_all` with access to the lead's branch. It runs on every owner or branch change, and for round-robin candidates. This closes a Sprint 2 gap: a branch-restricted manager could be given a lead they couldn't open.

## 3. Round-robin assignment
- `lead_assignment_settings.round_robin_enabled` is one switch per business. When it's on, a `BEFORE INSERT` trigger gives any new lead without an owner to the next person. That covers manual entry with "Unassigned", the API, and future WhatsApp and Meta intake.
- Each branch has its own pool in `round_robin_members` (`branch_id` set). The business-wide pool (`branch_id` null) serves leads with no branch, and branches whose own pool is empty or can't take the lead.
- The next person is the one with the oldest `last_assigned_at`. Rows are locked with `FOR UPDATE SKIP LOCKED`, so simultaneous leads go to different people. People who have left, are paused, or can't see the lead are skipped.
- The unassigned queue (`/leads/queue`) can assign one lead manually, or hand out a selection through `assign_leads_round_robin()`.
- A lead with no owner shows **Unassigned** everywhere. That plus the queue meets the acceptance rule "every lead has an owner or an explicit unassigned state".
- Rotation turns (`last_assigned_at`) are excluded from the audit log. Changes to who is in a rotation are audited.

## 4. Tasks
`tasks` belong to a lead, a customer, or neither (personal to-dos). They are completed or cancelled, never deleted.

- Tasks take their customer and branch from their lead, and follow it through branch changes and customer merges.
- `leads.next_follow_up_at` is the earliest open task's due time, kept current by triggers. It powers the overdue badges on the list, board and lead page without a join.
- Creating, completing and cancelling a task writes to the lead timeline.
- **Visibility:** a person sees tasks assigned to them, tasks they created, tasks on leads they can see, and, with `tasks.view_all`, everyone's tasks in their branches. Giving a task to someone else needs `tasks.view_all`.
- Changing a task's due time re-arms its reminder and overdue alert.
- Due times are entered in the business's time zone. `src/modules/tasks/schedule.ts` converts with `Intl`, so there's no date library, and it is unit tested across IST and a DST zone. Preset times ("Tomorrow, 10 am") are resolved on the server when the form is sent.

## 5. Notifications: written by triggers, delivered by Realtime
Only `security definer` triggers and jobs insert into `notifications`. Members can read their own and set `read_at`, nothing else. The header bell subscribes to inserts through Supabase Realtime (`supabase_realtime` publication). RLS on the table limits the stream to the signed-in user.

Notifications are sent for:
- a lead assigned to you by someone else, including round-robin and API leads;
- a task assigned to you by someone else;
- your task becoming overdue;
- for managers with `tasks.view_all`, one summary per job run of newly overdue tasks belonging to other people in their branches.

## 6. Email: an outbox in Postgres, sent by a job route
- Reminder emails are queued by the database in `private.email_outbox` (`run_task_jobs()`, 15 minutes before a task is due). They're sent by `GET /api/cron/tasks`, which renders the template in TypeScript (`src/modules/email/templates.ts`) and calls Resend's HTTP API. Claims use `SKIP LOCKED`; a failure is retried up to 3 times and anything older than a day expires.
- The job route is the first use of the service-role key, which the project rules reserve for server jobs and webhooks (README, rule 2). It has no user, is gated by `CRON_SECRET`, and calls only the three job functions (`run_task_jobs`, `claim_emails`, `finish_email`), which are executable by `service_role` alone. The outbox sits in the `private` schema, which the API never exposes.
- **Invitations are emailed directly** from the invite action, not through the outbox. The raw invitation token only exists in that request, and storing it would undo the token hashing from Sprint 1. The link is still shown, so a failed or unconfigured email never blocks an invitation.
- Without `RESEND_API_KEY` and `EMAIL_FROM`, nothing is emailed and the app works as before.

**Scheduling.** Call the route every 5 minutes. Vercel Cron does this on the Pro plan (Hobby is daily only, which is too slow for reminders). On Supabase, once the `pg_cron` and `pg_net` extensions are enabled:

```sql
select cron.schedule('scaler-task-jobs', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://app.example.com/api/cron/tasks',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'))
$$);
```

**Revisit when:** the job queue lands in Sprint 4 (Inngest). The route's body becomes a scheduled function, and the outbox stays. Also revisit if people want to choose which emails they get; per-user notification preferences aren't in scope yet.
