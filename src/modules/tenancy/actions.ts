"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, echo, fieldErrors, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_BUSINESS_COOKIE, getMemberships, getUser } from "./session";
import { SLUG_PATTERN } from "./slug";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

async function setActiveBusiness(businessId: string) {
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, businessId, COOKIE_OPTIONS);
}

const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Use at least 3 characters.")
    .max(48)
    .regex(SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens."),
  branchName: z.string().trim().min(2, "Name your first branch or store.").max(120),
  countryCode: z.string().length(2),
  currency: z.string().length(3),
  timezone: z.string().min(3),
});

export async function createBusiness(_: ActionState, form: FormData): Promise<ActionState> {
  if (!(await getUser())) redirect("/login");
  const parsed = businessSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fieldErrors(parsed.error, form);
  const d = parsed.data;

  const supabase = await createClient();
  const { data: businessId, error } = await supabase.rpc("create_business", {
    p_name: d.name,
    p_slug: d.slug,
    p_branch_name: d.branchName,
    p_country_code: d.countryCode,
    p_currency: d.currency,
    p_timezone: d.timezone,
  });
  if (error) {
    const message = friendlyDbError(error);
    return message.includes("web address")
      ? { ok: false, message: "Check the highlighted fields.", fieldErrors: { slug: message }, values: echo(form) }
      : { ok: false, message, values: echo(form) };
  }

  await setActiveBusiness(businessId as string);
  redirect("/dashboard");
}

export async function switchBusiness(form: FormData) {
  const id = String(form.get("businessId") ?? "");
  const memberships = await getMemberships();
  if (memberships.some((m) => m.businessId === id)) {
    await setActiveBusiness(id);
  }
  redirect("/dashboard");
}

export async function acceptInvitation(_: ActionState, form: FormData): Promise<ActionState> {
  if (!(await getUser())) redirect("/login");
  const token = String(form.get("token") ?? "");
  const supabase = await createClient();
  const { data: businessId, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return { ok: false, message: friendlyDbError(error) };
  await setActiveBusiness(businessId as string);
  redirect("/dashboard");
}
