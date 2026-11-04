-- Self-serve onboarding: sign-up checks, trials, industry templates, setup progress,
-- the demo business, WhatsApp review and activation tracking.
\set ON_ERROR_STOP on
\set QUIET on

\set ola  '50000000-0000-0000-0000-000000000001'
\set sam  '50000000-0000-0000-0000-000000000002'
\set ops  '50000000-0000-0000-0000-000000000003'
\set dis  '50000000-0000-0000-0000-000000000004'
\set many '50000000-0000-0000-0000-000000000005'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ola', 'ola@sigma.test', '{"full_name":"Ola Owner"}'),
  (:'sam', 'sam@sigma.test', '{"full_name":"Sam Sales"}'),
  (:'ops', 'ops@springs360-onboarding.test', '{"full_name":"Ops"}'),
  (:'dis', 'dis@mailinator.com', '{}'),
  (:'many', 'many@tau.test', '{}');
update public.profiles set is_platform_admin = true where id = :'ops';

-- ------------------------------------------------------------ sign-up checks
set role anon;
select tests.ok(public.signup_check('new@sigma.test', 'client-a') = 'ok', 'a normal email can sign up');
select tests.ok(public.signup_check('x@mailinator.com', 'client-a') = 'disposable', 'disposable email domains are refused');
select tests.ok(public.signup_check('x@eu.mailinator.com', 'client-a') = 'disposable', 'including their subdomains');
select tests.ok(public.signup_check('not-an-email', 'client-a') = 'invalid', 'and malformed addresses');
select public.signup_check('a' || n || '@sigma.test', 'client-b') from generate_series(1, 5) n;
select tests.ok(public.signup_check('six@sigma.test', 'client-b') = 'rate_limited', 'five sign-ups an hour from one client');
select tests.ok(public.signup_check('other@sigma.test', 'client-c') = 'ok', 'other clients are not affected');
reset role;

-- ------------------------------------------------------------ trial on sign-up
select set_config('request.jwt.claim.sub', :'ola', false);
set role authenticated;
select public.create_business('Sigma Salon', 'sigma-salon', 'Banjara Hills') as biz \gset
reset role;
select tests.ok((select plan_key = 'growth' and trial_ends_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 minute'
                   from public.businesses where id = :'biz'),
                'a new business gets a 14-day Growth trial');
select tests.ok((select count(*) = 1 from public.business_plan_history where business_id = :'biz' and reason like 'Signed up%'),
                'recorded in its plan history');
select tests.ok((select count(*) = 1 from public.onboarding_progress where business_id = :'biz' and completed_at is null),
                'and setup starts');

select set_config('request.jwt.claim.sub', :'dis', false);
set role authenticated;
select tests.fails($$select public.create_business('Junk', 'junk-biz', 'Main')$$, 'a disposable email cannot create a business');
reset role;

select set_config('request.jwt.claim.sub', :'many', false);
set role authenticated;
select public.create_business('Tau ' || n, 'tau-' || n, 'Main') from generate_series(1, 3) n;
select tests.fails($$select public.create_business('Tau 4', 'tau-4', 'Main')$$, 'at most three businesses a day per person');
reset role;

insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', :'sam', r.id, 'active', now() from public.roles r where r.key = 'sales_executive' and r.business_id is null;

-- ------------------------------------------------------------ setup progress
select set_config('request.jwt.claim.sub', :'ola', false);
set role authenticated;
select tests.ok((select (s -> 'steps' ->> 'template')::boolean = false and (s -> 'steps' ->> 'branches')::boolean = false
                   from public.onboarding_status(:'biz') s),
                'nothing is set up yet');
insert into public.branches (business_id, name) values (:'biz', 'Jubilee Hills');
select public.onboarding_mark(:'biz', 'app', 'skipped');
select tests.ok((select (s -> 'steps' ->> 'branches')::boolean and (s -> 'skipped' ->> 'app')::boolean
                   from public.onboarding_status(:'biz') s),
                'steps finish from the data (a second branch) or by hand (skipped)');
select tests.fails(format($$select public.onboarding_mark(%L, 'nonsense')$$, :'biz'), 'unknown steps are refused');
reset role;
select set_config('request.jwt.claim.sub', :'sam', false);
set role authenticated;
select tests.fails(format($$select public.onboarding_mark(%L, 'complete')$$, :'biz'), 'staff cannot finish setup for the admin');
select tests.fails(format($$select public.apply_industry_template(%L, 'salon')$$, :'biz'), 'or choose the industry');
select tests.ok((public.onboarding_status(:'biz') -> 'steps') is not null, 'but can see the progress');
reset role;

-- ------------------------------------------------------------ industry templates
select set_config('request.jwt.claim.sub', :'ola', false);
set role authenticated;
select public.apply_industry_template(:'biz', 'salon');
select tests.ok((select name = 'New enquiry' and is_default from public.lead_statuses where business_id = :'biz' and key = 'new'),
                'the salon template renames the pipeline');
