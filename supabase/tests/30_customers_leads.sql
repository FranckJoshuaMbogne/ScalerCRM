-- Customers (CIF), matching, leads, history, merge and the public lead API.
-- Uses its own users and businesses (runs after 20_invitations in the same database).
\set ON_ERROR_STOP on
\set QUIET on

\set hana  '77777777-7777-7777-7777-777777777777'
\set ivan  '88888888-8888-8888-8888-888888888888'
\set jo    '99999999-9999-9999-9999-999999999999'
\set kim   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'hana', 'hana@delta.test',   '{"full_name":"Hana Admin"}'),
  (:'ivan', 'ivan@delta.test',   '{"full_name":"Ivan Sales"}'),
  (:'jo',   'jo@epsilon.test',   '{"full_name":"Jo Other"}'),
  (:'kim',  'kim@delta.test',    '{"full_name":"Kim Branch"}');

-- Delta (Hana) with two branches; Epsilon (Jo) is a separate tenant.
select set_config('request.jwt.claim.sub', :'hana', false);
set role authenticated;
select public.create_business('Delta Tailors', 'delta-tailors', 'Hyderabad') as biz \gset
select id as hyd from public.branches where business_id = :'biz' \gset
insert into public.branches (business_id, name) values (:'biz', 'Pune') returning id as pune \gset
reset role;

select set_config('request.jwt.claim.sub', :'jo', false);
set role authenticated;
select public.create_business('Epsilon Cars', 'epsilon-cars', 'Chennai') as other \gset
reset role;

-- Ivan: sales executive (assigned only). Kim: store manager restricted to Pune.
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', :'ivan', id, 'active', now() from public.roles where key = 'sales_executive' and business_id is null;
insert into public.business_memberships (business_id, user_id, role_id, all_branches, status, joined_at)
select :'biz', :'kim', id, false, 'active', now() from public.roles where key = 'store_manager' and business_id is null
returning id as kim_m \gset
insert into public.user_branch_access (membership_id, branch_id) values (:'kim_m', :'pune');

select set_config('t.biz', :'biz', false), set_config('t.other', :'other', false),
       set_config('t.hyd', :'hyd', false), set_config('t.pune', :'pune', false);

-- ------------------------------------------------------------ defaults
select set_config('request.jwt.claim.sub', :'hana', false);
set role authenticated;

select tests.ok((select count(*) = 12 from public.lead_statuses where business_id = :'biz'),
                'new business gets the 12-stage default pipeline');
select tests.ok((select count(*) = 1 from public.lead_statuses where business_id = :'biz' and is_default),
                'exactly one default status');
select tests.ok((select count(*) >= 5 from public.lead_sources where business_id = :'biz'),
                'new business gets default lead sources');
select tests.ok((select count(*) = 0 from public.lead_statuses where business_id = :'other'),
                'cannot see another business''s pipeline');

-- ------------------------------------------------------------ matching
select public.create_lead(:'biz', jsonb_build_object(
  'phone', '+919849012345', 'full_name', 'Ravi Kumar', 'source', 'walk_in',
  'branch_id', :'hyd', 'title', 'Wedding sherwani', 'expected_value', '45000.50')) as r1 \gset
select set_config('t.r1', :'r1', false);
select tests.ok((select (current_setting('t.r1')::jsonb ->> 'cif_number') = 'CIF-000001'),
                'first customer gets CIF-000001');
select tests.ok((select (current_setting('t.r1')::jsonb ->> 'lead_number') = 'L-000001'),
                'first lead gets L-000001');
select tests.ok((select (current_setting('t.r1')::jsonb ->> 'customer_created')::boolean),
                'new phone creates a customer file');

select public.create_lead(:'biz', jsonb_build_object(
  'phone', '+919849012345', 'full_name', 'R. Kumar', 'email', 'Ravi@Example.com', 'source', 'whatsapp')) as r2 \gset
