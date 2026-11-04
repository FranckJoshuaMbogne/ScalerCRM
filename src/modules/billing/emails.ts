import { escapeHtml, formatDue, layout, type RenderedEmail, str } from "@/modules/email/templates";

/** Dunning and invoice emails, queued by the database (private.billing_notify). */

const FOOTER = "You get this because you're the billing contact or an admin of this business on SCALER.";

function money(v: unknown, currency: unknown) {
  const n = Number(str(v) || v);
  if (!Number.isFinite(n)) return String(v ?? "");
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: str(currency) || "INR" }).format(n);
}

export function billingEmail(template: string, p: Record<string, unknown>, origin: string): RenderedEmail | null {
  const business = str(p.business_name) || "your business";
  const tz = str(p.timezone) || "Asia/Kolkata";
  const billing = `${origin}/settings/billing`;
  const when = (key: string) => formatDue(str(p[key]), tz);

  const make = (subject: string, title: string, lines: string[], action: { label: string; url: string }) => ({
    subject,
    html: layout(escapeHtml(title), lines.map(escapeHtml), action, FOOTER),
    text: [...lines, "", `${action.label}: ${action.url}`, "", FOOTER].join("\n"),
  });

  switch (template) {
    case "billing_trial_ending":
      return make(`Your SCALER trial for ${business} ends ${when("trial_ends_at")}`, "Your trial is ending", [
        `The free trial for ${business} ends on ${when("trial_ends_at")}.`,
        "Choose a plan to keep everything running. You can pay by UPI autopay, card or net banking.",
      ], { label: "Choose a plan", url: billing });
    case "billing_trial_ended":
      return make(`Your SCALER trial for ${business} has ended`, "Your trial has ended", [
        `The free trial for ${business} has ended. Everything keeps working until ${when("grace_ends_at")}.`,
        "After that the business becomes read-only (you can still view and export) until a plan is paid for. Nothing is deleted.",
      ], { label: "Choose a plan", url: billing });
    case "billing_payment_failed":
      return make(`Payment for ${business} didn't go through`, "Your renewal payment failed", [
        `We couldn't collect the renewal payment for ${business}. The payment provider will try again.`,
        `Please check your payment method. If it isn't paid by ${when("grace_ends_at")}, the business becomes read-only until it is.`,
      ], { label: "Check billing", url: billing });
    case "billing_grace_ending":
      return make(`${business} becomes read-only on ${when("grace_ends_at")}`, "Payment is still due", [
        `The payment for ${business} is still due. On ${when("grace_ends_at")} the business becomes read-only: your team can view and export, but not add or change anything.`,
        "Pay now to keep working without interruption.",
      ], { label: "Pay now", url: billing });
    case "billing_read_only":
      return make(`${business} is read-only until payment`, "Your business is read-only", [
        `${business} is read-only because the payment is overdue. Your team can still sign in, view and export everything.`,
        "Paying restores full access at once. Nothing has been deleted.",
      ], { label: "Pay now", url: billing });
    case "billing_cancelled":
      return make(`Your SCALER subscription for ${business} has ended`, "Subscription ended", [
        `The subscription for ${business} has ended, so the business is read-only. Your data is kept: you can view and export it.`,
        "Subscribe again at any time to pick up where you left off.",
      ], { label: "Subscribe again", url: billing });
    case "billing_downgrade_blocked":
      return make(`Your plan change for ${business} didn't happen`, "Plan change postponed", [
        `${business} renewed on its current plan because it uses more than the plan you chose allows.`,
        "Remove what's over the limit (users, branches, WhatsApp numbers or active automations) and the change happens at the next renewal.",
      ], { label: "See plan and usage", url: `${origin}/settings/plan` });
    case "billing_invoice": {
      const test = p.test_mode === true;
      const id = str(p.invoice_id);
      return make(
        `${test ? "Test invoice" : "Invoice"} ${str(p.number)} from SCALER: ${money(p.total, p.currency)}`,
        "Payment received, thank you",
        [
          `We received ${money(p.total, p.currency)} for ${business}. ${test ? "Test invoice" : "Invoice"} ${str(p.number)} is ready.`,
          ...(test ? ["This is a test-mode invoice, not a tax invoice. No money was charged."] : []),
        ],
        { label: "View invoice", url: id ? `${billing}/invoices/${id}` : billing },
      );
    }
    default:
      return null;
  }
}
