import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { hoursSince, listActivation, listWhatsappReviews } from "@/modules/onboarding/platform";
import { reviewWhatsapp } from "@/modules/onboarding/platform-actions";
import { requirePlatformAdmin } from "@/modules/plans/platform";

export const metadata = { title: "Signups" };
export const maxDuration = 30;

function Hours({ from, to }: { from: string; to: string | null }) {
  const h = hoursSince(from, to);
  if (h === null) return <span className="text-muted">—</span>;
  return <span>{h < 48 ? `${h} h` : `${Math.round(h / 24)} d`}</span>;
}

export default async function PlatformOnboardingPage() {
  await requirePlatformAdmin();
  const [rows, reviews] = await Promise.all([listActivation(90), listWhatsappReviews()]);
  const tz = "Asia/Kolkata";
  const reached = (k: "firstLeadAt" | "firstReplyAt" | "firstOrderAt") => rows.filter((r) => r[k]).length;

  return (
    <>
      <PageHeader title="Signups" description="New businesses in the last 90 days, how fast they got going, and WhatsApp numbers waiting for review." />

      <Panel className="mb-6 p-5">
        <h2 className="mb-1 text-[15px] font-semibold">WhatsApp numbers to review ({reviews.length})</h2>
        <p className="mb-4 text-[13.5px] text-muted">
          Numbers connected during a trial can reply to customers but can&apos;t send templates or campaigns until approved. Paying approves them
          automatically.
        </p>
        {reviews.length === 0 ? (
          <p className="text-[13.5px] text-muted">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-line">
            {reviews.map((r) => (
              <li key={r.accountId} className="flex flex-wrap items-end gap-3 py-3 text-[13.5px]">
                <div className="min-w-[240px] flex-1">
                  <Link href={`/platform/${r.businessId}`} className="font-medium text-signal hover:underline">
                    {r.businessName}
                  </Link>
                  <p>
                    {r.verifiedName ?? "Unnamed number"} · {r.displayPhone ?? "number pending"}
                  </p>
                  <p className="text-muted">
                    {r.adminEmail ?? "—"} · {r.leads} leads · connected {formatDateTime(r.connectedAt, tz)}
                  </p>
                </div>
                <ActionForm action={reviewWhatsapp} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="accountId" value={r.accountId} />
                  <input
                    name="note"
                    placeholder="Note (needed to reject)"
                    maxLength={300}
                    className="h-9 w-56 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13.5px]"
                  />
                  <SubmitButton name="decision" value="approve" className="h-9" pendingLabel="…">
                    Approve
                  </SubmitButton>
                  <SubmitButton name="decision" value="reject" variant="danger" className="h-9" pendingLabel="…">
                    Reject
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Activation ({rows.length} signups)</h2>
          <p className="text-[13px] text-muted">
            First lead {reached("firstLeadAt")} · first WhatsApp reply {reached("firstReplyAt")} · first order {reached("firstOrderAt")}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px] tabular-nums">
            <thead className="text-left text-[12.5px] text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Business</th>
                <th className="px-3 py-2.5 font-medium">Signed up</th>
                <th className="px-3 py-2.5 font-medium">Industry</th>
                <th className="px-3 py-2.5 font-medium">Setup</th>
                <th className="px-3 py-2.5 font-medium">First lead</th>
                <th className="px-3 py-2.5 font-medium">First reply</th>
                <th className="px-3 py-2.5 font-medium">First order</th>
                <th className="px-3 py-2.5 font-medium">Billing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.businessId}>
                  <td className="px-5 py-2.5">
                    <Link href={`/platform/${r.businessId}`} className="text-signal hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">{formatDateTime(r.createdAt, tz)}</td>
                  <td className="px-3 py-2.5">{r.templateKey ?? "—"}</td>
                  <td className="px-3 py-2.5"><Hours from={r.createdAt} to={r.setupCompletedAt} /></td>
                  <td className="px-3 py-2.5"><Hours from={r.createdAt} to={r.firstLeadAt} /></td>
                  <td className="px-3 py-2.5"><Hours from={r.createdAt} to={r.firstReplyAt} /></td>
                  <td className="px-3 py-2.5"><Hours from={r.createdAt} to={r.firstOrderAt} /></td>
                  <td className="px-3 py-2.5">{r.billingStatus ?? r.planKey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
