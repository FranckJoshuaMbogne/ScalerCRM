-- Subscription billing: webhook replay through every state, GST invoices, dunning, read-only.
\set ON_ERROR_STOP on
\set QUIET on

\set kai  '40000000-0000-0000-0000-000000000001'
\set lia  '40000000-0000-0000-0000-000000000002'
\set ops  '40000000-0000-0000-0000-000000000003'
\set mo   '40000000-0000-0000-0000-000000000004'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'kai', 'kai@lambda.test', '{"full_name":"Kai Admin"}'),
  (:'lia', 'lia@lambda.test', '{"full_name":"Lia Sales"}'),
  (:'ops', 'ops@springs360-billing.test', '{"full_name":"Ops Platform"}'),
  (:'mo',  'mo@mu.test', '{"full_name":"Mo Owner"}');
update public.profiles set is_platform_admin = true where id = :'ops';

select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select public.create_business('Lambda Linen', 'lambda-linen', 'Main') as biz \gset
reset role;
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', :'lia', r.id, 'active', now() from public.roles r where r.key = 'sales_executive' and r.business_id is null;

-- Replays one provider-neutral event through the webhook entry point, as the job route does.
create or replace function tests.billing(p_id text, p_kind text, p_sub text, p_at timestamptz, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select public.billing_ingest('fake', p_id, 'fake.' || p_kind, jsonb_build_object('raw', p_id),
                               jsonb_build_object('kind', p_kind, 'subscription_id', p_sub, 'occurred_at', p_at) || p_extra);
$$;
create or replace function tests.paid(p_id text, p_amount numeric, p_from timestamptz, p_to timestamptz)
returns jsonb language sql as $$
  select jsonb_build_object('payment', jsonb_build_object('id', p_id, 'amount', p_amount, 'currency', 'INR'),
                            'period_start', p_from, 'period_end', p_to);
$$;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

-- ------------------------------------------------------------ prices and permission
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select public.platform_save_plan('starter', '{"name":"Starter","is_public":true,"max_users":"5","max_branches":"1","max_whatsapp_numbers":"1","monthly_messages":"1000","max_automations":"5","daily_api_calls":"1000","price_monthly":"999","price_yearly":"9990"}');
select public.platform_save_plan('growth', '{"name":"Growth","is_public":true,"max_users":"15","max_branches":"3","max_whatsapp_numbers":"2","monthly_messages":"10000","max_automations":"15","daily_api_calls":"10000","price_monthly":"2499","price_yearly":"24990"}');
select public.platform_save_plan('scale', '{"name":"Scale","is_public":true,"max_users":"50","max_branches":"10","max_whatsapp_numbers":"5","monthly_messages":"50000","max_automations":"50","daily_api_calls":"50000","price_monthly":"5999","price_yearly":"59990"}');
select public.platform_set_plan(:'biz', 'growth', '{}', now() + interval '2 days', 'Trial');
reset role;

select set_config('request.jwt.claim.sub', :'lia', false);
set role authenticated;
select tests.fails(format($$select public.billing_quote(%L, 'growth', 'monthly')$$, :'biz'), 'sales staff cannot see billing');
select tests.fails(format($$insert into public.billing_profiles (business_id, legal_name, address, billing_email, state_code)
                             values (%L, 'Lia Ltd', 'Somewhere 1', 'lia@lambda.test', '27')$$, :'biz'),
                   'or set billing details');
select tests.ok((select count(*) = 0 from public.subscriptions), 'or read the subscription');
reset role;

-- ------------------------------------------------------------ billing details
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.fails(format($$insert into public.billing_profiles (business_id, legal_name, address, billing_email, gstin)
                             values (%L, 'Lambda Linen Pvt Ltd', 'MG Road, Pune', 'accounts@lambda.test', '27BADGSTIN')$$, :'biz'),
                   'a malformed GSTIN is refused');
select tests.fails(format($$insert into public.billing_profiles (business_id, legal_name, address, billing_email)
                             values (%L, 'Lambda Linen Pvt Ltd', 'MG Road, Pune', 'accounts@lambda.test')$$, :'biz'),
                   'an Indian buyer needs a state for the place of supply');
insert into public.billing_profiles (business_id, legal_name, address, city, postal_code, billing_email, gstin, state_code)
values (:'biz', 'Lambda Linen Pvt Ltd', 'MG Road', 'Pune', '411001', 'Accounts@Lambda.test', '27abcde1234f1z5', '07');
select tests.ok((select state_code = '27' and gstin = '27ABCDE1234F1Z5' and billing_email = 'accounts@lambda.test'
                   from public.billing_profiles where business_id = :'biz'),
                'the GSTIN sets the state, and both are normalised');
reset role;
select tests.ok((select count(*) = 1 from public.audit_logs where business_id = :'biz' and entity_type = 'billing_profiles'),
                'billing details are audited');

-- ------------------------------------------------------------ quotes
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.fails(format($$select public.billing_quote(%L, 'enterprise', 'monthly')$$, :'biz'), 'unlisted plans cannot be bought');
select tests.ok((select q ->> 'effective' = 'checkout' and (q ->> 'charge_amount')::numeric = 2948.82
                   from public.billing_quote(:'biz', 'growth', 'monthly') q),
                'a trial business checks out; the charge is the price plus 18% GST');
reset role;

-- ------------------------------------------------------------ trial reminders
set role service_role;
select tests.ok((public.billing_tick() ->> 'reminders')::int = 1, 'the job route sends a trial-ending reminder');
select tests.ok((public.billing_tick() ->> 'reminders')::int = 0, 'only once');
reset role;
select tests.ok((select status = 'trialing' from public.subscriptions where business_id = :'biz'), 'and tracks the trial');
select tests.ok((select count(*) = 1 from private.email_outbox where business_id = :'biz' and template = 'billing_trial_ending'
                   and to_email = 'accounts@lambda.test'),
                'the reminder goes to the billing contact');

-- ------------------------------------------------------------ checkout → active, invoice
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.ok((public.billing_begin_checkout(:'biz', 'growth', 'monthly') ->> 'billing_email') = 'accounts@lambda.test',
                'checkout starts with the billing details');
select public.billing_attach_subscription(:'biz', 'fake', 'sub_A', 'cust_A', 'growth', 'monthly', false);
reset role;

set role service_role;
select tests.ok((tests.billing('evt_1', 'activated', 'sub_A', now() - interval '15 days') ->> 'status') = 'applied',
                'the provider confirms the subscription');
select tests.ok((tests.billing('evt_2', 'charged', 'sub_A', now() - interval '15 days' + interval '1 minute',
                               tests.paid('pay_1', 2948.82, now() - interval '15 days', now() + interval '15 days'))
                 ->> 'result') like 'charged, invoiced TEST/%',
                'the first payment is invoiced');
select tests.ok((tests.billing('evt_2', 'charged', 'sub_A', now() - interval '15 days' + interval '1 minute',
                               tests.paid('pay_1', 2948.82, now() - interval '15 days', now() + interval '15 days'))
                 ->> 'status') = 'duplicate',
                'a repeated webhook is recognised');
reset role;
select tests.ok((select count(*) = 1 from public.invoices where business_id = :'biz'), 'and not invoiced twice');
select tests.ok((select status = 'active' and plan_key = 'growth' and current_period_end > now()
                   from public.subscriptions where business_id = :'biz'), 'the subscription is active');
select tests.ok((select plan_key = 'growth' and trial_ends_at is null from public.businesses where id = :'biz'),
                'the business is on the plan, trial over');
select tests.ok((select test_mode and supply_type = 'inter_state' and taxable_amount = 2499.00 and igst = 449.82 and cgst = 0
                        and total = 2948.82 and place_of_supply = '27' and financial_year = private.financial_year(paid_at)
                   from public.invoices where provider_payment_id = 'pay_1'),
                'a test invoice: price plus GST, IGST while the seller''s state is unknown');
select tests.ok((select count(*) = 1 from private.email_outbox where business_id = :'biz' and template = 'billing_invoice'),
                'the invoice is emailed');

-- An event older than the last one never moves the status back.
set role service_role;
select tests.ok((tests.billing('evt_old', 'payment_failed', 'sub_A', now() - interval '16 days') ->> 'result') = 'stale',
                'an out-of-order failure is ignored');
reset role;
select tests.ok((select status = 'active' from public.subscriptions where business_id = :'biz'), 'still active');

-- ------------------------------------------------------------ upgrade now, downgrade at renewal
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.ok((select q ->> 'effective' = 'now' and (q ->> 'proration_amount')::numeric between 2050 and 2080
                   from public.billing_quote(:'biz', 'scale', 'monthly') q),
                'an upgrade applies now, prorated for the half period left');
select tests.ok((public.billing_record_change(:'biz', 'scale', 'monthly') ->> 'effective') = 'now', 'upgrading');
select tests.ok((select plan_key = 'scale' from public.businesses where id = :'biz'), 'raises the limits at once');
insert into public.branches (business_id, name) values (:'biz', 'Second'), (:'biz', 'Third');
select tests.ok((select jsonb_array_length(q -> 'blockers') = 1 and q -> 'blockers' -> 0 ->> 'key' = 'max_branches'
                   from public.billing_quote(:'biz', 'starter', 'monthly') q),
                'a downgrade lists the limits the business is over');
select tests.fails(format($$select public.billing_record_change(%L, 'starter', 'monthly')$$, :'biz'),
                   'and is refused until it fits');
select tests.ok((public.billing_record_change(:'biz', 'growth', 'monthly') ->> 'effective') = 'renewal',
                'a downgrade that fits waits for the renewal');
select tests.ok((select plan_key = 'scale' from public.businesses where id = :'biz'), 'keeping the higher plan until then');
reset role;
set role service_role;
select tests.billing('evt_3', 'charged', 'sub_A', now() - interval '6 days',
                     tests.paid('pay_2', 2948.82, now() - interval '6 days', now() + interval '24 days'));
reset role;
select tests.ok((select s.plan_key = 'growth' and s.pending_plan_key is null and b.plan_key = 'growth'
                   from public.subscriptions s join public.businesses b on b.id = s.business_id where s.business_id = :'biz'),
                'the renewal applies the downgrade');

-- ------------------------------------------------------------ failed renewal → grace → read-only
set role service_role;
select tests.ok((tests.billing('evt_4', 'payment_failed', 'sub_A', now() - interval '5 days') ->> 'result') = 'past_due',
                'a failed renewal makes the subscription past due');
reset role;
select tests.ok((select grace_ends_at between now() + interval '47 hours' and now() + interval '49 hours'
                   from public.subscriptions where business_id = :'biz'),
                'with 7 days from the failure to pay');
select tests.ok((select count(*) = 1 from private.email_outbox where business_id = :'biz' and template = 'billing_payment_failed'),
                'and an email');
set role service_role;
select tests.ok((tests.billing('evt_5', 'halted', 'sub_A', now() - interval '4 days') ->> 'result') = 'grace',
                'when the provider stops retrying, the grace period runs');
select tests.ok((public.billing_tick() ->> 'reminders')::int = 1, 'with a reminder before it ends');
reset role;
select tests.ok((select status = 'active' from public.businesses where id = :'biz'), 'the business works normally during grace');
update public.subscriptions set grace_ends_at = now() - interval '1 minute' where business_id = :'biz';
set role service_role;
select tests.ok((public.billing_tick() ->> 'read_only')::int = 1, 'after grace the business goes read-only');
reset role;
select tests.ok((select b.status = 'suspended' and b.suspended_by = 'billing' and s.status = 'read_only' and s.read_only_since is not null
                   from public.businesses b join public.subscriptions s on s.business_id = b.id where b.id = :'biz'),
                'suspended by billing');
select tests.ok((select array_agg(to_status::text order by id) = array['trialing', 'active', 'past_due', 'grace', 'read_only']
                   from (select id, to_status from public.subscription_status_history where business_id = :'biz') h)
                or (select array_agg(to_status::text order by id) = array['active', 'past_due', 'grace', 'read_only']
                      from (select id, to_status from public.subscription_status_history where business_id = :'biz') h),
                'every transition is in the history');

select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.fails(format($$select public.create_lead(%L, '{"phone":"+919822000099"}')$$, :'biz'), 'read-only: no new leads');
select tests.ok((select count(*) = 1 from public.my_permissions(:'biz') p where p = 'billing.manage'), 'but billing still works');
select tests.ok((select count(*) = 1 from public.my_permissions(:'biz') p where p = 'leads.export'), 'and exports');
update public.billing_profiles set city = 'Pune City' where business_id = :'biz';
select tests.ok((select city = 'Pune City' from public.billing_profiles where business_id = :'biz'), 'billing details can be fixed');
select tests.ok((public.billing_quote(:'biz', 'growth', 'monthly') ->> 'effective') = 'checkout', 'and the business can pay again');
select public.billing_attach_subscription(:'biz', 'fake', 'sub_B', 'cust_A', 'growth', 'monthly', false);
reset role;
select set_config('request.jwt.claim.sub', :'lia', false);
set role authenticated;
select tests.fails(format($$select public.billing_quote(%L, 'growth', 'monthly')$$, :'biz'), 'staff without billing rights still cannot');
reset role;

set role service_role;
select tests.billing('evt_6', 'charged', 'sub_B', now() - interval '1 hour',
                     tests.paid('pay_3', 2948.82, now() - interval '1 hour', now() + interval '30 days'));
reset role;
select tests.ok((select b.status = 'active' and b.suspended_by is null and s.status = 'active' and s.read_only_since is null
                   from public.businesses b join public.subscriptions s on s.business_id = b.id where b.id = :'biz'),
                'paying lifts read-only at once');

-- Billing never lifts a suspension the platform made.
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select public.platform_set_status(:'biz', 'suspended', 'Fraud check');
reset role;
set role service_role;
select tests.billing('evt_7', 'charged', 'sub_B', now() - interval '30 minutes',
                     tests.paid('pay_4', 2948.82, now() - interval '30 minutes', now() + interval '30 days'));
reset role;
select tests.ok((select status = 'suspended' and suspended_by = 'platform' from public.businesses where id = :'biz'),
                'a platform suspension stays after a payment');
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select public.platform_set_status(:'biz', 'active', 'Checked');
reset role;

-- ------------------------------------------------------------ cancel
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select public.billing_cancel(:'biz');
select tests.ok((select cancel_at_period_end from public.subscriptions where business_id = :'biz'), 'cancelling stops renewal');
reset role;
set role service_role;
select tests.ok((tests.billing('evt_8', 'cancelled', 'sub_B', now() - interval '1 minute') ->> 'result') = 'cancelled',
                'the provider ends it at the period end');
reset role;
select tests.ok((select b.status = 'suspended' and b.suspended_by = 'billing' and s.status = 'cancelled'
                   from public.businesses b join public.subscriptions s on s.business_id = b.id where b.id = :'biz'),
                'a cancelled business is read-only, its data kept');

-- ------------------------------------------------------------ bad events
set role service_role;
select tests.ok((select r ->> 'status' = 'failed' and r ->> 'error' like 'unknown subscription%'
                   from tests.billing('evt_9', 'charged', 'sub_nobody', now()) r),
                'an event for an unknown subscription is stored as failed');
select tests.ok((select r ->> 'status' = 'failed'
                   from tests.billing('evt_10', 'payment_failed', 'sub_B', now(),
                                      jsonb_build_object('business_id', gen_random_uuid())) r),
                'and one naming another business is refused');
reset role;

-- ------------------------------------------------------------ live invoices once the seller is set
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select public.platform_save_seller('{"legal_name":"Springs 360 Pvt Ltd","gstin":"27AAACS1234A1Z1","address":"Baner, Pune","email":"billing@springs360.test","invoice_prefix":"scl"}');
reset role;
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select public.billing_attach_subscription(:'biz', 'fake', 'sub_C', 'cust_A', 'growth', 'monthly', true);
reset role;
set role service_role;
select tests.billing('evt_11', 'charged', 'sub_C', now(), tests.paid('pay_5', 2948.82, now(), now() + interval '30 days')
                     || '{"live": true}');
reset role;
select tests.ok((select number = 'SCL/' || financial_year || '/00001' and not test_mode and seller ->> 'gstin' = '27AAACS1234A1Z1'
                   from public.invoices where provider_payment_id = 'pay_5'),
                'a live payment with the seller set gets a tax invoice on its own series');
select tests.ok((select supply_type = 'intra_state' and cgst = 224.91 and sgst = 224.91 and igst = 0
                   from public.invoices where provider_payment_id = 'pay_5'),
                'a buyer in the seller''s state pays CGST and SGST');
select tests.ok((select array_agg(sequence order by sequence) = array[1, 2, 3, 4] from public.invoices where test_mode),
                'test invoices are numbered without gaps');
select tests.ok((select count(*) = 1 from public.businesses where id = :'biz' and status = 'active'), 'and paying reactivates');

-- ------------------------------------------------------------ append-only and immutable
select tests.fails($$update public.billing_events set payload = '{}' where provider_event_id = 'evt_1'$$, 'billing events cannot be edited');
select tests.fails($$delete from public.billing_events where provider_event_id = 'evt_1'$$, 'or deleted');
select tests.fails($$update public.invoices set total = 1 where provider_payment_id = 'pay_1'$$, 'invoices cannot be edited');
select tests.fails($$delete from public.invoices where provider_payment_id = 'pay_1'$$, 'or deleted');

-- ------------------------------------------------------------ reconciliation and the console
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select tests.ok(jsonb_array_length(public.platform_billing() -> 'unreconciled') = 0, 'every payment has a matching invoice');
select tests.ok(jsonb_array_length(public.platform_billing() -> 'failed_events') = 2, 'failed events are listed');
select tests.ok((select count(*) = 5 from public.platform_invoices_by_payment('fake', array['pay_1','pay_2','pay_3','pay_4','pay_5'])),
                'settlement reports match invoices by payment id');
select tests.ok(jsonb_array_length(public.platform_business_billing(:'biz') -> 'history') >= 5, 'the console shows the history');
reset role;
select set_config('request.jwt.claim.sub', :'kai', false);
set role authenticated;
select tests.fails('select public.platform_billing()', 'businesses cannot open the billing console');
select tests.ok((select count(*) = 0 from public.billing_events), 'or read raw webhooks');
select tests.ok((select count(*) = 5 from public.invoices), 'but see their own invoices');
select tests.fails($$select public.billing_ingest('fake', 'x', 'x', '{}', '{"kind":"charged"}')$$, 'or forge webhooks');
select tests.fails('select public.billing_tick()', 'or run the billing job');
reset role;

-- ------------------------------------------------------------ trial ends unpaid
select set_config('request.jwt.claim.sub', :'mo', false);
set role authenticated;
select public.create_business('Mu Mehndi', 'mu-mehndi', 'Main') as mu \gset
reset role;
set role service_role;
select public.billing_tick();
reset role;
select tests.ok((select count(*) = 0 from public.subscriptions where business_id = :'mu'),
                'a business billed by hand (no trial) is left alone');
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select public.platform_set_plan(:'mu', 'starter', '{}', now() - interval '1 hour', 'Trial');
reset role;
set role service_role;
select tests.ok((public.billing_tick() ->> 'trials_ended')::int = 1, 'an unpaid trial ends');
reset role;
select tests.ok((select status = 'grace' and grace_ends_at between now() + interval '6 days' and now() + interval '7 days'
                   from public.subscriptions where business_id = :'mu'),
                'into 7 days of grace');
select tests.ok((select status = 'active' from public.businesses where id = :'mu'), 'still working');
update public.subscriptions set grace_ends_at = now() - interval '1 minute' where business_id = :'mu';
set role service_role;
select public.billing_tick();
reset role;
select tests.ok((select status = 'suspended' from public.businesses where id = :'mu'), 'then read-only');
select tests.ok((select count(*) = 1 from private.email_outbox where business_id = :'mu' and template = 'billing_read_only'
                   and to_email = 'mo@mu.test'),
                'and the admin is told (no billing contact yet)');

-- ------------------------------------------------------------ helpers
select tests.ok(private.financial_year('2027-03-31 18:00Z') = '26-27' and private.financial_year('2027-03-31 19:00Z') = '27-28',
                'the financial year turns over at midnight IST on 1 April');
select tests.ok((select taxable = 100.00 and igst = 18.00 and cgst = 0 from private.gst_split(118.00, 18, 'inter_state')),
                'inter-state supplies carry IGST');
select tests.ok((select taxable = 0.85 and cgst + sgst = 0.15 from private.gst_split(1.00, 18, 'intra_state')),
                'rounding never loses a paisa');

\echo 'billing: all checks passed'
