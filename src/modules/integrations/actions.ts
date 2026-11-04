"use server";

import { randomInt } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import { embeddedSignupAvailable } from "./whatsapp/config";
import { exchangeCode, metaCloud, registerNumber, subscribeApp } from "./whatsapp/meta-cloud";

const digits = (label: string) => z.string().trim().regex(/^\d{5,30}$/, `${label} is the long number from Meta, digits only.`);

async function saveAccount(
  businessId: string,
  input: { wabaId: string; phoneNumberId: string; token: string; via: "manual" | "embedded_signup" },
): Promise<ActionState> {
  // Prove the token works for this number before storing anything.
  const info = await metaCloud.getPhoneNumber(input.phoneNumberId, input.token);
  if (!info.ok) return { ok: false, message: `Meta refused the details: ${info.error}` };
  const subscribed = await subscribeApp(input.wabaId, input.token);

  const supabase = await createClient();
  const { error } = await supabase.rpc("connect_whatsapp_account", {
    p_business_id: businessId,
    p_input: {
      waba_id: input.wabaId,
      phone_number_id: input.phoneNumberId,
      access_token: input.token,
      display_phone: info.value.displayPhone,
      verified_name: info.value.verifiedName,
      quality_rating: info.value.qualityRating,
      connected_via: input.via,
    },
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return {
    ok: true,
    message: subscribed.ok
      ? `${info.value.verifiedName ?? "Number"} ${info.value.displayPhone ?? ""} is connected. New WhatsApp messages will appear in the inbox.`
      : `Connected, but Meta didn't confirm the webhook subscription (${subscribed.error}). Check the app's webhook settings.`,
  };
}

const manualSchema = z.object({
  wabaId: digits("WhatsApp Business Account ID"),
  phoneNumberId: digits("Phone number ID"),
  token: z.string().trim().min(20, "Paste the full access token."),
});

/** For Meta's test number or a system-user token, before Embedded Signup is approved. */
export async function connectManually(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const parsed = manualSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    return saveAccount(ctx.business.businessId, { ...parsed.data, via: "manual" });
  });
}

const signupSchema = z.object({
  code: z.string().min(10),
  wabaId: digits("WhatsApp Business Account ID"),
  phoneNumberId: digits("Phone number ID"),
});

/** Finishes Embedded Signup: code → business token → subscribe and register the number. */
export async function completeEmbeddedSignup(input: { code: string; wabaId: string; phoneNumberId: string }): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    if (!embeddedSignupAvailable()) return { ok: false, message: "Embedded Signup isn't configured on this server." };
    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Meta didn't return the account details. Try again." };
    const token = await exchangeCode(parsed.data.code);
    if (!token.ok) return { ok: false, message: `Meta refused the sign-up code: ${token.error}` };
    // Cloud API numbers need registering once, with a two-step verification PIN.
    const pin = String(randomInt(100000, 1000000));
    const registered = await registerNumber(parsed.data.phoneNumberId, token.value.access_token, pin);
    if (!registered.ok) console.warn("[whatsapp] register:", registered.error);
    return saveAccount(ctx.business.businessId, {
      wabaId: parsed.data.wabaId,
      phoneNumberId: parsed.data.phoneNumberId,
      token: token.value.access_token,
      via: "embedded_signup",
    });
  });
}

export async function testConnection(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const id = z.uuid().parse(form.get("accountId"));
    const supabase = await createClient();
    const { data: account } = await supabase
      .from("whatsapp_accounts")
      .select("id, phone_number_id")
      .eq("id", id)
      .eq("business_id", ctx.business.businessId)
      .maybeSingle();
    if (!account) return { ok: false, message: "That number isn't connected to this business." };
    const admin = createAdminClient();
    const { data: token } = await admin.rpc("whatsapp_account_token", { p_account_id: id });
    if (!token) return { ok: false, message: "No token is stored for this number. Connect it again." };
    const info = await metaCloud.getPhoneNumber(account.phone_number_id, String(token));
    await admin.rpc("record_whatsapp_check", {
      p_account_id: id,
      p_result: info.ok
        ? { display_phone: info.value.displayPhone, verified_name: info.value.verifiedName, quality_rating: info.value.qualityRating }
        : { error: info.error },
    });
    refresh();
    return info.ok
      ? { ok: true, message: `Working. Quality rating: ${info.value.qualityRating ?? "unknown"}.` }
      : { ok: false, message: `Meta returned an error: ${info.error}` };
  });
}

export async function disconnectAccount(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission("integrations.manage");
    const id = z.uuid().parse(form.get("accountId"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("disconnect_whatsapp_account", { p_account_id: id });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Disconnected. Conversations and history are kept." };
  });
}
