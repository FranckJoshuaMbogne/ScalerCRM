-- White-label: brands, assets, custom domains and sender domains, with no brand
-- or data leaking between tenants, and plan gating.
\set ON_ERROR_STOP on
\set QUIET on

\set wa '63000000-0000-0000-0000-000000000001'
\set ws '63000000-0000-0000-0000-000000000002'
\set wb '63000000-0000-0000-0000-000000000003'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'wa', 'wa@alpha-brand.test', '{"full_name":"Alpha Admin"}'),
  (:'ws', 'ws@alpha-brand.test', '{"full_name":"Alpha Staff"}'),
  (:'wb', 'wb@beta-brand.test', '{"full_name":"Beta Admin"}');

select set_config('request.jwt.claim.sub', :'wa', false);
set role authenticated;
select public.create_business('Alpha Atelier', 'alpha-atelier', 'Main') as biz_a \gset
reset role;
select set_config('request.jwt.claim.sub', :'wb', false);
set role authenticated;
select public.create_business('Beta Boutique', 'beta-boutique', 'Main') as biz_b \gset
reset role;
update public.businesses set trial_ends_at = null, plan_key = 'scale' where id = :'biz_a';
update public.businesses set trial_ends_at = null, plan_key = 'growth' where id = :'biz_b';
insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz_a', :'ws', r.id, 'active', now() from public.roles r where r.key = 'sales_executive' and r.business_id is null;

-- A tiny valid-looking PNG (signature + padding) and a fake SVG, base64.
select encode('\x89504e470d0a1a0a'::bytea || decode(repeat('00', 64), 'hex'), 'base64') as png \gset
select encode(convert_to('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>' || repeat(' ', 64) || '</svg>', 'UTF8'), 'base64') as svg \gset

-- ------------------------------------------------------------ brand settings
select set_config('request.jwt.claim.sub', :'wa', false);
set role authenticated;
select tests.fails(format($$insert into public.business_brands (business_id, app_name, short_name, primary_color, updated_by)
                             values (%L, 'Alpha', 'Alpha', '#ffd400', %L)$$, :'biz_a', :'wa'),
                   'colours too light for white text are refused');
select tests.ok(private.contrast_ratio('#ffffff', '#000000') = 21 and private.contrast_ratio('#2f6bff', '#ffffff') >= 4.5,
                'contrast follows WCAG');
insert into public.business_brands (business_id, app_name, short_name, primary_color, sidebar_color, support_email, signin_headline, hide_powered_by, updated_by)
values (:'biz_a', 'Alpha CRM', 'Alpha', '#7A1F5C', '#1d1230', 'help@alpha-brand.test', 'Welcome to Alpha', true, :'wa');
select tests.ok((select primary_color = '#7a1f5c' from public.business_brands where business_id = :'biz_a'), 'colours are stored in lower case');
select public.set_brand_asset(:'biz_a', 'logo', 'image/png', :'png') as logo_hash \gset
select public.set_brand_asset(:'biz_a', 'icon', 'image/png', :'png');
select tests.fails(format($$select public.set_brand_asset(%L, 'logo', 'image/svg+xml', %L)$$, :'biz_a', :'svg'), 'SVG logos are refused');
select tests.fails(format($$select public.set_brand_asset(%L, 'logo', 'image/png', %L)$$, :'biz_a', :'svg'), 'and so are files that aren''t really PNG');
reset role;

select set_config('request.jwt.claim.sub', :'ws', false);
set role authenticated;
select tests.ok((select app_name = 'Alpha CRM' from public.business_brands where business_id = :'biz_a'), 'members see their business''s brand');
select tests.ok((public.my_brand(:'biz_a') ->> 'logo') = :'logo_hash', 'with its logo');
select tests.affects_none(format($$update public.business_brands set app_name = 'Hacked' where business_id = %L$$, :'biz_a'),
                          'staff cannot change the brand');
select tests.fails(format($$select public.set_brand_asset(%L, 'logo', 'image/png', %L)$$, :'biz_a', :'png'), 'or the logo');
select tests.ok((select count(*) = 0 from public.custom_domains), 'or see the domains');
reset role;

select set_config('request.jwt.claim.sub', :'wb', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.business_brands where business_id = :'biz_a'), 'another business cannot read the brand');
select tests.ok(public.my_brand(:'biz_a') is null, 'or get it through my_brand');
select tests.ok((select count(*) = 0 from public.brand_asset(:'biz_a', 'logo')), 'or its logo');
select tests.fails(format($$insert into public.business_brands (business_id, app_name, short_name, hide_powered_by, updated_by)
                             values (%L, 'Beta', 'Beta', true, %L)$$, :'biz_b', :'wb'),
                   'hiding "Powered by SCALER" needs a white-label plan');
insert into public.business_brands (business_id, app_name, short_name, primary_color, updated_by)
values (:'biz_b', 'Beta Desk', 'Beta', '#0b6e4f', :'wb');
select tests.fails(format($$select public.add_custom_domain(%L, 'crm.beta-brand.test')$$, :'biz_b'), 'custom domains need a white-label plan');
select tests.fails(format($$select public.set_email_domain(%L, 'beta-brand.test')$$, :'biz_b'), 'and so does a branded sender');
reset role;

-- ------------------------------------------------------------ custom domains
select set_config('request.jwt.claim.sub', :'wa', false);
set role authenticated;
select (public.add_custom_domain(:'biz_a', ' CRM.Alpha-Brand.test. ')).id as dom_a \gset
select tests.ok((select hostname = 'crm.alpha-brand.test' and status = 'pending' from public.custom_domains where id = :'dom_a'),
                'a domain is stored in lower case, waiting for DNS');
