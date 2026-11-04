# ADR 0009 — Automation engine, lead scoring and analytics

**Date:** 22 February 2027 · **Status:** accepted

## 1. Automations run in the database, stepped by the job route
An automation has three parts:
- **a trigger** (lead created, stage changed, assigned or idle for N days; order created or stage changed; appointment no-show);
- **optional conditions**, checked against fresh data when the run starts;
- **a list of actions**: create task, notify, assign by round-robin, assign to a person, change stage, tag customer, wait, send WhatsApp template.

Triggers on `leads`, `orders` and `appointments` queue one `automation_runs` row per matching active automation. Idle leads are found by a scan, deduplicated per quiet spell.

The job route (every 5 minutes) steps due runs through `step_automation_run()`, which works through the actions in order:
- **Waits** park the run until `run_at`.
- **Failed steps** retry after 5 and 10 minutes, then the run is marked `failed`; admins can retry failed runs.
- **WhatsApp template steps** are handed back to the app, which calls the provider and then resumes the run. The template must be approved. Marketing templates go only to customers who opted in and aren't suppressed, the same rule as campaigns.

Every step is written to the run's `log`, and skipped runs record why.

Each business gets six ready-made automations, switched off: call new leads within 15 minutes, round-robin and alert on unassigned leads, chase quiet leads, follow up no-shows, tag converted customers, and ask for feedback after delivery. They can be switched on and edited, but not deleted.

## 2. Lead scoring v1 is rules, not a model
Scoring is a sum of points from `lead_scoring_rules`: source, stage colour, expected value, email given, appointment booked, recent activity, number of logged activities. Triggers keep `leads.score` current.

- **Time-based rules:** these decay, so every lead is rescored nightly. Changing the rules rescores everything at once.
- **Write access:** the score has no column grant, so nobody can type a score in.
- **Timeline:** score changes are excluded from the lead timeline diff.

## 3. One set of metric definitions
`src/modules/analytics/metrics.ts` holds the written definition of every number. `analytics_summary()` and `analytics_breakdown()` are the only SQL that computes them. The dashboard, the Analytics pages, scheduled report emails and the definitions panel all use the same two, so the same label never shows two different numbers.

**Cohort rule:** conversion counts leads created in the period that are won now, not leads won during the period. Breakdowns credit orders to the lead cohort by customer, from when the lead was created. That makes sources and salespeople comparable.

**Money visibility:**
- money figures are returned only to roles with sales, financial or marketing analytics;
- ad spend needs financial or marketing analytics;
- everyone else sees counts only.

## 4. Fair salesperson comparisons
`pic_performance()` counts only leads at least 7 days old, so a salesperson isn't penalised for brand-new leads. Each person's conversions are compared with what the business converts on leads from the same sources: expected = Σ source conversion rate per lead. The index is actual ÷ expected, so 1.00 means as expected. A salesperson fed mostly cold leads isn't marked down for it. Days to convert and overdue tasks are shown alongside.

## 5. Exports, PDFs and scheduled reports
- **CSV exports** (`/api/export/leads|customers|orders`) read with the user's own client. An export contains exactly what the person can see, up to 10,000 rows.
  - Spreadsheet formulas are neutralised.
  - Exports are UTF-8 with a BOM, so Excel shows ₹ and Indian scripts correctly.
  - Every export is written to the audit log.
- **PDF:** a print stylesheet plus the browser's "Save as PDF". A server-side PDF engine would add a dependency and font handling for ₹ and Indian scripts for little gain.
- **Scheduled reports:** daily, weekly or monthly at 8 am business time, emailed to the person who scheduled them. Figures are computed with that person's permissions.

## 6. Saved views
Saved views store the filter part of a page's address, never the page number. They can be private or shared with the team, and are used on the lead list and Analytics.

## Not built
"Preconfigured workflows from the PRD table" and the PRD §6 metric list aren't in this repository. The presets and metrics above are the working set. When the PRD tables arrive, they map onto new presets (seed rows) and new `METRICS` entries without schema changes.
