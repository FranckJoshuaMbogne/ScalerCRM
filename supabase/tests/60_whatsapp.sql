-- WhatsApp: connecting numbers, webhook ingestion, conversations, replies, receipts and inbox access.
\set ON_ERROR_STOP on
\set QUIET on
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

\set vic '0d000000-0000-0000-0000-000000000001'
\set wes '0d000000-0000-0000-0000-000000000002'
\set yan '0d000000-0000-0000-0000-000000000003'
\set xan '0d000000-0000-0000-0000-000000000004'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'vic', 'vic@kappa.test', '{"full_name":"Vic Admin"}'),
  (:'wes', 'wes@kappa.test', '{"full_name":"Wes Sales"}'),
  (:'yan', 'yan@kappa.test', '{"full_name":"Yan Sales"}'),
  (:'xan', 'xan@lambda.test', '{"full_name":"Xan Other"}');

select set_config('request.jwt.claim.sub', :'vic', false);
set role authenticated;
select public.create_business('Kappa Couture', 'kappa-couture', 'Main') as biz \gset
reset role;
select set_config('request.jwt.claim.sub', :'xan', false);
set role authenticated;
select public.create_business('Lambda Shoes', 'lambda-shoes', 'Delhi') as other \gset
-- Established businesses (set up by Springs 360, not self-serve trials): no WhatsApp review.
reset role;
update public.businesses set trial_ends_at = null where id in (:'biz', :'other');
set role authenticated;
reset role;
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', u.id, r.id, 'active', now()
  from (values (:'wes'::uuid), (:'yan'::uuid)) u(id)
  join public.roles r on r.key = 'sales_executive' and r.business_id is null;
select set_config('t.biz', :'biz', false), set_config('t.other', :'other', false);

-- ------------------------------------------------------------ connecting a number
select set_config('request.jwt.claim.sub', :'vic', false);
set role authenticated;
select public.connect_whatsapp_account(:'biz', '{"waba_id":"100200300","phone_number_id":"555000111","display_phone":"+91 98490 00000","access_token":"EAAG-test-token-0123456789"}') as acct \gset
select set_config('t.acct', :'acct', false);
select tests.ok((select status = 'connected' from public.whatsapp_accounts where id = :'acct'), 'a number can be connected');
select tests.fails('select token_secret_id from public.whatsapp_accounts', 'members cannot read where the token is kept');
select tests.fails('select * from vault.decrypted_secrets', 'members cannot read Vault');
select tests.ok((select count(*) = 1 from public.audit_logs where entity_type = 'whatsapp_accounts' and entity_id = :'acct'),
                'connecting a number is audited');
insert into public.lead_assignment_settings (business_id, round_robin_enabled, updated_by) values (:'biz', true, :'vic');
insert into public.round_robin_members (business_id, user_id) values (:'biz', :'wes');
reset role;

select set_config('request.jwt.claim.sub', :'wes', false);
set role authenticated;
select tests.fails(format('select public.connect_whatsapp_account(%L, %L)', current_setting('t.biz'),
                          '{"waba_id":"1","phone_number_id":"555000999","access_token":"EAAG-test-token-0123456789"}'),
                   'connecting numbers needs integrations.manage');
reset role;
select set_config('request.jwt.claim.sub', :'xan', false);
set role authenticated;
select tests.fails(format('select public.connect_whatsapp_account(%L, %L)', current_setting('t.other'),
                          '{"waba_id":"100200300","phone_number_id":"555000111","access_token":"EAAG-other-token-0123456789"}'),
                   'a number connected to one business cannot be taken by another');
reset role;

-- ------------------------------------------------------------ webhook ingestion
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.record_webhook_event('meta', 'wamid.A1', 'message', '555000111', '{"x":1}') as e1 \gset
select tests.ok(public.record_webhook_event('meta', 'wamid.A1', 'message', '555000111', '{"x":1}') is null,
                'a repeated webhook is stored once');
