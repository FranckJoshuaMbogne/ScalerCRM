-- Plans, limits, usage, suspension, support access and the platform console.
\set ON_ERROR_STOP on
\set QUIET on
-- Runs on its own too: the job checks below call tests.ok as the service role.
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

\set kai  '30000000-0000-0000-0000-000000000001'
\set lia  '30000000-0000-0000-0000-000000000002'
\set ops  '30000000-0000-0000-0000-000000000003'
\set u3   '30000000-0000-0000-0000-000000000004'
\set u4   '30000000-0000-0000-0000-000000000005'
\set u5   '30000000-0000-0000-0000-000000000006'
\set u6   '30000000-0000-0000-0000-000000000007'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'kai', 'kai@kappa.test', '{"full_name":"Kai Admin"}'),
  (:'lia', 'lia@kappa.test', '{"full_name":"Lia Sales"}'),
  (:'ops', 'ops@springs360.test', '{"full_name":"Ops Platform"}'),
  (:'u3', 'u3@kappa.test', '{}'), (:'u4', 'u4@kappa.test', '{}'), (:'u5', 'u5@kappa.test', '{}'), (:'u6', 'u6@kappa.test', '{}');
update public.profiles set is_platform_admin = true where id = :'ops';

select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select public.create_business('Kappa Kurtas', 'kappa-kurtas', 'Main') as biz \gset
reset role;
select set_config('t.biz', :'biz', false);
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', :'lia', r.id, 'active', now() from public.roles r where r.key = 'sales_executive' and r.business_id is null;

-- ------------------------------------------------------------ plans
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.ok((select count(*) >= 3 from public.plans where is_public), 'members can read the plan catalogue');
select tests.ok((public.business_plan(:'biz') ->> 'plan_key') = 'growth', 'new businesses start on Growth');
select tests.fails(format($$select public.platform_set_plan(%L, 'scale', '{}', null, 'please')$$, :'biz'),
                   'a business cannot change its own plan');
select tests.fails($$select * from public.platform_businesses()$$, 'or open the platform console');
select tests.fails(format($$update public.businesses set plan_overrides = '{"max_users": 999}' where id = %L$$, :'biz'),
                   'or set its own limits');
reset role;

select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select tests.fails(format($$select public.platform_set_plan(%L, 'starter', '{}', null, '')$$, :'biz'), 'plan changes need a reason');
select tests.fails(format($$select public.platform_set_plan(%L, 'starter', '{"max_users": "lots"}', null, 'x')$$, :'biz'),
                   'overrides must be numbers for known limits');
select public.platform_set_plan(:'biz', 'starter', '{}', now() + interval '14 days', 'Testing Starter limits');
select tests.ok((select count(*) = 1 from public.platform_businesses() where id = :'biz' and plan_key = 'starter'),
                'the platform console lists the business on its new plan');
select tests.ok(jsonb_array_length(public.platform_business(:'biz') -> 'history') >= 1, 'with the change in its history');
reset role;
select tests.ok((select count(*) = 1 from public.audit_logs where business_id = :'biz' and entity_type = 'plan'), 'and in the audit log');

-- ------------------------------------------------------------ limits (Starter: 5 users, 1 branch, 1 number, 5 automations)
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.fails(format($$insert into public.branches (business_id, name) values (%L, 'Second')$$, :'biz'),
                   'Starter allows one branch');
reset role;
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', u, r.id, 'active', now()
  from unnest(array[:'u3', :'u4', :'u5']::uuid[]) u
  join public.roles r on r.key = 'sales_executive' and r.business_id is null;
select tests.fails(format($$insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
                             select %L, %L, id, 'active', now() from public.roles where key = 'sales_executive' and business_id is null$$,
                          :'biz', :'u6'),
                   'a sixth active user goes over the five-user limit');
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.fails(format($$select public.create_invitation(%L, 'new@kappa.test', (select id from public.roles where key = 'sales_executive' and business_id is null), null, true, '{}')$$, :'biz'),
                   'and nobody can be invited while the plan is full');
update public.automations set is_active = true
 where business_id = :'biz' and id in (select id from public.automations where business_id = :'biz' order by name limit 5);
