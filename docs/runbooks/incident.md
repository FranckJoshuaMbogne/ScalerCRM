# Runbook: incidents

**Incident:** tenants can't work (sign-in, leads, inbox or orders broken), data is wrong or exposed, or messages go to the wrong people.

## First 15 minutes

1. **Own it.** Say in #scaler-ops "I'm on it", with the time.
2. **Size it.** Who is affected? One business or all? Since when? Check Sentry, `/api/health` and the Vercel and Supabase dashboards.
3. **Stop the harm:**
   - **Bad deploy:** promote the previous Vercel deployment.
   - **Campaign sending wrongly:** pause it from the Campaigns page. To stop everything, unset the scheduler. Sending only happens in the job route.
   - **Automation misfiring:** switch it off in Automation.
   - **Suspected data exposure:** revoke the leaked key. API keys are under Settings → API keys. For the service role or Meta, rotate the secret in Supabase or Meta, then update Vercel. Then go to "Security incident" below.
4. **Tell the affected businesses** what's broken and when you'll update next. Use WhatsApp or a phone call to the business admin.

## Security incident (data seen by the wrong people, leaked secret)

- Keep the evidence: Supabase logs, the Vercel logs, `audit_logs` rows. Don't delete anything.
- Rotate every secret that could be involved. Each one is listed in `.env.example`.
- Within 24 hours, decide with the founders whether affected customers or authorities must be told (India's DPDP Act 2023: notify the Data Protection Board and affected people of a personal-data breach).

## After

Within 3 working days, write a blameless post-mortem (in `docs/incidents/YYYY-MM-DD-<slug>.md`) covering:
- the timeline;
- the impact;
- the cause;
- what we changed;
- what we'll change, with owners.

Add a test that would have caught it where possible.
