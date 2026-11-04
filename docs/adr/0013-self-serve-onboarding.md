# ADR 0013 — Self-serve onboarding

**Date:** 3 May 2027 · **Status:** accepted

## 1. Sign-up starts a trial
Sign-up is Supabase Auth with email confirmation. "Confirm email" must stay on in the production project (deploy runbook).

**The sign-up form checks first.** Before creating the account, `signup_check` runs. It refuses:
- disposable email domains, from a list in the database (`private.disposable_email_domains`), subdomains included;
- more than 5 sign-ups an hour from one client;
- more than 300 sign-ups an hour overall.

The client is identified by a salted hash of its IP address. The address itself is never stored.

**Creating a business** (`create_business`):
- starts a **14-day trial on Growth**;
- records it in the plan history;
- opens the setup wizard.

**It is refused** for disposable email addresses and after 3 businesses a day per person. Platform admins are exempt.

**Established businesses are taken off the trial.** Springs 360 does this in the platform console by clearing the trial date; the business is then billed by hand (ADR 0012). The SQL test fixtures for established businesses do the same.

## 2. Industry templates are data, applied once
`industry_templates` is a global catalogue, like `plans`. There are five templates: tailoring (MY PERFECT FIT's setup), salon, clinic, real estate and retail. Each sets:
- pipeline stages and the default stage;
- sources;
- lost reasons;
- order stages;
- measurement templates;
- custom fields;
- which starter automations are switched on.

**Applying a template** (`apply_industry_template`):
- **When:** only before the first lead or order. After that, the business changes things in Settings, where the pipeline rules protect live data.
- **Nothing is deleted.** Unused items are hidden (`is_active = false`), so a template can be swapped while the business is empty.
- **Stage keys stay stable.** Every template keeps `new`, `won`, `lost` and `delivered`, so the Sprint 8 automations and reports keep working.
- **Tests.** Every template is tested against the pipeline rules:
  - one active open default;
  - open, won and lost stages;
  - colours matching categories;
  - open, done and cancelled order stages;
  - a lead can be won;
  - the starter automations fit the trial plan.

## 3. The wizard is derived, not a script
`/setup` has seven steps:
1. business details;
2. industry;
3. branches;
4. team;
5. WhatsApp;
6. customers;
7. app.

**Progress comes from the data where possible.** A second branch, an invitation, a connected number, an import or a lead counts as done. `onboarding_progress` only stores what the data can't show: steps finished or skipped by hand, the template, completion and whether the checklist is hidden.

**It is resumable.** `/setup` opens the first step neither done nor skipped, and any step can be revisited. The dashboard shows a getting-started checklist until setup is finished or hidden; it replaces the old placeholder list.

Existing businesses were marked as set up.

## 4. Sample data lives in a separate demo business
`create_demo_business` makes a separate business, marked `is_demo`, for the person who asks. It has:
- the chosen industry template;
- 12 sample leads spread across the pipeline;
- no trial or billing;
- every automation switched off, so nothing messages anyone.

**One demo per person.** A banner says it is a demo, and "Remove the demo" deletes it and everything in it. `delete_demo_business` refuses any business that isn't a demo. Demo businesses are left out of activation tracking.

## 5. New WhatsApp numbers on a trial are reviewed
A number connected while the business is on a trial (with no paid subscription) is marked `review_status = 'pending'`.

**While pending:**
- replies to customers work;
- business-initiated template messages and campaign launches are refused by triggers on `messages` and `campaign_recipients`, so no screen or job can get round them;
- the app explains why.

**Who decides:**
- Platform admins approve or reject numbers in Platform → Signups. A rejection needs a reason. Every decision is audited.
- A subscription becoming active approves pending numbers automatically.

## 6. Activation is computed, not tracked
`platform_activation()` lists signups from the last 90 days with these timestamps, computed live from the data:
- setup finished;
- first lead;
- first WhatsApp reply (the first outbound message a person sent);
- first order.

Platform → Signups shows the time from sign-up to each. No event tracking was added.

## Acceptance still to run
"Five people outside Springs 360 complete onboarding unaided in under 30 minutes" is a timed session with real people. The script is in [runbooks/onboarding-usability-test.md](../runbooks/onboarding-usability-test.md). It needs a preview deployment with email (Resend) configured.
