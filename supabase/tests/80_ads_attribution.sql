-- Meta Lead Ads, Google lead webhooks, ad spend, touchpoints, attribution and integration health.
\set ON_ERROR_STOP on
\set QUIET on
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

\set ada '0f000000-0000-0000-0000-000000000001'
\set mia '0f000000-0000-0000-0000-000000000002'
\set sid '0f000000-0000-0000-0000-000000000003'
\set ozz '0f000000-0000-0000-0000-000000000004'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ada', 'ada@xi.test', '{"full_name":"Ada Admin"}'),
  (:'mia', 'mia@xi.test', '{"full_name":"Mia Marketing"}'),
  (:'sid', 'sid@xi.test', '{"full_name":"Sid Sales"}'),
  (:'ozz', 'ozz@omicron.test', '{"full_name":"Ozz Other"}');

select set_config('request.jwt.claim.sub', :'ada', false);
set role authenticated;
select public.create_business('Xi Ethnic', 'xi-ethnic', 'Main') as biz \gset
reset role;
select set_config('request.jwt.claim.sub', :'ozz', false);
set role authenticated;
select public.create_business('Omicron Store', 'omicron-store', 'Delhi') as other \gset
reset role;
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', u.id, r.id, 'active', now()
  from (values (:'mia'::uuid, 'marketing_manager'), (:'sid'::uuid, 'sales_executive')) u(id, role)
  join public.roles r on r.key = u.role and r.business_id is null;
select set_config('t.biz', :'biz', false);

-- ------------------------------------------------------------ connecting
select set_config('request.jwt.claim.sub', :'mia', false);
set role authenticated;
select public.connect_meta_page(:'biz', '{"page_id":"1122334455","name":"Xi Ethnic","access_token":"EAAG-page-token-0123456789","subscribed":true}') as page \gset
select tests.ok((select subscribed and status = 'connected' from public.meta_pages where id = :'page'), 'a marketing manager can connect a Facebook page');
select tests.fails('select token_secret_id from public.meta_pages', 'page tokens are never selectable');
select public.connect_ad_account(:'biz', '{"platform":"meta","external_id":"9876543","name":"Xi ads","currency":"INR","token":"EAAG-ads-token-0123456789"}') as acct \gset
insert into public.lead_webhooks (business_id, name, url_token_hash, secret_hash, created_by)
values (:'biz', 'Google search leads', 'urlhash123', 'secrethash123', :'mia') returning id as gw \gset
reset role;

select set_config('request.jwt.claim.sub', :'sid', false);
set role authenticated;
select tests.fails(format('select public.connect_meta_page(%L, %L)', current_setting('t.biz'), '{"page_id":"5566778899","access_token":"EAAG-page-token-0123456789"}'),
                   'sales staff cannot connect pages');
select tests.ok((select count(*) = 0 from public.meta_pages), 'sales staff do not see integrations');
reset role;

-- ------------------------------------------------------------ Meta lead
set role service_role;
select tests.ok(public.meta_page_business('1122334455') = :'biz', 'leadgen webhooks find the business by page');
select public.record_lead_event('meta_leadgen', 'lg-1', :'biz', '{"leadgen_id":"lg-1","page_id":"1122334455","form_id":"f1"}') as e1 \gset
select tests.ok(public.record_lead_event('meta_leadgen', 'lg-1', :'biz', '{}') is null, 'a repeated leadgen webhook is stored once');
select tests.ok((public.lead_event_context(:'e1') ->> 'page_token') = 'EAAG-page-token-0123456789'
                and (public.lead_event_context(:'e1') ->> 'country_code') = 'IN',
                'the processor gets the page token and country');
select public.ingest_external_lead(:'e1', jsonb_build_object(
  'phone', '+919822000001', 'full_name', 'Lakshmi', 'source', 'meta_ads', 'campaign', 'Diwali FB',
  'touch', jsonb_build_object('campaign_id', 'c-1', 'adset_id', 'as-1', 'ad_id', 'ad-1', 'form_id', 'f1'),
  'form', jsonb_build_object('id', 'f1', 'name', 'Diwali form', 'fields', jsonb_build_array('full_name', 'phone_number')))) as l1 \gset
select tests.ok((public.ingest_external_lead(:'e1', '{}') ->> 'duplicate')::boolean, 'a processed lead is not processed twice');
reset role;
select set_config('t.l1', :'l1', false);
select tests.ok((select s.key = 'meta_ads' and l.first_campaign = 'Diwali FB' and l.first_touch ->> 'ad_id' = 'ad-1'
                   from public.leads l join public.lead_sources s on s.id = l.first_source_id
                  where l.id = (:'l1'::jsonb ->> 'lead_id')::uuid),
                'Meta leads keep source, campaign and ad ids');
select tests.ok((select fields = array['full_name', 'phone_number'] and leads_received = 1
                   from public.lead_forms where business_id = :'biz' and external_form_id = 'f1'),
                'the form and its fields are recorded for mapping');
select tests.ok((select count(*) = 1 from public.lead_touchpoints
                  where lead_id = (:'l1'::jsonb ->> 'lead_id')::uuid and kind = 'first' and campaign_id = 'c-1'),
                'the lead''s first touchpoint is recorded');

-- Mapping: send this form's leads in as Instagram from now on.
select set_config('request.jwt.claim.sub', :'mia', false);
set role authenticated;
update public.lead_forms set source_id = (select id from public.lead_sources where business_id = :'biz' and key = 'instagram'),
                             mapping = '{"phone_number":"phone","full_name":"full_name"}'
 where business_id = :'biz' and external_form_id = 'f1';
