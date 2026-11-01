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
  if (error.code === "42501") return "You don't have permission to do that.";
  return msg || "Something went wrong. Try again.";
}
