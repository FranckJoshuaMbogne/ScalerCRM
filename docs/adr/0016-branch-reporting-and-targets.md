# ADR 0016 — Multi-branch reporting and targets

**Date:** 14 June 2027 · **Status:** accepted

## 1. One metrics source, so branches add up
Sprint 8's `analytics_summary` counted leads, orders and payments with its own queries. Sprint 15 adds a branch comparison and report packs, and their totals must match the summary to the rupee.

So every count and sum now comes from one function, `private.metric_rows(business, from, to)`. It returns rows by branch, owner and source for:
- leads, won, lost and days to win;
- orders, revenue and collected;
- walk-ins, appointments, no-shows and attended appointments.

The summary sums all its rows. `branch_comparison` groups them by branch. The packs use both.

**The definitions are Sprint 8's.**
- Conversion is a cohort: leads created in the period that are won by now.
- Revenue is orders created in the period, not cancelled.
- Collected is payments less refunds received in the period.
- Orders and payments are credited to the order's branch and owner. Walk-ins and appointments are credited to their branch.

`987_branch_reporting.sql` checks that branch totals equal the business totals over 400 days and over 60 days.

**Not split by branch:** spend, median first reply, outstanding and overdue tasks stay business-wide in the summary. Outstanding and overdue tasks also appear per branch in the comparison, from the order's and the task's branch. Messages and ad spend have no branch.

## 2. Daily rollups that stay exact
Twelve-month views at a million leads were the risk. The answer is materialised daily rollups for history older than 90 days.

**Where they live.**
- `private.analytics_daily` holds one row per business, day, branch, owner and source, with the counts above.
- `private.analytics_rollup_state.rolled_through` is the last day the rollup covers.
- `refresh_analytics_rollups` runs on every job pass (it's cheap when there is nothing to do). It extends each business up to 91 days ago, at most 60 days a pass, so the first backfill is spread out.

**Old data can still change.** A lead from last year gets won today, or a refund is recorded on an old order. Triggers on leads, orders, payments, walk-ins and appointments mark that record's business-local day as dirty in `private.analytics_dirty_days`, when it falls inside the rollup:
- the check is one primary-key lookup, and only old records add a row;
- changing an order's branch or owner also marks its payments' days.

**Reads.** `metric_rows` reads the rollup for clean days up to `rolled_through`, and the live tables for everything else: recent days, dirty days, and days not rolled up yet. The live part is a `tstzmultirange`.

**So the rollup is an optimisation, never a different answer.** The test compares the summary with and without rollups, marks an old lead won and sees it counted at once, then re-rolls. At a million leads, a 12-month summary and branch comparison stay within the Sprint 9 budgets ([load-test.md](../load-test.md)).

## 3. Branch comparison, normalised
`branch_comparison` shows every summary metric per branch, plus:
- **Expected won:** each branch's leads multiplied by the business's conversion rate for the source each lead came from.
- **Performance index:** won ÷ expected. A branch that gets mostly walk-ins (which convert well) isn't flattered against one that lives on website enquiries. This is the method `pic_performance` uses for salespeople.

**Who sees what.**
- People with all-branch access see every branch and a "No branch" row.
- A manager limited to some branches sees only those.
- Money columns follow the analytics money permissions, as in the summary.

**Team reports.** `team_performance(business, branch, …)` is the Sprint 8 PIC report for one branch's leads, still normalised against the business's source rates. A branch manager (`store_manager`, which already has `analytics.sales`) gets it for their own branches only.

## 4. Targets
**The table.** `targets` holds rows for the business, a branch or a person, by month or quarter, for one measure:

| Measure | Counts |
|---------|--------|
| Leads handled | Leads created in the period, owned by the person or in the branch |
| Conversions | Leads moved to a won stage during the period (by `closed_at`) |
| Revenue | Orders created in the period, not cancelled |
| Collections | Payments less refunds received in the period |

**Conversions are wins in the period, not the cohort rate.** It is what a manager manages to this month, and it doesn't change after the month ends. The analytics conversion *rate* stays cohort-based.

**Rules.**
- Periods start on the first of a month or quarter (checked in SQL). Quarters are calendar quarters, labelled as Indian financial-year quarters in the app (Apr–Jun is Q1).
- Count targets are whole numbers; money targets are `numeric(14,2)`.

**Who sets and sees targets.**
- The new permission `targets.manage` (business admin, sales manager) sets targets. Targets are configuration, so they are audited.
- Managers and people with analytics see every target.
- A salesperson sees their own targets and their branches'. Money targets of other people are hidden unless the viewer can see money.

**Where they show.** `target_progress` gives each target's actual, percent, and the share of the period already gone. The progress bar marks where you'd be if the period went evenly, labelled "ahead", "on track" or "behind" (±10 points). Targets appear on the dashboard, in My day (your own), on Analytics → Targets and in packs.

## 5. Leaderboard
**Off by default.** `businesses.leaderboard_enabled` is changed only through `set_leaderboard` (settings permission, audited). Some owners don't want a public ranking.

**When it's on**, every member sees conversions, order value, collections and leads handled per person for a period, ranked by conversions. Sales managers can always see it.

## 6. Lead transfers
**Recording.** Moving a lead to another branch writes an append-only `lead_transfers` row: from and to branch, from and to owner, who moved it, and when. Imports don't record transfers.

**The report.** `transfer_report` groups transfers by route (from → to) and shows:
- how many were won afterwards;
- the median days from transfer to win;
- who sent them;
- who closed them (the owner of the won lead).

Managers see routes that touch their branches.

## 7. Report packs
**The packs.** The Sprint 8 scheduler has three new reports, weekly or monthly only:

| Pack | Holds |
|------|-------|
| `pack_owner` | Summary, every branch, targets, all salespeople, sources, campaigns and transfers |
| `pack_branch` | One branch (the schedule's `branch_id`): its figures, targets, team and transfers |
| `pack_marketing` | Summary, sources and campaigns |

**Computed as the recipient.** `report_pack_for` runs with the recipient's permissions, like `report_summary_for`. A branch manager's pack can never hold more than they could see in the app, and a branch pack can only be scheduled for a branch the person can see.

**Delivery.**
- The email carries the headline figures and targets, with every table attached as a CSV file (Resend attachments).
- It links to `/analytics/pack`: the same pack on screen, printable as the PDF ("Save as PDF", as for reports since ADR 0009), with a CSV download per table that is limited and audited like other exports.

## Consequences
- **Data cost.** The rollup is small: about one row per active branch, owner and source per day. Dirty-day triggers cost one primary-key lookup per change to an old record.
- **Rollup delay.** A business's history becomes fully rolled up over its first nights, at 60 days a pass. Until then reads are live, which is correct but slower.
- **Branch-level spend.** Ad spend per branch needs campaigns tied to branches, which they aren't. It is left out rather than guessed.
