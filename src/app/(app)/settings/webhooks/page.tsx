import Link from "next/link";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { listWebhookEndpoints } from "@/modules/webhooks/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { CreateEndpointForm } from "./forms";

export const metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const ctx = await getContext();
  if (!can(ctx, "integrations.manage")) return <NoAccess what="webhooks" />;
  const endpoints = await listWebhookEndpoints(ctx.business.businessId);
  const tz = ctx.business.timezone;

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Settings
      </Link>
      <PageHeader
        title="Webhooks"
        description="SCALER tells your other systems when leads and orders change, by sending a signed POST to your URL."
      />

      <Panel className="mb-6">
        <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Endpoints</h2>
        {endpoints.length === 0 ? (
          <EmptyState title="No endpoints yet">Add one below to start receiving events.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {endpoints.map((e) => (
              <li key={e.id}>
                <Link href={`/settings/webhooks/${e.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-[13.5px] hover:bg-paper">
                  <span className="min-w-[200px] flex-1">
                    <span className="block truncate font-medium">{e.url}</span>
                    {e.description && <span className="block text-[12.5px] text-muted">{e.description}</span>}
                  </span>
                  <span className="text-[12.5px] text-muted">{e.events.length} event{e.events.length === 1 ? "" : "s"}</span>
                  <span className={e.isActive ? "text-[12.5px] text-muted" : "text-[12.5px] text-danger"}>
                    {e.isActive
                      ? e.lastSuccessAt
                        ? `Last delivered ${formatDateTime(e.lastSuccessAt, tz)}`
                        : "Nothing delivered yet"
                      : "Off"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="mb-6 p-5">
        <h2 className="mb-4 text-[15px] font-semibold">Add an endpoint</h2>
        <CreateEndpointForm />
      </Panel>

      <Panel className="p-5 text-[13.5px] text-muted">
        <h2 className="mb-2 text-[15px] font-semibold text-ink">How delivery works</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Each event is a JSON POST with a <code>Scaler-Signature</code> header. Check it with your signing secret before trusting the body.</li>
          <li>Answer with any 2xx status within 10 seconds. Anything else is retried with growing gaps for 24 hours.</li>
          <li>After 20 failures in a row the endpoint is switched off and admins get an email. Replay missed events from the delivery log.</li>
          <li>
            Payloads and sample verification code are in the{" "}
            <Link href="/developers#webhooks" className="text-signal hover:underline">
              API reference
            </Link>
            .
          </li>
        </ul>
      </Panel>
    </>
  );
}
