# ADR 0015 — Visual workflow editor

**Date:** 31 May 2027 · **Status:** accepted

## 1. An automation is a graph
The Sprint 8 engine ran a list of actions after one set of conditions. A workflow is now a graph of steps, stored as JSON:

| Step | Exits | Does |
|------|-------|------|
| `trigger` | next | What starts it (the Sprint 8 triggers and their filters) |
| `condition` | yes, no | Checks, all or any, on lead, customer, order and message facts |
| `wait` | next | A fixed time |
| `wait_until` | next | A time of day, or the next opening hour, in the business's time zone |
| `wait_for_reply` | replied, timeout | Waits for a WhatsApp reply from the customer, up to a time limit |
| `action` | next | Sprint 8 actions, plus send email, update a custom field and call a webhook |

**New condition facts:** the customer has an email or a phone, WhatsApp opt-in, customer tags (include / don't include), replied since the run started, and the order balance.

**Opening hours are on the step.** There is no business-wide opening-hours setting yet. The default is 10:00–20:00, Monday to Saturday.

**One set of rules, checked in two places.** `src/modules/automation/graph.ts` checks the rules in the editor, and `private.automation_graph_errors` checks the same ones on publish:
- exactly one trigger;
- every connection points at a step that exists;
- every step is reachable from the trigger;
- no loops (branches may join again, but never lead back);
- at most 50 steps;
- every step has its settings.

## 2. Converting what exists
`private.linear_to_graph` turns the Sprint 8 format into trigger → condition (with only a yes exit) → each action in turn. A wait becomes a `wait` step.

**The migration converted everything:**
- every automation, the six presets included, now has version 1;
- queued and waiting runs continue at the same step (Sprint 8's step *n* is node `a<n+1>`).

**The old format still works.** Anything written in it later is converted and published by a trigger. That covers new businesses' presets (`seed_automation_defaults` is unchanged), the industry templates and old clients.

**Skipped versus done.** When the first condition fails and has no "no" exit, the run is *skipped* with the reason "conditions not met", exactly as before. A "no" exit that leads nowhere later in the graph ends the run as *done*.

**Acceptance.** `supabase/tests/90_automation_analytics.sql`, the Sprint 8 tests, passes unchanged against the graph engine. `986_workflows.sql` checks the conversion itself, and `graph.test.ts` checks that the TypeScript conversion gives the same graph as the SQL one.

## 3. Versions
**Drafts.** Editing saves `automations.draft_graph`. Live runs don't see it.

**Publishing.** Publishing writes an immutable `automation_versions` row (version n+1) and points `current_version_id` at it. It also copies the trigger and its filter onto `automations`, because events are matched on them.

**Runs keep their version.** A run records `version_id` when it is queued and walks that version's graph until it ends. A run that waits for a week finishes on the version it started on, even after three more publishes.

**Rolling back** publishes an old version's graph again, as a new version. History only grows, and the run statistics stay with the version they came from.

## 4. The engine
`step_automation_run` keeps its contract with the job route: `{status}`, `external` for WhatsApp sends, `finish_automation_external` afterwards. Inside, it walks the run's `node_id` until the workflow ends, waits or hands off to the app.
- **Errors** keep Sprint 8's behaviour: a step that throws is retried after 5 and 10 minutes, then the run fails.
- **Problems a retry can't fix** are logged and the run moves on: no email address, a deleted custom field, a switched-off endpoint, or the message limit reached.
- **Wait for a reply.** The run records who it is waiting for (`waiting_customer_id`). An inbound WhatsApp message wakes the run at once (a trigger on `messages`), instead of after the full timeout.
- **Send email.** It goes through the email outbox (`automation_email`), with `{{customer_name}}`, `{{business_name}}`, `{{lead_number}}` and `{{owner_name}}` filled in by the database.
- **Call a webhook.** It sends a signed `automation.called` event, with the lead, customer and order, to one of the business's Sprint 13 endpoints. It is not sent to any URL typed into the step. That keeps one place for signing secrets, retries, the delivery log and the private-address checks. The event is in the OpenAPI document and the contract tests.

## 5. Guard-rails
- **No loops in a graph.** Checked on publish, in the editor and in the database.
- **100 steps per run.** A run that somehow exceeds this fails with "stopped after 100 steps". The test bypasses validation to prove it.
- **No loops between automations.** While a run steps, `scaler.automation_chain` holds the automations that led to it. A change made by a run can't start an automation already in that chain, and chains stop at 5 deep. Without this, "any stage change → move to Contacted" plus "Contacted → move to Qualified" would trigger each other forever. Each run records its `chain`.
- **Plan limits.** Automation emails count as messages for the plan (`monthly_messages`) and stop when it is used up, as WhatsApp sends already do.

## 6. Dry runs never write
`automation_dry_run(automation, 'lead' | 'order', id, graph?)` walks the draft, an unsaved graph or the live version for a real record:
- it evaluates the conditions with that record's facts;
- it lets later steps see earlier simulated changes (a stage change, an owner, a tag);
- it describes each action in plain words.

For a wait for a reply, it shows the no-reply path.

**How "never writes" is guaranteed.** The function is `stable`, so Postgres itself refuses any insert, update or delete it tries. The SQL test counts tasks, notifications, runs, step logs, tags, emails, webhook events, audit rows and owners before and after dry runs of every automation.

## 7. Per-step analytics
Every step a run takes appends a row to `automation_run_steps`: the node and its outcome (ok, error, yes, no, replied, timeout, waiting). `automation_step_stats` reports, per version and per step:
- runs that reached it;
- successes and failures;
- branch counts;
- **conversion after each branch:** how many leads that went down "yes" or "no" are won now.

The editor shows these on the canvas.

## 8. The editor
**The canvas.** It uses React Flow (`@xyflow/react` 12):
- one node type that draws every kind of step, with an exit handle per branch;
- a side panel to edit the selected step;
- the dry-run path highlighted on the canvas.

**Saving.** Server actions save drafts and publish. The editor checks the graph as you go and won't publish while it has errors.

## Consequences
- **The old columns are emptied on publish.** `automations.conditions` and `actions` still exist, so old clients that write them keep working, but the graph is the truth.
- **Email replies don't count.** Wait for a reply listens only to WhatsApp, because SCALER doesn't receive email.
- **Opening hours live on each step.** If business-wide opening hours are added later, the step can default to them.