select set_config('t.r2', :'r2', false);
select tests.ok((select (current_setting('t.r2')::jsonb ->> 'customer_id') = (current_setting('t.r1')::jsonb ->> 'customer_id')),
                'repeated phone number links to the same CIF');
select tests.ok((select (current_setting('t.r2')::jsonb ->> 'matched_on') = 'phone' and
                        (current_setting('t.r2')::jsonb ->> 'lead_number') = 'L-000002'),
                'second enquiry is a new lead on the same customer');
select tests.ok((select full_name = 'Ravi Kumar' and primary_email = 'ravi@example.com'
                   from public.customers where id = (current_setting('t.r1')::jsonb ->> 'customer_id')::uuid),
                'matching never renames the customer and fills in the missing email');

select public.create_lead(:'biz', jsonb_build_object(
  'email', 'ravi@example.com', 'phone', '+919900011122', 'full_name', 'Ravi')) as r3 \gset
select set_config('t.r3', :'r3', false);
select tests.ok((select (current_setting('t.r3')::jsonb ->> 'matched_on') = 'email'
                    and (current_setting('t.r3')::jsonb ->> 'customer_id') = (current_setting('t.r1')::jsonb ->> 'customer_id')),
                'email matches when the phone is new');
select tests.ok((select count(*) = 2 from public.customer_contacts
                  where customer_id = (current_setting('t.r1')::jsonb ->> 'customer_id')::uuid and kind = 'phone'),
                'new phone is added to the matched customer');

select public.create_lead(:'biz', jsonb_build_object('phone', '+919811122233', 'full_name', 'Ravi Kumar')) as r4 \gset
select set_config('t.r4', :'r4', false);
select tests.ok((select (current_setting('t.r4')::jsonb ->> 'cif_number') = 'CIF-000002'),
                'same name with a different phone is a different customer (never match on name)');

select tests.fails(format('select public.create_lead(%L, %L)', :'biz', '{"phone":"98490 12345"}'),
                   'non-E.164 phone is rejected by the database');
select tests.fails(format('select public.create_lead(%L, %L)', :'biz', '{"full_name":"No Contact"}'),
                   'a lead needs a phone or email');
select tests.fails(format('select public.create_lead(%L, %L)', :'other', '{"phone":"+919800000001"}'),
                   'cannot create leads in another business');
select tests.fails(
  format('insert into public.customers (business_id, cif_number, full_name) values (%L, %L, %L)', :'biz', 'CIF-999999', 'Direct'),
  'customers are only created through matching');
select tests.fails(
  format('insert into public.customer_contacts (business_id, customer_id, kind, value) values (%L, %L, %L, %L)',
         :'biz', current_setting('t.r4')::jsonb ->> 'customer_id', 'phone', '+919849012345'),
  'a phone number cannot belong to two customer files');

-- ------------------------------------------------------------ history
select (current_setting('t.r1')::jsonb ->> 'lead_id') as lead1 \gset
select id as contacted from public.lead_statuses where business_id = :'biz' and key = 'contacted' \gset
update public.leads set status_id = :'contacted' where id = :'lead1';
update public.leads set title = 'Wedding sherwani and kurta' where id = :'lead1';
select tests.ok((select count(*) = 2 from public.lead_status_history where lead_id = :'lead1'),
                'status changes are recorded in status history');
select tests.ok((select array_agg(type order by id) = array['created', 'status_changed', 'updated']
                   from public.lead_activities where lead_id = :'lead1'),
                'creation, status change and edits appear on the timeline');
select tests.ok((select expected_value = 45000.50 from public.leads where id = :'lead1'),
                'expected value is stored as exact decimal');
insert into public.lead_activities (business_id, lead_id, type, body, actor_id)
values (:'biz', :'lead1', 'note', 'Prefers ivory silk', :'hana');
select tests.fails(format($s$insert into public.lead_activities (business_id, lead_id, type, actor_id)
                             values (%L, %L, 'status_changed', %L)$s$, :'biz', :'lead1', :'hana'),
                   'system activity types cannot be forged');
select tests.fails(format('update public.lead_activities set body = %L where lead_id = %L', 'edited', :'lead1'),
                          'activities cannot be edited');
