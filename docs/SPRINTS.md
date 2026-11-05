# SCALER — Sprint Plan v1.0

**Product:** SCALER — omnichannel lead management, marketing automation and sales CRM (multi-tenant SaaS, PWA)
**First tenant:** MY PERFECT FIT
**Cadence:** 10 sprints × 2 weeks ≈ 20 weeks to v1.0 (planning estimate, not a guarantee — Meta/WhatsApp app review and BSP onboarding are external dependencies)
**Start:** Monday 2 November 2026

## Guiding rules

1. **Tenant-first.** Every business-owned table has `business_id` and RLS from the migration that creates it. No table ships without an isolation test.
2. **CIF is the centre.** Leads, conversations, appointments, orders and campaign sends all reference `customers.id`.
3. **Modular monolith.** One Next.js app; business logic lives in `src/modules/<domain>`, never in pages. Providers (WhatsApp, Meta, Google) sit behind adapters in `src/modules/integrations`.
4. **History is append-only.** Status changes, payments and webhook events are recorded as rows, never overwritten.
5. **Async by default for anything external.** Webhooks acknowledge fast and hand off to the job queue; campaigns never run in a browser request.
6. **Definition of Done** (every story): typed, RLS-covered, tested (unit + isolation where data is touched), audited where it mutates business data, works at 375px width, CI green.

## Roadmap at a glance

| # | Sprint | Dates (2026–27) | PRD milestone | Demo at sprint review |
|---|--------|-----------------|---------------|------------------------|
| 0 | Foundation & design system | 2 Nov – 15 Nov | M1 | App shell, design tokens, schema foundation, CI |
| 1 | Auth, tenants & RBAC | 16 Nov – 29 Nov | M1 | Sign up → create business → invite employee → scoped access |
| 2 | Customers (CIF) & leads core | 30 Nov – 13 Dec | M2 | Create lead → CIF matched by phone → timeline |
| 3 | Pipeline, PIC & tasks | 14 Dec – 27 Dec | M2 | Kanban drag, assignment, follow-up reminders |
| 4 | Walk-ins, appointments & orders | 28 Dec – 10 Jan | M3 | Walk-in → quotation → order → partial payments → tracking |
| 5 | WhatsApp engine & inbox | 11 Jan – 24 Jan | M4 | Inbound WhatsApp creates/updates lead, reply from CRM |
| 6 | Templates, consent & campaigns | 25 Jan – 7 Feb | M4 | Audience → approved template → queued send → delivery report |
| 7 | Meta, Google & attribution | 8 Feb – 21 Feb | M5 | Meta Lead Ad lands as lead with campaign IDs; integration health |
| 8 | Automation & analytics | 22 Feb – 7 Mar | M5 | Workflows firing, executive / marketing / PIC dashboards, exports |
| 9 | Hardening & MY PERFECT FIT go-live | 8 Mar – 21 Mar | M6 | PWA installed, prod deploy, data migration, training |

---

## Sprint 0 — Foundation & design system
**Goal:** a running, deployable skeleton that every later sprint builds on.

- Next.js (App Router) + TypeScript + Tailwind, folder structure by domain
- SCALER design tokens: deep navy primary, blue accent, status colours, typography, light/dark
- UI primitives (button, card, badge, input, table, stat tile) and the application shell: sidebar with Workspace / Administration groups, top bar, mobile bottom nav
- Placeholder routes for all 12 modules
- Supabase project layout: first migration with `businesses`, `branches`, `profiles`, `business_memberships`, `roles`, `permissions`, `role_permissions`, `audit_logs`, tenant helper functions and RLS
- Seed: system roles (8 from PRD) and permission catalogue
- GitHub Actions: lint, typecheck, unit tests, build, migration check
- `.env.example`, README, ADR log

**Acceptance:** `npm run build` passes in CI; migrations apply cleanly to an empty Postgres; a SQL test proves user A cannot read business B's rows.

## Sprint 1 — Auth, tenants & RBAC
**Goal:** a business can sign up, configure itself and onboard staff with correct access.
**Status:** built on branch `sprint-1/auth-tenants-rbac`. Invitations are shared as one-time links (WhatsApp or email by hand); automatic invitation emails come with transactional email in Sprint 3.

- Supabase Auth (email + magic link; Google OAuth optional), session middleware
- Onboarding wizard: business profile, currency, timezone, first branch
- Business switcher (one user, many businesses)
- Employee invitations (email link, expiry, accept flow)
- Role & permission management UI; permission checks in server actions (`can(user, 'leads.assign')`)
- Branch management; `user_branch_access` record-level restriction
- Audit log writer + viewer
- Platform admin flag (super admin) — separate from tenant roles