select tests.fails(format($$update public.automations set is_active = true where business_id = %L and not is_active$$, :'biz'),
                   'a sixth active automation goes over the limit');
select public.connect_whatsapp_account(:'biz', '{"waba_id":"910000001","phone_number_id":"920000001","access_token":"EAAG-kappa-token-0123456789"}') as acct \gset
select tests.fails(format($$select public.connect_whatsapp_account(%L, '{"waba_id":"910000001","phone_number_id":"920000002","access_token":"EAAG-kappa-token-0123456789"}')$$, :'biz'),
                   'a second WhatsApp number goes over the limit');
reset role;
select tests.ok((select (public.business_plan(:'biz') -> 'usage' ->> 'max_users')::int = 5
                    and (public.business_plan(:'biz') -> 'limits' ->> 'max_users')::int = 5
                   from (select set_config('request.jwt.claim.sub', :'kai', false)) x),
                'the plan page shows usage against each limit');

-- An override raises one limit without changing plan.
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select public.platform_set_plan(:'biz', 'starter', '{"max_branches": 2, "monthly_messages": 3, "daily_api_calls": 2}', null, 'Negotiated');
reset role;
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
insert into public.branches (business_id, name) values (:'biz', 'Second');
select tests.ok((select count(*) = 2 from public.branches where business_id = :'biz'), 'an override lifts a single limit');
reset role;

-- Messages: template sends count; a campaign must fit in what's left of the month.
insert into public.whatsapp_templates (business_id, waba_id, name, language, category, components, variable_count, status, created_by)
values (:'biz', '910000001', 'kappa_offer', 'en', 'MARKETING', '{"body":{"text":"Hi"}}', 0, 'approved', :'kai') returning id as tpl \gset
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select (public.create_lead(:'biz', '{"phone":"+919822000001","full_name":"A"}') ->> 'customer_id') as c1 \gset
select (public.create_lead(:'biz', '{"phone":"+919822000002","full_name":"B"}') ->> 'customer_id') as c2 \gset
select (public.create_lead(:'biz', '{"phone":"+919822000003","full_name":"C"}') ->> 'customer_id') as c3 \gset
select (public.create_lead(:'biz', '{"phone":"+919822000004","full_name":"D"}') ->> 'customer_id') as c4 \gset
reset role;
-- The number was connected during a trial, so Springs 360 reviews it before campaigns (Sprint 12).
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select public.platform_review_whatsapp(:'acct', true, 'Checked');
reset role;
insert into public.campaigns (business_id, name, account_id, template_id, created_by)
values (:'biz', 'Too big', :'acct', :'tpl', :'kai') returning id as camp \gset
select tests.fails(format($$insert into public.campaign_recipients (business_id, campaign_id, customer_id, phone, params)
                             select %L, %L, c, '+91982200000' || n, '[]'
                               from unnest(array[%L, %L, %L, %L]::uuid[]) with ordinality t(c, n)$$,
                          :'biz', :'camp', :'c1', :'c2', :'c3', :'c4'),
                   'a campaign bigger than the month''s remaining messages is refused');
insert into public.campaign_recipients (business_id, campaign_id, customer_id, phone, params)
values (:'biz', :'camp', :'c1', '+919822000001', '[]'), (:'biz', :'camp', :'c2', '+919822000002', '[]');
insert into public.conversations (business_id, account_id, customer_id) values (:'biz', :'acct', :'c3') returning id as conv \gset
insert into public.messages (business_id, conversation_id, direction, type, body, status)
values (:'biz', :'conv', 'outbound', 'template', 'Hi', 'sent');
select tests.ok((select (public.business_plan(:'biz') -> 'usage' ->> 'monthly_messages')::int = 1
                   from (select set_config('request.jwt.claim.sub', :'kai', false)) x), 'sent templates count towards the month');
select tests.fails(format($$insert into public.campaign_recipients (business_id, campaign_id, customer_id, phone, params)
                             values (%L, %L, %L, '+919822000004', '[]')$$, :'biz', :'camp', :'c4'),
                   'queued and sent messages together cannot pass the limit');

