import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { createWorkflow, deleteAutomation, rollbackWorkflow } from "@/modules/automation/actions";
import { TRIGGERS } from "@/modules/automation/definitions";
import { getWorkflow, workflowStats } from "@/modules/automation/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { builderOptions } from "../data";
import { WorkflowEditor } from "./workflow-editor";

export const metadata = { title: "Automation" };

export default async function AutomationEditPage({ params }: PageProps<"/automation/[id]">) {
  const ctx = await getContext();
  if (!can(ctx, "automation.manage")) return <NoAccess what="automation" />;
  const { id } = await params;

  if (id === "new") {
    return (
      <>
        <Link href="/automation" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Automation</Link>
        <PageHeader title="New workflow" description="Choose what starts it. You build the rest on the canvas." />
        <Panel className="max-w-xl p-5">
          <ActionForm action={createWorkflow} className="flex flex-col gap-3">
            <Field label="Name" name="name" required maxLength={120} placeholder="No-show follow-up" />
            <SelectField label="Starts when" name="trigger" options={Object.entries(TRIGGERS).map(([value, label]) => ({ value, label }))} />
            <div><SubmitButton>Open the canvas</SubmitButton></div>
          </ActionForm>
        </Panel>
      </>
    );
  }

  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const workflow = await getWorkflow(ctx.business.businessId, id);
  if (!workflow) notFound();
  const [options, stats] = await Promise.all([builderOptions(ctx.business.businessId), workflowStats(id)]);
  const graph = workflow.draftGraph ?? workflow.graph;
  if (!graph) notFound();
  const tz = ctx.business.timezone;
  const person = new Map(options.people.map((p) => [p.value, p.label]));

  return (
    <>
      <Link href="/automation" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Automation</Link>
      <PageHeader
        title={workflow.name}
        description={
          workflow.version
            ? `Version ${workflow.version} is ${workflow.isActive ? "on" : "off"}${workflow.hasDraft ? "; you have unpublished changes" : ""}. ${stats.runs} run${stats.runs === 1 ? "" : "s"} on this version${stats.failedRuns ? `, ${stats.failedRuns} failed` : ""}.`
            : "Not published yet. Publish it, then switch it on from the automation list."
        }
      />
      <WorkflowEditor
        automationId={workflow.id}
        initialName={workflow.name}
        initialGraph={graph}
        publishedGraph={workflow.graph}
        options={options}
        stats={stats.nodes}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Panel>
          <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">
            Versions
            <span className="block text-[12.5px] font-normal text-muted">Runs finish on the version they started on. Rolling back publishes an older version again.</span>
          </h2>
          {workflow.versions.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted">Nothing published yet.</p>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {workflow.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
                  <span className="w-20 font-medium">Version {v.version}</span>
                  <span className="min-w-0 flex-1 text-muted">
                    {v.note ?? "No note"} · {formatDateTime(v.createdAt, tz)}
                    {v.createdBy && person.get(v.createdBy) ? ` · ${person.get(v.createdBy)}` : ""}
                  </span>
                  {v.id === workflow.currentVersionId ? (
                    <span className="text-[12px] font-medium text-signal">Live</span>
                  ) : (
                    <ActionForm action={rollbackWorkflow}>
                      <input type="hidden" name="id" value={workflow.id} />
                      <input type="hidden" name="versionId" value={v.id} />
                      <SubmitButton variant="ghost">Roll back to this</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {!workflow.presetKey && (
          <Panel className="p-5 text-[13px]">
            <h2 className="mb-2 text-[15px] font-semibold">Delete</h2>
            <p className="mb-3 text-muted">Deletes the workflow, its versions and its run history.</p>
            <ActionForm action={deleteAutomation}>
              <input type="hidden" name="id" value={workflow.id} />
              <SubmitButton variant="danger">Delete workflow</SubmitButton>
            </ActionForm>
          </Panel>
        )}
      </div>
    </>
  );
}
