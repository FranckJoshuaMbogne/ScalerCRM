# ADR 0001 — Foundation choices

**Date:** 2 November 2026 · **Status:** accepted

## 1. Single Next.js app, modules by domain (not a monorepo yet)
The PRD sketches `apps/` + `packages/`. With one deployable app and one team, workspace tooling adds build complexity without isolation benefit. We keep the same boundaries as folders: `src/modules/<domain>` holds business logic, `src/app` only routes and renders. Splitting a module into a package later is a move, not a rewrite.

**Revisit when:** a second deployable (worker service, public API, white-label app) appears.

## 2. Tenancy enforced in Postgres
Every tenant table carries `business_id`; RLS policies call `private.is_member()` / `private.has_permission()` (security definer, so policies never recurse). A tenant is created only through `public.create_business()`, which inserts business, first branch and admin membership atomically. Tenants cannot change their own `status` or `plan_key` (column privileges).

Suspending a business locks all its data for every member because both helpers require `businesses.status = 'active'`.

## 3. Roles: shared system roles + per-tenant custom roles
The seven PRD tenant roles are system rows (`business_id is null`) shared by all tenants and read-only to them. Businesses can add custom roles. A trigger rejects assigning another tenant's role. "Super admin" is the platform flag `profiles.is_platform_admin`, not a tenant role, so a tenant admin can never grant it.

## 4. Permission keys live in SQL, mirrored in TypeScript
`supabase/migrations/*_foundation.sql` seeds the catalogue; `src/modules/permissions/catalog.ts` mirrors it for typed checks. A unit test fails on drift.

## 5. Audit log via triggers
Inserts, updates (with from/to diff) and deletes on tenant configuration tables are written by `private.audit_row()`. The table has no FK to `businesses` so the trail survives deletions, and the app role cannot write or alter it.

## 6. SQL tests on plain Postgres
`supabase/tests/00_bootstrap_plain_postgres.sql` stubs `auth.users`, `auth.uid()` and the Supabase roles so CI can run migrations and RLS tests against a stock `postgres` container without the Supabase CLI.