select public.record_webhook_event('meta', 'wamid.Z9', 'message', '999999999', '{"x":1}') as e_unknown \gset
select public.ingest_whatsapp_message(:'e1', jsonb_build_object('wamid', 'wamid.A1', 'phone', '+919900112233',
  'profile_name', 'Meera WA', 'type', 'text', 'body', 'Hi, do you stitch lehengas?', 'sent_at', now() - interval '5 minutes')) as r1 \gset
select public.record_webhook_event('meta', 'wamid.A2', 'message', '555000111', '{"x":2}') as e2 \gset
select public.ingest_whatsapp_message(:'e2', jsonb_build_object('wamid', 'wamid.A2', 'phone', '+919900112233',
  'profile_name', 'Meera WA', 'type', 'image', 'media', '{"id":"m1","mime_type":"image/jpeg"}'::jsonb, 'sent_at', now() - interval '4 minutes')) as r2 \gset
select public.record_webhook_event('meta', 'wamid.A1-again', 'message', '555000111', '{"x":3}') as e3 \gset
select public.ingest_whatsapp_message(:'e3', jsonb_build_object('wamid', 'wamid.A1', 'phone', '+919900112233', 'body', 'dup')) as r3 \gset
reset role;

select set_config('t.conv', :'r1'::jsonb ->> 'conversation_id', false);
select tests.ok((select status = 'ignored' from private.webhook_events where id = :'e_unknown'),
                'events for numbers nobody connected are kept but not processed');
select tests.ok((select status = 'processed' from private.webhook_events where id = :'e1'), 'processed events are marked');
select tests.ok((:'r1'::jsonb ->> 'lead_created')::boolean and not (:'r2'::jsonb ->> 'lead_created')::boolean
                and (:'r1'::jsonb ->> 'conversation_id') = (:'r2'::jsonb ->> 'conversation_id'),
                'the first message opens a lead; the next ones join the same conversation');
select tests.ok((:'r3'::jsonb ->> 'duplicate')::boolean, 'a message id seen before is not stored twice');
select tests.ok((select count(*) = 2 from public.messages where conversation_id = current_setting('t.conv')::uuid),
                'two messages in the conversation');
select tests.ok((select s.key = 'whatsapp' and l.owner_id = :'wes'
                   from public.leads l join public.lead_sources s on s.id = l.first_source_id
                  where l.id = (:'r1'::jsonb ->> 'lead_id')::uuid),
                'the lead has source WhatsApp and was handed out by round-robin');
select tests.ok((select c.full_name = 'Meera WA' and c.primary_phone = '+919900112233'
                   from public.customers c where c.id = (:'r1'::jsonb ->> 'customer_id')::uuid),
                'the customer file uses the WhatsApp profile name and number');
select tests.ok((select unread_count = 2 and awaiting_since is not null and assignee_id = :'wes'
                   from public.conversations where id = current_setting('t.conv')::uuid),
                'the conversation is unread, waiting, and assigned to the lead owner');

-- ------------------------------------------------------------ inbox access and replies
select set_config('request.jwt.claim.sub', :'wes', false);
set role authenticated;
select tests.ok((select count(*) = 1 from public.notifications where type = 'whatsapp_message'),
                'the assignee is told once per unanswered burst');
select tests.ok((select count(*) = 1 from public.conversations), 'the assignee sees their conversation');
select public.queue_whatsapp_reply(current_setting('t.conv')::uuid, 'Yes! When can you visit?') as m1 \gset
select tests.ok((select status = 'queued' and response_seconds >= 290 from public.messages where id = :'m1'),
                'a reply is queued with its response time');
select tests.ok((select awaiting_since is null and unread_count = 0 from public.conversations where id = current_setting('t.conv')::uuid),
                'replying clears the waiting state');
insert into public.messages (business_id, conversation_id, direction, type, body, status, sent_by)
values (current_setting('t.biz')::uuid, current_setting('t.conv')::uuid, 'note', 'note', 'Asked for lehenga photos', 'note', :'wes');
select tests.fails(format('insert into public.messages (business_id, conversation_id, direction, body, status, sent_by) values (%L, %L, %L, %L, %L, %L)',
                          current_setting('t.biz'), current_setting('t.conv'), 'outbound', 'sneaky', 'sent', :'wes'),
                   'outbound messages only go through the reply function');
