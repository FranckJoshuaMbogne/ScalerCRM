-- Schema-wide security audit. Runs last, over every migration, so a new table
-- or function that forgets RLS, a search_path or its grants fails CI.
\set ON_ERROR_STOP on
\set QUIET on

-- Every table in public has row level security switched on.
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  'every public table has row level security');

-- Every table has at least one policy, except tables nobody reads directly.
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname not in ('api_idempotency_keys')
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  'every public table has policies');

-- Tables holding tenant data are keyed by business.
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname not in ('businesses', 'profiles', 'permissions', 'role_permissions', 'user_branch_access', 'push_subscriptions', 'plans', 'industry_templates')
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped)),
  'every tenant table has a business_id');

-- Views run with the caller's rights, so RLS applies through them.
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  'every view is security_invoker');

-- Security definer functions pin search_path (no hijacking through a writable schema).
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  'every security definer function pins its search_path');

-- Signed-out visitors can only reach these functions.
select tests.ok((
  select coalesce(array_agg(p.proname::text order by p.proname), '{}')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
) = array['api_key_business', 'api_rate_limit', 'api_submit_lead', 'get_invitation', 'health', 'signup_check'],
  'the anonymous role can call only the public API, invitations, health and the sign-up check');

-- And can't touch any table or view directly.
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'p')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
          or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))),
  'the anonymous role has no table privileges');

-- TRUNCATE ignores row level security, so nobody but the owner and service role has it.
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (has_table_privilege('authenticated', c.oid, 'truncate') or has_table_privilege('anon', c.oid, 'truncate'))),
  'signed-in users cannot truncate tables');

-- Job-runner functions are not callable by signed-in users.
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('claim_emails', 'finish_email', 'pending_webhook_events', 'record_webhook_event', 'finish_webhook_event',
                       'whatsapp_account_token', 'integration_token', 'claim_campaign_batch', 'claim_automation_runs',
                       'step_automation_run', 'claim_report_schedules', 'claim_push_batch', 'record_job_heartbeat',
                       'housekeeping', 'run_task_jobs', 'billing_ingest', 'billing_tick', 'billing_save_provider_plan',
                       'snapshot_usage')
     and has_function_privilege('authenticated', p.oid, 'execute')),
  'background-job functions are reserved for the service role');

-- The private schema is never reachable by signed-out visitors.
select tests.ok(not has_schema_privilege('anon', 'private', 'usage'), 'the private schema is closed to the public');

-- Provider tokens live in Vault, never in plain columns.
select tests.ok(not exists (
  select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not a.attisdropped
     and a.attname ~ '(access|refresh)_token$|secret$|password'),
  'no public table stores tokens, secrets or passwords in plain text');

\echo 'security audit: all checks passed'
