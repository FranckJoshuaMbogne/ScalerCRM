"use server";

import { refresh } from "next/cache";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/modules/plans/platform";
import { isValidGstin, normaliseGstin } from "./gst";
import { parseSettlementCsv, reconcile } from "./reconcile";

/** Springs 360's details for invoices. Until the GSTIN is set, invoices are test invoices. */
export async function saveSeller(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const gstin = normaliseGstin(String(form.get("gstin") ?? ""));
  if (gstin && !isValidGstin(gstin)) return { ok: false, message: "That GSTIN isn't valid." };
  const prefix = String(form.get("invoice_prefix") ?? "").trim().toUpperCase();
  if (prefix && !/^[A-Z]{2,4}$/.test(prefix)) return { ok: false, message: "The invoice prefix is 2 to 4 letters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_save_seller", {
    p_input: {
      legal_name: String(form.get("legal_name") ?? ""),
      gstin,
      state_code: String(form.get("state_code") ?? ""),
      address: String(form.get("address") ?? ""),
      email: String(form.get("email") ?? ""),
      invoice_prefix: prefix,
      sac_code: String(form.get("sac_code") ?? ""),
    },
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Seller details saved. New invoices use them." };
}

/** Checks a provider settlement report against the invoices issued. */
export async function reconcileSettlement(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a settlement report (CSV)." };
  if (file.size > 5_000_000) return { ok: false, message: "That file is over 5 MB. Export a shorter date range." };
  const { rows, error } = parseSettlementCsv(await file.text());
  if (error) return { ok: false, message: error };
  if (!rows.length) return { ok: false, message: "No payments found in that file." };
  const supabase = await createClient();
  const { data, error: dbError } = await supabase.rpc("platform_invoices_by_payment", {
    p_provider: String(form.get("provider") ?? "razorpay"),
    p_payment_ids: rows.map((r) => r.paymentId),
  });
  if (dbError) return { ok: false, message: friendlyDbError(dbError) };
  const invoices = ((data ?? []) as { payment_id: string; number: string; total: number }[]).map((i) => ({
    paymentId: i.payment_id,
    number: i.number,
    total: i.total,
  }));
  const result = reconcile(rows, invoices);
  if (!result.mismatches.length) return { ok: true, message: `All ${result.matched} payments match their invoices.` };
  return {
    ok: false,
    message: `${result.matched} match. ${result.mismatches.length} don't: ${result.mismatches
      .slice(0, 20)
      .map((m) => `${m.paymentId} (${m.problem}${m.invoiced ? `: settled ${m.settled}, invoiced ${m.invoiced}` : ""})`)
      .join("; ")}${result.mismatches.length > 20 ? "; …" : ""}`,
  };
}
