# ADR 0011 — Plans, limits and the platform console

**Date:** 5 April 2027 · **Status:** accepted

## 1. Limits live in the database, next to permissions
A `plans` catalogue holds the limits:
- active users;
- branches;
- WhatsApp numbers;
- template messages a month;
- active automations;
- API calls a day.

A null limit means unlimited. Each business has a `plan_key` and `plan_overrides` (negotiated or grandfathered limits). `private.plan_limit()` returns the override if set, otherwise the plan's value.

**Where limits are enforced.** Triggers check the limit where rows are created, so no RPC, import or future screen can go around it:

| Limit | Checked on |
|-------|-----------|
| Users | Activating a membership, and creating an invitation (pending invitations count, so nobody is invited who can't join) |
| Branches | Creating or reactivating a branch |
| WhatsApp numbers | Connecting or reconnecting a number |
| Automations | Switching an automation on |
| Messages | Every outbound template message is counted. A campaign launch must fit in what's left of the month: what's been sent plus what other campaigns still have queued. Automations stop sending templates once the month's allowance is used, and the run log says why. |
| API calls | A per-business daily allowance, after Sprint 9's per-key per-minute limit |

The database raises `plan limit reached: <key> (limit n)`. The app turns that into a sentence people can act on (`src/modules/plans/limits.ts`).

**Going over is never punished retroactively.** Limits only stop new additions; nothing existing is removed or switched off.

**Usage.** Usage is computed live (`private.usage_of`). Monthly and daily counters live in `private.usage_counters`. A daily snapshot goes to `usage_snapshots` for trends and, later, billing.

**Existing businesses** (MY PERFECT FIT) moved to Growth. Where they already use more than Growth allows, an override keeps their current level, recorded in `business_plan_history` with the reason.

Storage isn't limited yet: attachment sizes aren't recorded per business. It is added when billing needs it.

## 2. Suspended means read-only, not locked out
Before this sprint, suspending a business hid all its data from its own team. Now a suspended business keeps every **view** and **export** permission and loses every permission that changes data. People can still get their data out while a payment or dispute is sorted.

- **How it works:** `has_permission`, `permitted_business_ids` and `my_permissions` apply the rule. The two write policies that only checked membership (conversation assignment, saved views) now also check that the business is active.
- **What it looks like:** the app shows a banner with the reason.
- **Tests:** the Sprint 1 isolation test was updated to the new rule.

## 3. Support access needs the business's consent
Platform admins have no access to tenant data by default. A business admin can allow "SCALER support" for 1–72 hours from Settings → Plan and usage.

- **While a grant is open,** any platform admin gets **view** permissions only: no export, no edits. The business appears in their business menu as "SCALER support (read-only)".
- **The business stays informed.** It sees a banner while access is open and can end it at any time.
- **Audit:** granting and ending access are both in the audit log.

Grants are checked inside the same helpers as memberships, so every RLS policy honours them without changes.

## 4. The platform console is RPCs, not table access
`/platform` (platform admins only, 404 for everyone else) is built on security-definer functions: `platform_businesses`, `platform_business`, `platform_set_plan`, `platform_set_status`, `platform_save_plan`. Each checks `is_platform_admin`. Plan and status changes:
- need a reason;
- are appended to `business_plan_history`;
- are written to the audit log.

Businesses aren't closed from the console. Closing is a data-retention decision, left to a runbook.

## Operating notes
- **Making someone a platform admin** is deliberately manual (SQL): `update profiles set is_platform_admin = true where email = '…'`. The deploy runbook lists who.
- **Prices** are blank until Springs 360 sets them in Platform → Plans. Billing (Sprint 11) reads them.
