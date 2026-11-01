@AGENTS.md

# SCALER — working rules

- Plan: `docs/SPRINTS.md`. Decisions: `docs/adr/`. Check which sprint a task belongs to before building ahead.
- Next.js 16 with Cache Components: read `node_modules/next/dist/docs/` before using an unfamiliar API. Middleware is `src/proxy.ts`.
- Business logic goes in `src/modules/<domain>`; route files stay thin.
- Every new tenant table: `business_id`, RLS enabled, policies via `private.is_member()` / `private.has_permission()`, audit trigger if it holds configuration, and new cases in `supabase/tests/`.
- New permission keys go in the migration's `-- BEGIN permissions` block AND `src/modules/permissions/catalog.ts`.
- Phone numbers are matched only through `normalisePhone()` (E.164).
- Money: `numeric(14,2)` in SQL, never floats. Status and payment history are append-only tables.
- Before pushing: `npm run check`, `npm run build`, and `npm run db:test` with a disposable `DATABASE_URL`.
- Commits: Conventional Commits (`feat(leads): …`). One sprint = one branch + PR into `main`.
