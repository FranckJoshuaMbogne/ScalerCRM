-- Sprint 16: white-label (ADR 0017).
--
--   * Brand settings per business: app name, colours (contrast-checked), logo
--     and app icon, support contact, sign-in page words, "Powered by SCALER".
--   * Custom domains per business, verified through the hosting provider;
--     a domain shows that business's brand and only lets its members in.
--   * Branded email: the business's own sender domain, verified with Resend,
--     otherwise SCALER's address with the business's name.
--   * Domains, sender domains and hiding "Powered by SCALER" come with plans
--     that include white-label (Scale and Enterprise).
-- Reseller accounts wait for a signed reseller ("Decisions to confirm early").

insert into public.permissions (key, module, description) values
-- BEGIN permissions
  ('branding.manage', 'settings', 'Set the brand: name, logo, colours, custom domain and sender email')
-- END permissions
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'branding.manage' from public.roles r
 where r.business_id is null and r.key = 'business_admin'
on conflict do nothing;

-- =====================================================================
-- Plans
-- =====================================================================
alter table public.plans add column white_label boolean not null default false;
update public.plans set white_label = key in ('scale', 'enterprise');

-- A plan feature (boolean), with the business's override if Springs 360 set one.
create or replace function private.plan_feature(p_business_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((b.plan_overrides ->> p_key)::boolean, (to_jsonb(p) ->> p_key)::boolean, false)
    from public.businesses b join public.plans p on p.key = b.plan_key
   where b.id = p_business_id;
$$;

-- Whether the business's plan includes white-label (for the settings screen).
create or replace function public.white_label_enabled(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_member(p_business_id) and private.plan_feature(p_business_id, 'white_label');
$$;
revoke execute on function public.white_label_enabled(uuid) from public, anon;
grant execute on function public.white_label_enabled(uuid) to authenticated;

-- =====================================================================
-- Brand
-- =====================================================================
-- WCAG relative luminance and contrast ratio for #rrggbb colours.
create or replace function private.luminance(p_hex text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric[] := '{}';
  c numeric;
  i int;
begin
  for i in 0..2 loop
    c := ('x' || substr(p_hex, 2 + i * 2, 2))::bit(8)::int / 255.0;
    v := v || case when c <= 0.03928 then c / 12.92 else power((c + 0.055) / 1.055, 2.4) end;
  end loop;
  return 0.2126 * v[1] + 0.7152 * v[2] + 0.0722 * v[3];
end;
$$;

create or replace function private.contrast_ratio(p_a text, p_b text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round((greatest(private.luminance(p_a), private.luminance(p_b)) + 0.05)
             / (least(private.luminance(p_a), private.luminance(p_b)) + 0.05), 2);
$$;

create table public.business_brands (
  business_id      uuid primary key references public.businesses(id) on delete cascade,
  app_name         text not null check (length(trim(app_name)) between 1 and 40),
  short_name       text not null check (length(trim(short_name)) between 1 and 12),
  -- Buttons and links (white text on it) and the sidebar (white text on it).
  primary_color    text not null default '#2f6bff' check (primary_color ~ '^#[0-9a-f]{6}$'),
  sidebar_color    text not null default '#0e1b33' check (sidebar_color ~ '^#[0-9a-f]{6}$'),
  support_email    text check (support_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(support_email) <= 254),
  support_phone    text check (support_phone ~ '^\+[1-9][0-9]{6,14}$'),
  signin_headline  text check (length(signin_headline) <= 120),
  signin_tagline   text check (length(signin_tagline) <= 300),
  hide_powered_by  boolean not null default false,
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now(),
  -- White text must stay readable (WCAG AA for normal text).
  check (private.contrast_ratio(primary_color, '#ffffff') >= 4.5),
  check (private.contrast_ratio(sidebar_color, '#ffffff') >= 4.5)
);
create trigger business_brands_updated_at before update on public.business_brands
  for each row execute function private.set_updated_at();
create trigger audit_business_brands after insert or update or delete on public.business_brands
  for each row execute function private.audit_row();

-- Hiding "Powered by SCALER" is a white-label plan feature.
create or replace function private.check_brand()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hide_powered_by and not private.plan_feature(new.business_id, 'white_label') then
    raise exception 'hiding "Powered by SCALER" needs a plan with white-label' using errcode = '23514';
  end if;
  new.primary_color := lower(new.primary_color);
  new.sidebar_color := lower(new.sidebar_color);
  return new;
end;
$$;
create trigger business_brands_check before insert or update on public.business_brands
  for each row execute function private.check_brand();

-- Logo (shown in the app and on sign-in) and app icon (home screen). PNG or
-- WebP only: SVG can carry scripts and would run on our domain.
create table public.brand_assets (
  business_id   uuid not null references public.businesses(id) on delete cascade,
  kind          text not null check (kind in ('logo', 'icon')),
  content_type  text not null check (content_type in ('image/png', 'image/webp')),
  data          bytea not null check (octet_length(data) between 64 and 524288),
  sha256        text not null,
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (business_id, kind),
  check ((content_type = 'image/png' and substring(data from 1 for 8) = '\x89504e470d0a1a0a'::bytea)
         or (content_type = 'image/webp' and substring(data from 1 for 4) = 'RIFF'::bytea and substring(data from 9 for 4) = 'WEBP'::bytea))
);

alter table public.business_brands enable row level security;
alter table public.brand_assets enable row level security;
-- Members see their business's brand (the app shows it); branding.manage changes it.
create policy business_brands_select on public.business_brands for select to authenticated
  using (private.is_member(business_id));
create policy business_brands_insert on public.business_brands for insert to authenticated
  with check (business_id = any ((select private.permitted_business_ids('branding.manage'))::uuid[]));
create policy business_brands_update on public.business_brands for update to authenticated
  using (business_id = any ((select private.permitted_business_ids('branding.manage'))::uuid[]))
  with check (business_id = any ((select private.permitted_business_ids('branding.manage'))::uuid[]));
create policy brand_assets_select on public.brand_assets for select to authenticated
  using (private.is_member(business_id));
revoke all on public.business_brands, public.brand_assets from anon;
revoke insert, update, delete on public.brand_assets from authenticated;
revoke update on public.business_brands from authenticated;
grant update (app_name, short_name, primary_color, sidebar_color, support_email, support_phone, signin_headline,
              signin_tagline, hide_powered_by, updated_by) on public.business_brands to authenticated;
revoke delete on public.business_brands from authenticated;

create or replace function public.set_brand_asset(p_business_id uuid, p_kind text, p_content_type text, p_base64 text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data bytea;
  v_hash text;
begin
  if not private.has_permission(p_business_id, 'branding.manage') then
    raise exception 'not allowed to change the brand' using errcode = '42501';
  end if;
  begin
    v_data := decode(p_base64, 'base64');
  exception when others then
    raise exception 'the image could not be read' using errcode = '22023';
  end;
  v_hash := encode(sha256(v_data), 'hex');
  insert into public.brand_assets (business_id, kind, content_type, data, sha256, updated_by)
  values (p_business_id, p_kind, p_content_type, v_data, v_hash, auth.uid())
  on conflict (business_id, kind) do update
    set content_type = excluded.content_type, data = excluded.data, sha256 = excluded.sha256,
        updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (p_business_id, auth.uid(), 'update', 'brand_assets', p_business_id, jsonb_build_object('kind', p_kind, 'sha256', v_hash));
  return v_hash;
end;
$$;

create or replace function public.remove_brand_asset(p_business_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_business_id, 'branding.manage') then
    raise exception 'not allowed to change the brand' using errcode = '42501';
  end if;
  delete from public.brand_assets where business_id = p_business_id and kind = p_kind;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, changes)
  values (p_business_id, auth.uid(), 'delete', 'brand_assets', p_business_id, jsonb_build_object('kind', p_kind));
end;
$$;

-- =====================================================================
-- Custom domains
-- =====================================================================
create table public.custom_domains (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  hostname         text not null unique check (hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' and length(hostname) <= 253),
  status           text not null default 'pending' check (status in ('pending', 'active', 'failed')),
  -- DNS records the business must add, as the hosting provider gave them.
  instructions     jsonb not null default '[]' check (jsonb_typeof(instructions) = 'array'),
  error            text check (length(error) <= 500),
  verified_at      timestamptz,
  last_checked_at  timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index custom_domains_business_idx on public.custom_domains (business_id);
create trigger custom_domains_updated_at before update on public.custom_domains
  for each row execute function private.set_updated_at();
create trigger audit_custom_domains after insert or update or delete on public.custom_domains
  for each row execute function private.audit_row();

-- Branded sender address for email. One per business.
create table public.email_domains (
  business_id      uuid primary key references public.businesses(id) on delete cascade,
  domain           text not null check (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  from_local       text not null default 'hello' check (from_local ~ '^[a-z0-9][a-z0-9._-]{0,40}$'),
  provider_id      text,
  status           text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  records          jsonb not null default '[]' check (jsonb_typeof(records) = 'array'),
  error            text check (length(error) <= 500),
  verified_at      timestamptz,
  last_checked_at  timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger email_domains_updated_at before update on public.email_domains
  for each row execute function private.set_updated_at();
create trigger audit_email_domains after insert or update or delete on public.email_domains
  for each row execute function private.audit_row();

alter table public.custom_domains enable row level security;
alter table public.email_domains enable row level security;
create policy custom_domains_select on public.custom_domains for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('branding.manage'))::uuid[]));
create policy email_domains_select on public.email_domains for select to authenticated
  using (business_id = any ((select private.permitted_business_ids('branding.manage'))::uuid[]));
revoke all on public.custom_domains, public.email_domains from anon;
revoke insert, update, delete on public.custom_domains, public.email_domains from authenticated;

-- Hostnames no tenant may claim: SCALER's own and the hosting provider's.
create or replace function private.reserved_hostname(p_host text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_host ~ '(^|\.)(scalercrm\.com|springs360\.com|vercel\.app|vercel\.com|supabase\.co|supabase\.com|localhost|local|internal)$';
$$;

create or replace function public.add_custom_domain(p_business_id uuid, p_hostname text)
returns public.custom_domains
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host text := lower(trim(trailing '.' from trim(p_hostname)));
  v public.custom_domains;
begin
  if not private.has_permission(p_business_id, 'branding.manage') then
    raise exception 'not allowed to change the brand' using errcode = '42501';
  end if;
  if not private.plan_feature(p_business_id, 'white_label') then
    raise exception 'custom domains need a plan with white-label' using errcode = '23514';
  end if;
  if v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or private.reserved_hostname(v_host) then
    raise exception 'use a domain you own, e.g. crm.yourbrand.in' using errcode = '23514';
  end if;
  if (select count(*) from public.custom_domains where business_id = p_business_id) >= 2 then
    raise exception 'a business can have up to 2 custom domains' using errcode = '23514';
  end if;
  if exists (select 1 from public.custom_domains where hostname = v_host) then
    raise exception 'that domain is already connected' using errcode = '23505';
  end if;
  insert into public.custom_domains (business_id, hostname, created_by) values (p_business_id, v_host, auth.uid())
  returning * into v;
  return v;
end;
$$;

create or replace function public.remove_custom_domain(p_business_id uuid, p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host text;
begin
  if not private.has_permission(p_business_id, 'branding.manage') then
    raise exception 'not allowed to change the brand' using errcode = '42501';
  end if;
  delete from public.custom_domains where id = p_id and business_id = p_business_id returning hostname into v_host;
  if v_host is null then
    raise exception 'domain not found' using errcode = 'P0002';
  end if;
  return v_host;
end;
$$;

create or replace function public.set_email_domain(p_business_id uuid, p_domain text, p_from_local text default 'hello')
returns public.email_domains
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := lower(trim(trailing '.' from trim(p_domain)));
  v public.email_domains;
begin
  if not private.has_permission(p_business_id, 'branding.manage') then
    raise exception 'not allowed to change the brand' using errcode = '42501';
  end if;
  if not private.plan_feature(p_business_id, 'white_label') then
    raise exception 'a branded sender needs a plan with white-label' using errcode = '23514';
  end if;
  if v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or private.reserved_hostname(v_domain) then
    raise exception 'use a domain you own, e.g. yourbrand.in' using errcode = '23514';
  end if;
  insert into public.email_domains (business_id, domain, from_local, created_by)
  values (p_business_id, v_domain, lower(coalesce(nullif(trim(p_from_local), ''), 'hello')), auth.uid())
  on conflict (business_id) do update
    set domain = excluded.domain, from_local = excluded.from_local, provider_id = null, status = 'pending',
        records = '[]', error = null, verified_at = null, last_checked_at = null
  returning * into v;
  return v;
end;
$$;

create or replace function public.remove_email_domain(p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
begin
  if not private.has_permission(p_business_id, 'branding.manage') then
    raise exception 'not allowed to change the brand' using errcode = '42501';
  end if;
  delete from public.email_domains where business_id = p_business_id returning provider_id into v_provider;
  return v_provider;
end;
$$;

-- ---------------------------------------------------------------- provider results (server only)
-- The app talks to the hosting provider and Resend, then records what they said.
create or replace function public.record_custom_domain(p_id uuid, p_status text, p_instructions jsonb, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.custom_domains
     set status = p_status, instructions = coalesce(p_instructions, instructions), error = left(p_error, 500),
         last_checked_at = now(),
         verified_at = case when p_status = 'active' then coalesce(verified_at, now()) else null end
   where id = p_id;
$$;

create or replace function public.record_email_domain(p_business_id uuid, p_provider_id text, p_status text, p_records jsonb, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.email_domains
     set provider_id = coalesce(p_provider_id, provider_id), status = p_status, records = coalesce(p_records, records),
         error = left(p_error, 500), last_checked_at = now(),
         verified_at = case when p_status = 'verified' then coalesce(verified_at, now()) else null end
   where business_id = p_business_id;
$$;

-- Pending domains to look at again (every job pass, each at most every 5 minutes, for 3 days).
create or replace function public.domains_to_check(p_limit int default 20)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'custom', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'business_id', d.business_id, 'hostname', d.hostname)), '[]')
                 from (select * from public.custom_domains
                        where status = 'pending' and created_at > now() - interval '3 days'
                          and (last_checked_at is null or last_checked_at < now() - interval '5 minutes')
                        order by last_checked_at nulls first limit p_limit) d),
    'email', (select coalesce(jsonb_agg(jsonb_build_object('business_id', e.business_id, 'domain', e.domain, 'provider_id', e.provider_id)), '[]')
                from (select * from public.email_domains
                       where status = 'pending' and created_at > now() - interval '3 days'
                         and (last_checked_at is null or last_checked_at < now() - interval '5 minutes')
                       order by last_checked_at nulls first limit p_limit) e));
$$;

-- The "from" for a business's email: its verified domain, else null (SCALER's
-- address is used, with the business's app name as the display name).
create or replace function public.email_sender(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', coalesce(bb.app_name, b.name),
    'address', case when e.status = 'verified' and private.plan_feature(b.id, 'white_label') then e.from_local || '@' || e.domain end)
    from public.businesses b
    left join public.business_brands bb on bb.business_id = b.id
    left join public.email_domains e on e.business_id = b.id
   where b.id = p_business_id;
$$;

-- The email queue says which business each email is for, so it can be branded.
drop function public.claim_emails(int);
create or replace function public.claim_emails(p_limit int default 20)
returns table (id bigint, to_email text, template text, payload jsonb, attempts int, business_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update private.email_outbox o set status = 'expired'
   where o.status in ('pending', 'sending') and o.created_at < now() - interval '1 day';
  update private.email_outbox o set status = 'pending'
   where o.status = 'sending' and o.locked_at < now() - interval '10 minutes';

  return query
  update private.email_outbox o
     set status = 'sending', attempts = o.attempts + 1, locked_at = now()
   where o.id in (select x.id from private.email_outbox x
                   where x.status = 'pending'
                   order by x.id
                   limit greatest(1, least(p_limit, 100))
                   for update skip locked)
  returning o.id, o.to_email, o.template, o.payload, o.attempts, o.business_id;
end;
$$;

-- =====================================================================
-- What a host shows. Public: the sign-in page and the app manifest need it
-- before anyone signs in. Only active domains, and only public brand fields.
-- =====================================================================
create or replace function private.brand_json(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'business_id', b.id,
    'app_name', coalesce(bb.app_name, 'SCALER'),
    'short_name', coalesce(bb.short_name, 'SCALER'),
    'primary_color', coalesce(bb.primary_color, '#2f6bff'),
    'sidebar_color', coalesce(bb.sidebar_color, '#0e1b33'),
    'support_email', bb.support_email,
    'support_phone', bb.support_phone,
    'signin_headline', bb.signin_headline,
    'signin_tagline', bb.signin_tagline,
    'powered_by', not (coalesce(bb.hide_powered_by, false) and private.plan_feature(b.id, 'white_label')),
    'logo', (select a.sha256 from public.brand_assets a where a.business_id = b.id and a.kind = 'logo'),
    'icon', (select a.sha256 from public.brand_assets a where a.business_id = b.id and a.kind = 'icon'),
    'branded', bb.business_id is not null)
    from public.businesses b
    left join public.business_brands bb on bb.business_id = b.id
   where b.id = p_business_id and b.status in ('active', 'suspended');
$$;

create or replace function public.brand_for_host(p_host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.brand_json(d.business_id)
    from public.custom_domains d
   where d.hostname = lower(split_part(coalesce(p_host, ''), ':', 1)) and d.status = 'active'
     and private.plan_feature(d.business_id, 'white_label');
$$;

create or replace function public.brand_asset_for_host(p_host text, p_kind text)
returns table (content_type text, data bytea, sha256 text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.content_type, a.data, a.sha256
    from public.custom_domains d
    join public.brand_assets a on a.business_id = d.business_id and a.kind = p_kind
   where d.hostname = lower(split_part(coalesce(p_host, ''), ':', 1)) and d.status = 'active'
     and private.plan_feature(d.business_id, 'white_label');
$$;

-- The brand of a business its members are in (the app on SCALER's own domain).
create or replace function public.my_brand(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.brand_json(p_business_id) where private.is_member(p_business_id);
$$;

create or replace function public.brand_asset(p_business_id uuid, p_kind text)
returns table (content_type text, data bytea, sha256 text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.content_type, a.data, a.sha256 from public.brand_assets a
   where a.business_id = p_business_id and a.kind = p_kind and private.is_member(p_business_id);
$$;

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.brand_for_host(text) from public;
revoke execute on function public.brand_asset_for_host(text, text) from public;
grant execute on function public.brand_for_host(text) to anon, authenticated;
grant execute on function public.brand_asset_for_host(text, text) to anon, authenticated;

revoke execute on function public.my_brand(uuid) from public, anon;
revoke execute on function public.brand_asset(uuid, text) from public, anon;
revoke execute on function public.set_brand_asset(uuid, text, text, text) from public, anon;
revoke execute on function public.remove_brand_asset(uuid, text) from public, anon;
revoke execute on function public.add_custom_domain(uuid, text) from public, anon;
revoke execute on function public.remove_custom_domain(uuid, uuid) from public, anon;
revoke execute on function public.set_email_domain(uuid, text, text) from public, anon;
revoke execute on function public.remove_email_domain(uuid) from public, anon;
grant execute on function public.my_brand(uuid) to authenticated;
grant execute on function public.brand_asset(uuid, text) to authenticated;
grant execute on function public.set_brand_asset(uuid, text, text, text) to authenticated;
grant execute on function public.remove_brand_asset(uuid, text) to authenticated;
grant execute on function public.add_custom_domain(uuid, text) to authenticated;
grant execute on function public.remove_custom_domain(uuid, uuid) to authenticated;
grant execute on function public.set_email_domain(uuid, text, text) to authenticated;
grant execute on function public.remove_email_domain(uuid) to authenticated;

revoke execute on function public.record_custom_domain(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.record_email_domain(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.domains_to_check(int) from public, anon, authenticated;
revoke execute on function public.email_sender(uuid) from public, anon, authenticated;
revoke execute on function public.claim_emails(int) from public, anon, authenticated;
grant execute on function public.record_custom_domain(uuid, text, jsonb, text) to service_role;
grant execute on function public.record_email_domain(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.domains_to_check(int) to service_role;
grant execute on function public.email_sender(uuid) to service_role;
grant execute on function public.claim_emails(int) to service_role;

grant execute on all functions in schema private to authenticated, service_role;
