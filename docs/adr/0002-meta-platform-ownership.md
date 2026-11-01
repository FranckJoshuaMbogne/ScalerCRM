# ADR 0002 — Meta platform ownership and WhatsApp integration order

**Date:** 1 November 2026 · **Status:** accepted

## Decision
- **Springs 360** owns SCALER's Meta developer app and registers as a WhatsApp **Tech Provider**. Springs 360 completes Meta business verification and app review for `whatsapp_business_messaging`, `whatsapp_business_management` and, for Lead Ads, `leads_retrieval`.
- **Each client business** (MY PERFECT FIT first) connects through **Embedded Signup**. It owns its WhatsApp Business Account, phone numbers, display name, business verification, billing and message templates, all inside its own Meta Business Manager.
- **Build order:** direct Meta Cloud API in Sprint 5; first BSP adapter in Sprint 6, behind the same `MessagingProvider` interface.

## Consequences
- Credentials are per tenant: one encrypted token set per connected WABA, never shared across businesses.
- One app-level webhook receives all events; the handler resolves the tenant from the WABA / phone-number ID before any processing, and drops events for unknown accounts.
- Templates are created and synced per tenant WABA. SCALER never sends a template on behalf of a business that does not own it.
- Development and testing use Meta's test number and standard access; Springs 360 verification only gates onboarding real clients, so it must be done before Sprint 5 ends.