select tests.fails(format('delete from public.lead_status_history where lead_id = %L', :'lead1'),
                          'status history cannot be deleted');
select tests.fails(format('delete from public.leads where id = %L', :'lead1'), 'leads cannot be deleted, only archived');

update public.customers set full_name = 'Ravi Kumar Rao' where id = (current_setting('t.r1')::jsonb ->> 'customer_id')::uuid;
select tests.ok((select count(*) = 1 from public.customer_events
                  where customer_id = (current_setting('t.r1')::jsonb ->> 'customer_id')::uuid and type = 'updated'
                    and changes ? 'full_name'),
                'customer edits are recorded with a from/to diff');
select tests.fails(
  format('update public.customers set cif_number = %L where id = %L', 'CIF-000777', current_setting('t.r1')::jsonb ->> 'customer_id'),
  'CIF number cannot be changed');

-- Consent is append-only
insert into public.customer_consents (business_id, customer_id, channel, status, captured_by)
values (:'biz', (current_setting('t.r1')::jsonb ->> 'customer_id')::uuid, 'whatsapp', 'opted_in', :'hana');
insert into public.customer_consents (business_id, customer_id, channel, status, captured_by, captured_at)
values (:'biz', (current_setting('t.r1')::jsonb ->> 'customer_id')::uuid, 'whatsapp', 'opted_out', :'hana', now() + interval '1 second');
select tests.ok((select status = 'opted_out' from public.customer_consent_state
                  where customer_id = (current_setting('t.r1')::jsonb ->> 'customer_id')::uuid and channel = 'whatsapp'),
                'latest consent entry wins');
select tests.fails(format('update public.customer_consents set status = %L', 'opted_in'),
                          'consent history cannot be rewritten');
reset role;

-- ------------------------------------------------------------ Ivan (assigned only)
select set_config('request.jwt.claim.sub', :'ivan', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.leads), 'sales executive sees no unassigned leads');
select tests.ok((select count(*) = 0 from public.customers), 'sales executive sees no unrelated customers');
select public.create_lead(current_setting('t.biz')::uuid, '{"phone":"+919822233344","full_name":"Meera"}') as r5 \gset
select set_config('t.r5', :'r5', false);
select tests.ok((select owner_id = :'ivan' from public.leads where id = (current_setting('t.r5')::jsonb ->> 'lead_id')::uuid),
                'a lead created by an assigned-only user is owned by them');
select tests.ok((select count(*) = 1 from public.customers), 'and they can see its customer');
select tests.fails(
  format('select public.create_lead(%L, %L)', current_setting('t.biz'),
         jsonb_build_object('phone', '+919822233355', 'owner_id', :'hana')),
  'cannot assign to someone else without leads.assign');
select tests.fails(format('update public.leads set archived_at = now() where id = %L', current_setting('t.r5')::jsonb ->> 'lead_id'),
                   'cannot archive without leads.delete');
select tests.fails(format('update public.leads set owner_id = null where id = %L', current_setting('t.r5')::jsonb ->> 'lead_id'),
                   'cannot unassign without leads.assign');
select tests.fails(format('select public.merge_customers(%L, %L)',
                          current_setting('t.r1')::jsonb ->> 'customer_id', current_setting('t.r4')::jsonb ->> 'customer_id'),
                   'cannot merge without customers.merge');
reset role;

-- ------------------------------------------------------------ Kim (Pune only)
select set_config('request.jwt.claim.sub', :'hana', false);
set role authenticated;
select public.create_lead(:'biz', jsonb_build_object('phone', '+919833344455', 'full_name', 'Pune Lead', 'branch_id', :'pune')) as r6 \gset
reset role;
select set_config('request.jwt.claim.sub', :'kim', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.leads where branch_id = current_setting('t.hyd')::uuid),
                'branch-restricted member cannot see other branches'' leads');
select tests.ok((select count(*) = 1 from public.leads where branch_id = current_setting('t.pune')::uuid),
                'branch-restricted member sees their branch''s leads');
