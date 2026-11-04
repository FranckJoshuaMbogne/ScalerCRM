import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { deleteWebhookEndpoint, replayDelivery, sendWebhookTest, setWebhookActive } from "@/modules/webhooks/actions";
import { getWebhookEndpoint, listDeliveries } from "@/modules/webhooks/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { EventsForm, RotateSecretForm } from "../forms";

export const metadata = { title: "Webhook endpoint" };

const STATUS_LABEL = {
  pending: "Waiting to retry",
  sending: "Sending",
  succeeded: "Delivered",
  failed: "Gave up",
  cancelled: "Cancelled",
} as const;

export default async function WebhookEndpointPage({ params }: PageProps<"/settings/webhooks/[id]">) {
  const { id } = await params;
  const ctx = await getContext();
  if (!can(ctx, "integrations.manage")) return <NoAccess what="webhooks" />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const endpoint = await getWebhookEndpoint(ctx.business.businessId, id);
  if (!endpoint) notFound();
  const deliveries = await listDeliveries(ctx.business.businessId, id);
  const tz = ctx.business.timezone;

  return (
    <>
      <Link href="/settings/webhooks" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Webhooks
      </Link>
      <PageHeader title={endpoint.url} description={endpoint.description ?? undefined} />

      <Panel className="mb-6 p-5 text-[13.5px]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p>
            {endpoint.isActive ? (
              <span className="font-medium">On</span>
            ) : (
              <span className="font-medium text-danger">Off{endpoint.disabledReason ? `: ${endpoint.disabledReason}` : ""}</span>
            )}
          </p>
          <p className="text-muted">
            Secret <code>{endpoint.secretPrefix}…</code>
          </p>
          {endpoint.consecutiveFailures > 0 && (
            <p className="text-muted">{endpoint.consecutiveFailures} failed in a row</p>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {endpoint.isActive && (
              <ActionForm action={sendWebhookTest}>
                <input type="hidden" name="endpointId" value={endpoint.id} />
                <SubmitButton variant="secondary">Send a test event</SubmitButton>
              </ActionForm>
            )}
            <ActionForm action={setWebhookActive}>
              <input type="hidden" name="endpointId" value={endpoint.id} />
              <input type="hidden" name="active" value={endpoint.isActive ? "false" : "true"} />
              <SubmitButton variant={endpoint.isActive ? "ghost" : "primary"}>{endpoint.isActive ? "Turn off" : "Turn on"}</SubmitButton>
            </ActionForm>
          </div>
        </div>
      </Panel>

      <Panel className="mb-6">
        <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Delivery log</h2>
        {deliveries.length === 0 ? (
          <EmptyState title="Nothing sent yet">Events appear here once something happens, or send a test event.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[12px] text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Attempts</th>
                  <th className="px-3 py-2 font-medium">Answer</th>
                  <th className="px-3 py-2 font-medium">Queued</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {deliveries.map((d) => (
                  <tr key={d.id} className="align-top">
                    <td className="px-5 py-2.5">
                      <code>{d.eventType}</code>
                      <span className="block text-[12px] text-muted">
                        evt_{d.eventId}
                        {d.replayOf ? ` · replay of whd_${d.replayOf}` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={d.status === "failed" ? "text-danger" : undefined}>{STATUS_LABEL[d.status]}</span>
                      {d.status === "pending" && d.attempts > 0 && (
                        <span className="block text-[12px] text-muted">next {formatDateTime(d.nextAttemptAt, tz)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{d.attempts}</td>
                    <td className="max-w-[280px] px-3 py-2.5">
                      {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : ""}
                      {d.durationMs !== null ? <span className="text-muted"> · {d.durationMs} ms</span> : null}
                      {d.lastError && <span className="block break-words text-[12px] text-muted">{d.lastError}</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted">{formatDateTime(d.createdAt, tz)}</td>
                    <td className="px-5 py-2.5 text-right">
                      {endpoint.isActive && d.status !== "pending" && d.status !== "sending" && (
                        <ActionForm action={replayDelivery}>
                          <input type="hidden" name="deliveryId" value={d.id} />
                          <SubmitButton variant="ghost">Replay</SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Events</h2>
          <EventsForm endpointId={endpoint.id} selected={endpoint.events} />
        </Panel>
        <Panel className="p-5 text-[13.5px]">
          <h2 className="mb-2 text-[15px] font-semibold">Signing secret</h2>
          <p className="mb-3 text-muted">
            A new secret takes effect at once. Update your receiver first, or accept both secrets while you switch.
          </p>
          <RotateSecretForm endpointId={endpoint.id} />
          <h2 className="mt-6 mb-2 text-[15px] font-semibold">Delete</h2>
          <p className="mb-3 text-muted">Deletes the endpoint and its delivery log.</p>
          <ActionForm action={deleteWebhookEndpoint}>
            <input type="hidden" name="endpointId" value={endpoint.id} />
            <SubmitButton variant="danger">Delete endpoint</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
