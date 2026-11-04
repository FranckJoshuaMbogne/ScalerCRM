"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, echo, fieldErrors, safeNext } from "@/lib/forms";
import { siteOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

/** A hash of the client's address for sign-up rate limits; the address itself is never stored. */
async function clientHash() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${process.env.SIGNUP_HASH_SALT ?? "scaler"}:${ip}`).digest("hex").slice(0, 32);
}

const email = z.email("Enter a valid email address.").trim().toLowerCase();

const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fieldErrors(parsed.error, form);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      ok: false,
      message:
        error.code === "email_not_confirmed"
          ? "Confirm your email first. We sent you a link when you signed up."
          : "Email or password is incorrect.",
      values: echo(form),
    };
  }
  redirect(safeNext(form.get("next")));
}

export async function sendMagicLink(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { ok: false, fieldErrors: { email: "Enter a valid email address." } };

  const supabase = await createClient();
  const next = safeNext(form.get("next"));
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  // Same message whether or not the account exists, so emails can't be probed.
  if (error?.status === 429) {
    return { ok: false, message: "Too many sign-in links requested. Try again in a minute." };
  }
  return { ok: true, message: `If ${parsed.data} has an account, a sign-in link is on its way.` };
}

const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name."),
  email,
  password: z.string().min(8, "Use at least 8 characters."),
});

export async function signUp(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fieldErrors(parsed.error, form);

  const next = safeNext(form.get("next"), "/onboarding");
  const supabase = await createClient();
  const { data: check } = await supabase.rpc("signup_check", { p_email: parsed.data.email, p_client: await clientHash() });
  if (check === "disposable")
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: { email: "Use your work email. Temporary inboxes aren't accepted." },
      values: echo(form),
    };
  if (check === "rate_limited")
    return { ok: false, message: "Too many sign-ups from this network. Try again in an hour.", values: echo(form) };
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    return {
      ok: false,
      message: error.code === "weak_password" ? "Choose a stronger password." : error.message,
      values: echo(form),
    };
  }
  if (data.session) redirect(next);
  return {
    ok: true,
    message: `Check ${parsed.data.email} for a confirmation link to finish creating your account.`,
  };
}