select tests.fails(format('select public.create_lead(%L, %L)', current_setting('t.biz'),
                          jsonb_build_object('phone', '+919833344466', 'branch_id', current_setting('t.hyd'))),
                   'cannot create a lead in a branch you cannot access');
reset role;

-- ------------------------------------------------------------ Jo (other tenant)
select set_config('request.jwt.claim.sub', :'jo', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.leads), 'other tenant sees no leads');
select tests.ok((select count(*) = 0 from public.customers), 'other tenant sees no customers');
select tests.ok((select count(*) = 0 from public.customer_contacts), 'other tenant sees no contacts');
select tests.ok((select count(*) = 0 from public.lead_activities), 'other tenant sees no activity');
select tests.affects_none(format('update public.leads set title = %L', 'x'), 'other tenant cannot edit leads');
select public.create_lead(current_setting('t.other')::uuid, '{"phone":"+919849012345","full_name":"Same phone elsewhere"}') as r7 \gset
select tests.ok((select (:'r7'::jsonb ->> 'cif_number') = 'CIF-000001' and (:'r7'::jsonb ->> 'customer_created')::boolean),
                'the same phone in another business is a separate customer with its own numbering');
reset role;

-- ------------------------------------------------------------ merge
select set_config('request.jwt.claim.sub', :'hana', false);
set role authenticated;
select (current_setting('t.r1')::jsonb ->> 'customer_id') as keep, (current_setting('t.r4')::jsonb ->> 'customer_id') as dup \gset
select public.merge_customers(:'keep', :'dup');
select tests.ok((select merged_into_id = :'keep' from public.customers where id = :'dup'), 'duplicate points at the survivor');
select tests.ok((select count(*) = 0 from public.leads where customer_id = :'dup'), 'leads move to the survivor');
select tests.ok((select count(*) = 3 from public.customer_contacts where customer_id = :'keep' and kind = 'phone'),
                'contacts move to the survivor');
select tests.ok((select count(*) = 1 from public.customer_merges where merged_id = :'dup' and snapshot ? 'customer'),
                'merge keeps a snapshot of the folded file');
select tests.ok((select count(*) = 1 from public.lead_activities a join public.leads l on l.id = a.lead_id
                  where l.id = (current_setting('t.r4')::jsonb ->> 'lead_id')::uuid and a.type = 'customer_merged'),
                'moved leads record the merge on their timeline');
select tests.fails(format('select public.merge_customers(%L, %L)', :'keep', :'dup'), 'a merged file cannot be merged again');
select public.create_lead(:'biz', '{"phone":"+919811122233"}') as r8 \gset
select tests.ok((select (:'r8'::jsonb ->> 'customer_id') = :'keep'), 'the merged file''s phone now matches the survivor');
select tests.fails(format('select public.merge_customers(%L, %L)', :'keep', :'r7'::jsonb ->> 'customer_id'),
                   'cannot merge across businesses');

-- ------------------------------------------------------------ custom fields
insert into public.custom_field_definitions (business_id, entity, key, label, field_type, options)
values (:'biz', 'lead', 'garment', 'Garment', 'select', '["Suit","Sherwani"]');
select public.create_lead(:'biz', jsonb_build_object('phone', '+919844455566',
  'custom_fields', jsonb_build_object('garment', 'Suit', 'unknown_field', 'x'))) as r9 \gset
select tests.ok((select custom_fields = '{"garment":"Suit"}'::jsonb from public.leads
                  where id = (:'r9'::jsonb ->> 'lead_id')::uuid),
                'only defined custom fields are stored');

-- ------------------------------------------------------------ public API
select public.create_api_key(:'biz', 'Website') as api_key \gset
select set_config('t.key', :'api_key', false);
select tests.fails('select key_hash from public.api_keys', 'API key hash is not readable');
select tests.ok((select count(*) = 1 from public.audit_logs where entity_type = 'api_keys' and not (changes ? 'key_hash')),
                'API key creation is audited without the hash');
