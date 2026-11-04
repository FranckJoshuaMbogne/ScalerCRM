"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { saveAutomation } from "@/modules/automation/actions";
import { ACTION_LABELS, type Action, type Condition, CONDITION_FIELDS, TRIGGERS } from "@/modules/automation/definitions";

type Option = { value: string; label: string };
const box = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]";

const blankAction = (type: Action["type"]): Action => {
  switch (type) {
    case "create_task": return { type, task_type: "follow_up", title: "", due_in_minutes: 60, assignee: "owner" };
    case "notify": return { type, to: "owner", title: "" };
    case "assign_to": return { type, user_id: "" };
    case "change_status": return { type, status_key: "" };
    case "add_tag": return { type, tag: "" };
    case "wait": return { type, minutes: 60 };
    case "send_whatsapp_template": return { type, template_id: "", variables: [] };
    default: return { type: "assign_round_robin" };
  }
};

export function AutomationBuilder({
  automation,
  statuses,
  stages,
  people,
  templates,
}: {
  automation?: { id: string; name: string; description: string | null; trigger: string; triggerConfig: Record<string, unknown>; conditions: Condition[]; actions: Action[]; preset: boolean };
  statuses: Option[];
  stages: Option[];
  people: Option[];
  templates: (Option & { variables: number })[];
}) {
  const [state, action] = useActionState(saveAutomation, initialState);
  const [trigger, setTrigger] = useState(automation?.trigger ?? "lead_created");
  const [conditions, setConditions] = useState<Condition[]>(automation?.conditions ?? []);
  const [actions, setActions] = useState<Action[]>(automation?.actions ?? [blankAction("create_task")]);
  const setA = (i: number, patch: Partial<Action>) => setActions((xs) => xs.map((x, j) => (j === i ? ({ ...x, ...patch } as Action) : x)));

  return (
    <form action={action} className="flex flex-col gap-5">
      {automation && <input type="hidden" name="automationId" value={automation.id} />}
      <input type="hidden" name="conditions" value={JSON.stringify(conditions)} />
      <input type="hidden" name="actions" value={JSON.stringify(actions)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" defaultValue={automation?.name} required maxLength={120} state={state} />
        <Field label="Description" name="description" defaultValue={automation?.description ?? ""} maxLength={500} state={state} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] font-semibold">When</legend>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} disabled={Boolean(automation)} aria-label="Trigger" className={box}>
            {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {automation && <input type="hidden" name="trigger" value={trigger} />}
          {trigger === "lead_idle" && (
            <label className="flex items-center gap-1.5">for <input name="idleDays" type="number" min={1} max={90} defaultValue={Number(automation?.triggerConfig.days ?? 3)} className={`${box} w-16`} /> days</label>
          )}
          {trigger === "lead_status_changed" && (
            <select name="statusKey" defaultValue={String(automation?.triggerConfig.status_key ?? "")} aria-label="Stage" className={box}>
              <option value="">any stage</option>
              {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
          {trigger === "order_stage_changed" && (
            <select name="stageKey" defaultValue={String(automation?.triggerConfig.stage_key ?? "")} aria-label="Order stage" className={box}>
              <option value="">any stage</option>
              {stages.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] font-semibold">Only if <span className="font-normal text-muted">(optional)</span></legend>
        {conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select value={c.field} onChange={(e) => setConditions((xs) => xs.map((x, j) => (j === i ? { ...x, field: e.target.value as Condition["field"] } : x)))} aria-label="Field" className={box}>
              {Object.entries(CONDITION_FIELDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={c.op} onChange={(e) => setConditions((xs) => xs.map((x, j) => (j === i ? { ...x, op: e.target.value as Condition["op"] } : x)))} aria-label="Comparison" className={box}>
              <option value="eq">is</option><option value="neq">is not</option><option value="gte">at least</option><option value="lte">at most</option>
              <option value="is_true">is yes</option><option value="is_false">is no</option>
            </select>
            {!["is_true", "is_false"].includes(c.op) && (
              <input value={c.value ?? ""} onChange={(e) => setConditions((xs) => xs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder={c.field.endsWith("_key") ? "key, e.g. walk_in" : "value"} aria-label="Value" className={`${box} w-44`} />
            )}
            <button type="button" onClick={() => setConditions((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove condition" className="text-muted hover:text-danger"><X className="size-4" /></button>
          </div>
        ))}
        <div><button type="button" onClick={() => setConditions((xs) => [...xs, { field: "source_key", op: "eq", value: "" }])} className="inline-flex items-center gap-1 text-[13px] text-signal"><Plus className="size-4" /> Add condition</button></div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] font-semibold">Then</legend>
        <ol className="flex flex-col gap-2">
          {actions.map((x, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-line p-2.5 text-[13px]">
              <span className="w-5 text-muted tabular-nums">{i + 1}</span>
              <select value={x.type} onChange={(e) => setActions((xs) => xs.map((y, j) => (j === i ? blankAction(e.target.value as Action["type"]) : y)))} aria-label="Action" className={box}>
                {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {x.type === "create_task" && (
                <>
                  <input value={x.title} onChange={(e) => setA(i, { title: e.target.value })} placeholder="Task title" className={`${box} w-48`} aria-label="Task title" />
                  <select value={x.task_type} onChange={(e) => setA(i, { task_type: e.target.value })} aria-label="Task type" className={box}>
                    {["follow_up", "call", "whatsapp", "visit", "meeting"].map((t) => <option key={t} value={t}>{t.replace("_", "-")}</option>)}
                  </select>
                  due in <input type="number" min={0} value={x.due_in_minutes} onChange={(e) => setA(i, { due_in_minutes: Number(e.target.value) })} className={`${box} w-20`} aria-label="Due in minutes" /> min, for
                  <select value={x.assignee} onChange={(e) => setA(i, { assignee: e.target.value })} aria-label="Assignee" className={box}>
                    <option value="owner">the lead owner</option>
                    {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </>
              )}
              {x.type === "notify" && (
                <>
                  <select value={x.to} onChange={(e) => setA(i, { to: e.target.value })} aria-label="Who" className={box}>
                    <option value="owner">the lead owner</option><option value="managers">managers</option>
                    {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <input value={x.title} onChange={(e) => setA(i, { title: e.target.value })} placeholder="Message" className={`${box} min-w-48 flex-1`} aria-label="Message" />
                </>
              )}
              {x.type === "assign_to" && (
                <select value={x.user_id} onChange={(e) => setA(i, { user_id: e.target.value })} aria-label="Person" className={box}>
                  <option value="">Choose…</option>
                  {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              )}
              {x.type === "change_status" && (
                <select value={x.status_key} onChange={(e) => setA(i, { status_key: e.target.value })} aria-label="Stage" className={box}>
                  <option value="">Choose…</option>
                  {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
              {x.type === "add_tag" && <input value={x.tag} onChange={(e) => setA(i, { tag: e.target.value })} placeholder="Tag" maxLength={40} className={`${box} w-40`} aria-label="Tag" />}
              {x.type === "wait" && (
                <><input type="number" min={1} value={x.minutes} onChange={(e) => setA(i, { minutes: Number(e.target.value) })} className={`${box} w-24`} aria-label="Minutes" /> minutes</>
              )}
              {x.type === "send_whatsapp_template" && (
                <select value={x.template_id} onChange={(e) => {
                  const t = templates.find((y) => y.value === e.target.value);
                  setA(i, { template_id: e.target.value, variables: Array.from({ length: t?.variables ?? 0 }, () => ({ source: "first_name" })) });
                }} aria-label="Template" className={box}>
                  <option value="">Choose an approved template…</option>
                  {templates.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              )}
              <button type="button" onClick={() => setActions((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove action" className="ml-auto text-muted hover:text-danger"><X className="size-4" /></button>
            </li>
          ))}
        </ol>
        <div><button type="button" onClick={() => setActions((xs) => [...xs, blankAction("notify")])} disabled={actions.length >= 10} className="inline-flex items-center gap-1 text-[13px] text-signal"><Plus className="size-4" /> Add action</button></div>
        <p className="text-[12.5px] text-muted">WhatsApp templates fill variables with the customer&apos;s first name, and marketing templates only go to customers who opted in.</p>
      </fieldset>

      <FormMessage state={state} />
      <div><SubmitButton pendingLabel="Saving…">{automation ? "Save automation" : "Create automation (switched off)"}</SubmitButton></div>
    </form>
  );
}
