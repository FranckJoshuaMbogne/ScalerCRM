-- Templates, consent and opt-outs, suppression, audiences, campaigns, the send queue and reports.
\set ON_ERROR_STOP on
\set QUIET on
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

\set ann  '0e000000-0000-0000-0000-000000000001'
\set mark '0e000000-0000-0000-0000-000000000002'
\set sal  '0e000000-0000-0000-0000-000000000003'
\set oli  '0e000000-0000-0000-0000-000000000004'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ann',  'ann@mu.test',  '{"full_name":"Ann Admin"}'),
  (:'mark', 'mark@mu.test', '{"full_name":"Mark Marketing"}'),
  (:'sal',  'sal@mu.test',  '{"full_name":"Sal Sales"}'),
  (:'oli',  'oli@nu.test',  '{"full_name":"Oli Other"}');

select set_config('request.jwt.claim.sub', :'ann', false);
set role authenticated;
select public.create_business('Mu Menswear', 'mu-menswear', 'Main') as biz \gset
reset role;
select set_config('request.jwt.claim.sub', :'oli', false);
set role authenticated;
select public.create_business('Nu Store', 'nu-store', 'Delhi') as other \gset
reset role;
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', u.id, r.id, 'active', now()
  from (values (:'mark'::uuid, 'marketing_manager'), (:'sal'::uuid, 'sales_executive')) u(id, role)
  join public.roles r on r.key = u.role and r.business_id is null;
select set_config('t.biz', :'biz', false);

-- ------------------------------------------------------------ customers and consent
select set_config('request.jwt.claim.sub', :'ann', false);
set role authenticated;
select public.connect_whatsapp_account(:'biz', '{"waba_id":"700800900","phone_number_id":"777000111","access_token":"EAAG-mu-token-0123456789"}') as acct \gset
select (public.create_lead(:'biz', '{"phone":"+919811000001","full_name":"Ravi Kumar"}') ->> 'customer_id') as c1 \gset
select (public.create_lead(:'biz', '{"phone":"+919811000002","full_name":"No Consent"}') ->> 'customer_id') as c2 \gset
select (public.create_lead(:'biz', '{"phone":"+919811000003","full_name":"Suppressed Sam"}') ->> 'customer_id') as c3 \gset
select (public.create_lead(:'biz', '{"email":"nophone@mu.test","full_name":"Email Only"}') ->> 'customer_id') as c4 \gset
select (public.create_lead(:'biz', '{"phone":"+919811000005","full_name":"Priya Shah"}') ->> 'customer_id') as c5 \gset
insert into public.customer_consents (business_id, customer_id, channel, purpose, status, source, captured_by)
select :'biz', x, 'whatsapp', 'marketing', 'opted_in', 'manual', :'ann'
  from unnest(array[:'c1', :'c3', :'c4', :'c5']::uuid[]) x;
insert into public.tags (business_id, name) values (:'biz', 'VIP') returning id as vip \gset
insert into public.customer_tags (business_id, customer_id, tag_id) values (:'biz', :'c1', :'vip');
reset role;

select set_config('request.jwt.claim.sub', :'mark', false);
set role authenticated;
insert into public.suppressions (business_id, phone, reason, created_by) values (:'biz', '+919811000003', 'manual', :'mark');
select tests.ok((public.audience_estimate(:'biz', '{}') = '{"matching":5,"eligible":2,"no_phone":1,"no_consent":1,"suppressed":1}'::jsonb),
                'the estimate counts who can be messaged and why the rest cannot');
select tests.ok(((public.audience_estimate(:'biz', jsonb_build_object('tag_ids', jsonb_build_array(:'vip'))) ->> 'eligible')::int = 1),
                'filters narrow the audience');

-- ------------------------------------------------------------ templates
insert into public.whatsapp_templates (business_id, waba_id, name, language, category, components, variable_count, created_by)
values (:'biz', '700800900', 'diwali_offer', 'en', 'MARKETING',
        '{"body":{"text":"Hi {{1}}, 20% off this Diwali.","examples":["Ravi"]},"buttons":[{"type":"QUICK_REPLY","text":"Stop promotions"}]}', 1, :'mark')
returning id as tpl \gset
insert into public.whatsapp_templates (business_id, waba_id, name, language, components, variable_count, created_by)
values (:'biz', '700800900', 'still_draft', 'en', '{"body":{"text":"Hello"}}', 0, :'mark') returning id as tpl_draft \gset
select tests.fails(format('insert into public.whatsapp_templates (business_id, waba_id, name, components, status, created_by) values (%L, %L, %L, %L, %L, %L)',
                          :'biz', '700800900', 'sneaky', '{"body":{"text":"x"}}', 'approved', :'mark'),
                   'a template cannot be created as approved');
