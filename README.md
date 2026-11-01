# SCALER

Omnichannel lead management, marketing automation and sales CRM, built as a multi-tenant SaaS and installable PWA. MY PERFECT FIT is the first tenant.

Leads from Meta, Google, WhatsApp, the website and walk-ins land in one pipeline, attach to a single customer file (CIF), and are followed through to orders, payments and delivery — with every step attributed to a channel, campaign and person in charge.

- **Plan:** [docs/SPRINTS.md](docs/SPRINTS.md) — 10 two-week sprints to v1.0
- **Architecture decisions:** [docs/adr](docs/adr)

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, RLS, Realtime, Storage) · Vitest · GitHub Actions · Vercel

Inngest (jobs), Sentry and Redis are added in the sprints that need them.

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in Supabase URL and anon key
npx supabase start              # local Postgres + Auth (needs Docker)
npx supabase db reset           # applies supabase/migrations
npm run dev                     # http://localhost:3000
```

## Connecting a hosted Supabase project

1. **Schema.** From the repo root:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push          # applies supabase/migrations in order
   ```
   (Or paste each file in `supabase/migrations/` into the SQL editor, oldest first.)
2. **Auth → URL configuration.** Site URL = your app URL. Add `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback` to Redirect URLs.
3. **Auth → Providers → Email.** Keep "Confirm email" on in production. Turn it off locally if you want sign-up to log straight in.
4. **`.env.local`.** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Project settings → API.

## Checks

| Command | What it does |
|---------|--------------|
| `npm run check` | Lint, typecheck and unit tests |
| `npm run build` | Production build |
| `DATABASE_URL=postgres://… npm run db:test` | Applies every migration to a scratch database and runs the RLS / tenant-isolation suite |

CI runs all of these on every push and pull request.

## Project layout

```
src/
  app/                 routes (thin — render and call modules)
    (app)/             authenticated workspace with the app shell
  components/          shell and UI primitives
  modules/<domain>/    business logic: crm, permissions, messaging, …
  lib/                 env, Supabase clients, utilities
supabase/
  migrations/          SQL migrations (source of truth for schema + RLS)
  tests/               SQL tests run by scripts/db-test.sh
docs/                  sprint plan and ADRs
```

## Rules every change follows

1. Every tenant-owned table has `business_id`, RLS enabled, and an isolation test.
2. Tenant data is read through the user-scoped Supabase client; the service-role key only appears in server jobs and webhooks.
3. Status changes, payments and webhook events are appended, never overwritten.
4. Anything that talks to Meta, WhatsApp or Google goes through an adapter in `src/modules/integrations`.
