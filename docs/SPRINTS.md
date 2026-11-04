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

- `MessagingProvider` interface; Meta Cloud API adapter (direct, via SCALER's Tech Provider app owned by Springs 360)
- Embedded Signup: each business connects its own WhatsApp Business Account and numbers from Integrations; per-tenant tokens in encrypted storage (Supabase Vault), connection test
- One app-level webhook endpoint that routes each event to its tenant by WABA / phone-number ID: signature verification, `webhook_events` dedupe by external id, fast ack, job hand-off (Inngest)
- Inbound flow: phone match → CIF → open lead or create new lead → conversation
- Shared inbox: list, unread, assignment, labels, internal notes, customer side panel, media, delivery status, 24-hour window indicator
- Realtime updates; response-time tracking

**Acceptance:** inbound WhatsApp creates/updates records without duplicates; staff reply from CRM within the service window.

## Sprint 6 — Templates, consent & campaigns
**Goal:** compliant WhatsApp marketing at scale.

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

- Meta Lead Ads: page subscription, leadgen webhook, Graph fetch, form-field mapping UI
- Instagram / Messenger enquiries where permissions allow
- Google Ads lead form webhook; website tracking snippet capturing UTM, gclid, fbclid
- Ad spend sync (Meta Marketing API, Google Ads API) into `ad_campaigns`
- Attribution model: first-touch, last-touch, assisted; per-business revenue attribution policy
- Integration health centre: last sync, webhook failures, token expiry, retry

**Acceptance:** leads retain source/campaign/ad IDs; orders traceable to touchpoints; admin sees integration health.

## Sprint 8 — Automation & analytics
**Goal:** SCALER acts, not just records; management sees the numbers.

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

## After v1.0 (Phase 4 — SaaS expansion)
Subscription billing, plan limits, self-serve onboarding, white-label, public API & webhooks, visual workflow editor, multi-branch advanced reporting.

## Decisions to confirm early
| Decision | Needed by | Default if not confirmed |
|----------|-----------|--------------------------|
| WhatsApp integration order | **Decided** | Direct Meta Cloud API in Sprint 5; BSP adapter in Sprint 6 |
| Owner of SCALER's Meta app | **Decided** | Springs 360 (Tech Provider) |
| Springs 360 business verification + app review (WhatsApp Tech Provider; `leads_retrieval` for Lead Ads) | Before Sprint 5 | — long lead time; development uses Meta's test number meanwhile |
| Client-side verification, WABA, numbers, templates | Per client, at onboarding | Each business does this in its own Business Manager |
| Job queue vendor | Sprint 5 | Inngest (the Sprint 3 job route covers reminders until webhooks need a queue) |
| Production domain | Sprint 8 | `app.scalercrm.com` placeholder |
| MY PERFECT FIT historical data source/format | Sprint 7 | CSV import |
