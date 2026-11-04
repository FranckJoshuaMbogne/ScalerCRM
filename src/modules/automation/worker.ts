import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderBody, type TemplateComponents, toSendComponents } from "@/modules/campaigns/template";
import { providerFor } from "@/modules/integrations/whatsapp/providers";

type External = { status: "external"; action: { type: string } };
type WaContext = {
  error?: string;
  to: string;
  customer_id: string;
  account_id: string;
  provider: string;
  phone_number_id: string | null;
  waba_id: string;
  token: string | null;
  template_name: string;
  language: string;
  components: TemplateComponents;
  params: string[];
};

/**
 * Steps every due automation run. Database steps run inside step_automation_run;
 * WhatsApp sends come back here (provider call), then the run continues.
 */
export async function runAutomations() {
  const admin = createAdminClient();
  const { data: ids, error } = await admin.rpc("claim_automation_runs", { p_limit: 200 });
  if (error) throw new Error(`claim_automation_runs failed: ${error.message}`);
  let done = 0;
  for (const id of (ids ?? []) as string[]) {
    for (let hop = 0; hop < 12; hop++) {
      const { data: result } = await admin.rpc("step_automation_run", { p_run_id: id });
      const r = result as { status: string } | External | null;
      if (!r || r.status !== "external") break;
      const { data: ctxData } = await admin.rpc("automation_whatsapp_context", { p_run_id: id });
      const ctx = ctxData as WaContext | null;
      if (!ctx || ctx.error || !ctx.token) {
        await admin.rpc("finish_automation_external", { p_run_id: id, p_error: ctx?.error ?? "WhatsApp is not connected" });
        continue;
      }
      const params = (ctx.params ?? []).map(String);
      const sent = await providerFor(ctx.provider).sendTemplate(
        { phoneNumberId: ctx.phone_number_id, wabaId: ctx.waba_id, token: ctx.token },
        ctx.to,
        { name: ctx.template_name, language: ctx.language, components: toSendComponents(ctx.components, params) },
      );
      if (sent.ok) {
        await admin.rpc("record_automation_message", {
          p_account_id: ctx.account_id,
          p_customer_id: ctx.customer_id,
          p_wamid: sent.value.wamid,
          p_body: renderBody(ctx.components.body?.text ?? "", params),
        });
      }
      await admin.rpc("finish_automation_external", { p_run_id: id, p_error: sent.ok ? null : sent.error });
    }
    done++;
  }

  // Once a night (around 02:30 IST), rescore leads so time-based rules decay.
  const now = new Date();
  if (now.getUTCHours() === 21 && now.getUTCMinutes() < 5) {
    const { data: businesses } = await admin.from("businesses").select("id").eq("status", "active");
    for (const b of businesses ?? []) await admin.rpc("rescore_leads", { p_business_id: b.id });
  }
  return { runs: done };
}
