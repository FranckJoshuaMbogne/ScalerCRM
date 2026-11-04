import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTemporary } from "@/modules/integrations/whatsapp/provider";
import { providerFor } from "@/modules/integrations/whatsapp/providers";
import { renderBody, type TemplateComponents, toSendComponents } from "./template";

type Claimed = { recipient_id: string; campaign_id: string; phone: string; params: string[] };
type Context = {
  provider: string;
  phone_number_id: string | null;
  waba_id: string;
  template_name: string;
  language: string;
  components: TemplateComponents;
  header_media_url: string | null;
  token: string | null;
};

const CONCURRENCY = 5;

/**
 * One pass of the send queue: start due schedules, claim a throttled batch,
 * send each template, record the outcome. Safe to run concurrently (claims
 * use SKIP LOCKED) and often; the job route runs it every 5 minutes and
 * launching a campaign runs it once straight away.
 */
export async function runCampaigns(maxBatches = 5) {
  const admin = createAdminClient();
  const { data: started, error: tickError } = await admin.rpc("campaign_tick");
  if (tickError) throw new Error(`campaign_tick failed: ${tickError.message}`);

  let sent = 0;
  let failed = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const { data, error } = await admin.rpc("claim_campaign_batch", { p_limit: 200, p_minutes: 5 });
    if (error) throw new Error(`claim_campaign_batch failed: ${error.message}`);
    const rows = (data ?? []) as Claimed[];
    if (!rows.length) break;

    const contexts = new Map<string, Context | null>();
    for (const id of new Set(rows.map((r) => r.campaign_id))) {
      const { data: ctx } = await admin.rpc("campaign_send_context", { p_campaign_id: id });
      contexts.set(id, (ctx as Context | null) ?? null);
    }

    const queue = [...rows];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let r = queue.shift(); r; r = queue.shift()) {
          const ctx = contexts.get(r.campaign_id);
          const params = (r.params ?? []).map(String);
          if (!ctx?.token) {
            await admin.rpc("record_campaign_send", {
              p_recipient_id: r.recipient_id,
              p_wamid: null,
              p_body: null,
              p_error: { message: "WhatsApp number disconnected" },
              p_retry: false,
            });
            failed++;
            continue;
          }
          const result = await providerFor(ctx.provider).sendTemplate(
            { phoneNumberId: ctx.phone_number_id, wabaId: ctx.waba_id, token: ctx.token },
            r.phone,
            { name: ctx.template_name, language: ctx.language, components: toSendComponents(ctx.components, params, ctx.header_media_url) },
          );
          await admin.rpc("record_campaign_send", {
            p_recipient_id: r.recipient_id,
            p_wamid: result.ok ? result.value.wamid : null,
            p_body: renderBody(ctx.components.body?.text ?? "", params),
            p_error: result.ok ? null : { message: result.error, code: result.code != null ? String(result.code) : null },
            p_retry: result.ok ? false : isTemporary(result),
          });
          if (result.ok) sent++;
          else failed++;
        }
      }),
    );
  }
  return { started: Number(started ?? 0), sent, failed };
}
