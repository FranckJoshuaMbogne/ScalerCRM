-- Tenant isolation and RBAC tests for the foundation schema.
-- Run with: npm run db:test   (see scripts/db-test.sh)
\set ON_ERROR_STOP on
\set QUIET on

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.ok(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'ok - %', label;
end $$;

create or replace function tests.fails(statement text, label text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    raise notice 'ok - % (%)', label, sqlstate;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;

create or replace function tests.affects_none(statement text, label text)
returns void language plpgsql as $$
declare n int;
begin
  execute statement;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, label);
end $$;

grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------- fixtures
\set alice '11111111-1111-1111-1111-111111111111'
\set bob   '22222222-2222-2222-2222-222222222222'
\set carol '33333333-3333-3333-3333-333333333333'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'alice', 'alice@alpha.test', '{"full_name":"Alice Admin"}'),
  (:'bob',   'bob@beta.test',    '{"full_name":"Bob Owner"}'),
  (:'carol', 'carol@alpha.test', '{"full_name":"Carol Sales"}');

select tests.ok((select count(*) = 3 from public.profiles), 'profiles auto-created for new auth users');

-- Alice creates Alpha; Bob creates Beta
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.create_business('Alpha Tailors', 'alpha-tailors', 'Hyderabad') as biz_a \gset
reset role;

select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;
select public.create_business('Beta Motors', 'beta-motors', 'Delhi') as biz_b \gset
reset role;

select set_config('t.biz_a', :'biz_a', false), set_config('t.biz_b', :'biz_b', false);

-- ------------------------------------------------ Alice (admin of Alpha)
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;

select tests.ok((select count(*) = 1 from public.businesses), 'admin sees only her own business');
select tests.ok((select count(*) = 0 from public.branches where business_id = current_setting('t.biz_b')::uuid),
                'cannot see another business''s branches');
select tests.ok((select count(*) = 0 from public.business_memberships where business_id = current_setting('t.biz_b')::uuid),
                'cannot see another business''s members');

select tests.affects_none(
  format('update public.businesses set name = %L where id = %L', 'Hacked', current_setting('t.biz_b')),
  'cannot rename another business');
select tests.fails(
  format('insert into public.branches (business_id, name) values (%L, %L)', current_setting('t.biz_b'), 'Rogue'),
  'cannot add a branch to another business');
select tests.fails(
  format($s$insert into public.business_memberships (business_id, user_id, role_id)
            select %L, %L, id from public.roles where key = 'business_admin' and business_id is null$s$,
         current_setting('t.biz_b'), :'alice'),
  'cannot join another business');
select tests.fails('insert into public.businesses (name, slug) values (''Direct'', ''direct-insert'')',
  'businesses can only be created through create_business()');
select tests.fails(
  format('update public.businesses set plan_key = %L where id = %L', 'enterprise', current_setting('t.biz_a')),
  'tenant admin cannot change own plan');
select tests.fails(
  format('update public.profiles set is_platform_admin = true where id = %L', :'alice'),
  'user cannot make themselves platform admin');

-- Alice invites Carol as a sales executive and adds a second branch
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select current_setting('t.biz_a')::uuid, :'carol', id, 'active', now()
  from public.roles where key = 'sales_executive' and business_id is null;
insert into public.branches (business_id, name) values (current_setting('t.biz_a')::uuid, 'Bengaluru');

select tests.ok((select count(*) = 2 from public.branches), 'admin can add branches');
select tests.ok((select count(*) > 0 from public.audit_logs where business_id = current_setting('t.biz_a')::uuid),
                'changes are written to the audit log');
select tests.ok((select count(*) = 0 from public.audit_logs where business_id = current_setting('t.biz_b')::uuid),
                'cannot read another business''s audit log');
select tests.fails(
  format('insert into public.audit_logs (business_id, action, entity_type) values (%L, %L, %L)',
         current_setting('t.biz_a'), 'forge', 'x'),
  'audit log cannot be written directly');
reset role;

-- --------------------------------------------- Carol (sales exec, Alpha)
select set_config('request.jwt.claim.sub', :'carol', false);
set role authenticated;

select tests.ok((select count(*) = 1 from public.businesses), 'employee sees her business');
select tests.ok((select count(*) = 2 from public.profiles), 'employee sees colleagues'' profiles only');
select tests.affects_none(
  format('update public.businesses set name = %L where id = %L', 'Renamed', current_setting('t.biz_a')),
  'employee without permission cannot edit business');
select tests.fails(
  format('insert into public.branches (business_id, name) values (%L, %L)', current_setting('t.biz_a'), 'Pune'),
  'employee without permission cannot add branches');
select tests.affects_none(
  format($s$update public.business_memberships set role_id = (select id from public.roles where key = 'business_admin' and business_id is null)
            where user_id = %L$s$, :'carol'),
  'employee cannot promote herself');
select tests.ok((select count(*) = 0 from public.audit_logs), 'employee without audit.view sees no audit entries');
reset role;

-- -------------------------------------- Cross-tenant role assignment
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;
insert into public.roles (business_id, key, name)
values (current_setting('t.biz_b')::uuid, 'beta_custom', 'Beta custom')
returning id as beta_role \gset
reset role;

select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.roles where key = 'beta_custom'),
                'cannot see another business''s custom roles');
select tests.fails(
  format('update public.business_memberships set role_id = %L where user_id = %L', :'beta_role', :'carol'),
  'cannot assign a role belonging to another business');
reset role;

-- ------------------------------------------------------------ Suspension
update public.businesses set status = 'suspended' where id = :'biz_a';
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
-- Sprint 10: a suspended business is read-only, not locked out.
select tests.ok((select count(*) > 0 from public.branches), 'a suspended business can still read its data');
select tests.fails(format('insert into public.branches (business_id, name) values (%L, %L)', current_setting('t.biz_a'), 'Pune'),
                   'but cannot change it');
reset role;

\echo 'tenant isolation: all checks passed'
