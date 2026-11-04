# Onboarding usability test (Sprint 12 acceptance)

**Goal:** five people outside Springs 360 each set up a business in SCALER, unaided, in under 30 minutes.

## Before the session
**Deployment.** Use a preview deployment with:
- email configured (`RESEND_API_KEY`, `EMAIL_FROM`), so confirmation links arrive;
- the test payment provider (no Razorpay keys), so nobody can pay real money.

**Each person gets:**
- a laptop or phone they use every day;
- a CSV of 20–50 sample customers (name, phone, email), as their own shop would export it;
- a WhatsApp test number from Meta's developer console, if they will try the WhatsApp step.

**Facilitator.** One facilitator per person. They watch and time but don't help. If someone is stuck for 3 minutes, note it and give the smallest hint.

## The task (read it out)
"You run a [tailoring shop / salon / clinic / real-estate office / store]. Sign up for SCALER, set it up for your business, add two colleagues, connect WhatsApp if you can, bring in your customers and put the app on your phone. Tell us when you think you're done."

## Record for each person
| | |
|---|---|
| Industry | |
| Start time (opens the sign-up page) | |
| Email confirmed at | |
| Wizard finished at | |
| Total minutes | |
| Steps skipped | |
| Where they hesitated (step and what they said) | |
| Hints given | |
| Errors seen (screenshot) | |

## Pass
All five finish in under 30 minutes. If anyone took longer or needed a hint, the step where they got stuck becomes the next fix.

## After
Check Platform → Signups: every test business shows a setup time and a first lead. Delete the test businesses with the data-retention runbook.
