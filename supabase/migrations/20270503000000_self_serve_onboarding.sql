-- Sprint 12 — self-serve onboarding: trial on sign-up, industry templates, a resumable
-- setup wizard, a removable demo business, activation tracking and abuse controls.

-- =====================================================================
-- Abuse controls: disposable email domains and sign-up rate limits
-- =====================================================================
create table private.disposable_email_domains (
  domain  text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$')
);
insert into private.disposable_email_domains (domain) values
  ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('sharklasers.com'), ('10minutemail.com'),
  ('10minutemail.net'), ('tempmail.com'), ('temp-mail.org'), ('temp-mail.io'), ('tempmail.dev'), ('throwawaymail.com'),
  ('yopmail.com'), ('yopmail.net'), ('getnada.com'), ('nada.email'), ('dispostable.com'), ('maildrop.cc'),
  ('mintemail.com'), ('trashmail.com'), ('trashmail.de'), ('fakeinbox.com'), ('mailnesia.com'), ('mohmal.com'),
  ('emailondeck.com'), ('spamgourmet.com'), ('mytemp.email'), ('tempail.com'), ('burnermail.io'), ('moakt.com'),
  ('mailcatch.com'), ('inboxkitten.com'), ('tempr.email'), ('discard.email'), ('33mail.com'), ('getairmail.com'),
  ('mail.tm'), ('mailpoof.com'), ('tmpmail.org'), ('tmpmail.net'), ('emailfake.com'), ('crazymailing.com'),
  ('linshiyouxiang.net'), ('spambox.us'), ('mailsac.com'), ('anonaddy.me'), ('harakirimail.com'), ('tempinbox.com')
on conflict do nothing;

create or replace function private.is_disposable_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.disposable_email_domains d
     where lower(split_part(p_email, '@', 2)) = d.domain
        or lower(split_part(p_email, '@', 2)) like '%.' || d.domain);
$$;

