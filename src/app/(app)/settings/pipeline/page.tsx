import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel, StatusBadge } from "@/components/ui/primitives";
import { listLostReasons, listSources, listStatuses, listTransitions } from "@/modules/leads/config";
import {
  makeDefaultStage,
  moveConfigItem,
  setLostReasonActive,
  setSourceActive,
  setStageActive,
} from "@/modules/pipeline/actions";
import { can, getContext } from "@/modules/tenancy/session";
import { ReasonForm, SourceForm, StageForm, TransitionsForm } from "./pipeline-forms";

export const metadata = { title: "Pipeline settings" };

const CATEGORY_LABEL = { open: "Open", won: "Won", lost: "Lost" } as const;

function Arrows({ list, id, first, last }: { list: string; id: string; first: boolean; last: boolean }) {
  const btn = "grid size-8 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-paper hover:text-text disabled:opacity-30";
  return (
    <div className="flex">
      {(["up", "down"] as const).map((direction) => (
        <ActionForm key={direction} action={moveConfigItem}>
          <input type="hidden" name="list" value={list} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="direction" value={direction} />
          <button
            type="submit"
            className={btn}
            disabled={direction === "up" ? first : last}
            aria-label={direction === "up" ? "Move up" : "Move down"}
          >
            {direction === "up" ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </ActionForm>
      ))}
    </div>
  );
}

function Toggle({
  action,
  field,
  id,
  active,
}: {
  action: Parameters<typeof ActionForm>[0]["action"];
  field: string;
  id: string;
  active: boolean;
}) {
  return (
    <ActionForm action={action}>
      <input type="hidden" name={field} value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <SubmitButton variant="ghost">{active ? "Hide" : "Show"}</SubmitButton>
    </ActionForm>
  );
}

export default async function PipelineSettingsPage() {
  const ctx = await getContext();
  if (!can(ctx, "settings.pipeline.manage")) return <NoAccess what="pipeline settings" />;
  const businessId = ctx.business.businessId;
  const [statuses, transitions, reasons, sources] = await Promise.all([
    listStatuses(businessId),
    listTransitions(businessId),
    listLostReasons(businessId),
    listSources(businessId),
  ]);
  const name = new Map(statuses.map((s) => [s.id, s.name]));

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Settings
      </Link>
      <PageHeader
        title="Pipeline"
        description="The stages a lead moves through, the rules between them, why leads are lost, and where they come from. Changes are audited."
      />

      <Panel className="mb-6">
        <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Stages</h2>
        <ol className="divide-y divide-line">
          {statuses.map((s, i) => {
            const rule = transitions[s.id] ?? [];
            return (
              <li key={s.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Arrows list="statuses" id={s.id} first={i === 0} last={i === statuses.length - 1} />
                  <div className="min-w-[180px] flex-1">
                    <StatusBadge stage={s.stage} name={s.name} />
                    <p className="mt-1 text-[12.5px] text-muted">
                      {CATEGORY_LABEL[s.category]}
                      {s.isDefault && " · new leads start here"}
                      {s.requiresOwner && " · needs an owner"}
                      {rule.length > 0 && ` · next: ${rule.map((id) => name.get(id)).filter(Boolean).join(", ")}`}
                      {!s.isActive && " · hidden"}
                    </p>
                  </div>
                  {!s.isDefault && s.isActive && s.category === "open" && (
                    <ActionForm action={makeDefaultStage}>
                      <input type="hidden" name="stageId" value={s.id} />
                      <SubmitButton variant="ghost">Make default</SubmitButton>
                    </ActionForm>
                  )}
                  {!s.isDefault && <Toggle action={setStageActive} field="stageId" id={s.id} active={s.isActive} />}
                </div>
                <details className="mt-2 pl-[72px]">
                  <summary className="cursor-pointer text-[13px] font-medium text-signal select-none">Edit stage and rules</summary>
                  <div className="mt-3 flex flex-col gap-5 rounded-[var(--radius-control)] border border-line p-4">
                    <StageForm stage={s} />
                    <div className="border-t border-line pt-4">
                      <TransitionsForm
                        stageId={s.id}
                        allowed={rule}
                        others={statuses.filter((o) => o.id !== s.id && o.isActive).map((o) => ({ value: o.id, label: o.name }))}
                      />
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
        <div className="border-t border-line p-5">
          <h3 className="mb-3 text-[14px] font-semibold">Add a stage</h3>
          <StageForm />
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel>
          <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">
            Lost reasons
            <span className="block text-[13px] font-normal text-muted">Asked for whenever a lead moves to a lost stage.</span>
          </h2>
          <ul className="divide-y divide-line">
            {reasons.map((r, i) => (
              <li key={r.id} className="flex items-start gap-2 px-5 py-3">
                <Arrows list="lost_reasons" id={r.id} first={i === 0} last={i === reasons.length - 1} />
                <div className={`flex-1 ${r.isActive ? "" : "opacity-60"}`}>
                  <ReasonForm reason={r} />
                </div>
                <div className="pt-6">
                  <Toggle action={setLostReasonActive} field="reasonId" id={r.id} active={r.isActive} />
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-5">
            <ReasonForm />
          </div>
        </Panel>

        <Panel>
          <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">
            Lead sources
            <span className="block text-[13px] font-normal text-muted">The key is what the lead API and integrations send.</span>
          </h2>
          <ul className="divide-y divide-line">
            {sources.map((s, i) => (
              <li key={s.id} className="flex items-start gap-2 px-5 py-3">
                <Arrows list="sources" id={s.id} first={i === 0} last={i === sources.length - 1} />
                <div className={`min-w-0 flex-1 ${s.isActive ? "" : "opacity-60"}`}>
                  <SourceForm source={s} />
                  <p className="mt-1 text-[12px] text-muted">
                    Key: <code>{s.key}</code>
                  </p>
                </div>
                <div className="pt-6">
                  <Toggle action={setSourceActive} field="sourceId" id={s.id} active={s.isActive} />
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-5">
            <SourceForm />
          </div>
        </Panel>
      </div>
    </>
  );
}
