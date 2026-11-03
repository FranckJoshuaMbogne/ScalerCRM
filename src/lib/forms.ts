import type { z } from "zod";

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
  if (error.code === "42501") return "You don't have permission to do that.";
  return msg || "Something went wrong. Try again.";
}
