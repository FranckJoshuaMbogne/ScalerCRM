import Link from "next/link";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { can, getContext } from "@/modules/tenancy/session";
import { CampaignForm } from "../campaign-forms";
import { builderOptions } from "../data";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.manage")) return <NoAccess what="creating campaigns" />;
  const options = await builderOptions(ctx.business.businessId);
  return (
    <>
      <Link href="/campaigns" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Campaigns</Link>
      <PageHeader title="New campaign" description="Saved as a draft. Send yourself a test, then launch or schedule it." />
      <Panel className="max-w-4xl p-5">
        {options.accounts.length === 0 ? (
          <p className="text-[14px] text-muted">Connect a WhatsApp number under <Link href="/integrations" className="text-signal underline">Integrations</Link> first.</p>
        ) : (
          <CampaignForm {...options} />
        )}
      </Panel>
    </>
  );
}
