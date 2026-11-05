# ADR 0017 — White-label

**Date:** 28 June 2027 · **Status:** accepted

## 1. Scope: per-business branding first
"Decisions to confirm early" says to build per-business branding first, and reseller accounts only once a reseller has signed. None has.

**This sprint builds, per business:**
- brand settings;
- custom domains;
- a branded sender address;
- "Powered by SCALER" shown or hidden by plan.

**Reseller accounts are not built.** A reseller would own several businesses, see their usage and billing, set one brand for all of them, and be billed for them. When a reseller signs, it is a `resellers` table that owns businesses, with brand rows inherited from it and Sprint 11 subscriptions attached to it. Nothing below needs to change for that.

## 2. What a brand is
`business_brands` holds:
- app name and short name (home screen);
- main colour and sidebar colour;
- support email and phone (phone through `normalisePhone`);
- sign-in headline and text;
- `hide_powered_by`.

The table is configuration, so it is audited, and only `branding.manage` (a new permission, for business admins) can change it.

**Colours must stay readable.** White text has to reach WCAG AA (4.5:1) on both colours. The database checks it (`private.contrast_ratio`) and so does the form, which shows the ratio live.

**Logo and app icon** live in `brand_assets`, up to 512 KB.
- **PNG or WebP only**, checked by their first bytes in the database and the app. SVG is refused because it can carry scripts that would run on our domain.
- **Served by `/brand/logo` and `/brand/icon`** with `nosniff` and a `default-src 'none'` content security policy.
- **Versioned by hash** (`?v=`), so they can be cached for ever.

**What a plan unlocks.** The Scale and Enterprise plans (`plans.white_label`, which Springs 360 can override per business) unlock:
- custom domains;
- a branded sender;
- hiding "Powered by SCALER".

Name, colours and logo are open to every plan. On a downgrade, the domain stops showing the brand and "Powered by SCALER" comes back, without deleting anything.

## 3. Custom domains
**Adding a domain.** `add_custom_domain` checks:
- the plan;
- the hostname's shape (lower case, no scheme);
- reserved names (SCALER's and the hosting provider's);
- the limit of 2 domains per business;
- that no other business has it (unique across all tenants).

The app then adds it to the Vercel project through the Domains API, which issues TLS once DNS points at it, and stores the DNS records to show.

**Going live.** The job route re-checks pending domains every few minutes for three days. A domain is `active` only when Vercel says it is verified *and* its DNS points at us.

**Without Vercel credentials** (`VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`), the screen shows the standard records and someone adds the domain to the project by hand.

## 4. A domain is one tenant, end to end
**What a domain shows.** `brand_for_host(host)` is the only public lookup. It returns public brand fields, and only for an active domain on a white-label plan:
- the sign-in pages show that brand, with no SCALER branding and no SCALER sign-up link (`/signup` sends people to `/login`);
- `manifest.webmanifest` gives that app name, short name, icon and theme colour, so the PWA installs as the tenant's app;
- inside the app, the brand recolours buttons, links and the sidebar.

**Sessions stay on their domain.**
- Cookies are host-only: nothing sets a `Domain` attribute. A session on one domain is never sent to another, or to SCALER's own domain.
- On a custom domain, `getContext` only ever opens that domain's business (`resolveActiveBusiness`). The business switcher and its cookie are ignored there.
- Someone signed in who isn't a member of that business gets `/wrong-workspace` and a sign-out button, never their own business under someone else's brand.

**Data stays behind RLS.**
- Brands are readable by members only. `brand_for_host` returns nothing private: no plan, no billing, no members.
- Domains and sender settings are readable by `branding.manage` only.

**Never a moment of the wrong brand.** The brand is read per request (`connection()`, then the host header). The pages' loading placeholders show nothing, so a tenant's domain never flashes SCALER's brand while it loads.

**How it was tested.**
- `988_white_label.sql` covers RLS, plan gating, image checks, uniqueness and the public lookup.
- `brand.test.ts` covers contrast, hostnames, the manifest and active-business resolution.
- `scripts/white-label-check.sh` builds the app once, serves it against a stand-in for Supabase's API with two active domains, and checks over HTTP:
  - each domain's manifest and sign-in page;
  - that no brand leaks between them;
  - that no cookie is scoped beyond its host.

  A Chromium run confirmed the parsed manifests (name, icon, no errors) for both domains, alternating between them.

## 5. Branded email
**Setting up a sender.** `email_domains` holds a business's sender, such as `hello@yourbrand.in`. The app creates the domain in Resend and shows its SPF and DKIM records. The job route asks Resend to verify it until it passes.

**Who each email is from.** The email queue now carries each email's business (`claim_emails` returns `business_id`), and `email_sender` answers:
- **Verified domain on a white-label plan:** from that address, with the brand's app name.
- **Otherwise:** from SCALER's address (`EMAIL_FROM`), with the business's app name as the display name.

The name is stripped of quotes, angle brackets and line breaks, so it can't inject headers.

## Consequences
- **iOS home-screen title.** The tab title and `apple-mobile-web-app-title` still say SCALER; iOS uses the manifest's name only on newer versions. Installing from Chrome and Android uses the manifest.
- **Invitation emails** are sent directly, not through the queue, so they still go from SCALER's sender.
- **Taking a domain over.** Removing a domain frees it at Vercel. A business can't take over another's domain while it is connected, because hostnames are unique.
