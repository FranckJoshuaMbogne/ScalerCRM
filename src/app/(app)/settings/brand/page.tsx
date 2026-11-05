import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import {
  addDomain,
  checkDomain,
  checkSenderDomain,
  removeBrandImage,
  removeDomain,
  removeSenderDomain,
  setSenderDomain,
  uploadBrandImage,
} from "@/modules/branding/actions";
import { getBrandSettings } from "@/modules/branding/queries";
import type { DnsRecord } from "@/modules/branding/providers";
import { can, getContext } from "@/modules/tenancy/session";
import { BrandForm } from "./brand-form";

export const metadata = { title: "Brand" };

function Records({ records }: { records: DnsRecord[] }) {
  if (!records.length) return null;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-muted"><tr><th className="py-1 pr-3 font-medium">Type</th><th className="py-1 pr-3 font-medium">Name</th><th className="py-1 font-medium">Value</th></tr></thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} className="align-top">
              <td className="py-1 pr-3 font-mono">{r.type}</td>
              <td className="py-1 pr-3 font-mono break-all">{r.name}</td>
              <td className="py-1 font-mono break-all">{r.value}{r.status ? <span className="ml-2 text-muted">({r.status})</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS: Record<string, string> = { pending: "Waiting for DNS", active: "Live", failed: "Failed", verified: "Verified" };

export default async function BrandPage() {
  const ctx = await getContext();
  if (!can(ctx, "branding.manage")) return <NoAccess what="the brand" />;
  const s = await getBrandSettings(ctx.business.businessId);
  const tz = ctx.business.timezone;
  const assetQuery = `b=${ctx.business.businessId}`;

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Settings</Link>
      <PageHeader title="Brand" description="Your name, logo and colours in SCALER, on your own domain and in emails." />

      <Panel className="mb-6 p-5">
        <h2 className="mb-4 text-[15px] font-semibold">Name and colours</h2>
        <BrandForm brand={s.brand} defaultName={ctx.business.businessName} whiteLabel={s.whiteLabel} />
      </Panel>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {(["logo", "icon"] as const).map((kind) => (
          <Panel key={kind} className="p-5">
            <h2 className="text-[15px] font-semibold">{kind === "logo" ? "Logo" : "App icon"}</h2>
            <p className="mb-3 text-[13px] text-muted">
              {kind === "logo" ? "Shown in the sidebar and on your sign-in page. PNG or WebP, under 512 KB." : "The home-screen icon when the app is installed from your domain. A square PNG, 512 × 512."}
            </p>
            {s.assets[kind] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/brand/${kind}?${assetQuery}&v=${s.assets[kind]!.slice(0, 12)}`} alt="" className="mb-3 h-16 w-auto rounded border border-line bg-paper object-contain p-1" />
            )}
            <ActionForm action={uploadBrandImage} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="kind" value={kind} />
              <input type="file" name="file" accept="image/png,image/webp" required className="text-[13px]" />
              <SubmitButton variant="secondary">Upload</SubmitButton>
            </ActionForm>
            {s.assets[kind] && (
              <ActionForm action={removeBrandImage} className="mt-2">
                <input type="hidden" name="kind" value={kind} />
                <SubmitButton variant="ghost">Remove</SubmitButton>
              </ActionForm>
            )}
          </Panel>
        ))}
      </div>

      <Panel className="mb-6 p-5">
        <h2 className="text-[15px] font-semibold">Your own domain</h2>
        <p className="mb-3 text-[13px] text-muted">
          Run SCALER on an address like crm.yourbrand.in, with HTTPS. Only your team can sign in there, and it installs as your app.
          {!s.whiteLabel && " Comes with the Scale plan and above."}
        </p>
        <ul className="mb-4 divide-y divide-line">
          {s.domains.map((d) => (
            <li key={d.id} className="py-3 text-[13.5px]">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium">{d.hostname}</span>
                <span className={d.status === "active" ? "text-stage-won" : d.status === "failed" ? "text-danger" : "text-muted"}>{STATUS[d.status] ?? d.status}</span>
                {d.last_checked_at && <span className="text-[12px] text-muted">checked {formatDateTime(d.last_checked_at, tz)}</span>}
                <div className="ml-auto flex gap-2">
                  {d.status !== "active" && (
                    <ActionForm action={checkDomain}><input type="hidden" name="id" value={d.id} /><SubmitButton variant="secondary">Check now</SubmitButton></ActionForm>
                  )}
                  <ActionForm action={removeDomain}><input type="hidden" name="id" value={d.id} /><SubmitButton variant="ghost">Remove</SubmitButton></ActionForm>
                </div>
              </div>
              {d.error && <p className="mt-1 text-[12.5px] text-danger">{d.error}</p>}
              {d.status !== "active" && (
                <>
                  <p className="mt-2 text-[12.5px] text-muted">Add this at your domain provider (GoDaddy, Hostinger, Cloudflare…). We check every few minutes.</p>
                  <Records records={d.instructions} />
                </>
              )}
            </li>
          ))}
        </ul>
        {s.whiteLabel && s.domains.length < 2 && (
          <ActionForm action={addDomain} className="flex flex-wrap items-end gap-2">
            <Field label="Domain" name="hostname" placeholder="crm.yourbrand.in" required className="min-w-[240px]" />
            <SubmitButton>Add domain</SubmitButton>
          </ActionForm>
        )}
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[15px] font-semibold">Email sender</h2>
        <p className="mb-3 text-[13px] text-muted">
          Reminders and reports go from SCALER&apos;s address with your app name. Verify your own domain to send from it instead.
          {!s.whiteLabel && " Comes with the Scale plan and above."}
        </p>
        {s.email ? (
          <div className="text-[13.5px]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-medium">{s.email.from_local}@{s.email.domain}</span>
              <span className={s.email.status === "verified" ? "text-stage-won" : s.email.status === "failed" ? "text-danger" : "text-muted"}>{STATUS[s.email.status] ?? s.email.status}</span>
              <div className="ml-auto flex gap-2">
                {s.email.status !== "verified" && <ActionForm action={checkSenderDomain}><SubmitButton variant="secondary">Check now</SubmitButton></ActionForm>}
                <ActionForm action={removeSenderDomain}><SubmitButton variant="ghost">Remove</SubmitButton></ActionForm>
              </div>
            </div>
            {s.email.error && <p className="mt-1 text-[12.5px] text-danger">{s.email.error}</p>}
            {s.email.status !== "verified" && <Records records={s.email.records} />}
          </div>
        ) : (
          s.whiteLabel && (
            <ActionForm action={setSenderDomain} className="flex flex-wrap items-end gap-2">
              <Field label="Send as" name="fromLocal" defaultValue="hello" className="w-32" />
              <Field label="@ domain" name="domain" placeholder="yourbrand.in" required className="min-w-[200px]" />
              <SubmitButton>Set up</SubmitButton>
            </ActionForm>
          )
        )}
      </Panel>
    </>
  );
}
