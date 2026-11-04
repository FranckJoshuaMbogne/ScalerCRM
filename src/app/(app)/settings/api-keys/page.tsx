import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { siteOrigin } from "@/lib/origin";
import { revokeApiKey } from "@/modules/api/actions";
import { listApiKeys } from "@/modules/api/queries";
import { listSources } from "@/modules/leads/config";
import { can, getContext } from "@/modules/tenancy/session";
import { CreateKeyForm } from "./key-form";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const ctx = await getContext();
  if (!can(ctx, "integrations.manage")) return <NoAccess what="API keys" />;
  const [keys, sources, origin] = await Promise.all([
    listApiKeys(ctx.business.businessId),
    listSources(ctx.business.businessId),
    siteOrigin(),
  ]);
  const tz = ctx.business.timezone;
  const example = `curl -X POST ${origin}/api/v1/leads \\
  -H "Authorization: Bearer <your key>" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: <unique id per form submission>" \\
  -d '{"name":"Ravi Kumar","phone":"98490 12345","interest":"Wedding sherwani",
       "utm_source":"google","utm_campaign":"diwali"}'`;

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Settings
      </Link>
      <PageHeader
        title="API keys"
        description="Let your website send enquiries straight into SCALER. Keep keys on your server; never put them in browser code."
      />

      <Panel className="mb-6 p-5">
        <h2 className="mb-4 text-[15px] font-semibold">Create a key</h2>
        <CreateKeyForm />
      </Panel>

      <Panel className="mb-6">
        <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Keys</h2>
        {keys.length === 0 ? (
          <EmptyState title="No keys yet" />
        ) : (
          <ul className="divide-y divide-line">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-[13.5px]">
                <p className="min-w-[140px] flex-1 font-medium">{k.name}</p>
                <code className="text-[12.5px] text-muted">{k.prefix}…</code>
                <p className="text-[12.5px] text-muted">
                  {k.lastUsedAt ? `Last used ${formatDateTime(k.lastUsedAt, tz)}` : "Never used"}
                </p>
                {k.revokedAt ? (
                  <span className="text-[12.5px] text-muted">Revoked {formatDateTime(k.revokedAt, tz)}</span>
                ) : (
                  <ActionForm action={revokeApiKey}>
                    <input type="hidden" name="keyId" value={k.id} />
                    <SubmitButton variant="ghost">Revoke</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="p-5 text-[13.5px]">
        <h2 className="mb-2 text-[15px] font-semibold">Sending leads</h2>
        <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-paper p-3 text-[12.5px] leading-relaxed">{example}</pre>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
          <li>Send <code>phone</code> or <code>email</code>. Numbers without a country code are read as {ctx.business.countryCode}.</li>
          <li>
            Optional <code>source</code> (default <code>website</code>):{" "}
            {sources.map((s) => (
              <code key={s.id} className="mr-1">
                {s.key}
              </code>
            ))}
          </li>
          <li>
            Attribution fields kept on the lead: <code>campaign</code>, <code>utm_*</code>, <code>gclid</code>, <code>fbclid</code>,{" "}
            <code>campaign_id</code>, <code>adset_id</code>, <code>ad_id</code>, <code>form_id</code>, <code>page_url</code>, <code>referrer</code>.
          </li>
          <li>A repeat enquiry from a customer with an open lead is added to that lead&apos;s timeline instead of creating a new one.</li>
          <li>Retrying with the same <code>Idempotency-Key</code> returns the first result and never creates a duplicate.</li>
        </ul>
      </Panel>
    </>
  );
}