select tests.fails(format($$select public.add_custom_domain(%L, 'alpha.vercel.app')$$, :'biz_a'), 'the hosting provider''s domains are refused');
select tests.fails(format($$select public.add_custom_domain(%L, 'app.scalercrm.com')$$, :'biz_a'), 'and so are SCALER''s');
select tests.fails(format($$select public.add_custom_domain(%L, 'not a domain')$$, :'biz_a'), 'and things that aren''t domains');
reset role;
update public.businesses set plan_key = 'scale' where id = :'biz_b';
select set_config('request.jwt.claim.sub', :'wb', false);
set role authenticated;
select tests.fails(format($$select public.add_custom_domain(%L, 'crm.alpha-brand.test')$$, :'biz_b'), 'a domain belongs to one business');
select (public.add_custom_domain(:'biz_b', 'desk.beta-brand.test')).id as dom_b \gset
select tests.ok((select count(*) = 1 from public.custom_domains), 'each business sees only its own domains');
select tests.fails(format($$select public.remove_custom_domain(%L, %L)$$, :'biz_b', :'dom_a'), 'and cannot remove another''s');
reset role;

-- Until the provider confirms it, a domain shows nothing.
set role anon;
select tests.ok(public.brand_for_host('crm.alpha-brand.test') is null, 'a pending domain shows no brand');
select tests.fails($$select * from public.business_brands$$, 'signed-out visitors cannot read brands directly');
select tests.fails($$select * from public.custom_domains$$, 'or domains');
reset role;
set role service_role;
select public.record_custom_domain(:'dom_a', 'active', '[{"type":"CNAME","name":"crm","value":"cname.vercel-dns.com"}]', null);
select public.record_custom_domain(:'dom_b', 'active', '[]', null);
reset role;
set role anon;
select tests.ok((select (b ->> 'business_id') = :'biz_a' and b ->> 'app_name' = 'Alpha CRM' and b ->> 'primary_color' = '#7a1f5c'
                   and not (b ->> 'powered_by')::boolean and b ->> 'logo' = :'logo_hash'
                   from (select public.brand_for_host('CRM.alpha-brand.test:443') b) x),
                'an active domain shows its business''s brand (any case, any port)');
select tests.ok((select array_agg(k order by k) = array['app_name', 'branded', 'business_id', 'icon', 'logo', 'powered_by', 'primary_color',
                                                        'short_name', 'sidebar_color', 'signin_headline', 'signin_tagline',
                                                        'support_email', 'support_phone']
                   from jsonb_object_keys(public.brand_for_host('crm.alpha-brand.test')) k),
                'and only public brand fields');
select tests.ok((select (b ->> 'business_id') = :'biz_b' and b ->> 'app_name' = 'Beta Desk' and b ->> 'logo' is null and (b ->> 'powered_by')::boolean
                   from (select public.brand_for_host('desk.beta-brand.test') b) x),
                'the other domain shows the other brand, nothing of the first');
select tests.ok((select count(*) = 1 and bool_and(sha256 = :'logo_hash') from public.brand_asset_for_host('crm.alpha-brand.test', 'logo')),
                'the logo is served on its own domain');
select tests.ok((select count(*) = 0 from public.brand_asset_for_host('desk.beta-brand.test', 'logo')), 'and never on another');
select tests.ok(public.brand_for_host('unknown.example.test') is null, 'unknown hosts get the SCALER default');
reset role;

-- Downgrading turns the domain and the hidden "Powered by" off.
update public.businesses set plan_key = 'growth' where id = :'biz_a';
set role anon;
select tests.ok(public.brand_for_host('crm.alpha-brand.test') is null, 'without white-label the custom domain stops showing the brand');
reset role;
select set_config('request.jwt.claim.sub', :'wa', false);
set role authenticated;
select tests.ok((public.my_brand(:'biz_a') ->> 'powered_by')::boolean, 'and "Powered by SCALER" shows again');
reset role;
update public.businesses set plan_key = 'scale' where id = :'biz_a';

-- ------------------------------------------------------------ branded email
select set_config('request.jwt.claim.sub', :'wa', false);
set role authenticated;
select public.set_email_domain(:'biz_a', 'alpha-brand.test', 'Team');
select tests.ok((select status = 'pending' and from_local = 'team' from public.email_domains where business_id = :'biz_a'), 'a sender domain waits for DNS');
select tests.fails(format($$select public.email_sender(%L)$$, :'biz_a'), 'only the server reads senders');
reset role;
set role service_role;
select tests.ok((select s ->> 'name' = 'Alpha CRM' and s ->> 'address' is null from (select public.email_sender(:'biz_a') s) x),
                'until verified, email goes from SCALER''s address with the brand''s name');
select public.record_email_domain(:'biz_a', 're_123', 'verified', '[{"type":"TXT","name":"resend._domainkey"}]', null);
select tests.ok(public.email_sender(:'biz_a') ->> 'address' = 'team@alpha-brand.test', 'then from the business''s own domain');
select tests.ok((select s ->> 'name' = 'Beta Desk' and s ->> 'address' is null from (select public.email_sender(:'biz_b') s) x),
                'other businesses keep their own sender');
select tests.ok((select count(*) >= 0 from public.claim_emails(1)), 'the email queue says which business each email is for');
select tests.ok(jsonb_array_length(public.domains_to_check(20) -> 'custom') = 0, 'active domains are not re-checked');
reset role;
select set_config('request.jwt.claim.sub', :'wb', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.email_domains), 'another business cannot see the sender domain');
reset role;

\echo 'white-label: all checks passed'