reset role;
set role service_role;
select public.record_lead_event('meta_leadgen', 'lg-2', :'biz', '{"page_id":"1122334455","form_id":"f1"}') as e2 \gset
select (public.lead_event_context(:'e2') -> 'form' ->> 'source_id') is not null as mapped \gset
select public.ingest_external_lead(:'e2', jsonb_build_object('phone', '+919822000002', 'full_name', 'Meena',
  'form', jsonb_build_object('id', 'f1', 'fields', jsonb_build_array('full_name', 'phone_number')))) as l2 \gset
reset role;
select tests.ok(:'mapped' and (select s.key = 'instagram' from public.leads l join public.lead_sources s on s.id = l.first_source_id
                  where l.id = (:'l2'::jsonb ->> 'lead_id')::uuid),
                'a form''s mapping decides the lead source');

-- ------------------------------------------------------------ Google lead (repeat enquiry)
set role service_role;
select tests.ok((public.lead_webhook_by_token('urlhash123') ->> 'secret_hash') = 'secrethash123', 'Google webhooks find their configuration by URL token');
select public.record_lead_event('google_ads', 'g-1', :'biz', '{"form_id":"gf1"}') as e3 \gset
select public.ingest_external_lead(:'e3', jsonb_build_object('phone', '+919822000001', 'full_name', 'Lakshmi', 'source', 'google_ads',
  'campaign', 'Search brand', 'touch', jsonb_build_object('campaign_id', 'g-77', 'gclid', 'gcl-abc'))) as l3 \gset
reset role;
select tests.ok(not (:'l3'::jsonb ->> 'lead_created')::boolean
                and (:'l3'::jsonb ->> 'lead_id') = (:'l1'::jsonb ->> 'lead_id'),
                'a returning customer''s Google lead joins their open lead');
select tests.ok((select count(*) = 1 from public.lead_touchpoints
                  where lead_id = (:'l1'::jsonb ->> 'lead_id')::uuid and kind = 'repeat' and gclid = 'gcl-abc'),
                'and is recorded as a second touchpoint');

-- ------------------------------------------------------------ spend and attribution
set role service_role;
select tests.ok(public.upsert_ad_spend(:'acct', '[
  {"campaign_id":"c-1","campaign_name":"Diwali FB","day":"2027-02-01","spend":"1000.50","impressions":"20000","clicks":"300"},
  {"campaign_id":"c-1","campaign_name":"Diwali FB","day":"2027-02-02","spend":"499.50","impressions":"9000","clicks":"120"}]') = 2,
  'daily spend is stored per campaign');
select public.upsert_ad_spend(:'acct', '[{"campaign_id":"c-1","campaign_name":"Diwali FB","day":"2027-02-02","spend":"500.00"}]');
reset role;
select tests.ok((select sum(spend) = 1500.50 from public.ad_spend_daily where business_id = :'biz'), 're-syncing a day replaces it');

select set_config('request.jwt.claim.sub', :'ada', false);
set role authenticated;
select public.create_order(:'biz', jsonb_build_object('customer_id', :'l1'::jsonb ->> 'customer_id',
  'items', jsonb_build_array(jsonb_build_object('description', 'Saree', 'unit_price', '10000')))) as o1 \gset
reset role;
select set_config('request.jwt.claim.sub', :'mia', false);
set role authenticated;
select tests.ok((select first_orders = 1 and first_revenue = 10000 and last_orders = 0 and linear_revenue = 5000 and leads = 1 and spend = 1500.50
                   from public.attribution_report(:'biz', '2026-01-01', '2030-01-01') where campaign_id = 'c-1'),
                'first touch gets the order under first-touch, half under linear, and spend lines up');
select tests.ok((select last_orders = 1 and last_revenue = 10000 and linear_revenue = 5000
                   from public.attribution_report(:'biz', '2026-01-01', '2030-01-01') where campaign_id = 'g-77'),
                'the Google repeat touch gets it under last-touch');
insert into public.attribution_settings (business_id, model, lookback_days, updated_by) values (:'biz', 'linear', 60, :'mia');
reset role;
select tests.ok((select count(*) = 1 from public.audit_logs where entity_type = 'attribution_settings' and business_id = :'biz'),
                'the attribution policy is audited');

-- ------------------------------------------------------------ health and retry
update private.webhook_events set status = 'failed', last_error = 'token expired' where id = :'e2';
select set_config('request.jwt.claim.sub', :'mia', false);
set role authenticated;
select tests.ok(((public.integration_health(:'biz') ->> 'failed')::int = 1), 'failed events show in integration health');
select tests.ok(public.retry_failed_events(:'biz') = 1, 'failed events can be retried');
select tests.ok(((public.integration_health(:'biz') ->> 'pending')::int = 1), 'and wait for the job again');
select public.disconnect_integration('meta_page', :'page');
select tests.ok((select status = 'disconnected' from public.meta_pages where id = :'page'), 'pages can be disconnected');
reset role;
select tests.ok((select s.secret = 'revoked' from vault.secrets s join public.meta_pages p on p.token_secret_id = s.id where p.id = :'page'),
                'disconnecting wipes the page token');

-- ------------------------------------------------------------ isolation
select set_config('request.jwt.claim.sub', :'ozz', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.lead_touchpoints), 'other tenant sees no touchpoints');
select tests.ok((select count(*) = 0 from public.ad_spend_daily), 'other tenant sees no spend');
select tests.ok((select count(*) = 0 from public.lead_forms), 'other tenant sees no lead forms');
select tests.ok((select count(*) = 0 from public.attribution_report(current_setting('t.biz')::uuid, '2026-01-01', '2030-01-01')),
                'other tenant gets no attribution');
select tests.fails(format('select public.integration_health(%L)', current_setting('t.biz')), 'other tenant cannot read integration health');
reset role;

\echo 'ads and attribution: all checks passed'
