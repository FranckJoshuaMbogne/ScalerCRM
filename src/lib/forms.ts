import type { z } from "zod";
import { limitMessage } from "@/modules/plans/limits";

/** Result returned by every server action used with useActionState. */
export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Free-form payload, e.g. a generated invitation link. */
  data?: Record<string, string>;
  /** Submitted values echoed back so a failed form keeps what was typed. */
  values?: Record<string, string>;
};

const SECRET = /password|token/i;

/** Text fields from a submitted form, minus secrets. */
export function echo(form?: FormData): Record<string, string> | undefined {
  if (!form) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string" && !SECRET.test(k) && !k.startsWith("$")) out[k] = v;
  }
  return out;
}

export const initialState: ActionState = {};

export function fieldErrors(error: z.ZodError, form?: FormData): ActionState {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return { ok: false, message: "Check the highlighted fields.", fieldErrors: out, values: echo(form) };
}

/** Only allow same-site relative redirects. */
export function safeNext(next: FormDataEntryValue | string | null | undefined, fallback = "/dashboard") {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : fallback;
}

/** Turns Postgres / PostgREST errors into sentences people can act on. */
export function friendlyDbError(error: { code?: string; message?: string } | null): string {
  if (!error) return "Something went wrong. Try again.";
  const msg = error.message ?? "";
  const limit = limitMessage(msg);
  if (limit) return limit;
  if (msg.includes("support access lasts")) return "Support access can last from 1 to 72 hours.";
  if (msg.includes("platform admins only")) return "Only SCALER platform admins can do that.";
  if (msg.includes("plan not on sale")) return "That plan isn't available to buy online. Contact Springs 360.";
  if (msg.includes("plan too small"))
    return "Your business uses more than that plan allows. Remove what's over the limit first, or choose a bigger plan.";
  if (msg.includes("billing details needed")) return "Add your billing details first. They're printed on your invoices.";
  if (msg.includes("already subscribed")) return "You already have a subscription. Change plan instead.";
  if (msg.includes("no subscription to cancel")) return "There's no active subscription to cancel.";
  if (msg.includes("not allowed to manage billing")) return "Only people with billing access can do that.";
  if (msg.includes("a reason is required")) return "Add a short reason. It's kept in the business's history.";
  if (msg.includes("at least one active business admin"))
    return "Every business needs at least one active business admin. Make someone else an admin first.";
  if (msg.includes("businesses_slug_key")) return "That web address is already taken. Try another.";
  if (msg.includes("branches_business_id_name_key")) return "A branch with that name already exists.";
  if (msg.includes("roles_key_unique")) return "A role with that name already exists.";
  if (msg.includes("already a member")) return "This person is already a member of the business.";
  if (msg.includes("different email")) return "This invitation was sent to a different email address. Sign in with that email to accept it.";
  if (msg.includes("expired")) return "This invitation has expired. Ask for a new one.";
  if (msg.includes("already used")) return "This invitation has already been used.";
  if (msg.includes("invitation not found")) return "This invitation is no longer valid.";
  if (msg.includes("customer_contacts_value_unique"))
    return "That phone number or email already belongs to another customer file. If it's the same person, merge the two files.";
  if (msg.includes("tags_name_unique")) return "A tag with that name already exists.";
  if (msg.includes("custom_field_definitions_business_id_entity_key_key")) return "A field with that name already exists.";
  if (msg.includes("already merged")) return "One of these customer files has already been merged.";
  if (msg.includes("merge a customer into itself")) return "Pick a different customer file to merge.";
  if (msg.includes("not allowed to assign")) return "You can't assign leads to other people.";
  if (msg.includes("branch not accessible")) return "You don't have access to that branch.";
  if (msg.includes("owner must be an active member")) return "Choose someone who is an active member of the business.";
  if (msg.includes("E.164")) return "That doesn't look like a valid phone number.";
  if (msg.includes("phone number or email is required")) return "Enter a phone number or an email.";
  if (msg.includes("customer not found")) return "That customer file couldn't be found.";
  if (msg.includes("lead_statuses_stage_matches_category")) return "Won and lost stages use their own colour.";
  if (msg.includes("lead_statuses_business_id_key_key") || msg.includes("lead_sources_business_id_key_key"))
    return "That name is already used. Try another.";
  if (msg.includes("lead_lost_reasons_name_unique")) return "That reason is already in the list.";
  if (msg.includes("default stage must be")) return "New leads must start in an open stage that's in use.";
  if (msg.includes("default stage cannot require an owner"))
    return "The stage new leads start in can't require an owner, because website and API leads arrive unassigned.";
  if (msg.includes("stage type cannot change")) return "Leads use this stage, so its type can't change. Add a new stage instead.";
  if (msg.includes("move the leads out of this stage")) return "Move the leads in this stage to another stage before hiding it.";
  if (msg.includes("lost reason required")) return "Choose why the lead was lost.";
  if (msg.includes("unknown lost reason")) return "Choose one of the lost reasons in the list.";
  if (msg.includes("stage transition not allowed")) return "Your pipeline rules don't allow that move.";
  if (msg.includes("this stage needs an owner")) return "Assign the lead to someone first. This stage needs an owner.";
  if (msg.includes("new leads start in an active open stage")) return "New leads start in an open stage.";
  if (msg.includes("no longer in use")) return "That stage is no longer in use.";
  if (msg.includes("owner cannot see leads in this branch"))
    return "That person can't see leads in this branch. Pick someone with access, or change the branch.";
  if (msg.includes("not allowed to assign tasks")) return "You can only give tasks to yourself.";
  if (msg.includes("assignee must be an active member")) return "Choose someone who is an active member of the business.";
  if (msg.includes("round_robin_members_business_id_branch_id_user_id_key")) return "That person is already in this rotation.";
  if (msg.includes("payment is more than the balance due")) return "That's more than the balance due on this order.";
  if (msg.includes("refund is more than was paid")) return "A refund can't be more than what was paid.";
  if (msg.includes("order is cancelled")) return "This order is cancelled, so it can't take payments.";
  if (msg.includes("order is closed")) return "This order is delivered or cancelled, so its lines are locked. Reopen it first.";
  if (msg.includes("quotation is closed")) return "This quotation is already accepted, declined or expired.";
  if (msg.includes("needs at least one line")) return "Add at least one line.";
  if (msg.includes("belongs to another customer")) return "That lead or order belongs to a different customer.";
  if (msg.includes("new orders start in")) return "There's no open fulfilment stage. Add one under Settings → Orders.";
  if (msg.includes("not allowed to edit orders")) return "You can't edit orders.";
  if (msg.includes("not allowed to move orders")) return "You can't move orders between stages.";
  if (msg.includes("can cancel or reopen")) return "Only someone who can edit orders can cancel or reopen them.";
  if (msg.includes("not allowed to reassign orders")) return "You can't give orders to someone else.";
  if (msg.includes("staff must be an active member")) return "Choose someone who is an active member of the business.";
  if (msg.includes("catalog_items_sku_unique")) return "Another item already uses that SKU.";
  if (msg.includes("measurement_templates_garment_unique")) return "There's already a template for that garment.";
  if (msg.includes("order_items_check") || msg.includes("quotation_items_check")) return "A line's discount can't be more than the line.";
  if (msg.includes("appointments_check")) return "An appointment must end after it starts, within 12 hours.";
  if (msg.includes("outside the 24-hour window"))
    return "It's been more than 24 hours since the customer last wrote. WhatsApp only allows approved templates now (coming with campaigns).";
  if (msg.includes("whatsapp number is not connected")) return "This WhatsApp number is disconnected. Reconnect it under Integrations.";
  if (msg.includes("number is connected to another business")) return "That WhatsApp number is already connected to another business.";
  if (msg.includes("assignee cannot use the inbox")) return "That person's role doesn't include the inbox.";
  if (msg.includes("not allowed to assign conversations")) return "You can only take conversations yourself.";
  if (msg.includes("not allowed to reply")) return "You can't reply to this conversation.";
  if (msg.includes("template is not approved")) return "The template isn't approved by WhatsApp yet.";
  if (msg.includes("campaign was already launched")) return "This campaign has already been launched.";
  if (msg.includes("template belongs to another WhatsApp account")) return "That template belongs to a different WhatsApp account than the sending number.";
  if (msg.includes("every template variable needs a value")) return "Fill in every template variable, then save.";
  if (/cannot \w+ a \w+ campaign/.test(msg)) return "That isn't possible in the campaign's current state.";
  if (error.code === "42501") return "You don't have permission to do that.";
  return msg || "Something went wrong. Try again.";
}
