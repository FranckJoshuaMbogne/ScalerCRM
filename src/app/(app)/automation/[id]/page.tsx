import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { deleteAutomation } from "@/modules/automation/actions";
import { listAutomations } from "@/modules/automation/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { AutomationBuilder } from "../builder";
import { builderOptions } from "../data";

export const metadata = { title: "Automation" };

export default async function AutomationEditPage({ params }: PageProps<"/automation/[id]">) {
  const ctx = await getContext();
  if (!can(ctx, "automation.manage")) return <NoAccess what="automation" />;
  const { id } = await params;
  const options = await builderOptions(ctx.business.businessId);
  const automation = id === "new" ? null : (await listAutomations(ctx.business.businessId)).find((a) => a.id === id);
  if (id !== "new" && !automation) notFound();
  return (
    <>
      <Link href="/automation" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Automation</Link>
      <PageHeader title={automation?.name ?? "New automation"} description={automation?.description ?? "Choose what starts it, any conditions, and the steps to take."} />
      <Panel className="max-w-4xl p-5">
        <AutomationBuilder
          automation={automation ? { ...automation, preset: Boolean(automation.presetKey) } : undefined}
          {...options}
        />
      </Panel>
      {automation && !automation.presetKey && (
        <ActionForm action={deleteAutomation} className="mt-4">
          <input type="hidden" name="id" value={automation.id} />
          <SubmitButton variant="danger">Delete automation</SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