-- Called by the sign-up form before creating the account (no session yet).
-- p_client is a hash of the client's IP address, never the address itself.
create or replace function public.signup_check(p_email text, p_client text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return 'invalid';
  end if;
  if private.is_disposable_email(p_email) then
    return 'disposable';
  end if;
  if not private.hit_rate_limit('signup:client:' || left(coalesce(p_client, 'unknown'), 64), 5, 3600)
     or not private.hit_rate_limit('signup:all', 300, 3600) then
    return 'rate_limited';
  end if;
  return 'ok';
end;
$$;

-- =====================================================================
-- Businesses: demo flag; new businesses start a 14-day Growth trial
-- =====================================================================
alter table public.businesses add column is_demo boolean not null default false;

create table public.onboarding_progress (
  business_id    uuid primary key references public.businesses(id) on delete cascade,
  template_key   text,
  -- Steps the person finished or skipped by hand: {"profile": "2027-05-03T…", "app": "…"}
  steps          jsonb not null default '{}' check (jsonb_typeof(steps) = 'object'),
  completed_at   timestamptz,
  dismissed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger onboarding_progress_updated_at before update on public.onboarding_progress
  for each row execute function private.set_updated_at();
alter table public.onboarding_progress enable row level security;
create policy onboarding_progress_select on public.onboarding_progress for select to authenticated
  using (business_id = any ((select private.my_business_ids())::uuid[]) or private.is_platform_admin());
revoke all on public.onboarding_progress from anon, authenticated;
grant select on public.onboarding_progress to authenticated;

create or replace function public.create_business(
  p_name text,
  p_slug text,
  p_branch_name text,
  p_country_code char(2) default 'IN',
  p_currency char(3) default 'INR',
  p_timezone text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_business uuid;
  v_branch uuid;
  v_admin_role uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select email into v_email from public.profiles where id = v_user;
  if not private.is_platform_admin() then
    if private.is_disposable_email(v_email) then
      raise exception 'disposable email addresses cannot create a business' using errcode = '22023';
    end if;
    if not private.hit_rate_limit('create_business:' || v_user, 3, 86400) then
      raise exception 'too many businesses created today' using errcode = 'P0429';
    end if;
  end if;

  insert into public.businesses (name, slug, country_code, currency, timezone, created_by, plan_key, trial_ends_at)
  values (p_name, p_slug, p_country_code, p_currency, p_timezone, v_user, 'growth', now() + interval '14 days')
  returning id into v_business;

  insert into public.branches (business_id, name, country_code, timezone)
  values (v_business, p_branch_name, p_country_code, p_timezone)
  returning id into v_branch;

  select id into v_admin_role from public.roles where business_id is null and key = 'business_admin';
  insert into public.business_memberships (business_id, user_id, role_id, default_branch_id, status, joined_at)
  values (v_business, v_user, v_admin_role, v_branch, 'active', now());

  insert into public.onboarding_progress (business_id) values (v_business);
  insert into public.business_plan_history (business_id, plan_key, plan_overrides, trial_ends_at, status, reason, changed_by)
  select id, plan_key, plan_overrides, trial_ends_at, status, 'Signed up: 14-day trial', v_user from public.businesses where id = v_business;
  return v_business;
end;
$$;

-- Businesses that existed before self-serve onboarding have nothing to set up.
insert into public.onboarding_progress (business_id, completed_at)
select id, now() from public.businesses
on conflict do nothing;

-- =====================================================================
-- Industry templates (global catalogue, like plans)
-- =====================================================================
-- config: {statuses: [{key, name, category, stage, default?}], sources: [{key, name, channel}],
--          lost_reasons: [name], order_stages: [{key, name, category}],
--          measurement_templates: [{garment, fields: [{key, label}]}],
--          custom_fields: [{entity, key, label, field_type, options?}], automations: [preset_key]}
create table public.industry_templates (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name         text not null check (length(trim(name)) between 1 and 60),
  description  text check (length(description) <= 300),
  position     int not null default 0,
  config       jsonb not null check (jsonb_typeof(config) = 'object')
);
alter table public.industry_templates enable row level security;
create policy industry_templates_select on public.industry_templates for select to authenticated using (true);
revoke all on public.industry_templates from anon, authenticated;
grant select on public.industry_templates to authenticated;

insert into public.industry_templates (key, name, description, position, config) values
('tailoring', 'Tailoring and bespoke clothing', 'Measurements, trials and alterations, from enquiry to delivery.', 1, $json$
{"statuses": [
  {"key":"new","name":"New","category":"open","stage":"new","default":true},
  {"key":"contacted","name":"Contacted","category":"open","stage":"contacted"},
  {"key":"no_response","name":"No response","category":"open","stage":"contacted"},
  {"key":"interested","name":"Interested","category":"open","stage":"contacted"},
  {"key":"appointment_booked","name":"Appointment booked","category":"open","stage":"qualified"},
  {"key":"visited","name":"Visited store","category":"open","stage":"qualified"},
  {"key":"quotation_sent","name":"Quotation sent","category":"open","stage":"negotiation"},
  {"key":"negotiation","name":"Negotiation","category":"open","stage":"negotiation"},
  {"key":"won","name":"Converted","category":"won","stage":"won"},
  {"key":"lost","name":"Lost","category":"lost","stage":"lost"},
  {"key":"invalid","name":"Invalid or junk","category":"lost","stage":"lost"}],
 "sources": [
  {"key":"meta_ads","name":"Meta ads","channel":"meta"},{"key":"instagram","name":"Instagram","channel":"meta"},
  {"key":"google_ads","name":"Google ads","channel":"google"},{"key":"whatsapp","name":"WhatsApp","channel":"whatsapp"},
  {"key":"walk_in","name":"Walk-in","channel":"walk_in"},{"key":"referral","name":"Referral","channel":"referral"},
  {"key":"website","name":"Website","channel":"website"},{"key":"phone_call","name":"Phone call","channel":"phone"},
  {"key":"other","name":"Other","channel":"other"}],
 "lost_reasons": ["Price too high", "Bought elsewhere", "Not reachable", "Delivery date too late", "Not interested any more", "Duplicate or junk enquiry", "Other"],
 "order_stages": [
  {"key":"confirmed","name":"Confirmed","category":"open"},{"key":"in_production","name":"In production","category":"open"},
  {"key":"trial","name":"Trial","category":"open"},{"key":"alterations","name":"Alterations","category":"open"},
  {"key":"ready","name":"Ready for pickup","category":"open"},{"key":"delivered","name":"Delivered","category":"done"},
  {"key":"cancelled","name":"Cancelled","category":"cancelled"}],
 "measurement_templates": [
  {"garment":"Shirt","fields":[{"key":"neck","label":"Neck"},{"key":"chest","label":"Chest"},{"key":"waist","label":"Waist"},{"key":"seat","label":"Seat"},{"key":"shoulder","label":"Shoulder"},{"key":"sleeve","label":"Sleeve"},{"key":"length","label":"Length"}]},
  {"garment":"Trousers","fields":[{"key":"waist","label":"Waist"},{"key":"seat","label":"Seat"},{"key":"thigh","label":"Thigh"},{"key":"knee","label":"Knee"},{"key":"bottom","label":"Bottom"},{"key":"inseam","label":"Inseam"},{"key":"length","label":"Length"}]},
  {"garment":"Suit jacket","fields":[{"key":"chest","label":"Chest"},{"key":"waist","label":"Waist"},{"key":"seat","label":"Seat"},{"key":"shoulder","label":"Shoulder"},{"key":"sleeve","label":"Sleeve"},{"key":"back_length","label":"Back length"}]},
  {"garment":"Sherwani","fields":[{"key":"neck","label":"Neck"},{"key":"chest","label":"Chest"},{"key":"waist","label":"Waist"},{"key":"seat","label":"Seat"},{"key":"shoulder","label":"Shoulder"},{"key":"sleeve","label":"Sleeve"},{"key":"length","label":"Length"}]},
  {"garment":"Blouse","fields":[{"key":"bust","label":"Bust"},{"key":"waist","label":"Waist"},{"key":"shoulder","label":"Shoulder"},{"key":"armhole","label":"Armhole"},{"key":"sleeve","label":"Sleeve"},{"key":"length","label":"Length"}]}],
 "custom_fields": [
  {"entity":"lead","key":"occasion","label":"Occasion","field_type":"select","options":["Wedding","Festival","Office","Party","Other"]},
  {"entity":"lead","key":"needed_by","label":"Needed by","field_type":"date"}],
 "automations": ["new_lead_call", "idle_lead", "no_show_followup", "delivered_feedback"]}
$json$),
('salon', 'Salon and spa', 'Appointments, packages and repeat visits.', 2, $json$
{"statuses": [
  {"key":"new","name":"New enquiry","category":"open","stage":"new","default":true},
  {"key":"contacted","name":"Contacted","category":"open","stage":"contacted"},
  {"key":"no_response","name":"No response","category":"open","stage":"contacted"},
  {"key":"appointment_booked","name":"Appointment booked","category":"open","stage":"qualified"},
  {"key":"visited","name":"Visited","category":"open","stage":"qualified"},
  {"key":"package_offered","name":"Package offered","category":"open","stage":"negotiation"},
  {"key":"won","name":"Became a client","category":"won","stage":"won"},
  {"key":"lost","name":"Lost","category":"lost","stage":"lost"},
  {"key":"invalid","name":"Invalid or junk","category":"lost","stage":"lost"}],
 "sources": [
  {"key":"instagram","name":"Instagram","channel":"meta"},{"key":"meta_ads","name":"Meta ads","channel":"meta"},
  {"key":"google_maps","name":"Google Maps","channel":"google"},{"key":"whatsapp","name":"WhatsApp","channel":"whatsapp"},
  {"key":"walk_in","name":"Walk-in","channel":"walk_in"},{"key":"referral","name":"Referral","channel":"referral"},
  {"key":"phone_call","name":"Phone call","channel":"phone"},{"key":"website","name":"Website","channel":"website"},
  {"key":"other","name":"Other","channel":"other"}],
 "lost_reasons": ["Price too high", "Chose another salon", "Not reachable", "No suitable slot", "Not interested any more", "Duplicate or junk enquiry", "Other"],
 "order_stages": [
  {"key":"booked","name":"Booked","category":"open"},{"key":"in_service","name":"In service","category":"open"},
  {"key":"delivered","name":"Completed","category":"done"},{"key":"cancelled","name":"Cancelled","category":"cancelled"}],
 "measurement_templates": [],
 "custom_fields": [
  {"entity":"customer","key":"hair_type","label":"Hair type","field_type":"select","options":["Straight","Wavy","Curly","Coily"]},
  {"entity":"customer","key":"allergies","label":"Allergies or sensitivities","field_type":"textarea"},
  {"entity":"lead","key":"service","label":"Service wanted","field_type":"text"}],
 "automations": ["new_lead_call", "no_show_followup", "delivered_feedback"]}
$json$),
('clinic', 'Clinic', 'Consultations, treatment plans and follow-ups.', 3, $json$
{"statuses": [
  {"key":"new","name":"New enquiry","category":"open","stage":"new","default":true},
  {"key":"contacted","name":"Contacted","category":"open","stage":"contacted"},
  {"key":"no_response","name":"No response","category":"open","stage":"contacted"},
  {"key":"consultation_booked","name":"Consultation booked","category":"open","stage":"qualified"},
  {"key":"consulted","name":"Consulted","category":"open","stage":"qualified"},
  {"key":"treatment_plan","name":"Treatment plan shared","category":"open","stage":"negotiation"},
  {"key":"won","name":"Started treatment","category":"won","stage":"won"},
  {"key":"lost","name":"Lost","category":"lost","stage":"lost"},
  {"key":"invalid","name":"Invalid or junk","category":"lost","stage":"lost"}],
 "sources": [
  {"key":"google_ads","name":"Google ads","channel":"google"},{"key":"google_maps","name":"Google Maps","channel":"google"},
  {"key":"meta_ads","name":"Meta ads","channel":"meta"},{"key":"website","name":"Website","channel":"website"},
  {"key":"whatsapp","name":"WhatsApp","channel":"whatsapp"},{"key":"referral","name":"Doctor or patient referral","channel":"referral"},
  {"key":"walk_in","name":"Walk-in","channel":"walk_in"},{"key":"phone_call","name":"Phone call","channel":"phone"},
  {"key":"other","name":"Other","channel":"other"}],
 "lost_reasons": ["Cost of treatment", "Chose another clinic", "Not reachable", "Not ready yet", "Insurance not accepted", "Duplicate or junk enquiry", "Other"],
 "order_stages": [
  {"key":"scheduled","name":"Scheduled","category":"open"},{"key":"in_treatment","name":"In treatment","category":"open"},
  {"key":"review","name":"Review visit","category":"open"},{"key":"delivered","name":"Completed","category":"done"},
  {"key":"cancelled","name":"Cancelled","category":"cancelled"}],
 "measurement_templates": [],
 "custom_fields": [
  {"entity":"lead","key":"concern","label":"Main concern","field_type":"textarea"},
  {"entity":"customer","key":"preferred_doctor","label":"Preferred doctor","field_type":"text"}],
 "automations": ["new_lead_call", "idle_lead", "no_show_followup"]}
$json$),
('real_estate', 'Real estate', 'Requirements, site visits and bookings.', 4, $json$
{"statuses": [
  {"key":"new","name":"New","category":"open","stage":"new","default":true},
  {"key":"contacted","name":"Contacted","category":"open","stage":"contacted"},
  {"key":"no_response","name":"No response","category":"open","stage":"contacted"},
  {"key":"qualified","name":"Requirement captured","category":"open","stage":"qualified"},
  {"key":"site_visit_booked","name":"Site visit booked","category":"open","stage":"qualified"},
  {"key":"site_visited","name":"Site visited","category":"open","stage":"qualified"},
  {"key":"negotiation","name":"Negotiation","category":"open","stage":"negotiation"},
  {"key":"won","name":"Booked","category":"won","stage":"won"},
  {"key":"lost","name":"Lost","category":"lost","stage":"lost"},
  {"key":"invalid","name":"Invalid or junk","category":"lost","stage":"lost"}],
 "sources": [
  {"key":"meta_ads","name":"Meta ads","channel":"meta"},{"key":"google_ads","name":"Google ads","channel":"google"},
  {"key":"property_portal","name":"Property portal","channel":"other"},{"key":"website","name":"Website","channel":"website"},
  {"key":"whatsapp","name":"WhatsApp","channel":"whatsapp"},{"key":"referral","name":"Referral or channel partner","channel":"referral"},
  {"key":"walk_in","name":"Site or office walk-in","channel":"walk_in"},{"key":"phone_call","name":"Phone call","channel":"phone"},
  {"key":"other","name":"Other","channel":"other"}],
 "lost_reasons": ["Budget mismatch", "Location not suitable", "Bought elsewhere", "Loan not approved", "Not reachable", "Duplicate or junk enquiry", "Other"],
 "order_stages": [
  {"key":"booking_confirmed","name":"Booking confirmed","category":"open"},{"key":"agreement","name":"Agreement","category":"open"},
  {"key":"loan_processing","name":"Loan processing","category":"open"},{"key":"registration","name":"Registration","category":"open"},
  {"key":"delivered","name":"Handed over","category":"done"},{"key":"cancelled","name":"Cancelled","category":"cancelled"}],
 "measurement_templates": [],
 "custom_fields": [
  {"entity":"lead","key":"budget","label":"Budget","field_type":"number"},
  {"entity":"lead","key":"property_type","label":"Property type","field_type":"select","options":["Apartment","Villa","Plot","Commercial"]},
  {"entity":"lead","key":"preferred_location","label":"Preferred location","field_type":"text"}],
 "automations": ["new_lead_call", "idle_lead", "no_show_followup"]}
$json$),
('retail', 'Retail store', 'Enquiries, store visits and orders.', 5, $json$
{"statuses": [
  {"key":"new","name":"New","category":"open","stage":"new","default":true},
  {"key":"contacted","name":"Contacted","category":"open","stage":"contacted"},
  {"key":"no_response","name":"No response","category":"open","stage":"contacted"},
  {"key":"interested","name":"Interested","category":"open","stage":"contacted"},
  {"key":"visited","name":"Visited store","category":"open","stage":"qualified"},
  {"key":"quotation_sent","name":"Quotation sent","category":"open","stage":"negotiation"},
  {"key":"won","name":"Purchased","category":"won","stage":"won"},
  {"key":"lost","name":"Lost","category":"lost","stage":"lost"},
  {"key":"invalid","name":"Invalid or junk","category":"lost","stage":"lost"}],
 "sources": [
  {"key":"walk_in","name":"Walk-in","channel":"walk_in"},{"key":"instagram","name":"Instagram","channel":"meta"},
  {"key":"meta_ads","name":"Meta ads","channel":"meta"},{"key":"google_ads","name":"Google ads","channel":"google"},
  {"key":"whatsapp","name":"WhatsApp","channel":"whatsapp"},{"key":"website","name":"Website","channel":"website"},
  {"key":"referral","name":"Referral","channel":"referral"},{"key":"phone_call","name":"Phone call","channel":"phone"},
  {"key":"other","name":"Other","channel":"other"}],
 "lost_reasons": ["Price too high", "Out of stock", "Bought elsewhere", "Not reachable", "Not interested any more", "Duplicate or junk enquiry", "Other"],
 "order_stages": [
  {"key":"confirmed","name":"Confirmed","category":"open"},{"key":"packed","name":"Packed","category":"open"},
  {"key":"ready","name":"Ready for pickup or dispatch","category":"open"},{"key":"delivered","name":"Delivered","category":"done"},
  {"key":"cancelled","name":"Cancelled","category":"cancelled"}],
 "measurement_templates": [],
 "custom_fields": [
  {"entity":"lead","key":"product_interest","label":"Product interest","field_type":"text"}],
 "automations": ["new_lead_call", "idle_lead", "delivered_feedback"]}
$json$);

-- Reshapes a new business's pipeline, sources, lost reasons, order stages, measurement
-- templates, custom fields and starter automations. Only before any lead or order exists:
-- after that, changes are made in Settings. Nothing is deleted; unused items are hidden.
create or replace function public.apply_industry_template(p_business_id uuid, p_template_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.industry_templates;
  c jsonb;
  v_default text;
begin
  if not private.has_permission(p_business_id, 'settings.business.manage') then
    raise exception 'not allowed to set up the business' using errcode = '42501';
  end if;
  select * into t from public.industry_templates where key = p_template_key;
  if t.key is null then
    raise exception 'unknown industry template' using errcode = '22023';
  end if;
  if exists (select 1 from public.leads where business_id = p_business_id)
     or exists (select 1 from public.orders where business_id = p_business_id) then
    raise exception 'templates apply only before the first lead or order' using errcode = '22023';
  end if;
  c := t.config;
  v_default := (select s ->> 'key' from jsonb_array_elements(c -> 'statuses') s where (s ->> 'default')::boolean limit 1);

  -- Pipeline stages: no default while reshaping, then the template's default.
  update public.lead_statuses set is_default = false where business_id = p_business_id and is_default;
  insert into public.lead_statuses (business_id, key, name, category, stage, position, is_default, is_active)
  select p_business_id, s ->> 'key', s ->> 'name', (s ->> 'category')::public.lead_status_category, s ->> 'stage', o::int, false, true
    from jsonb_array_elements(c -> 'statuses') with ordinality x(s, o)
  on conflict (business_id, key) do update
    set name = excluded.name, category = excluded.category, stage = excluded.stage, position = excluded.position, is_active = true;
  update public.lead_statuses set is_default = true where business_id = p_business_id and key = v_default;
  update public.lead_statuses set is_active = false
   where business_id = p_business_id
     and key not in (select s ->> 'key' from jsonb_array_elements(c -> 'statuses') s);

  insert into public.lead_sources (business_id, key, name, channel, position, is_active)
  select p_business_id, s ->> 'key', s ->> 'name', (s ->> 'channel')::public.lead_channel, o::int, true
    from jsonb_array_elements(c -> 'sources') with ordinality x(s, o)
  on conflict (business_id, key) do update
    set name = excluded.name, channel = excluded.channel, position = excluded.position, is_active = true;
  update public.lead_sources set is_active = false
   where business_id = p_business_id and key not in (select s ->> 'key' from jsonb_array_elements(c -> 'sources') s);

  update public.lead_lost_reasons set is_active = false where business_id = p_business_id;
  insert into public.lead_lost_reasons (business_id, name, position, is_active)
  select p_business_id, r, o::int, true from jsonb_array_elements_text(c -> 'lost_reasons') with ordinality x(r, o)
  on conflict (business_id, lower(name)) do update set position = excluded.position, is_active = true;

  insert into public.order_stages (business_id, key, name, category, position, is_active)
  select p_business_id, s ->> 'key', s ->> 'name', (s ->> 'category')::public.order_stage_category, o::int, true
    from jsonb_array_elements(c -> 'order_stages') with ordinality x(s, o)
  on conflict (business_id, key) do update
    set name = excluded.name, category = excluded.category, position = excluded.position, is_active = true;
  update public.order_stages set is_active = false
   where business_id = p_business_id and key not in (select s ->> 'key' from jsonb_array_elements(c -> 'order_stages') s);

  update public.measurement_templates set is_active = false where business_id = p_business_id;
  insert into public.measurement_templates (business_id, garment, fields, position, is_active)
  select p_business_id, m ->> 'garment', m -> 'fields', o::int, true
    from jsonb_array_elements(c -> 'measurement_templates') with ordinality x(m, o)
  on conflict (business_id, lower(garment)) do update set fields = excluded.fields, position = excluded.position, is_active = true;

  insert into public.custom_field_definitions (business_id, entity, key, label, field_type, options, position, is_active)
  select p_business_id, (f ->> 'entity')::public.custom_field_entity, f ->> 'key', f ->> 'label',
         (f ->> 'field_type')::public.custom_field_type, coalesce(f -> 'options', '[]'), o::int, true
    from jsonb_array_elements(c -> 'custom_fields') with ordinality x(f, o)
  on conflict (business_id, entity, key) do update
    set label = excluded.label, field_type = excluded.field_type, options = excluded.options, is_active = true;

  -- Starter automations the industry usually wants, switched on (within the plan's limit).
  update public.automations set is_active = (preset_key in (select jsonb_array_elements_text(c -> 'automations')))
   where business_id = p_business_id and preset_key is not null;

  update public.businesses set industry = t.name where id = p_business_id;
  update public.onboarding_progress
     set template_key = t.key, steps = steps || jsonb_build_object('template', now())
   where business_id = p_business_id;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (p_business_id, auth.uid(), 'update', 'industry_template', t.key, jsonb_build_object('name', t.name));
end;
$$;

-- =====================================================================
-- Setup progress: derived from the data where possible, marked by hand otherwise
-- =====================================================================
create or replace function public.onboarding_status(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.onboarding_progress;
  b public.businesses;
  v_steps jsonb;
begin
  if not private.is_member(p_business_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into o from public.onboarding_progress where business_id = p_business_id;
  select * into b from public.businesses where id = p_business_id;
  v_steps := jsonb_build_object(
    'profile', o.steps ? 'profile' or b.legal_name is not null,
    'template', o.template_key is not null or o.steps ? 'template',
    'branches', o.steps ? 'branches' or (select count(*) > 1 from public.branches where business_id = p_business_id),
    'team', o.steps ? 'team'
            or exists (select 1 from public.invitations where business_id = p_business_id)
            or (select count(*) > 1 from public.business_memberships where business_id = p_business_id),
    'whatsapp', o.steps ? 'whatsapp' or exists (select 1 from public.whatsapp_accounts where business_id = p_business_id),
    'import', o.steps ? 'import' or exists (select 1 from public.import_jobs where business_id = p_business_id)
              or exists (select 1 from public.leads where business_id = p_business_id),
    'app', o.steps ? 'app');
  return jsonb_build_object(
    'steps', v_steps,
    'skipped', coalesce((select jsonb_object_agg(k, true) from jsonb_each(o.steps) e(k, v) where v = '"skipped"'), '{}'),
    'template_key', o.template_key,
    'completed_at', o.completed_at,
    'dismissed_at', o.dismissed_at,
    'is_demo', b.is_demo);
end;
$$;

-- Marks a step done (or skipped), finishes the wizard, or hides the checklist.
create or replace function public.onboarding_mark(p_business_id uuid, p_step text, p_value text default 'done')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_business_id, 'settings.business.manage') then
    raise exception 'not allowed to set up the business' using errcode = '42501';
  end if;
  insert into public.onboarding_progress (business_id) values (p_business_id) on conflict do nothing;
  if p_step = 'complete' then
    update public.onboarding_progress set completed_at = coalesce(completed_at, now()) where business_id = p_business_id;
  elsif p_step = 'dismiss' then
    update public.onboarding_progress set dismissed_at = now() where business_id = p_business_id;
  elsif p_step in ('profile', 'template', 'branches', 'team', 'whatsapp', 'import', 'app') and p_value in ('done', 'skipped') then
    update public.onboarding_progress
       set steps = steps || jsonb_build_object(p_step, case when p_value = 'skipped' then to_jsonb('skipped'::text) else to_jsonb(now()) end)
     where business_id = p_business_id;
  else
    raise exception 'unknown onboarding step' using errcode = '22023';
  end if;
end;
$$;

-- =====================================================================
-- Demo business: sample data in a separate business, removable in one click
-- =====================================================================
create or replace function public.create_demo_business(p_template_key text default 'tailoring')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_biz uuid;
  v_branch uuid;
  v_role uuid;
  v_lead jsonb;
  v_status uuid;
  v_names text[] := array['Aarav Sharma', 'Diya Patel', 'Kabir Reddy', 'Ananya Iyer', 'Vihaan Gupta', 'Ishita Rao', 'Arjun Nair',
                          'Meera Joshi', 'Rohan Das', 'Saanvi Menon', 'Aditya Kulkarni', 'Nisha Verma'];
  v_sources text[] := array['instagram', 'walk_in', 'whatsapp', 'referral', 'meta_ads', 'website'];
  v_keys text[];
  i int;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.businesses b join public.business_memberships m on m.business_id = b.id
              where b.is_demo and m.user_id = v_user and m.status = 'active') then
    raise exception 'you already have a demo business' using errcode = '23505';
  end if;
  if not exists (select 1 from public.industry_templates where key = p_template_key) then
    raise exception 'unknown industry template' using errcode = '22023';
  end if;

  insert into public.businesses (name, slug, created_by, plan_key, is_demo)
  values ('Demo business', 'demo-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), v_user, 'growth', true)
  returning id into v_biz;
  insert into public.branches (business_id, name) values (v_biz, 'Demo store') returning id into v_branch;
  select id into v_role from public.roles where business_id is null and key = 'business_admin';
  insert into public.business_memberships (business_id, user_id, role_id, default_branch_id, status, joined_at)
  values (v_biz, v_user, v_role, v_branch, 'active', now());
  insert into public.onboarding_progress (business_id, completed_at) values (v_biz, now());

  perform public.apply_industry_template(v_biz, p_template_key);
  -- Starter automations stay off in the demo: nothing should message anyone.
  update public.automations set is_active = false where business_id = v_biz;
  select array_agg(key order by position) into v_keys
    from public.lead_statuses where business_id = v_biz and is_active;

  for i in 1 .. array_length(v_names, 1) loop
    v_lead := public.create_lead(v_biz, jsonb_build_object(
      'phone', '+9190000' || lpad((10000 + i)::text, 5, '0'),
      'full_name', v_names[i],
      'source', v_sources[1 + (i % array_length(v_sources, 1))],
      'branch_id', v_branch,
      'title', 'Sample enquiry'));
    v_status := (select id from public.lead_statuses where business_id = v_biz
                  and key = v_keys[1 + (i % least(array_length(v_keys, 1), 8))]);
    update public.leads set status_id = v_status where id = (v_lead ->> 'lead_id')::uuid and v_status is not null
      and (select category from public.lead_statuses where id = v_status) = 'open';
  end loop;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (v_biz, v_user, 'insert', 'demo_business', v_biz::text, jsonb_build_object('template', p_template_key));
  return v_biz;
end;
$$;

-- Deletes a demo business and everything in it. Real businesses can't be deleted this way.
create or replace function public.delete_demo_business(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.businesses where id = p_business_id and is_demo) then
    raise exception 'only demo businesses can be removed' using errcode = '42501';
  end if;
  if not private.has_permission(p_business_id, 'settings.business.manage') then
    raise exception 'not allowed to remove this business' using errcode = '42501';
  end if;
  -- History and audit rows reference the business without cascading; demo data has no money in it.
  perform set_config('scaler.importing', 'on', true);
  delete from public.businesses where id = p_business_id and is_demo;
end;
$$;

-- =====================================================================
-- WhatsApp review: numbers connected during a trial wait for a person before business-initiated sends
-- =====================================================================
alter table public.whatsapp_accounts
  add column review_status text check (review_status in ('pending', 'approved', 'rejected')),
  add column review_note text check (length(review_note) <= 300),
  add column reviewed_by uuid references public.profiles(id) on delete set null,
  add column reviewed_at timestamptz;

-- A trial business (no paid subscription yet) connecting a new number goes into the queue.
create or replace function private.whatsapp_review_on_connect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.review_status is null
     and exists (select 1 from public.businesses b where b.id = new.business_id and b.trial_ends_at is not null and not b.is_demo)
     and not exists (select 1 from public.subscriptions s where s.business_id = new.business_id and s.status = 'active') then
    new.review_status := 'pending';
  end if;
  return new;
end;
$$;
create trigger whatsapp_accounts_review before insert on public.whatsapp_accounts
  for each row execute function private.whatsapp_review_on_connect();

-- Customers can always be answered; business-initiated templates and campaigns wait for the review.
create or replace function private.whatsapp_review_blocks(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.whatsapp_accounts
                  where business_id = p_business_id and review_status in ('pending', 'rejected'));
$$;

create or replace function private.guard_reviewed_templates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.whatsapp_review_blocks(new.business_id) then
    raise exception 'whatsapp number awaiting review' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger messages_review_templates before insert on public.messages
  for each row when (new.direction = 'outbound' and new.type = 'template')
  execute function private.guard_reviewed_templates();

create or replace function private.guard_reviewed_campaigns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select distinct business_id from new_rows loop
    if private.whatsapp_review_blocks(r.business_id) then
      raise exception 'whatsapp number awaiting review' using errcode = '42501';
    end if;
  end loop;
  return null;
end;
$$;
create trigger campaign_recipients_review after insert on public.campaign_recipients
  referencing new table as new_rows
  for each statement execute function private.guard_reviewed_campaigns();

-- Paying lifts the review: a subscription that becomes active approves pending numbers.
create or replace function private.whatsapp_review_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.whatsapp_accounts set review_status = 'approved', reviewed_at = now(), review_note = 'Approved on payment'
     where business_id = new.business_id and review_status = 'pending';
  end if;
  return new;
end;
$$;
create trigger subscriptions_whatsapp_review after update on public.subscriptions
  for each row execute function private.whatsapp_review_on_payment();

create or replace function public.platform_whatsapp_reviews()
returns table (account_id uuid, business_id uuid, business_name text, display_phone text, verified_name text,
               connected_at timestamptz, admin_email text, leads int, review_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
    select a.id, b.id, b.name::text, a.display_phone, a.verified_name, a.connected_at,
           (select p.email::text from public.profiles p where p.id = b.created_by),
           (select count(*)::int from public.leads l where l.business_id = b.id), a.review_status
      from public.whatsapp_accounts a join public.businesses b on b.id = a.business_id
     where a.review_status = 'pending'
     order by a.connected_at;
end;
$$;

create or replace function public.platform_review_whatsapp(p_account_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.whatsapp_accounts;
begin
  perform private.require_platform_admin();
  if not p_approve and nullif(trim(p_note), '') is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.whatsapp_accounts
     set review_status = case when p_approve then 'approved' else 'rejected' end,
         review_note = nullif(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_account_id
  returning * into a;
  if a.id is null then
    raise exception 'number not found' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (a.business_id, auth.uid(), 'update', 'whatsapp_review', a.id::text,
          jsonb_build_object('approved', p_approve, 'note', p_note));
end;
$$;

-- =====================================================================
-- Activation: how fast each new signup gets to its first lead, reply and order
-- =====================================================================
create or replace function public.platform_activation(p_days int default 90)
returns table (business_id uuid, name text, created_at timestamptz, template_key text, setup_completed_at timestamptz,
               first_lead_at timestamptz, first_reply_at timestamptz, first_order_at timestamptz, plan_key text,
               billing_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
    select b.id, b.name::text, b.created_at, o.template_key, o.completed_at,
           (select min(l.created_at) from public.leads l where l.business_id = b.id),
           (select min(m.created_at) from public.messages m
             where m.business_id = b.id and m.direction = 'outbound' and m.sent_by is not null),
           (select min(r.created_at) from public.orders r where r.business_id = b.id),
           b.plan_key, (select s.status::text from public.subscriptions s where s.business_id = b.id)
      from public.businesses b
      left join public.onboarding_progress o on o.business_id = b.id
     where not b.is_demo and b.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 365))
     order by b.created_at desc;
end;
$$;

-- The Plan & usage summary also says whether this is a demo business (for the banner).
create or replace function public.business_plan(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  s public.subscriptions;
  v_limits jsonb;
begin
  if not private.is_member(p_business_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = p_business_id;
  select * into s from public.subscriptions where business_id = p_business_id;
  select jsonb_object_agg(k, private.plan_limit(p_business_id, k)) into v_limits
    from unnest(array['max_users', 'max_branches', 'max_whatsapp_numbers', 'monthly_messages', 'max_automations', 'daily_api_calls']) k;
  return jsonb_build_object(
    'plan_key', b.plan_key,
    'plan_name', (select name from public.plans where key = b.plan_key),
    'status', b.status,
    'status_reason', b.status_reason,
    'suspended_by', b.suspended_by,
    'is_demo', b.is_demo,
    'trial_ends_at', b.trial_ends_at,
    'billing_status', s.status,
    'grace_ends_at', s.grace_ends_at,
    'limits', v_limits,
    'usage', private.usage_of(p_business_id),
    'support_until', (select max(expires_at) from public.support_access_grants
                       where business_id = p_business_id and revoked_at is null and expires_at > now()));
end;
$$;

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.signup_check(text, text) from public;
grant execute on function public.signup_check(text, text) to anon, authenticated;

revoke execute on function public.apply_industry_template(uuid, text) from public, anon;
revoke execute on function public.onboarding_status(uuid) from public, anon;
revoke execute on function public.onboarding_mark(uuid, text, text) from public, anon;
revoke execute on function public.create_demo_business(text) from public, anon;
revoke execute on function public.delete_demo_business(uuid) from public, anon;
revoke execute on function public.platform_whatsapp_reviews() from public, anon;
revoke execute on function public.platform_review_whatsapp(uuid, boolean, text) from public, anon;
revoke execute on function public.platform_activation(int) from public, anon;
grant execute on function public.apply_industry_template(uuid, text) to authenticated;
grant execute on function public.onboarding_status(uuid) to authenticated;
grant execute on function public.onboarding_mark(uuid, text, text) to authenticated;
grant execute on function public.create_demo_business(text) to authenticated;
grant execute on function public.delete_demo_business(uuid) to authenticated;
grant execute on function public.platform_whatsapp_reviews() to authenticated;
grant execute on function public.platform_review_whatsapp(uuid, boolean, text) to authenticated;
grant execute on function public.platform_activation(int) to authenticated;