select tests.fails(format('update public.conversations set assignee_id = %L where id = %L', :'vic', current_setting('t.conv')),
                   'a sales executive cannot hand a conversation to someone else');
select tests.fails(format('update public.messages set body = %L', 'x'), 'messages cannot be edited');
reset role;

select set_config('request.jwt.claim.sub', :'yan', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.conversations), 'other sales executives do not see it');
select tests.fails(format('select public.queue_whatsapp_reply(%L, %L)', current_setting('t.conv'), 'hi'),
                   'and cannot reply to it');
reset role;

-- Sending and delivery receipts
set role service_role;
select tests.ok((public.whatsapp_send_context(:'m1') ->> 'token') = 'EAAG-test-token-0123456789'
                and (public.whatsapp_send_context(:'m1') ->> 'to') = '+919900112233',
                'the sender gets the token and recipient');
select public.record_whatsapp_send(:'m1', 'wamid.OUT1');
select public.record_webhook_event('meta', 'wamid.OUT1:delivered', 'status', '555000111', '{}') as s1 \gset
select public.apply_whatsapp_status(:'s1', '{"wamid":"wamid.OUT1","status":"delivered"}');
select public.record_webhook_event('meta', 'wamid.OUT1:sent', 'status', '555000111', '{}') as s2 \gset
select public.apply_whatsapp_status(:'s2', '{"wamid":"wamid.OUT1","status":"sent"}');
reset role;
select tests.ok((select status = 'delivered' and wamid = 'wamid.OUT1' from public.messages where id = :'m1'),
                'delivery status only moves forward, even when receipts arrive out of order');
set role service_role;
select public.record_webhook_event('meta', 'wamid.OUT1:read', 'status', '555000111', '{}') as s3 \gset
select public.apply_whatsapp_status(:'s3', '{"wamid":"wamid.OUT1","status":"read"}');
reset role;
select tests.ok((select status = 'read' from public.messages where id = :'m1'), 'read receipts land');

-- 24-hour window
update public.conversations set last_inbound_at = now() - interval '25 hours' where id = current_setting('t.conv')::uuid;
select set_config('request.jwt.claim.sub', :'wes', false);
set role authenticated;
select tests.fails(format('select public.queue_whatsapp_reply(%L, %L)', current_setting('t.conv'), 'Still there?'),
                   'free-form replies are refused outside the 24-hour window');
reset role;
update public.conversations set last_inbound_at = now() where id = current_setting('t.conv')::uuid;

-- Assignment by a manager, then disconnect.
select set_config('request.jwt.claim.sub', :'vic', false);
set role authenticated;
update public.conversations set assignee_id = :'yan' where id = current_setting('t.conv')::uuid;
select tests.ok((select assignee_id = :'yan' from public.conversations where id = current_setting('t.conv')::uuid),
                'an admin can reassign a conversation');
select tests.ok((select count(*) = 1 from public.whatsapp_health(current_setting('t.biz')::uuid) where events_24h >= 6),
                'webhook health is reported per number');
select public.disconnect_whatsapp_account(current_setting('t.acct')::uuid);
select tests.fails(format('select public.queue_whatsapp_reply(%L, %L)', current_setting('t.conv'), 'hello'),
                   'a disconnected number cannot send');
reset role;
select tests.ok((select s.secret = 'revoked' from vault.secrets s join public.whatsapp_accounts a on a.token_secret_id = s.id
                  where a.id = current_setting('t.acct')::uuid),
                'disconnecting wipes the stored token');
select set_config('request.jwt.claim.sub', :'yan', false);
set role authenticated;
select tests.ok((select count(*) = 1 from public.notifications where type = 'conversation_assigned'),
                'the new assignee is notified');
reset role;

select set_config('request.jwt.claim.sub', :'xan', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.conversations), 'other tenant sees no conversations');
select tests.ok((select count(*) = 0 from public.messages), 'other tenant sees no messages');
select tests.ok((select count(*) = 0 from public.whatsapp_accounts), 'other tenant sees no numbers');
reset role;

\echo 'whatsapp: all checks passed'