select tests.fails(format('insert into public.whatsapp_templates (business_id, waba_id, name, components, created_by) values (%L, %L, %L, %L, %L)',
                          :'biz', '123456789', 'foreign', '{"body":{"text":"x"}}', :'mark'),
                   'templates belong to a WhatsApp account the business connected');
reset role;
set role service_role;
select tests.ok(public.apply_template_status('700800900', '{"name":"diwali_offer","language":"en","status":"APPROVED","id":"tmpl-1"}') = 1,
                'template approval from Meta is applied');
reset role;

-- ------------------------------------------------------------ campaigns
select set_config('request.jwt.claim.sub', :'mark', false);
set role authenticated;
insert into public.campaigns (business_id, name, account_id, template_id, variables, rate_per_minute, created_by)
values (:'biz', 'Diwali', :'acct', :'tpl', '[{"source":"first_name"}]', 1, :'mark') returning id as camp \gset
insert into public.campaigns (business_id, name, account_id, template_id, created_by)
values (:'biz', 'Draft template', :'acct', :'tpl_draft', :'mark') returning id as camp_bad \gset
select set_config('t.camp', :'camp', false);
select tests.fails(format('select public.launch_campaign(%L)', :'camp_bad'), 'only approved templates can be sent');
reset role;

select set_config('request.jwt.claim.sub', :'sal', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.campaigns), 'sales staff without campaign access see no campaigns');
select tests.fails(format('select public.launch_campaign(%L)', current_setting('t.camp')), 'launching needs campaigns.send');
select tests.fails(format('insert into public.suppressions (business_id, phone, reason, created_by) values (%L, %L, %L, %L)',
                          current_setting('t.biz'), '+919811000099', 'manual', :'sal'),
                   'suppressions need campaigns.manage');
reset role;

select set_config('request.jwt.claim.sub', :'mark', false);
set role authenticated;
select tests.ok((public.launch_campaign(:'camp') ->> 'recipients')::int = 2, 'launch builds recipients from consenting, unsuppressed numbers');
select tests.ok((select array_agg(params ->> 0 order by phone) = array['Ravi', 'Priya'] from public.campaign_recipients where campaign_id = :'camp'),
                'template variables are filled per customer');
select tests.affects_none(format('update public.campaigns set name = %L where id = %L', 'x', :'camp'), 'a launched campaign cannot be edited');
reset role;

-- Send queue: throttled to 1 per minute. Hold Priya back so Ravi goes first (claim order is otherwise by id).
update public.campaign_recipients set next_attempt_at = now() + interval '1 minute'
 where campaign_id = :'camp' and customer_id = :'c5';
set role service_role;
select count(*) as claimed1 from public.claim_campaign_batch(100, 1) \gset
reset role;
select tests.ok(:'claimed1' = 1, 'sending is throttled to the campaign''s rate');
select id as sent_r, customer_id as sent_c from public.campaign_recipients where campaign_id = :'camp' and status = 'sending' \gset
select id as other_r, customer_id as other_c, phone as other_phone from public.campaign_recipients where campaign_id = :'camp' and status = 'pending' \gset
set role service_role;
select public.record_campaign_send(:'sent_r', 'wamid.CAMP1', 'Hi Ravi, 20% off this Diwali.');
reset role;
select tests.ok((select r.status = 'sent' and m.type = 'template' and m.direction = 'outbound'
                   from public.campaign_recipients r join public.messages m on m.id = r.message_id where r.id = :'sent_r'),
                'a sent campaign message appears in the customer''s conversation');

-- The other recipient replies STOP before their turn.
set role service_role;
select public.record_webhook_event('meta', 'wamid.STOP1', 'message', '777000111', '{}') as stop_ev \gset
select public.ingest_whatsapp_message(:'stop_ev', jsonb_build_object('wamid', 'wamid.STOP1', 'phone', :'other_phone', 'type', 'button', 'body', 'Stop promotions'));
select count(*) as claimed2 from public.claim_campaign_batch(100, 1) \gset
select public.campaign_tick();
reset role;
select tests.ok((select status = 'opted_out' and source = 'whatsapp_keyword' from public.customer_consent_state
                  where customer_id = :'other_c' and channel = 'whatsapp' and purpose = 'marketing'),
                'replying STOP records an opt-out');
select tests.ok((select count(*) = 1 from public.suppressions where phone = :'other_phone' and reason = 'opt_out'),
                'and suppresses the number');
select tests.ok((select status = 'skipped' and last_error = 'suppressed' from public.campaign_recipients where id = :'other_r'),
                'someone who opted out after launch is skipped, never sent to');
select tests.ok((select status = 'completed' from public.campaigns where id = :'camp'), 'the campaign completes when nothing is left');