-- API: the plan's daily allowance per business, after the per-minute key limit.
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select public.create_api_key(:'biz', 'Site') as apikey \gset
reset role;
set role anon;
select tests.ok(public.api_rate_limit(:'apikey') and public.api_rate_limit(:'apikey'), 'two API calls fit the daily allowance');
select tests.ok(not public.api_rate_limit(:'apikey'), 'the third is refused for the day');
reset role;

-- ------------------------------------------------------------ suspension
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select tests.fails(format($$select public.platform_set_status(%L, 'closed', 'x')$$, :'biz'), 'businesses are not closed from the console');
select public.platform_set_status(:'biz', 'suspended', 'Unpaid invoice');
reset role;
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.ok((select count(*) = 4 from public.leads where business_id = :'biz'), 'a suspended business can still see its leads');
select tests.ok((select bool_and(p in (select public.my_permissions(:'biz'))) from unnest(array['leads.view_all', 'leads.export']) p),
                'and keeps viewing and export permissions');
select tests.ok((select count(*) = 0 from public.my_permissions(:'biz') p where p in ('leads.create', 'settings.business.manage')),
                'but loses every permission that changes data');
select tests.fails(format($$select public.create_lead(%L, '{"phone":"+919822000009"}')$$, :'biz'), 'so it cannot add leads');
select tests.affects_none(format($$update public.leads set title = 'x' where business_id = %L$$, :'biz'), 'or edit them');
select tests.ok(public.export_allowed(:'biz'), 'but can export');
select tests.ok((public.business_plan(:'biz') ->> 'status_reason') = 'Unpaid invoice', 'and sees why it was suspended');
reset role;
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select public.platform_set_status(:'biz', 'active', 'Paid');
reset role;
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.ok((public.create_lead(:'biz', '{"phone":"+919822000009"}') ->> 'lead_id') is not null, 'reactivating restores changes');
reset role;

-- ------------------------------------------------------------ support access
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.leads where business_id = :'biz'), 'support sees no customer data without consent');
reset role;
select set_config('request.jwt.claim.sub', :'lia', false);
set role authenticated;
select tests.fails(format('select public.grant_support_access(%L, 24)', :'biz'), 'only business admins can let support in');
reset role;
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.fails(format('select public.grant_support_access(%L, 500)', :'biz'), 'support access lasts at most 72 hours');
select public.grant_support_access(:'biz', 24, 'Leads not syncing');
reset role;
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select tests.ok((select count(*) = 5 from public.leads where business_id = :'biz'), 'with consent, support can see the business');
select tests.ok((select count(*) = 0 from public.my_permissions(:'biz') p where p in ('leads.export', 'leads.create', 'leads.edit')),
                'read-only: no export or edit permissions');
select tests.ok((select count(*) > 0 from public.my_permissions(:'biz') p where p = 'leads.view_all'), 'but can view');
select tests.affects_none(format($$update public.leads set title = 'support' where business_id = %L$$, :'biz'), 'support cannot edit leads');
select tests.fails(format($$select public.create_lead(%L, '{"phone":"+919822000010"}')$$, :'biz'), 'or create them');
select tests.ok(public.platform_business(:'biz') ->> 'support_until' is not null, 'the console shows the open grant');
reset role;
select tests.ok((select count(*) = 1 from public.audit_logs where business_id = :'biz' and entity_type = 'support_access'),
                'granting support access is audited');
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.ok(public.revoke_support_access(:'biz') = 1, 'the business can end support access early');
reset role;
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.leads where business_id = :'biz'), 'and support loses access at once');
reset role;

-- A platform admin who isn't let in also can't use another business's grant.
select set_config('request.jwt.claim.sub', :'lia', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.support_access_grants), 'staff without admin rights see no grants');
reset role;

-- ------------------------------------------------------------ snapshots
set role service_role;
select tests.ok(public.snapshot_usage() >= 1, 'the job route snapshots usage daily');
select tests.ok(public.snapshot_usage() >= 1, 'and running it twice in a day is harmless');
reset role;
select tests.ok((select count(*) = 1 from public.usage_snapshots where business_id = :'biz'), 'one row per business per day');
set role authenticated;
select tests.fails('select public.snapshot_usage()', 'signed-in users cannot write snapshots');
reset role;

\echo 'plans, limits and platform: all checks passed'
