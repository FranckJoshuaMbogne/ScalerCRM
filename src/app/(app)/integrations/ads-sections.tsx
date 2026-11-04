import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { disconnectIntegration, retryFailed } from "@/modules/integrations/ads-actions";
import { googleConfigured } from "@/modules/integrations/ads/clients";
import { metaConfig } from "@/modules/integrations/whatsapp/config";
import { AdAccountForm, GoogleWebhookForm, PageLogin, PageManualForm } from "./ads-forms";

function Disconnect({ kind, id }: { kind: string; id: string }) {
  return (
    <ActionForm action={disconnectIntegration}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost">Disconnect</SubmitButton>
    </ActionForm>
  );
}

const daysUntil = (at: string) => Math.round((new Date(at).getTime() - Date.now()) / 86400_000);

function Expiry({ at, tz }: { at: string | null; tz: string }) {
  if (!at) return null;
  const days = daysUntil(at);
  return (
    <span className={days < 7 ? "font-medium text-danger" : "text-muted"}>
      · token {days < 0 ? "expired" : `expires ${formatDateTime(at, tz)}`}
    </span>
  );
}

const status = (s: string) =>
  `rounded-full px-2 py-0.5 text-[12px] font-medium ${s === "connected" ? "bg-stage-won/15" : s === "error" ? "bg-danger/10 text-danger" : "bg-line"}`;