-- Receipts and replies
set role service_role;
select public.record_webhook_event('meta', 'wamid.CAMP1:read', 'status', '777000111', '{}') as rd \gset
select public.apply_whatsapp_status(:'rd', '{"wamid":"wamid.CAMP1","status":"read"}');
select public.record_webhook_event('meta', 'wamid.REPLY1', 'message', '777000111', '{}') as rp \gset
select public.ingest_whatsapp_message(:'rp', jsonb_build_object('wamid', 'wamid.REPLY1', 'phone', '+919811000001', 'body', 'Is the offer valid on suits?'));
reset role;
select tests.ok((select status = 'read' and delivered_at is not null and read_at is not null and replied_at is not null
                   from public.campaign_recipients where id = :'sent_r'),
                'read receipts and replies are tracked per recipient');

select set_config('request.jwt.claim.sub', :'mark', false);
set role authenticated;
select tests.ok((select (r ->> 'sent')::int = 1 and (r ->> 'read')::int = 1 and (r ->> 'replied')::int = 1 and (r ->> 'skipped')::int = 1
                   from public.campaign_report(:'camp') r),
                'the report shows sent, read, replied and skipped');
select public.duplicate_campaign(:'camp') as dup \gset
select tests.ok((select status = 'draft' and name = 'Copy of Diwali' from public.campaigns where id = :'dup'), 'campaigns can be duplicated as drafts');

-- Retry, then a permanent failure that suppresses the number.
update public.campaigns set filter = jsonb_build_object('tag_ids', jsonb_build_array(:'vip')), rate_per_minute = 100 where id = :'dup';
select public.launch_campaign(:'dup');
reset role;
set role service_role;
select recipient_id as r2 from public.claim_campaign_batch(10, 5) \gset
select public.record_campaign_send(:'r2', null, null, '{"message":"rate limited","code":"130429"}', true);
reset role;
select tests.ok((select status = 'pending' and next_attempt_at > now() from public.campaign_recipients where id = :'r2'),
                'a temporary error is retried later');
update public.campaign_recipients set next_attempt_at = now() where id = :'r2';
set role service_role;
select recipient_id as r2b from public.claim_campaign_batch(10, 5) \gset
select public.record_campaign_send(:'r2b', null, null, '{"message":"user stopped marketing","code":"131050"}', false);
reset role;
select tests.ok((select status = 'failed' from public.campaign_recipients where id = :'r2'), 'a permanent error fails the recipient');
select tests.ok((select count(*) = 1 from public.suppressions where phone = '+919811000001' and reason = 'blocked_marketing'),
                'a number that blocked marketing is suppressed');

-- Pause, resume, cancel
select set_config('request.jwt.claim.sub', :'mark', false);
set role authenticated;
select public.duplicate_campaign(:'camp') as c3 \gset
select public.launch_campaign(:'c3', now() + interval '1 day');
select tests.ok((select status = 'scheduled' from public.campaigns where id = :'c3'), 'campaigns can be scheduled');
select public.set_campaign_state(:'c3', 'cancel');
select tests.ok((select status = 'cancelled' from public.campaigns where id = :'c3'), 'and cancelled');
select tests.ok((select array_agg(type order by id) = array['started', 'completed'] from public.campaign_events where campaign_id = :'camp'),
                'campaign events are logged');
reset role;

-- ------------------------------------------------------------ 360dialog
select set_config('request.jwt.claim.sub', :'ann', false);
set role authenticated;
select public.connect_whatsapp_account(:'biz', '{"provider":"dialog360","waba_id":"700800900","access_token":"D360-key-0123456789abcdef","webhook_token_hash":"abc123hash"}') as d360 \gset
reset role;
set role service_role;
select tests.ok(public.whatsapp_account_by_webhook_token('abc123hash') = :'d360', '360dialog webhooks find their account by token');
select tests.ok(public.record_webhook_event_for_account('dialog360', 'wamid.D1', 'message', :'d360', '{}') is not null,
                '360dialog events are stored against that account');
reset role;

-- ------------------------------------------------------------ isolation
select set_config('request.jwt.claim.sub', :'oli', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.campaigns), 'other tenant sees no campaigns');
select tests.ok((select count(*) = 0 from public.campaign_recipients), 'other tenant sees no recipients');
select tests.ok((select count(*) = 0 from public.whatsapp_templates), 'other tenant sees no templates');
select tests.ok((select count(*) = 0 from public.suppressions), 'other tenant sees no suppressions');
select tests.fails(format('select public.audience_estimate(%L, %L)', current_setting('t.biz'), '{}'), 'other tenant cannot size an audience');
reset role;

\echo 'templates, consent and campaigns: all checks passed'