reset role;

set role anon;
select tests.fails(format('select public.create_api_key(%L, %L)', :'biz', 'x'), 'anonymous cannot create API keys');
select tests.fails('select * from public.customers', 'anon cannot read customers');
select tests.fails('select * from public.leads', 'anon cannot read leads');
select tests.ok((select business_id = current_setting('t.biz')::uuid from public.api_key_business(current_setting('t.key'))),
                'API key resolves to its business');
select tests.fails(format('select public.api_submit_lead(%L, null, %L, %L)', 'sk_live_wrong', 'h', '{"phone":"+919855566677"}'),
                   'invalid API key is rejected');

select public.api_submit_lead(current_setting('t.key'), 'form-1', 'hash-a',
  '{"phone":"+919855566677","full_name":"Web Visitor","touch":{"utm_source":"google","utm_campaign":"diwali","gclid":"abc"},"owner_id":"11111111-1111-1111-1111-111111111111"}') as a1 \gset
select set_config('t.a1', :'a1', false);
select tests.ok((select (current_setting('t.a1')::jsonb ->> 'lead_created')::boolean
                    and not (current_setting('t.a1')::jsonb ->> 'replayed')::boolean),
                'API creates a lead');
select public.api_submit_lead(current_setting('t.key'), 'form-1', 'hash-a', '{"phone":"+919855566677"}') as a2 \gset
select tests.ok((select (:'a2'::jsonb ->> 'lead_id') = (current_setting('t.a1')::jsonb ->> 'lead_id')
                    and (:'a2'::jsonb ->> 'replayed')::boolean),
                'same idempotency key replays the first response');
select tests.fails(format('select public.api_submit_lead(%L, %L, %L, %L)', current_setting('t.key'), 'form-1', 'hash-b', '{"phone":"+919855566677"}'),
                   'idempotency key reused with a different body is rejected');
select public.api_submit_lead(current_setting('t.key'), 'form-2', 'hash-c',
  '{"phone":"+919855566677","source":"meta_ads","campaign":"spring"}') as a3 \gset
select tests.ok((select (:'a3'::jsonb ->> 'lead_id') = (current_setting('t.a1')::jsonb ->> 'lead_id')
                    and not (:'a3'::jsonb ->> 'lead_created')::boolean),
                'repeat API enquiry from a customer with an open lead is added to that lead');
reset role;

select tests.ok((select s.key = 'website' and l.owner_id is null and l.first_campaign = 'diwali'
                        and l.first_touch ->> 'gclid' = 'abc' and l.latest_campaign = 'spring'
                   from public.leads l join public.lead_sources s on s.id = l.first_source_id
                  where l.id = (current_setting('t.a1')::jsonb ->> 'lead_id')::uuid),
                'API lead keeps first and latest source and campaign, and ignores owner');
select tests.ok((select count(*) = 1 from public.lead_activities
                  where lead_id = (current_setting('t.a1')::jsonb ->> 'lead_id')::uuid and type = 'enquiry'),
                'repeat enquiry is on the lead timeline');

select set_config('request.jwt.claim.sub', :'hana', false);
set role authenticated;
update public.api_keys set revoked_at = now() where business_id = current_setting('t.biz')::uuid;
reset role;
set role anon;
select tests.fails(format('select public.api_submit_lead(%L, null, %L, %L)', current_setting('t.key'), 'h', '{"phone":"+919855566688"}'),
                   'revoked API key is rejected');
reset role;

-- ------------------------------------------------------------ storage path helpers
select tests.ok(private.path_uuid('not/a-uuid/file.pdf', 2) is null, 'non-uuid storage paths parse to null, never raise');
select tests.ok(private.customer_file_path_ok(format('%s/%s/x.pdf', :'biz', :'keep')), 'attachment path for own customer is accepted');
select tests.ok(not private.customer_file_path_ok(format('%s/%s/x.pdf', :'other', :'keep')), 'attachment path under another business is rejected');

\echo 'customers and leads: all checks passed'