export async function AdsSections({ businessId, tz }: { businessId: string; tz: string }) {
  const supabase = await createClient();
  const [{ data: pages }, { data: forms }, { data: hooks }, { data: accounts }, { data: health }] = await Promise.all([
    supabase.from("meta_pages").select("id, page_id, name, status, subscribed, token_expires_at, last_lead_at, last_error").eq("business_id", businessId).order("connected_at"),
    supabase.from("lead_forms").select("id, provider, external_form_id, name, leads_received, last_lead_at, mapping").eq("business_id", businessId).order("last_lead_at", { ascending: false, nullsFirst: false }),
    supabase.from("lead_webhooks").select("id, name, is_active, last_received_at").eq("business_id", businessId).order("created_at"),
    supabase.from("ad_accounts").select("id, platform, external_id, name, status, last_synced_at, last_error, token_expires_at").eq("business_id", businessId).order("created_at"),
    supabase.rpc("integration_health", { p_business_id: businessId }),
  ]);
  const h = (health ?? {}) as { events_24h?: number; failed?: number; pending?: number; recent_failures?: { kind: string; provider: string; error: string | null; at: string }[] };
  const meta = metaConfig();
  const snippet = `<script src="https://YOUR-SCALER-DOMAIN/scaler-touch.js" async></script>`;

  return (
    <>
      <Panel className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold">Health</h2>
            <p className="text-[13px] text-muted">
              {h.events_24h ?? 0} webhook events in 24 h · {h.pending ?? 0} waiting · <span className={h.failed ? "font-medium text-danger" : ""}>{h.failed ?? 0} failed</span>
            </p>
          </div>
          {(h.failed ?? 0) > 0 && (
            <ActionForm action={retryFailed}>
              <SubmitButton variant="secondary">Retry failed events</SubmitButton>
            </ActionForm>
          )}
        </div>
        {h.recent_failures && h.recent_failures.length > 0 && (
          <ul className="divide-y divide-line text-[13px]">
            {h.recent_failures.map((f, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 px-5 py-2">
                <span className="w-36 text-muted tabular-nums">{formatDateTime(f.at, tz)}</span>
                <span className="w-28">{f.provider.replace("_", " ")}</span>
                <span className="flex-1 text-danger">{f.error}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="mb-6">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Meta Lead Ads</h2>
          <p className="text-[13px] text-muted">Leads from Facebook and Instagram lead forms arrive as leads with their campaign, ad set and ad.</p>
        </div>
        <ul className="divide-y divide-line">
          {(pages ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13.5px]">
              <span className="font-medium">{p.name ?? p.page_id}</span>
              <span className={status(p.status)}>{p.status === "connected" ? (p.subscribed ? "Receiving leads" : "Not subscribed") : p.status}</span>
              <span className="text-[12.5px] text-muted">
                {p.last_lead_at ? `Last lead ${formatDateTime(p.last_lead_at, tz)}` : "No leads yet"}
              </span>
              <Expiry at={p.token_expires_at} tz={tz} />
              {p.last_error && <span className="basis-full text-[12.5px] text-danger">{p.last_error}</span>}
              {p.status !== "disconnected" && <span className="ml-auto"><Disconnect kind="meta_page" id={p.id} /></span>}
            </li>
          ))}
        </ul>
        {(forms ?? []).length > 0 && (
          <div className="border-t border-line px-5 py-3">
            <p className="mb-1 text-[13px] font-medium">Lead forms</p>
            <ul className="flex flex-col gap-1 text-[13px]">
              {(forms ?? []).map((f) => (
                <li key={f.id} className="flex flex-wrap gap-x-3">
                  <Link href={`/integrations/forms/${f.id}`} className="font-medium text-signal hover:underline">{f.name ?? f.external_form_id}</Link>
                  <span className="text-muted">{f.provider === "meta" ? "Meta" : "Google"} · {f.leads_received} leads</span>
                  {Object.keys(f.mapping ?? {}).length === 0 && <span className="text-stage-negotiation">using default mapping</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid gap-6 border-t border-line p-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[14px] font-semibold">Connect pages</h3>
            {meta.appId ? <PageLogin appId={meta.appId} graphVersion={meta.graphVersion} /> : <p className="text-[13px] text-muted">Set META_APP_ID to connect with Facebook Login.</p>}
            <p className="mt-2 text-[12.5px] text-muted">
              Webhook for the Meta app&apos;s Page product: <code>/api/webhooks/meta/leadgen</code>, field <code>leadgen</code>.
            </p>
          </div>
          <details>
            <summary className="cursor-pointer text-[14px] font-semibold select-none">Connect with a page token</summary>
            <div className="mt-3"><PageManualForm /></div>
          </details>
        </div>
      </Panel>

      <Panel className="mb-6">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Google Ads lead forms</h2>
          <p className="text-[13px] text-muted">Google sends each lead form submission to a webhook; leads keep the campaign, ad group and gclid.</p>
        </div>
        <ul className="divide-y divide-line">
          {(hooks ?? []).map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-x-3 px-5 py-2.5 text-[13.5px]">
              <span className="font-medium">{w.name}</span>
              <span className="text-[12.5px] text-muted">{w.is_active ? (w.last_received_at ? `Last lead ${formatDateTime(w.last_received_at, tz)}` : "Waiting for the first lead") : "Disconnected"}</span>
              {w.is_active && <span className="ml-auto"><Disconnect kind="lead_webhook" id={w.id} /></span>}
            </li>
          ))}
        </ul>
        <div className="border-t border-line p-5"><GoogleWebhookForm /></div>
      </Panel>

      <Panel className="mb-6">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Ad spend</h2>
          <p className="text-[13px] text-muted">Daily spend per campaign, synced every 6 hours, for cost per lead and return on ad spend.</p>
        </div>
        <ul className="divide-y divide-line">
          {(accounts ?? []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13.5px]">
              <span className="font-medium">{a.name ?? a.external_id}</span>
              <span className="text-muted">{a.platform === "meta" ? "Meta" : "Google Ads"} · {a.external_id}</span>
              <span className={status(a.status)}>{a.status}</span>
              <span className="text-[12.5px] text-muted">{a.last_synced_at ? `Synced ${formatDateTime(a.last_synced_at, tz)}` : "Not synced yet"}</span>
              <Expiry at={a.token_expires_at} tz={tz} />
              {a.last_error && <span className="basis-full text-[12.5px] text-danger">{a.last_error}</span>}
              {a.status !== "disconnected" && <span className="ml-auto"><Disconnect kind="ad_account" id={a.id} /></span>}
            </li>
          ))}
        </ul>
        <div className="border-t border-line p-5">
          {!googleConfigured() && <p className="mb-3 text-[12.5px] text-muted">Google Ads spend needs GOOGLE_ADS_DEVELOPER_TOKEN and OAuth client credentials on the server.</p>}
          <AdAccountForm />
        </div>
      </Panel>

      <Panel className="mb-6 p-5">
        <h2 className="text-[15px] font-semibold">Website tracking</h2>
        <p className="mb-3 text-[13px] text-muted">
          Add this to every page of the website. It remembers UTM tags, gclid and fbclid for 90 days and adds them to forms,
          so leads sent through the lead API keep where they came from.
        </p>
        <code className="block rounded-[var(--radius-control)] bg-paper px-3 py-2 text-[12.5px] break-all select-all">{snippet}</code>
        <p className="mt-2 text-[12.5px] text-muted">
          Then include <code>window.scalerTouch()</code> in the JSON you post to <code>/api/v1/leads</code>, or read the hidden <code>scaler_*</code> fields it adds to forms. See docs/api.md.
        </p>
      </Panel>
    </>
  );
}
