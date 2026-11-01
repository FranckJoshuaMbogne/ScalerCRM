-- Invitations, acceptance, permission lookup and admin guard.
-- Uses its own users and businesses (runs after 10_tenant_isolation in the same database).
\set ON_ERROR_STOP on
\set QUIET on

\set dana  '44444444-4444-4444-4444-444444444444'
\set eli   '55555555-5555-5555-5555-555555555555'
\set fay   '66666666-6666-6666-6666-666666666666'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'dana', 'dana@gamma.test', '{"full_name":"Dana Admin"}'),
  (:'eli',  'eli@gamma.test',  '{"full_name":"Eli Sales"}'),
  (:'fay',  'fay@other.test',  '{"full_name":"Fay Outsider"}');

-- Dana creates Gamma with two branches
select set_config('request.jwt.claim.sub', :'dana', false);
set role authenticated;
select public.create_business('Gamma Studio', 'gamma-studio', 'Hyderabad') as biz \gset
select set_config('t.biz', :'biz', false);
insert into public.branches (business_id, name) values (:'biz', 'Bengaluru') returning id as blr \gset
select id as sales_role from public.roles where key = 'sales_executive' and business_id is null \gset

select tests.ok((select count(*) = 47 from public.my_permissions(:'biz')), 'admin holds every permission');

-- Invite Eli restricted to Bengaluru
select public.create_invitation(:'biz', 'Eli@Gamma.test', :'sales_role', :'blr', false, array[:'blr']::uuid[]) as token \gset
select set_config('t.token', :'token', false);

select tests.ok((select count(*) = 1 from public.invitations where business_id = :'biz'), 'admin sees pending invitation');
select tests.fails('select token_hash from public.invitations', 'token hash is not readable');
select tests.ok(
  (select count(*) = 0 from public.audit_logs where entity_type = 'invitations' and changes ? 'token_hash'),
  'audit log never stores the token hash');
reset role;

-- Anyone holding the link can preview it
set role anon;
select tests.ok((select status = 'pending' and business_name = 'Gamma Studio' from public.get_invitation(current_setting('t.token'))),
                'invite link previews business and status');
select tests.ok((select count(*) = 0 from public.get_invitation('not-a-real-token')), 'unknown token previews nothing');
select tests.fails(format('select public.accept_invitation(%L)', current_setting('t.token')), 'anonymous user cannot accept');
reset role;

-- Fay (wrong email) cannot accept
select set_config('request.jwt.claim.sub', :'fay', false);
set role authenticated;
select tests.fails(format('select public.accept_invitation(%L)', current_setting('t.token')),
                   'invitation cannot be accepted by a different email');
select tests.fails(format('select public.create_invitation(%L, %L, %L)', current_setting('t.biz'), 'x@y.test',
                          (select id from public.roles where key = 'accounts' and business_id is null)),
                   'non-member cannot invite');
reset role;

-- Eli accepts (email match is case-insensitive)
select set_config('request.jwt.claim.sub', :'eli', false);
set role authenticated;
select tests.ok((select public.accept_invitation(current_setting('t.token')) = current_setting('t.biz')::uuid),
                'invited person accepts and joins');
select tests.fails(format('select public.accept_invitation(%L)', current_setting('t.token')), 'invitation is single use');
select tests.ok((select count(*) = 1 from public.businesses), 'new member sees the business');
select tests.ok(
  (select array_agg(b) = array[:'blr']::uuid[] from private.accessible_branch_ids(current_setting('t.biz')::uuid) b),
  'restricted member can access Bengaluru and nothing else');
select tests.ok((select not ('team.members.manage' = any(array(select public.my_permissions(current_setting('t.biz')::uuid))))),
                'sales executive lacks team management');
select tests.ok((select 'leads.create' = any(array(select public.my_permissions(current_setting('t.biz')::uuid)))),
                'sales executive can create leads');
select tests.fails(format('select public.create_invitation(%L, %L, %L)', current_setting('t.biz'), 'z@gamma.test',
                          (select id from public.roles where key = 'accounts' and business_id is null)),
                   'member without permission cannot invite');
reset role;

-- Last admin cannot be removed or demoted
select set_config('request.jwt.claim.sub', :'dana', false);
set role authenticated;
select tests.affects_none(
  format('delete from public.business_memberships where business_id = %L and user_id = %L', current_setting('t.biz'), :'dana'),
  'admin cannot remove herself');
reset role;
select tests.fails(
  format($s$update public.business_memberships set role_id = (select id from public.roles where key = 'accounts' and business_id is null)
            where business_id = %L and user_id = %L$s$, :'biz', :'dana'),
  'the last business admin cannot be demoted, even by the platform');

-- Revoked invitation cannot be used
select set_config('request.jwt.claim.sub', :'dana', false);
set role authenticated;
select public.create_invitation(:'biz', 'fay@other.test', :'sales_role') as token2 \gset
update public.invitations set revoked_at = now() where email = 'fay@other.test';
reset role;
select set_config('request.jwt.claim.sub', :'fay', false);
set role authenticated;
select tests.fails(format('select public.accept_invitation(%L)', :'token2'), 'revoked invitation cannot be accepted');
reset role;

\echo 'invitations: all checks passed'
