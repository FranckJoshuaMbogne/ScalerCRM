import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { providerFor } from "@/modules/integrations/whatsapp/providers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Streams an inbound WhatsApp attachment. The message is read with the
 * signed-in user's client, so RLS decides who may see it; only then is the
 * business's token used to fetch the file from Meta.
 */
export async function GET(_: Request, ctx: RouteContext<"/api/whatsapp/media/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("not found", { status: 404 });
  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select("media, conversation:conversations(account_id, account:whatsapp_accounts(provider, waba_id, phone_number_id))")
    .eq("id", id)
    .maybeSingle();
  const media = message?.media as { id?: string; mime_type?: string; filename?: string } | null;
  const conv = message?.conversation as
    | { account_id?: string; account?: { provider: string; waba_id: string; phone_number_id: string | null } | null }
    | null;
  const accountId = conv?.account_id;
  if (!media?.id || !accountId) return new Response("not found", { status: 404 });

  const admin = createAdminClient();
  const { data: token } = await admin.rpc("whatsapp_account_token", { p_account_id: accountId });
  if (!token) return new Response("number disconnected", { status: 410 });
  const provider = providerFor(conv?.account?.provider);
  const account = { phoneNumberId: conv?.account?.phone_number_id ?? null, wabaId: conv?.account?.waba_id ?? "", token: String(token) };
  const meta = await provider.getMediaUrl(account, media.id);
  if (!meta.ok) return new Response("media expired or unavailable", { status: 404 });
  const file = await provider.downloadMedia(account, meta.value.url);
  if (!file.ok || !file.body) return new Response("media unavailable", { status: 502 });

  const headers = new Headers({
    "content-type": meta.value.mimeType ?? media.mime_type ?? "application/octet-stream",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  });
  if (media.filename) headers.set("content-disposition", `inline; filename="${media.filename.replace(/["\r\n]/g, "")}"`);
  return new Response(file.body, { headers });
}