**Acceptance:** PRD M1 criteria — create account, invite employee, employee sees only authorised records, two businesses fully isolated (automated test).

## Sprint 2 — Customers (CIF) & leads core
**Goal:** every enquiry becomes a lead attached to exactly one customer.
**Status:** built on branch `claude/sweet-curie-2qveb2`. Decisions in [ADR 0003](adr/0003-customers-and-leads.md), API in [api.md](api.md). Statuses and sources are configurable in the database (`settings.pipeline.manage`); their settings screen ships with the pipeline settings UI in Sprint 3.

- `customers`, `customer_contacts`, `customer_addresses`, tags, `customer_consents`
- Phone normalisation to E.164 (libphonenumber), CIF number sequence per business (`CIF-000001`)
- Matching service: phone → email → create; never merge on name; manual merge tool that preserves history
- `leads`, `lead_sources`, `lead_statuses` (seeded 12-stage default, configurable), `lead_status_history`, `lead_activities`
- Lead number sequence (`L-000001`), first/latest source & campaign fields
- Lead create (manual), lead list with filters & search, lead detail with activity timeline
- CIF profile page (identity, leads, orders placeholder, consent, notes, attachments)
- Custom fields engine (`custom_field_definitions` + JSON values) — used for the tailoring extension
- Public `POST /api/v1/leads` (API key per business) for website forms, with idempotency key

**Acceptance:** manual and API leads recorded; repeated phone number links to same CIF; every change is in history.

## Sprint 3 — Pipeline, PIC & tasks
**Goal:** sales teams can work their pipeline daily.
**Status:** built on branch `sprint-3/pipeline-pic-tasks`. Decisions in [ADR 0004](adr/0004-pipeline-assignment-tasks.md). Reminder emails and overdue alerts need the job route scheduled every 5 minutes; invitation emails need `RESEND_API_KEY` and `EMAIL_FROM` (without them invitations are still shared as links).

- Kanban board with drag-and-drop between configurable stages; transition rules; lost-reason capture
- Pipeline settings UI (rename, reorder, add stages, won/lost flags)
- PIC assignment: manual, round-robin per branch, unassigned queue
- Tasks & follow-ups: due dates, types (call / WhatsApp / visit), overdue state, "My day" view
- In-app notifications (Supabase Realtime) for assignments and overdue tasks
- Transactional email (invitations, follow-up reminders) via a provider such as Resend
- Mobile quick actions: call, WhatsApp deep link, log activity, set follow-up

**Acceptance:** every lead has an owner or explicit unassigned state; overdue follow-ups surface to PIC and manager.

## Sprint 4 — Walk-ins, appointments & orders
**Goal:** connect the full journey from enquiry to delivered order.
**Status:** built on branch `claude/sweet-curie-2qveb2`. Decisions in [ADR 0005](adr/0005-appointments-orders-payments.md). Customer reminders by WhatsApp wait for Sprint 5; staff reminders use the Sprint 3 job route. The job queue (Inngest) is not needed yet and moves to Sprint 5 with the WhatsApp webhooks.

- Appointment calendar (branch / PIC views), reminders, no-show tracking
- Walk-in registration with phone lookup → CIF → lead (source = walk-in)
- Products/services catalogue; quotations with line items → convert to order
- Orders: line items, discount, tax, decimal money, configurable fulfilment stages, `order_status_history`
- Payments: multiple transactions, partial payments, refunds; outstanding balance computed, never stored as truth
- Tailoring extension for MY PERFECT FIT: measurements, fabric/garment, trial dates, alterations (via custom fields + measurement table)
- Customer purchase history and lifetime value on CIF

**Acceptance:** PRD M3 — one CIF with multiple leads and orders; payments reconcile; status history preserved.

## Sprint 5 — WhatsApp engine & inbox
**Goal:** WhatsApp conversations live inside the CRM.
**Status:** built on branch `sprint-5/whatsapp-inbox`. Decisions in [ADR 0006](adr/0006-whatsapp-engine-and-inbox.md). Webhook hand-off uses `after()` plus Postgres-backed retries through the job route instead of Inngest; the queue decision moves to Sprint 6 (campaign throttling).