select tests.ok((select count(*) = 0 from public.lead_statuses where business_id = :'biz' and is_active and key = 'quotation_sent'),
                'and hides stages the industry does not use');
select tests.ok((select count(*) = 0 from public.measurement_templates where business_id = :'biz' and is_active), 'no measurement templates for salons');
select tests.ok((select count(*) = 3 from public.automations where business_id = :'biz' and is_active), 'its starter automations are on');
select tests.ok((select industry = 'Salon and spa' from public.businesses where id = :'biz'), 'the industry is recorded');
select tests.ok((select template_key = 'salon' from public.onboarding_progress where business_id = :'biz'), 'and the step is done');
select public.apply_industry_template(:'biz', 'clinic');
select tests.ok((select count(*) = 1 from public.lead_statuses where business_id = :'biz' and is_default and key = 'new' and is_active)
                and (select count(*) = 0 from public.lead_statuses where business_id = :'biz' and is_active and key = 'package_offered'),
                'a template can be swapped while the business is empty');
select (public.create_lead(:'biz', '{"phone":"+919822100001","full_name":"First Lead"}') ->> 'lead_id') as lead1 \gset
select tests.fails(format($$select public.apply_industry_template(%L, 'retail')$$, :'biz'), 'but not after the first lead');
reset role;
select tests.ok((select count(*) = 1 from public.audit_logs where business_id = :'biz' and entity_type = 'industry_template' and entity_id = 'clinic'),
                'applying a template is audited');

-- Every template passes the pipeline rules: one active open default, active won and lost stages,
-- colours matching categories, a done and a cancelled order stage, a lead can move to won and lost.
select set_config('request.jwt.claim.sub', :'ops', false);
do $$
declare
  t record;
  v_biz uuid;
  v_lead uuid;
  v_won uuid;
  v_lost uuid;
begin
  for t in select key from public.industry_templates order by position loop
    set local role authenticated;
    v_biz := public.create_business('Template ' || t.key, 'tpl-' || replace(t.key, '_', '-'), 'Main');
    perform public.apply_industry_template(v_biz, t.key);
    perform tests.ok((select count(*) = 1 from public.lead_statuses where business_id = v_biz and is_default and is_active and category = 'open'),
                     t.key || ': one active open default stage');
    perform tests.ok((select bool_and(exists (select 1 from public.lead_statuses s where s.business_id = v_biz and s.is_active and s.category = c))
                        from unnest(array['open', 'won', 'lost']::public.lead_status_category[]) c),
                     t.key || ': open, won and lost stages');
    perform tests.ok((select count(*) = 0 from public.lead_statuses where business_id = v_biz
                        and ((category = 'won') <> (stage = 'won') or (category = 'lost') <> (stage = 'lost'))),
                     t.key || ': stage colours match their type');
    perform tests.ok((select count(distinct category) = 3 from public.order_stages where business_id = v_biz and is_active),
                     t.key || ': open, done and cancelled order stages');
    perform tests.ok((select count(*) >= 5 from public.lead_lost_reasons where business_id = v_biz and is_active)
                     and (select count(*) >= 5 from public.lead_sources where business_id = v_biz and is_active),
                     t.key || ': lost reasons and sources');
    perform tests.ok(exists (select 1 from public.order_stages where business_id = v_biz and key = 'delivered' and is_active)
                     and exists (select 1 from public.lead_statuses where business_id = v_biz and key = 'won' and is_active),
                     t.key || ': keeps the stage keys the starter automations listen for');
    v_lead := (public.create_lead(v_biz, jsonb_build_object('phone', '+91982210' || lpad((ascii(t.key) % 100)::text, 4, '0'),
                                                             'full_name', 'Rules check')) ->> 'lead_id')::uuid;
    select id into v_won from public.lead_statuses where business_id = v_biz and key = 'won';
    select id into v_lost from public.lead_statuses where business_id = v_biz and key = 'lost';
    update public.leads set status_id = v_won where id = v_lead;
    perform tests.ok((select status_id = v_won from public.leads where id = v_lead), t.key || ': a lead can be won');
    perform tests.ok((select count(*) <= 15 from public.automations where business_id = v_biz and is_active),
                     t.key || ': starter automations fit the trial plan');
    reset role;
  end loop;
end $$;
reset role;

