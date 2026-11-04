-- API contract samples: real api_* output for src/modules/api/contract.test.ts.
-- Run by scripts/db-test.sh after the test files (uses 985_public_api.sql's keys).
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

select value as k_read from tests.api_fixture where name = 'k_read' \gset
select value as k_erp from tests.api_fixture where name = 'k_erp' \gset
select value as k_hooks from tests.api_fixture where name = 'k_hooks' \gset
select value as lead from tests.api_fixture where name = 'lead' \gset
select value as cust from tests.api_fixture where name = 'customer' \gset
select value as ord from tests.api_fixture where name = 'order' \gset

select m.user_id as assignee from public.business_memberships m join public.api_keys k on k.business_id = m.business_id
 where k.key_hash = private.hash_token(:'k_erp') and m.status = 'active' limit 1 \gset

select set_config('request.jwt.claim.sub', '', false) \g /dev/null
set role anon;
select jsonb_build_object(
  'CustomerList', public.api_list(:'k_read', 'customers'),
  'LeadList', public.api_list(:'k_read', 'leads', p_limit => 2),
  'OrderList', public.api_list(:'k_read', 'orders'),
  'PaymentList', public.api_list(:'k_read', 'payments'),
  'WebhookEndpointList', public.api_list_webhooks(:'k_hooks'),
  'Customer', public.api_get(:'k_read', 'customers', :'cust'),
  'Lead', public.api_get(:'k_read', 'leads', :'lead'),
  'Order', public.api_get(:'k_read', 'orders', :'ord'),
  'Payment', public.api_get(:'k_read', 'payments', (public.api_list(:'k_read', 'payments') -> 'data' -> 0 ->> 'id')::uuid),
  'LeadUpdated', public.api_update_lead(:'k_erp', :'lead', null, 'contract-1', '{"title": "Contract check", "custom_fields": {}}'),
  'OrderCreated', public.api_create_order(:'k_erp', 'contract-2', 'c2', jsonb_build_object(
      'customer_id', :'cust', 'due_date', '2030-01-31',
      'items', '[{"description": "Kurta", "quantity": 2, "unit_price": "1499.50", "discount": "99.00", "tax_rate": 12}]'::jsonb)),
  'TaskCreated', public.api_create_task(:'k_erp', 'contract-3', 'c3', jsonb_build_object(
      'customer_id', :'cust', 'title', 'Contract task', 'due_at', '2030-01-01T10:00:00+05:30',
      'assignee_id', :'assignee')),
  'WebhookEndpointCreated', public.api_create_webhook(:'k_hooks', null, 'c4',
      '{"url": "https://contract.example.com/hook", "events": ["lead.created", "payment.recorded"]}')
) as samples \gset
reset role;
select (:'samples')::jsonb || jsonb_build_object('events', jsonb_agg(jsonb_build_object('business_id', e.business_id, 'event_id', e.id, 'event_type', e.type,
                                    'data', e.data, 'event_created_at', e.created_at) order by e.id))
  from public.webhook_events e;
