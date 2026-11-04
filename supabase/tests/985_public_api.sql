-- Public API and outbound webhooks: scoped keys, tenant and scope isolation,
-- pagination, idempotent writes, rate limits, the event outbox, delivery,
-- retries, auto-disable and replay.
\set ON_ERROR_STOP on
\set QUIET on

\set pia '60000000-0000-0000-0000-000000000001'
\set sal '60000000-0000-0000-0000-000000000002'
\set rho '60000000-0000-0000-0000-000000000003'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'pia', 'pia@pi.test', '{"full_name":"Pia Owner"}'),
  (:'sal', 'sal@pi.test', '{"full_name":"Sal Sales"}'),
  (:'rho', 'rho@rho.test', '{"full_name":"Rho Owner"}');

-- Fails with exactly this SQLSTATE (so a scope error isn't mistaken for a missing row).
create or replace function tests.fails_with(statement text, state text, label text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate <> state then
      raise exception 'FAIL: % (expected %, got %: %)', label, state, sqlstate, sqlerrm;
    end if;
    raise notice 'ok - % (%)', label, sqlstate;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;
grant execute on function tests.fails_with(text, text, text) to anon, authenticated, service_role;
grant usage on schema tests to service_role;

-- Keys and ids for the API contract samples (scripts/db-test.sh).
create table tests.api_fixture (name text primary key, value text not null);
grant select on tests.api_fixture to anon, service_role;

select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select public.create_business('Pi Tailors', 'pi-tailors', 'Main') as biz \gset
reset role;
select set_config('request.jwt.claim.sub', :'rho', false);
set role authenticated;
select public.create_business('Rho Retail', 'rho-retail', 'Main') as biz2 \gset
reset role;
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', :'sal', r.id, 'active', now() from public.roles r where r.key = 'sales_executive' and r.business_id is null;

-- ------------------------------------------------------------ scoped keys
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select public.create_api_key(:'biz', 'Website form') as k_form \gset
select public.create_api_key(:'biz', 'Sync', '{leads:read,customers:read,orders:read}') as k_read \gset
select public.create_api_key(:'biz', 'ERP', '{leads:write,orders:write,orders:read,tasks:write}') as k_erp \gset
select public.create_api_key(:'biz', 'Hooks', '{webhooks:manage}') as k_hooks \gset
select tests.fails_with(format($$select public.create_api_key(%L, 'Bad', '{admin}')$$, :'biz'), '23514', 'unknown scopes are refused');
select tests.fails_with(format($$select public.create_api_key(%L, 'None', '{}')$$, :'biz'), '23514', 'a key needs a scope');
select tests.ok((select scopes = '{leads:write}' from public.api_keys where business_id = :'biz' and name = 'Website form'),
                'keys made without scopes are lead-intake keys, like the Sprint 2 keys');
reset role;
select set_config('request.jwt.claim.sub', :'sal', false);
set role authenticated;
select tests.fails_with(format($$select public.create_api_key(%L, 'Mine', '{leads:read}')$$, :'biz'), '42501',
                        'staff without integrations.manage cannot make keys');
reset role;
select set_config('request.jwt.claim.sub', :'rho', false);
set role authenticated;
select public.create_api_key(:'biz2', 'Everything',
  '{leads:read,leads:write,customers:read,orders:read,orders:write,tasks:write,webhooks:manage}') as k_other \gset
reset role;

-- ------------------------------------------------------------ webhook endpoints (app)
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select x -> 'endpoint' ->> 'id' as ep, x ->> 'secret' as secret
  from (select public.create_webhook_endpoint(:'biz', 'https://hooks.pi.test/scaler',
          '{lead.created,lead.stage_changed,order.created,order.stage_changed,payment.recorded,customer.merged}', 'ERP') x) s \gset
select tests.ok(:'secret' like 'whsec_%' and length(:'secret') > 40, 'a new endpoint gets a signing secret, shown once');
select tests.ok((select secret_prefix = left(:'secret', 12) from public.webhook_endpoints where id = :'ep'), 'only its prefix is readable');
select tests.fails(format($$select secret_vault_id from public.webhook_endpoints where id = %L$$, :'ep'), 'the vault reference is not readable');
select tests.fails_with(format($$select public.create_webhook_endpoint(%L, 'http://hooks.pi.test/x', '{lead.created}')$$, :'biz'),
                        '23514', 'endpoints must use https');
select tests.fails_with(format($$select public.create_webhook_endpoint(%L, 'https://localhost/x', '{lead.created}')$$, :'biz'),
                        '23514', 'and a public address (localhost)');
select tests.fails_with(format($$select public.create_webhook_endpoint(%L, 'https://10.1.2.3/x', '{lead.created}')$$, :'biz'),
                        '23514', 'and a public address (private network)');
select tests.fails_with(format($$select public.create_webhook_endpoint(%L, 'https://hooks.pi.test/y', '{lead.deleted}')$$, :'biz'),
                        '23514', 'events come from the published list');
reset role;
select set_config('request.jwt.claim.sub', :'sal', false);
set role authenticated;
select tests.fails_with(format($$select public.create_webhook_endpoint(%L, 'https://x.pi.test/', '{lead.created}')$$, :'biz'),
                        '42501', 'staff cannot add endpoints');
select tests.ok((select count(*) = 0 from public.webhook_endpoints), 'or see them');
reset role;
select set_config('request.jwt.claim.sub', :'rho', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.webhook_endpoints where business_id = :'biz'), 'other businesses see no endpoints');
select tests.fails_with(format($$select public.update_webhook_endpoint(%L, %L, '{"is_active": false}')$$, :'biz2', :'ep'),
                        'P0002', 'or change them');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.fails($$select * from public.webhook_endpoints$$, 'signed-out visitors cannot read endpoints');
select tests.fails($$select * from public.webhook_deliveries$$, 'or deliveries');
reset role;

-- ------------------------------------------------------------ writes, scopes and tenants
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select r ->> 'lead_id' as lead, r ->> 'customer_id' as cust
  from (select public.api_submit_lead(:'k_form', 'form-1', 'h-form-1',
          '{"phone": "+919800001301", "full_name": "Api Lead", "source": "website"}') r) s \gset
select tests.fails_with(format($$select public.api_submit_lead(%L, null, 'h', '{"phone": "+919800001399"}')$$, :'k_read'),
                        '42501', 'a read-only key cannot create leads');
select tests.fails_with($$select public.api_submit_lead('sk_live_nope', null, 'h', '{"phone": "+919800001399"}')$$,
                        '28000', 'an unknown key is refused');
reset role;
select tests.ok((select count(*) = 1 from public.webhook_deliveries d join public.webhook_events e on e.id = d.event_id
                  where d.endpoint_id = :'ep' and e.type = 'lead.created' and e.data ->> 'id' = :'lead' and d.status = 'pending'),
                'a new lead queues lead.created for the endpoint');
select tests.ok((select count(*) = 0 from public.webhook_events where business_id = :'biz2'),
                'businesses without endpoints write no events');

-- ------------------------------------------------------------ reads
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.ok((public.api_get(:'k_read', 'leads', :'lead') ->> 'lead_number') is not null, 'a leads:read key reads the lead');
select tests.ok(public.api_get(:'k_other', 'leads', :'lead') is null, 'another business''s key gets nothing for that id');
select tests.ok(not exists (select 1 from jsonb_array_elements(public.api_list(:'k_other', 'leads') -> 'data') l where l ->> 'id' = :'lead'),
                'nor in its lists');
select tests.fails_with(format($$select public.api_list(%L, 'leads')$$, :'k_form'), '42501', 'a write-only key cannot list leads');
select tests.fails_with(format($$select public.api_get(%L, 'customers', %L)$$, :'k_erp', :'cust'), '42501',
                        'or read customers without customers:read');
select tests.fails_with(format($$select public.api_list(%L, 'tasks')$$, :'k_read'), '22023', 'unknown resources are refused');

select public.api_submit_lead(:'k_form', null, 'h2', '{"phone": "+919800001302", "full_name": "Second"}') ->> 'customer_id' as cust2 \gset
select public.api_submit_lead(:'k_form', null, 'h3', '{"phone": "+919800001303", "full_name": "Third"}');
select p -> 'next' ->> 't' as next_t, p -> 'next' ->> 'id' as next_id
  from (select public.api_list(:'k_read', 'leads', p_limit => 2) p) s \gset
select tests.ok((select jsonb_array_length(p -> 'data') = 2 and (p ->> 'has_more')::boolean
                   from (select public.api_list(:'k_read', 'leads', p_limit => 2) p) s), 'pages hold the limit and say there is more');
select tests.ok((select jsonb_array_length(p -> 'data') = 1 and not (p ->> 'has_more')::boolean
                   and p -> 'data' -> 0 ->> 'id' <> all (select l ->> 'id' from jsonb_array_elements(public.api_list(:'k_read', 'leads', p_limit => 2) -> 'data') l)
                   from (select public.api_list(:'k_read', 'leads', :'next_t'::timestamptz, :'next_id'::uuid, p_limit => 2) p) s),
                'the cursor continues exactly after the last row');
select tests.ok(jsonb_array_length(public.api_list(:'k_read', 'leads', p_updated_since => now() + interval '1 hour') -> 'data') = 0,
                'updated_since filters out older rows');
select tests.ok(jsonb_array_length(public.api_list(:'k_read', 'customers', p_filters => '{"phone": "+919800001301"}') -> 'data') = 1,
                'customers can be found by phone');
reset role;

-- ------------------------------------------------------------ lead updates
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.ok((select r ->> 'status' = '200' and r -> 'lead' ->> 'status' = 'contacted' and r -> 'lead' ->> 'expected_value' = '1500.50'
                   from (select public.api_update_lead(:'k_erp', :'lead', null, 'u1', '{"status": "contacted", "expected_value": "1500.50"}') r) s),
                'a leads:write key moves the lead and sets its value');
select tests.fails_with(format($$select public.api_update_lead(%L, %L, null, 'u2', '{"status": "nonsense"}')$$, :'k_erp', :'lead'),
                        '22023', 'unknown statuses are refused');
select tests.fails_with(format($$select public.api_update_lead(%L, %L, null, 'u3', '{"status": "qualified"}')$$, :'k_other', :'lead'),
                        'P0002', 'another business''s key cannot touch the lead');
select tests.fails_with(format($$select public.api_update_lead(%L, %L, null, 'u4', '{"title": "x"}')$$, :'k_read', :'lead'),
                        '42501', 'and nor can a read-only key');
reset role;
select tests.ok((select count(*) = 1 from public.webhook_events e
                  where e.business_id = :'biz' and e.type = 'lead.stage_changed'
                    and e.data ->> 'from_status' = 'new' and e.data ->> 'to_status' = 'contacted'),
                'lead.stage_changed carries the old and new status');
select tests.ok((select changed_by is null from public.lead_status_history where lead_id = :'lead' order by changed_at desc limit 1),
                'the status history records the change, as the app does');

-- ------------------------------------------------------------ orders, idempotency
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select o -> 'order' ->> 'id' as ord, o ->> 'status' as ord_status, o -> 'order' ->> 'total' as ord_total
  from (select public.api_create_order(:'k_erp', 'ord-1', 'hash-a', jsonb_build_object(
          'customer_id', :'cust', 'lead_id', :'lead',
          'items', '[{"description": "Sherwani", "quantity": 1, "unit_price": "12000.00", "tax_rate": 5}]'::jsonb)) o) s \gset
select tests.ok(:'ord_status' = '201' and :'ord_total' = '12600.00', 'an orders:write key creates an order (money as a string)');
select tests.ok((select o -> 'order' ->> 'id' = :'ord' and (o ->> 'replayed')::boolean
                   from (select public.api_create_order(:'k_erp', 'ord-1', 'hash-a', '{}') o) s),
                'retrying with the same idempotency key returns the first order');
select tests.fails_with(format($$select public.api_create_order(%L, 'ord-1', 'hash-b', '{}')$$, :'k_erp'), 'P0409',
                        'the same key with a different request is refused');
select tests.fails_with(format($$select public.api_create_order(%L, null, 'h', %L)$$, :'k_other',
                          jsonb_build_object('customer_id', :'cust', 'items', '[{"description": "x", "unit_price": 1}]'::jsonb)),
                        'P0002', 'a key cannot create orders for another business''s customer');
select tests.fails_with(format($$select public.api_create_order(%L, null, 'h', %L)$$, :'k_erp',
                          jsonb_build_object('customer_id', :'cust', 'items', '[]'::jsonb)),
                        '23514', 'an order needs a line');
select tests.ok((select r -> 'order' ->> 'stage' = 'in_production'
                   from (select public.api_update_order(:'k_erp', :'ord', null, 'o2', '{"stage": "in_production"}') r) s),
                'and moves it to another stage');
select tests.fails_with(format($$select public.api_update_order(%L, %L, null, 'o3', '{"stage": "nope"}')$$, :'k_erp', :'ord'),
                        '22023', 'unknown stages are refused');
reset role;
select tests.ok((select count(*) = 1 from public.api_idempotency_keys where business_id = :'biz' and idempotency_key = 'ord-1'),
                'the order was created once');
select tests.ok((select e.data ->> 'total' = '12600.00' and jsonb_array_length(e.data -> 'items') = 1
                   from public.webhook_events e where e.business_id = :'biz' and e.type = 'order.created'),
                'order.created is built after the lines are in');
select tests.ok((select e.data ->> 'to_stage' = 'in_production' from public.webhook_events e
                  where e.business_id = :'biz' and e.type = 'order.stage_changed'),
                'order.stage_changed is queued');

-- Payments are recorded in the app and read through the API.
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
insert into public.payments (business_id, order_id, amount, method) values (:'biz', :'ord', 2000, 'upi');
reset role;
select tests.ok((select e.data ->> 'amount' = '2000.00' from public.webhook_events e
                  where e.business_id = :'biz' and e.type = 'payment.recorded'),
                'payment.recorded is queued');
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.ok((select p -> 'data' -> 0 ->> 'amount' = '2000.00'
                   from (select public.api_list(:'k_read', 'payments', p_filters => jsonb_build_object('order_id', :'ord')) p) s),
                'payments are listed by order');
select tests.ok(public.api_get(:'k_read', 'orders', :'ord') ->> 'balance' = '10600.00', 'orders show what is still owed');
reset role;

-- ------------------------------------------------------------ tasks
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.fails_with(format($$select public.api_create_task(%L, null, 'h', %L)$$, :'k_erp',
                          jsonb_build_object('lead_id', :'lead', 'title', 'Call back', 'due_at', now() + interval '1 day')),
                        '23514', 'a task on an unowned lead needs an assignee');
select tests.ok((select r ->> 'status' = '201' and r -> 'task' ->> 'assignee_id' = :'sal' and r -> 'task' ->> 'customer_id' = :'cust'
                   from (select public.api_create_task(:'k_erp', 't-1', 'h', jsonb_build_object(
                           'lead_id', :'lead', 'title', 'Call back', 'assignee_id', :'sal', 'due_at', now() + interval '1 day')) r) s),
                'a tasks:write key creates a task on the lead');
select tests.fails_with(format($$select public.api_create_task(%L, null, 'h', %L)$$, :'k_erp',
                          jsonb_build_object('lead_id', :'lead', 'title', 'x', 'assignee_id', :'rho', 'due_at', now())),
                        '23514', 'assignees must be members of the business');
select tests.fails_with(format($$select public.api_create_task(%L, null, 'h', %L)$$, :'k_read',
                          jsonb_build_object('lead_id', :'lead', 'title', 'x', 'assignee_id', :'sal', 'due_at', now())),
                        '42501', 'a read-only key cannot create tasks');
reset role;

-- ------------------------------------------------------------ merges
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select public.merge_customers(:'cust', :'cust2');
reset role;
select tests.ok((select e.data ->> 'merged_customer_id' = :'cust2' and e.data -> 'customer' ->> 'id' = :'cust'
                   from public.webhook_events e where e.business_id = :'biz' and e.type = 'customer.merged'),
                'customer.merged names both files');

-- ------------------------------------------------------------ read-only and revoked
update public.businesses set status = 'suspended' where id = :'biz';
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.ok(jsonb_array_length(public.api_list(:'k_read', 'leads') -> 'data') >= 1, 'a read-only business can still be read');
select tests.fails_with(format($$select public.api_submit_lead(%L, null, 'h', '{"phone": "+919800001398"}')$$, :'k_form'),
                        '25006', 'but not written to');
reset role;
update public.businesses set status = 'active' where id = :'biz';

select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select public.create_api_key(:'biz', 'Old') as k_old \gset
update public.api_keys set revoked_at = now() where business_id = :'biz' and name = 'Old';
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.fails_with(format($$select public.api_list(%L, 'leads')$$, :'k_old'), '28000', 'revoked keys stop working');
reset role;
select tests.ok((select last_used_at is not null from public.api_keys where business_id = :'biz' and name = 'Sync'),
                'keys record when they were last used');

-- ------------------------------------------------------------ rate limits per plan
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.ok((select (r ->> 'limit')::int = 300 and (r ->> 'remaining')::int < 300 and (r ->> 'reset')::int between 1 and 60
                   from (select public.api_rate(:'k_read') r) s),
                'a Growth key gets 300 a minute, with remaining and reset for the headers');
reset role;
update public.businesses set plan_key = 'starter', trial_ends_at = null where id = :'biz2';
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.ok((public.api_rate(:'k_other') ->> 'limit')::int = 120, 'a Starter key gets 120');
reset role;

-- ------------------------------------------------------------ sending, retries, auto-disable, replay
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select tests.fails($$select * from public.claim_webhook_deliveries(10)$$, 'signed-in users cannot claim deliveries');
reset role;

set role service_role;
create temp table claimed as select * from public.claim_webhook_deliveries(100);
reset role;
select tests.ok((select count(*) >= 5 and bool_and(secret = :'secret' and url = 'https://hooks.pi.test/scaler' and attempt = 1)
                   from claimed),
                'the job route claims due deliveries with the url and secret to sign with');
select tests.ok((select count(*) = 0 from public.webhook_deliveries where endpoint_id = :'ep' and status = 'pending'),
                'claimed deliveries are no longer due');
select min(id) as d_ok, max(id) as d_fail from claimed \gset

set role service_role;
select tests.ok(public.finish_webhook_delivery(:d_ok, 200, null, 120) = 'succeeded', 'a 2xx answer is a success');
select tests.ok(public.finish_webhook_delivery(:d_fail, 500, null, 80) = 'pending', 'anything else is retried');
reset role;
select tests.ok((select next_attempt_at > now() and attempts = 1 and last_error = 'HTTP 500'
                   from public.webhook_deliveries where id = :d_fail),
                'after a back-off');
select tests.ok((select consecutive_failures = 1 and last_success_at is not null from public.webhook_endpoints where id = :'ep'),
                'the endpoint counts failures in a row');

-- Older than 24 hours: give up.
update public.webhook_deliveries set status = 'sending', created_at = now() - interval '24 hours' where id = :d_fail;
set role service_role;
select tests.ok(public.finish_webhook_delivery(:d_fail, 502, null, 50) = 'failed', 'retries stop after 24 hours');
reset role;

-- Replay
select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select public.replay_webhook_delivery(:'biz', :d_fail) as d_replay \gset
select tests.ok((select status = 'pending' and replay_of = :d_fail and attempts = 0 from public.webhook_deliveries where id = :d_replay),
                'a delivery can be replayed from the log');
reset role;
select set_config('request.jwt.claim.sub', :'rho', false);
set role authenticated;
select tests.fails_with(format($$select public.replay_webhook_delivery(%L, %s)$$, :'biz2', :d_fail), 'P0002',
                        'but not from another business');
reset role;

-- Twenty failures in a row switch the endpoint off and tell the admins.
update public.webhook_endpoints set consecutive_failures = 19 where id = :'ep';
set role service_role;
select tests.ok((select count(*) = 1 from public.claim_webhook_deliveries(100) where id = :d_replay), 'the replay is sent');
select tests.ok(public.finish_webhook_delivery(:d_replay, null, 'connect ECONNREFUSED', 3000) = 'disabled',
                'the twentieth failure in a row turns the endpoint off');
reset role;
select tests.ok((select not is_active and disabled_reason like '%20 failed%' from public.webhook_endpoints where id = :'ep'),
                'with the reason');
select tests.ok((select count(*) = 0 from public.webhook_deliveries where endpoint_id = :'ep' and status in ('pending', 'sending')),
                'and nothing more is queued for it');
select tests.ok((select count(*) = 1 from private.email_outbox where template = 'webhook_disabled' and to_email = 'pia@pi.test'),
                'admins are emailed');
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select public.api_update_lead(:'k_erp', :'lead', null, 'u5', '{"status": "qualified"}');
reset role;
select tests.ok((select count(*) = 0 from public.webhook_deliveries d join public.webhook_events e on e.id = d.event_id
                  where d.endpoint_id = :'ep' and e.data ->> 'to_status' = 'qualified'),
                'a switched-off endpoint gets no new events');

select set_config('request.jwt.claim.sub', :'pia', false);
set role authenticated;
select tests.ok((select (public.update_webhook_endpoint(:'biz', :'ep', '{"is_active": true}') ->> 'consecutive_failures')::int = 0),
                'turning it back on clears the failures');
select public.send_webhook_test(:'biz', :'ep') as d_ping \gset
select public.rotate_webhook_secret(:'biz', :'ep') as secret2 \gset
reset role;
set role service_role;
select tests.ok((select event_type = 'ping' and secret = :'secret2' and secret <> :'secret'
                   from public.claim_webhook_deliveries(100) where id = :d_ping),
                'a test event goes out signed with the rotated secret');
select tests.ok(public.prune_webhook_log() >= 0, 'old events are pruned');
reset role;

-- ------------------------------------------------------------ managing webhooks through the API
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select w -> 'webhook_endpoint' ->> 'id' as ep2, w -> 'webhook_endpoint' ->> 'secret' as secret3
  from (select public.api_create_webhook(:'k_hooks', null, 'w1', '{"url": "https://erp.pi.test/in", "events": ["order.created"]}') w) s \gset
select tests.ok(:'secret3' like 'whsec_%', 'a webhooks:manage key adds an endpoint and gets its secret');
select tests.ok(jsonb_array_length(public.api_list_webhooks(:'k_hooks') -> 'data') = 2, 'and lists them');
select tests.ok(not (public.api_list_webhooks(:'k_hooks') -> 'data' -> 0 ? 'secret'), 'lists never include secrets');
select tests.fails_with(format($$select public.api_list_webhooks(%L)$$, :'k_read'), '42501', 'other keys cannot');
select tests.fails_with(format($$select public.api_delete_webhook(%L, %L)$$, :'k_other', :'ep2'), 'P0002',
                        'nor can another business''s key delete it');
select tests.ok((public.api_delete_webhook(:'k_hooks', :'ep2') ->> 'deleted')::boolean, 'the key can delete it');
reset role;

-- ------------------------------------------------------------ fixtures for the contract samples
insert into tests.api_fixture (name, value) values
  ('k_read', :'k_read'), ('k_erp', :'k_erp'), ('k_hooks', :'k_hooks'),
  ('lead', :'lead'), ('customer', :'cust'), ('order', :'ord');

\echo 'public api and webhooks: all checks passed'
