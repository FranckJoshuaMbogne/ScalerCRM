# ADR 0005 — Appointments, walk-ins, orders and payments

**Date:** 28 December 2026 · **Status:** accepted

## 1. Money is exact, end to end
- Every amount is `numeric(14,2)`, quantities are `numeric(12,3)` and tax rates are `numeric(5,2)`.
- Each line's `gross`, `tax_amount` and `line_total` are **generated columns**, so a line can never disagree with its own numbers. `gross = round(qty × price, 2)`, tax is charged on `gross − discount`, and rounding is half away from zero.
- Discounts are per line, so tax is always charged on the discounted amount. Prices are tax-exclusive.
- Order and quotation totals are sums of their lines, kept by a trigger.
- The app previews totals with the same rules in `src/modules/orders/money.ts`, using integer paise (BigInt) and never floats. A unit test checks it against the same numbers as the SQL test.

## 2. Balances are computed, never stored
`payments` is an append-only ledger: no updates and no deletes. A mistake is corrected with a refund. `order_balances` (a view) computes paid, refunded and balance from the ledger every time it's read.

When a payment is inserted, the order row is locked and the amount is checked:
- a payment can't exceed the balance due;
- a refund can't exceed what was paid;
- a cancelled order takes no payments.

Receipts are numbered per business: `R-000001`, and refunds `RF-…`, sharing one counter. The view's balance is visible to anyone who can see the order; individual payment rows need `payments.view`.

## 3. Quotations and orders are separate documents
`quotations` (`Q-`) and `orders` (`O-`) have identical line tables. `convert_quotation()` copies the lines into a new order, links the two, and marks the quotation accepted; it can only happen once.

Orders move through **configurable fulfilment stages** (`order_stages`, seeded Confirmed → In production → Trial → Alterations → Ready → Delivered, plus Cancelled). Each move goes into `order_status_history`, and `closed_at` is set when an order is delivered or cancelled. Once an order is closed its lines are locked.

Who can change what:
- `orders.edit` can edit anything.
- `orders.fulfil` (production) can only move stages, and can't cancel or reopen.
- `orders.create` (sales) can create orders and quotations, and edit their own quotations.

## 4. Walk-ins reuse the matching and lead rules from Sprint 2
`register_walk_in()` runs `create_lead_internal()` with source `walk_in` and `reuse_open_lead`:
- a returning customer's visit is added to their open lead;
- a new phone gets a customer file and a lead.

Every walk-in is also a `walk_ins` row, for footfall counts. If the customer has an appointment booked at that branch today, it's marked completed.

## 5. Appointments
Appointments link a customer to an optional lead or order, which must belong to the same customer. Status changes (scheduled → confirmed → completed / no-show / cancelled) are kept in `appointment_status_history`.

The staff member is notified when someone else books them in. The Sprint 3 job route now also handles appointments:
- an in-app reminder and an email an hour before;
- an "outcome?" prompt 30 minutes after an appointment nobody has closed.

The customer profile shows the no-show count. Customer reminders by WhatsApp come with the WhatsApp engine in Sprint 5.

## 6. Tailoring extension
These are generic tables, so other trades can use them too:
- `measurement_templates` lists the fields asked for each garment. Four are seeded; a business that doesn't take measurements hides them.
- `customer_measurements` saves each session as a new row (`readings` jsonb), so history is never overwritten.
- Order lines carry `garment`, `fabric` and an optional link to a measurement session. The garment, fabric and measurement inputs appear only for businesses with an active template.
- Trial dates and alterations are trial or alteration appointments linked to the order, plus the Trial and Alterations stages.
- Anything else is an **order custom field**: `custom_field_entity` gains `order`.

## 7. Customer value
`customer_value` (a view) gives the number of orders, lifetime value, and first and last order per customer. Cancelled orders don't count. The CIF profile also shows the balance still owed. Both views are `security_invoker`, so they only count records the viewer can see.

## 8. Permissions
There is one new key: `settings.orders.manage`, for the catalogue, fulfilment stages and measurement templates. Business admins and store managers have it. Everything else uses the existing `orders.*`, `payments.*` and `appointments.*` keys. The catalogue test now reads every `-- BEGIN permissions` block across all migrations.

**Revisit when:** invoices or GST e-invoicing are needed (they'd need tax-inclusive pricing and HSN codes on catalogue items), or when payment-gateway webhooks start writing payments (they'd need an idempotency key on `payments`).
