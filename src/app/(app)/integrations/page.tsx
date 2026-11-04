import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { disconnectAccount, testConnection } from "@/modules/integrations/actions";
import { embeddedSignupAvailable, metaConfig } from "@/modules/integrations/whatsapp/config";
import { can, getContext } from "@/modules/tenancy/session";
import { EmbeddedSignup, ManualConnect } from "./whatsapp-connect";

export const metadata = { title: "Integrations" };

type Health = { account_id: string; last_event_at: string | null; events_24h: number; failed_24h: number; pending: number };

export default async function IntegrationsPage() {
  const ctx = await getContext();
  if (!can(ctx, "integrations.manage")) return <NoAccess what="integrations" />;
  const supabase = await createClient();
  const businessId = ctx.business.businessId;
  const [{ data: accounts }, { data: health }] = await Promise.all([
    supabase
      .from("whatsapp_accounts")
      .select("id, waba_id, phone_number_id, display_phone, verified_name, quality_rating, status, connected_via, connected_at, last_checked_at, last_error")
      .eq("business_id", businessId)
      .order("connected_at"),
    supabase.rpc("whatsapp_health", { p_business_id: businessId }),
  ]);
  const healthBy = new Map(((health ?? []) as Health[]).map((h) => [h.account_id, h]));
  const tz = ctx.business.timezone;
  const meta = metaConfig();
  const webhookReady = Boolean(meta.appSecret && meta.verifyToken && process.env.SUPABASE_SERVICE_ROLE_KEY);

  return (
    <>
      <PageHeader title="Integrations" description="Connect the channels leads come from. Meta and Google lead forms follow in Sprint 7." />

      <Panel className="mb-6">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">WhatsApp Business</h2>
          <p className="text-[13px] text-muted">
            Your business keeps ownership of its WhatsApp account and number. Messages arrive in the inbox, matched to customer files.
          </p>
        </div>
        {!webhookReady && (
          <p className="mx-5 mt-4 rounded-[var(--radius-control)] bg-stage-negotiation/10 px-3 py-2 text-[13px]">
            This server is missing <code>META_APP_SECRET</code>, <code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code> or{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code>, so incoming messages can&apos;t be received yet.
          </p>
        )}
        <ul className="divide-y divide-line">
          {(accounts ?? []).map((a) => {
            const h = healthBy.get(a.id);
            return (
              <li key={a.id} className="flex flex-col gap-2 px-5 py-4 text-[13.5px]">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-[14.5px] font-medium">{a.verified_name ?? "WhatsApp number"}</span>
                  <span className="tabular-nums">{a.display_phone ?? a.phone_number_id}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${a.status === "connected" ? "bg-stage-won/15" : a.status === "error" ? "bg-danger/10 text-danger" : "bg-line"}`}>
                    {a.status === "connected" ? "Connected" : a.status === "error" ? "Needs attention" : "Disconnected"}
                  </span>
                  {a.quality_rating && <span className="text-muted">Quality: {a.quality_rating.toLowerCase()}</span>}
                </div>
                <p className="text-[12.5px] text-muted">
                  WABA {a.waba_id} · number ID {a.phone_number_id} · {a.connected_via === "embedded_signup" ? "Embedded Signup" : "manual"} ·
                  connected {formatDateTime(a.connected_at, tz)}
                  {a.last_checked_at && ` · checked ${formatDateTime(a.last_checked_at, tz)}`}
                </p>
                {h && (
                  <p className="text-[12.5px] text-muted">
                    Webhooks: {h.events_24h} in 24 h
                    {h.last_event_at ? `, last ${formatDateTime(h.last_event_at, tz)}` : ", none received yet"}
                    {h.failed_24h > 0 && <span className="text-danger"> · {h.failed_24h} failed</span>}
                    {h.pending > 0 && ` · ${h.pending} waiting to retry`}
                  </p>
                )}
                {a.last_error && <p className="text-[12.5px] text-danger">{a.last_error}</p>}
                {a.status !== "disconnected" && (
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={testConnection}>
                      <input type="hidden" name="accountId" value={a.id} />
                      <SubmitButton variant="secondary" pendingLabel="Testing…">Test connection</SubmitButton>
                    </ActionForm>
                    <ActionForm action={disconnectAccount}>
                      <input type="hidden" name="accountId" value={a.id} />
                      <SubmitButton variant="danger">Disconnect</SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="grid gap-6 border-t border-line p-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-[14px] font-semibold">Connect a number</h3>
            {embeddedSignupAvailable() ? (
              <>
                <p className="mb-3 text-[13px] text-muted">Log in with the Facebook account that manages the business, then choose or add the number.</p>
                <EmbeddedSignup appId={meta.appId} configId={meta.configId} graphVersion={meta.graphVersion} />
              </>
            ) : (
              <p className="text-[13px] text-muted">
                One-click Facebook sign-up appears here once <code>META_APP_ID</code>, <code>META_APP_SECRET</code> and{" "}
                <code>META_EMBEDDED_SIGNUP_CONFIG_ID</code> are set.
              </p>
            )}
          </div>
          <details>
            <summary className="cursor-pointer text-[14px] font-semibold select-none">Connect with IDs and a token</summary>
            <p className="mt-2 mb-3 text-[13px] text-muted">For Meta&apos;s test number, or a number you manage with a system-user token.</p>
            <ManualConnect />
          </details>
        </div>
      </Panel>
    </>
  );
}