-- ------------------------------------------------------------ demo business
select set_config('request.jwt.claim.sub', :'ola', false);
set role authenticated;
select public.create_demo_business('tailoring') as demo \gset
reset role;
select tests.ok((select is_demo and trial_ends_at is null from public.businesses where id = :'demo'), 'the demo is its own business, never billed');
select tests.ok((select count(*) = 12 from public.leads where business_id = :'demo'), 'filled with sample leads');
select tests.ok((select count(distinct status_id) > 3 from public.leads where business_id = :'demo'), 'spread across the pipeline');
select tests.ok((select count(*) = 0 from public.automations where business_id = :'demo' and is_active), 'with automations off');
select tests.ok((select count(*) = 0 from public.leads where business_id = :'biz' and title = 'Sample enquiry'), 'the real business is untouched');
select set_config('request.jwt.claim.sub', :'ola', false);
set role authenticated;
select tests.fails($$select public.create_demo_business()$$, 'one demo per person');
select tests.fails(format($$select public.delete_demo_business(%L)$$, :'biz'), 'a real business cannot be removed this way');
select public.delete_demo_business(:'demo');
reset role;
select tests.ok((select count(*) = 0 from public.businesses where id = :'demo')
                and (select count(*) = 0 from public.leads where business_id = :'demo'),
                'removing the demo removes everything in it');

-- ------------------------------------------------------------ WhatsApp review during a trial
select set_config('request.jwt.claim.sub', :'ola', false);
set role authenticated;
select public.connect_whatsapp_account(:'biz', '{"waba_id":"930000001","phone_number_id":"940000001","access_token":"EAAG-sigma-token-0123456789"}') as acct \gset
reset role;
select tests.ok((select review_status = 'pending' from public.whatsapp_accounts where id = :'acct'), 'a number connected on a trial waits for review');
insert into public.conversations (business_id, account_id, customer_id)
select :'biz', :'acct', customer_id from public.leads where id = :'lead1' returning id as conv \gset
select tests.fails(format($$insert into public.messages (business_id, conversation_id, direction, type, body, status)
                             values (%L, %L, 'outbound', 'template', 'Offer!', 'queued')$$, :'biz', :'conv'),
                   'templates wait for the review');
insert into public.messages (business_id, conversation_id, direction, type, body, status)
values (:'biz', :'conv', 'outbound', 'text', 'Thanks for writing to us', 'queued');
select tests.ok(true, 'replies to customers still go out');
insert into public.whatsapp_templates (business_id, waba_id, name, language, category, components, variable_count, status, created_by)
values (:'biz', '930000001', 'promo', 'en', 'MARKETING', '{"body":{"text":"Hi"}}', 0, 'approved', :'ola') returning id as tpl \gset
insert into public.campaigns (business_id, name, account_id, template_id, created_by)
values (:'biz', 'Blast', :'acct', :'tpl', :'ola') returning id as camp \gset
select tests.fails(format($$insert into public.campaign_recipients (business_id, campaign_id, customer_id, phone, params)
                             select %L, %L, customer_id, '+919822100001', '[]' from public.leads where id = %L$$,
                          :'biz', :'camp', :'lead1'),
                   'and so do campaigns');

select set_config('request.jwt.claim.sub', :'ola', false);
set role authenticated;
select tests.fails('select * from public.platform_whatsapp_reviews()', 'businesses cannot see the review queue');
reset role;
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select tests.ok((select count(*) = 1 from public.platform_whatsapp_reviews() where account_id = :'acct'), 'the number is in the review queue');
select tests.fails(format($$select public.platform_review_whatsapp(%L, false, '')$$, :'acct'), 'a rejection needs a reason');
select public.platform_review_whatsapp(:'acct', true, 'Real salon, checked Instagram');
reset role;
insert into public.messages (business_id, conversation_id, direction, type, body, status)
values (:'biz', :'conv', 'outbound', 'template', 'Offer!', 'queued');
select tests.ok(true, 'once approved, templates go out');
select tests.ok((select count(*) = 1 from public.audit_logs where business_id = :'biz' and entity_type = 'whatsapp_review'), 'the review is audited');

-- Paying approves numbers still waiting.
update public.whatsapp_accounts set review_status = 'pending' where id = :'acct';
insert into public.subscriptions (business_id, status) values (:'biz', 'trialing');
update public.subscriptions set status = 'active' where business_id = :'biz';
select tests.ok((select review_status = 'approved' from public.whatsapp_accounts where id = :'acct'), 'a paying business skips the queue');

-- ------------------------------------------------------------ activation
select set_config('request.jwt.claim.sub', :'ops', false);
set role authenticated;
select tests.ok((select first_lead_at is not null and first_order_at is null and template_key = 'clinic'
                   from public.platform_activation() where business_id = :'biz'),
                'the console shows how far each signup got');
select tests.ok((select count(*) = 0 from public.platform_activation() a join public.businesses b on b.id = a.business_id where b.is_demo),
                'demo businesses are left out');
reset role;
select set_config('request.jwt.claim.sub', :'ola', false);
set role authenticated;
select tests.fails('select * from public.platform_activation()', 'businesses cannot see other signups');
reset role;

\echo 'onboarding: all checks passed'
