# Security checklist (OWASP Top 10, 2021)

Reviewed for v1.0. Re-run this review before each major release, and whenever a new integration is added.

| # | Risk | How SCALER handles it | Status |
|---|------|-----------------------|--------|
| A01 | Broken access control | Every tenant table has `business_id` + RLS. Permissions are checked in Postgres (`private.has_permission`) on every read and write, not only in the UI. `99_security_audit.sql` fails CI if a table lacks RLS or policies, or if the anonymous role has any table grant. A tenant-isolation test exists for every module (10–95). | ✅ |
| A02 | Cryptographic failures | TLS everywhere (HSTS 2 years). Provider tokens live in Supabase Vault, never in table columns (audit test). API keys and invitation tokens are stored only as hashes. Passwords are Supabase Auth's (bcrypt). | ✅ |
| A03 | Injection | All data access goes through PostgREST or parameterised RPCs. Dynamic SQL uses `format(%I/%L)` only. CSV exports neutralise spreadsheet formulas. React escapes output; no `dangerouslySetInnerHTML` with user data. | ✅ |
| A04 | Insecure design | Money is `numeric(14,2)`. Payment and status history are append-only. Consent and suppression are enforced in the database for every send path (campaigns, automations). Imports never bypass validation, only side effects. | ✅ |
| A05 | Security misconfiguration | Security headers: `X-Frame-Options`, `frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS. No `X-Powered-By`. Default privileges are revoked for the anonymous role. `TRUNCATE` is revoked. Supabase advisors are reviewed before release. | ✅; script CSP without nonces (ADR 0010) |
| A06 | Vulnerable components | `npm audit` and Dependabot on the repo. Few dependencies: no SDKs for Sentry, Web Push or Meta. Next.js and Supabase are kept on current minor versions. | ⚠️ turn on Dependabot alerts in GitHub settings |
| A07 | Identification and authentication | Supabase Auth with email confirmation, leaked-password protection and its rate limits. MFA is required for Supabase dashboard access. Sessions are refreshed by the proxy. Sign-out clears the device's site data. | ✅ (settings in the deploy runbook) |
| A08 | Software and data integrity | Webhooks are verified (Meta `X-Hub-Signature-256` with the app secret; Google per-webhook keys). The job route needs `CRON_SECRET`, compared in constant time. CI runs on every PR; deploys only from tags on `main`. | ✅ |
| A09 | Logging and monitoring | Config changes, exports (with alerts for large ones) and imports go to `audit_logs`. Sentry gets server errors without personal data. The health check covers the database and jobs. | ✅ |
| A10 | Server-side request forgery | Outbound calls only go to fixed provider hosts (graph.facebook.com, googleads.googleapis.com, Resend) and to push endpoints. Push endpoints must be `https://` and come from the browser's PushManager. Media downloads use URLs returned by Meta's API. | ✅ |

## Rate limits and abuse

- Lead API: 120 submissions a minute per key, then `429` with `Retry-After`. Request bodies are capped at 64 KB. Idempotency keys stop double submits.
- Exports: 20 an hour per person, 10,000 rows each. Each export is audited. Exports of 1,000 rows or more notify the people who read the audit log.
- Imports: business admins only, 10 MB or 50,000 rows per file, audited.
- Sign-in, sign-up and password reset: Supabase Auth's limits.
- Campaign sending is throttled per campaign (`rate_per_minute`) and follows WhatsApp's quality tiers.

## Data protection (India DPDP Act 2023)

- Consent is recorded per channel and purpose, with source and evidence. Opt-outs (STOP replies) suppress the number for marketing.
- Exports contain only what the exporting person can see.
- Customer data stays in Supabase's Mumbai region (deploy runbook, step 2).
- Deletion requests: archive leads, merge or anonymise the customer file. A self-serve erasure tool is planned for Phase 4.
