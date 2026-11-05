# SCALER for business admins

## 1. Your team
- **Team → Invite.** Pick a role. Sales executives see only their own leads and customers; managers see their branches. Give access to only the branches a person works in.
- **Roles.** The built-in roles fit most shops. Create a custom role under Team → Roles when one doesn't. Every switch is one permission, and it applies everywhere, including exports.
- **Someone leaves:** remove them from Team the same day. Reassign their open leads first: filter the lead list by their name and give each lead a new owner.

## 2. Settings to check once
- **Pipeline:**
  - stage names your team uses;
  - which stages need an owner;
  - lost reasons;
  - sources.
- **Lead assignment:** round-robin per branch, and who is in the rotation.
- **Orders:** fulfilment stages, catalogue, measurement templates.
- **Custom fields:** only what you'll actually report on.

## 3. Bringing in old data (Settings → Import data)
1. Download the template for customers, leads or orders.
2. Put your data under its headings. Dates as DD/MM/YYYY, amounts as numbers (₹ and commas are fine).
3. **Check file** first. Fix the listed rows in your spreadsheet, not in SCALER, then check again.
4. **Import.** Do customers first, then leads, then orders. Importing the same file twice is safe.

## 4. Integrations
- **WhatsApp:**
  - connect your number;
  - write templates for anything sent after 24 hours of silence;
  - watch the number's quality on the Integrations page.
- **Meta Lead Ads and Google lead forms:** connect once. New leads arrive with their campaign.
- **Website:** the API key and the tracking snippet are in Settings → API keys.

## 5. Automations
Six ready-made automations are switched off at first. Turn on "Call new leads within 15 minutes" and "Chase quiet leads" in week one. Add others once the team trusts them. The run log on each automation shows what it did and why it skipped.

**Building your own** (Automation → New workflow):
- **Build on the canvas.** Each workflow starts from what triggers it. Add steps and drag from the dot under a step to the next one. An *If / else* step and a *Wait for a reply* step each have two exits.
- **Try it before publishing.** Use **Dry run** with a real lead. It shows the path the lead would take and what each step would do, without doing anything.
- **Publish.** Saving keeps a draft. **Publish** makes it live as a new version. Runs that already started finish on the version they started on. If a change goes wrong, **Roll back** to an earlier version.
- **Check the steps.** Tick *Show what happened at each step* to see how many runs reached each step, which branch they took and how many failed.
- **Emails count on your plan.** Emails sent by workflows count as messages, like WhatsApp templates.

## 6. Branches, targets and packs
- **Analytics → Branches** puts every branch side by side. The *index* compares each branch with what the business converts on leads from the same sources, so a walk-in-heavy branch isn't flattered. Click a branch for its team, and see leads moved between branches at the bottom.
- **Analytics → Targets:** set monthly or quarterly targets for the business, a branch or a person. The four measures are leads handled, conversions, revenue and collections. People see their own targets in My day, and managers see them all on the dashboard.
- **Leaderboard:** off until you switch it on in Settings. When on, everyone sees the ranking.
- **Report packs:** in Reports, schedule the owner, branch manager or marketing pack weekly or monthly. They arrive by email with CSV files attached. "See a pack now" shows the same pack, ready to save as PDF.

## 7. Your brand
Settings → Brand:
- **Name and colours:** your app name, colours (the screen warns if text would be hard to read), support contact, logo and home-screen icon.
- **Plans:** on Scale and above you can also:
  - run SCALER on your own address, such as crm.yourbrand.in: add the DNS record shown and it goes live with HTTPS, usually within an hour;
  - send emails from your own domain;
  - hide "Powered by SCALER".
- **On your own address** only your team can sign in, and the app installs on phones under your name and icon.

## 8. Keeping an eye
- **Analytics:** the executive tab every morning. Sales tab: salespeople compared fairly, adjusted for the leads they got.
- **Audit log:** every settings change, export and import. You get a notification when someone exports 1,000 rows or more.
- **Exports** are limited to 20 an hour per person. That's enough for real work, and slows down anyone copying the database.