- `MessagingProvider` interface; Meta Cloud API adapter (direct, via SCALER's Tech Provider app owned by Springs 360)
- Embedded Signup: each business connects its own WhatsApp Business Account and numbers from Integrations; per-tenant tokens in encrypted storage (Supabase Vault), connection test
- One app-level webhook endpoint that routes each event to its tenant by WABA / phone-number ID: signature verification, `webhook_events` dedupe by external id, fast ack, job hand-off (Inngest)
- Inbound flow: phone match → CIF → open lead or create new lead → conversation
- Shared inbox: list, unread, assignment, labels, internal notes, customer side panel, media, delivery status, 24-hour window indicator
- Realtime updates; response-time tracking

**Acceptance:** inbound WhatsApp creates/updates records without duplicates; staff reply from CRM within the service window.

## Sprint 6 — Templates, consent & campaigns
**Goal:** compliant WhatsApp marketing at scale.
**Status:** built on branch `sprint-6/templates-consent-campaigns`. Decisions in [ADR 0007](adr/0007-templates-consent-campaigns.md). The BSP adapter is 360dialog. The send queue is a Postgres-backed throttled queue run by the job route; Inngest was not needed.

- First BSP adapter behind the same `MessagingProvider` interface
- Template manager: create, variables, media header, buttons, submit to the tenant's own WABA, sync approval status from provider
- Consent: opt-in capture, STOP/opt-out handling, suppression list
- Audience builder with PRD filters + live audience estimate; consent filter enforced
- Campaigns: draft, test send, schedule, launch, pause/resume, duplicate
- Send queue with throttling and retries; `campaign_recipients` + `campaign_events`
- Campaign report: sent / delivered / read / failed / replies / leads / orders / revenue

**Acceptance:** PRD M4 — approved templates only, queued and monitored sending, failures and opt-outs handled.

## Sprint 7 — Meta, Google & attribution
**Goal:** paid acquisition flows in automatically and is attributed correctly.
**Status:** built on branch `sprint-7/meta-google-attribution`. Decisions in [ADR 0008](adr/0008-ads-and-attribution.md). Instagram/Messenger direct messages wait for Meta app review (`instagram_manage_messages`, `pages_messaging`); Instagram Lead Ads work now. Google Ads spend needs a developer token and OAuth client.

- Meta Lead Ads: page subscription, leadgen webhook, Graph fetch, form-field mapping UI
- Instagram / Messenger enquiries where permissions allow
- Google Ads lead form webhook; website tracking snippet capturing UTM, gclid, fbclid
- Ad spend sync (Meta Marketing API, Google Ads API) into `ad_campaigns`
- Attribution model: first-touch, last-touch, assisted; per-business revenue attribution policy
- Integration health centre: last sync, webhook failures, token expiry, retry

**Acceptance:** leads retain source/campaign/ad IDs; orders traceable to touchpoints; admin sees integration health.

## Sprint 8 — Automation & analytics
**Goal:** SCALER acts, not just records; management sees the numbers.
**Status:** built on branch `sprint-8/automation-analytics`. Decisions in [ADR 0009](adr/0009-automation-and-analytics.md). PDF export is the browser's "Save as PDF" from a print stylesheet. Presets and metric definitions are a working set until the PRD tables are added to the repo.

- Automation engine: triggers, conditions, delays, actions; preconfigured workflows from PRD table; execution logs and retries
- Lead scoring v1 (rule-based)
- Analytics from metric definitions in PRD §6, with cohort rules
- Dashboards: executive, marketing (CPL, ROAS, channel conversion), sales (by PIC/branch/product), operations
- PIC performance report normalised by lead age/source
- Saved filters, CSV and PDF exports, scheduled email reports

**Acceptance:** reports reconcile with source records; consistent metric definitions across screens.

## Sprint 9 — Hardening & go-live
**Goal:** MY PERFECT FIT running on production.

- PWA: manifest, service worker, install prompt, push notifications, offline cache of today's tasks
- Security review: RLS audit, OWASP checklist, rate limits, export restrictions
- Load test (100k customers, campaign throughput), performance fixes
- Backups and restore drill; Sentry alerts; runbooks
- Data import tools (CSV for customers/leads/orders) and MY PERFECT FIT migration
- Staff training material; production deploy

**Acceptance:** PRD M6 and the v1.0 release checklist (19 items) complete.
**Status:** built on branch `sprint-9/hardening-go-live`. Decisions in [ADR 0010](adr/0010-hardening-and-go-live.md). The production deploy, backups, restore drill and MY PERFECT FIT import are written as runbooks and scripts (`docs/runbooks`, `scripts/`), for a person to carry out. The [release checklist](release-checklist.md) is the go-live record. PRD M6 wasn't in the repo, so its 19 items are reconstructed from this sprint's scope.

## After v1.0 (Phase 4 — SaaS expansion)
**Goal:** businesses other than MY PERFECT FIT can find SCALER, sign up, pay and run it without Springs 360 setting them up by hand.
**Status:** approved. Sprint 10 is built ahead of the original start date. The order below still holds.

| # | Sprint | Dates (2027) | Demo at sprint review |
|---|--------|--------------|------------------------|
| 10 | Plans, limits & platform console | 5 Apr – 18 Apr | Springs 360 changes a business's plan; a Starter business hits its user limit with a clear message |
| 11 | Subscription billing | 19 Apr – 2 May | Trial → pay by UPI autopay/card → GST invoice → failed renewal → grace period → read-only |
| 12 | Self-serve onboarding | 3 May – 16 May | A stranger signs up, picks their industry, invites staff, connects WhatsApp and imports customers in under 30 minutes |
| 13 | Public API & outbound webhooks | 17 May – 30 May | A partner reads and writes leads with a scoped key; SCALER pushes signed `order.stage_changed` events |
| 14 | Visual workflow editor | 31 May – 13 Jun | Build "no-show → wait 1 day → if no reply → task, else tag" on a canvas; dry-run it on a real lead |
| 15 | Multi-branch reporting & targets | 14 Jun – 27 Jun | Branch comparison, monthly targets per branch and person, leaderboard, weekly report pack |
| 16 | White-label | 28 Jun – 11 Jul | A reseller's tenant on `crm.theirbrand.in` with their logo, colours, sender address and installable app name |

## Sprint 10 — Plans, limits & platform console
**Goal:** SCALER knows what each business is entitled to, and Springs 360 can manage businesses without SQL.
**Status:** built on branch `sprint-10/plans-limits-platform`. Decisions in [ADR 0011](adr/0011-plans-limits-platform.md). Plan prices are blank until Springs 360 sets them in Platform → Plans. The storage limit waits until attachment sizes are recorded.

- Plan catalogue: `plans` with limits, `business_plan_history` (append-only). Limits cover:
  - active users;
  - branches;
  - WhatsApp numbers;
  - campaign messages a month;
  - automations;
  - API calls a day;
  - storage.
- Limits enforced in Postgres where the row is created (the same place as permissions), not only in the UI. Messages say what limit was hit and how to raise it.
- Usage meters: a daily snapshot per business, plus a live count for limits that move fast (messages, API calls).
- Platform console (`/platform`, platform admins only, every action audited):
  - businesses, usage and plan;
  - change plan;
  - extend a trial;
  - suspend or reactivate a business;
  - see integration health across tenants.
- Support access: a platform admin opens a business read-only, for a limited time, with the business admin's consent recorded and shown to them.
- MY PERFECT FIT moved onto a plan with its current usage grandfathered.

**Acceptance:** a SQL test per limit proves it can't be bypassed through any RPC. A suspended business can sign in and export but not change data.

## Sprint 11 — Subscription billing
**Goal:** businesses pay for SCALER every month or year without anyone chasing them.
**Status:** built on branch `sprint-11/subscription-billing`. Decisions in [ADR 0012](adr/0012-subscription-billing.md). Razorpay runs in test mode; development and previews use a test provider that moves no money. Live payments wait for Razorpay live keys, plan prices and Springs 360's GSTIN (until then every invoice is a test invoice). The invoice PDF is the browser's "Save as PDF", as for reports.

- Payment provider adapter in `src/modules/billing`. Razorpay Subscriptions is the default (UPI autopay, cards, net banking, e-mandates); Stripe follows when SCALER sells outside India.
- Checkout from the plan page. Upgrades take effect at once (prorated); downgrades take effect at renewal, after checking the business fits the lower limits.
- Provider webhooks (signed, idempotent, append-only `billing_events`) drive the subscription state: trialing → active → past_due → grace → read-only → cancelled.
- GST-compliant invoices: GSTIN capture, place of supply, CGST/SGST vs IGST, sequential invoice numbers per financial year, PDF and email.
- Dunning: reminder emails and in-app banners on failed renewals; 7-day grace before read-only. Nothing is ever deleted for non-payment within 90 days.
- Billing page: plan, next charge, invoices, payment method, cancel.

**Acceptance:** every state transition is covered by webhook replay tests. Invoices reconcile with provider settlements. A business in read-only mode can still pay and export.

## Sprint 12 — Self-serve onboarding
**Goal:** a new business is working in SCALER on day one without a call.
**Status:** built on branch `sprint-12/self-serve-onboarding`. Decisions in [ADR 0013](adr/0013-self-serve-onboarding.md). WhatsApp in the wizard links to the existing Embedded Signup. The timed test with five outside people is a [usability-test runbook](runbooks/onboarding-usability-test.md) for a preview deployment.

- Public sign-up with email verification, then a 14-day trial on the Growth plan.
- Setup wizard, resumable, under 10 steps:
  - business profile;
  - industry template (tailoring, salon, clinic, real estate, retail): pipeline stages, sources, lost reasons, order stages, measurement or custom-field sets, ready-made automations;
  - branches;
  - invite team;
  - connect WhatsApp (Embedded Signup);
  - import customers (Sprint 9 importer);
  - install the app.
- Optional sample data in a separate demo business, removable in one click.
- In-app getting-started checklist and empty states that link to the next step.
- Activation tracking: time to first lead, first WhatsApp reply and first order, per signup, on the platform console.
- Abuse controls: disposable-email block, sign-up rate limits, manual review queue for new WhatsApp connections on trial.

**Acceptance:** five people outside Springs 360 complete onboarding unaided in under 30 minutes, timed. Every industry template passes the pipeline rules tests.

## Sprint 13 — Public API & outbound webhooks
**Goal:** partners and the businesses' own developers can build on SCALER safely.
**Status:** built on branch `sprint-13/public-api-webhooks`. Decisions in [ADR 0014](adr/0014-public-api-and-webhooks.md), reference in [api.md](api.md) and on `/developers`. Keys act through `api_*` functions that pin every query to the key's business. That is the same guards and triggers as the app, but not RLS, because the API has no signed-in user. Webhooks go out on the job route's 5-minute tick. `/api/v1` is versioned as the default decision says.

- Scoped API keys (`leads:read`, `leads:write`, `customers:read`, `orders:read`, `orders:write`, `tasks:write`, `webhooks:manage`), hashed and revocable, with a last-used time. The Sprint 2 keys become `leads:write` keys.
- REST `/api/v1` for customers, leads, orders, payments (read), tasks:
  - cursor pagination;
  - filtering by `updated_since`;
  - idempotency keys on every write;
  - the same RLS-backed functions as the app.
- Rate limits per plan (Sprint 9 limiter), with `X-RateLimit-*` headers.
- Outbound webhooks: subscriptions per event type (`lead.created`, `lead.stage_changed`, `order.created`, `order.stage_changed`, `payment.recorded`, `customer.merged`).
  - Events are written by triggers to an outbox, sent by the job route, and signed (HMAC-SHA256 with a timestamp).
  - Retries with back-off for 24 hours; a delivery log with replay; auto-disable after repeated failure, with an email to the admin.
- OpenAPI 3.1 document generated from the zod schemas; reference docs page; Postman collection.

**Acceptance:** contract tests against the OpenAPI document. A key can never read outside its business or scopes (SQL tests). Webhook signatures verify with the published sample code.

## Sprint 14 — Visual workflow editor
**Goal:** business admins build their own automations without a list of steps.
**Status:** built on branch `sprint-14/workflow-editor`. Decisions in [ADR 0015](adr/0015-workflow-editor.md). The six presets and every existing automation were converted to graphs by the migration, and the Sprint 8 tests pass unchanged. "Wait for a reply" listens for WhatsApp replies; email replies aren't received by SCALER. "Call a webhook" sends a signed event to one of the business's Sprint 13 endpoints rather than to an arbitrary URL.

- Canvas editor (React Flow) over the Sprint 8 engine. The stored format becomes a graph, and existing linear automations convert automatically.
- New steps:
  - if/else branches on lead, customer, order or message conditions;
  - wait until (time of day, business hours);
  - wait for a reply (with timeout);
  - send email;
  - update a custom field;
  - call a webhook (Sprint 13).
- Dry run: pick a real lead and see which path it would take and what each step would do, without doing it.
- Versions: publishing creates a new version. Running instances finish on the version they started on. Roll back to an earlier version.
- Per-step analytics: how many runs reached each step, conversion after each branch, failures.
- Guard-rails:
  - loop detection;
  - a step limit per run;
  - automation sends count against the plan's message limit (Sprint 10).

**Acceptance:** all six Sprint 8 presets rebuilt on the canvas behave identically (same SQL tests). Dry runs never write.

## Sprint 15 — Multi-branch reporting & targets
**Goal:** owners with several branches compare them fairly and manage to targets.
**Status:** built on branch `sprint-15/branch-reporting-targets`. Decisions in [ADR 0016](adr/0016-branch-reporting-and-targets.md). Rollups are read only where they are exact, and dirty or recent days are read live, so they never change an answer. Packs arrive as an email with every table attached as CSV, plus a printable page for the PDF. Ad spend and first-reply times stay business-wide, because campaigns and messages have no branch. Load test at 1M leads across 10 branches: see [load-test.md](load-test.md).

- Branch comparison: every Sprint 8 metric side by side per branch, with cohort rules and source-mix normalisation (as for salespeople).
- Targets: monthly and quarterly targets per branch and per person (leads handled, conversions, revenue, collections), with progress on the dashboard and My day.
- Leaderboards (opt-in per business) and team-level PIC reports for branch managers.
- Lead transfers between branches tracked and reported (who sent, who closed, time to close).
- Report packs: a scheduled weekly or monthly PDF/CSV bundle per role (owner, branch manager, marketing), built on the Sprint 8 scheduler.
- Performance: materialised daily rollups for history older than 90 days, so 12-month views stay under the Sprint 9 budgets at 1M leads.

**Acceptance:** branch totals reconcile with business totals. The load test is extended to 1M leads across 10 branches, with every query within budget.

## Sprint 16 — White-label
**Goal:** resellers and larger brands run SCALER under their own name.
**Status:** built on branch `sprint-16/white-label`. Decisions in [ADR 0017](adr/0017-white-label.md). Per-business branding, custom domains (Vercel Domains API), branded email (Resend) and "Powered by SCALER" by plan are built. Reseller accounts wait for a signed reseller, as the default decision says. Two tenants on different domains in one deployment are checked by `scripts/white-label-check.sh` and `988_white_label.sql`.

- Brand settings per business (or per reseller account): logo, colours (checked for contrast), app name, support contact, sign-in page.
- Custom domain per tenant through the hosting provider's domains API: DNS instructions, verification, automatic TLS. Sign-in and the PWA manifest/icons are served per domain.
- Branded email: the tenant's sender domain verified with Resend (SPF/DKIM), falling back to SCALER's.
- Reseller accounts: a reseller owns several businesses, sees their usage and billing, and can set the brand for all of them. Billing goes to the reseller (Sprint 11).
- "Powered by SCALER" shown or hidden by plan.

**Acceptance:** two tenants on different custom domains in one deployment, with no cross-tenant session or brand leakage (cookie scope and RLS tests). The PWA installs with the tenant's name and icon.

## Decisions to confirm early
| Decision | Needed by | Default if not confirmed |
|----------|-----------|--------------------------|
| WhatsApp integration order | **Decided** | Direct Meta Cloud API in Sprint 5; BSP adapter in Sprint 6 |
| Owner of SCALER's Meta app | **Decided** | Springs 360 (Tech Provider) |
| Springs 360 business verification + app review (WhatsApp Tech Provider; `leads_retrieval` for Lead Ads) | Before Sprint 5 | — long lead time; development uses Meta's test number meanwhile |
| Client-side verification, WABA, numbers, templates | Per client, at onboarding | Each business does this in its own Business Manager |
| Job queue vendor | **Decided** | Postgres-backed queues run by the job route (ADR 0006, 0007); revisit Inngest only if volumes outgrow a 5-minute tick |
| Production domain | Sprint 8 | `app.scalercrm.com` placeholder |
| MY PERFECT FIT historical data source/format | Sprint 7 | CSV import |
| Plan tiers, limits and prices | Before Sprint 10 | Starter / Growth / Scale tiers drafted in Sprint 10 for Springs 360 to price |
| Billing provider | Before Sprint 11 | Razorpay Subscriptions (India first); Stripe when selling abroad |
| Springs 360 GST registration and invoice details | Before Sprint 11 | — needed to issue tax invoices; billing ships in test mode without it |
| Industry templates for onboarding | Sprint 12 | Tailoring (MY PERFECT FIT's setup), salon, clinic, real estate, retail |
| API versioning and deprecation policy | Sprint 13 | `/api/v1` stable; breaking changes only in `/v2`, with 6 months' notice |
| White-label demand (resellers vs single brands) | **Defaulted** | Per-business branding built in Sprint 16; reseller accounts only if a reseller has signed |
