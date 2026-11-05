"use client";

import { Plus, Trash2, X } from "lucide-react";
import {
  ACTION_LABELS,
  type Action,
  type Condition,
  CONDITION_FIELDS,
  type ConditionField,
  FIELD_KIND,
  OPS_FOR,
  TRIGGERS,
} from "@/modules/automation/definitions";
import { type GraphNode, KIND_LABELS } from "@/modules/automation/graph";
import type { BuilderOptions } from "../data";

const box = "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]";
const label = "mb-1 block text-[12.5px] font-medium";

type Option = { value: string; label: string };

function Select({ value, onChange, options, ariaLabel, blank }: { value: string; onChange: (v: string) => void; options: Option[]; ariaLabel: string; blank?: string }) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} className={box}>
      {blank !== undefined && <option value="">{blank}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={label}>{title}</span>
      {children}
    </div>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function blankAction(type: Action["type"]): Action {
  switch (type) {
    case "create_task": return { type, task_type: "follow_up", title: "Follow up", due_in_minutes: 60, assignee: "owner" };
    case "notify": return { type, to: "owner", title: "" };
    case "assign_to": return { type, user_id: "" };
    case "change_status": return { type, status_key: "" };
    case "add_tag": return { type, tag: "" };
    case "wait": return { type, minutes: 60 };
    case "send_whatsapp_template": return { type, template_id: "", variables: [] };
    case "send_email": return { type, to: "customer", subject: "", body: "" };
    case "set_custom_field": return { type, entity: "lead", key: "", value: "" };
    case "call_webhook": return { type, endpoint_id: "", label: "" };
    default: return { type: "assign_round_robin" };
  }
}

function valueOptions(field: ConditionField, o: BuilderOptions): Option[] | null {
  if (field === "status_key") return o.statuses;
  if (field === "stage_key") return o.stages;
  if (field === "source_key") return o.sources;
  if (field === "status_category") return [{ value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }];
  return null;
}

function ConditionsEditor({ node, onChange, options }: { node: GraphNode; onChange: (n: GraphNode) => void; options: BuilderOptions }) {
  const conditions = node.conditions ?? [];
  const set = (i: number, c: Condition) => onChange({ ...node, conditions: conditions.map((x, j) => (j === i ? c : x)) });
  return (
    <div className="flex flex-col gap-3">
      <Row title="Take the yes branch when">
        <Select
          ariaLabel="Match"
          value={node.match ?? "all"}
          onChange={(v) => onChange({ ...node, match: v as "all" | "any" })}
          options={[{ value: "all", label: "all of these are true" }, { value: "any", label: "any of these is true" }]}
        />
      </Row>
      {conditions.map((c, i) => {
        const kind = FIELD_KIND[c.field] ?? "key";
        const values = valueOptions(c.field, options);
        return (
          <div key={i} className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-line p-2">
            <div className="flex gap-1.5">
              <Select
                ariaLabel="Field"
                value={c.field}
                onChange={(v) => {
                  const f = v as ConditionField;
                  set(i, { field: f, op: OPS_FOR[FIELD_KIND[f]][0].value, value: "" });
                }}
                options={Object.entries(CONDITION_FIELDS).map(([value, l]) => ({ value, label: l }))}
              />
              <button type="button" aria-label="Remove check" onClick={() => onChange({ ...node, conditions: conditions.filter((_, j) => j !== i) })} className="px-1 text-muted hover:text-danger">
                <X className="size-4" />
              </button>
            </div>
            <Select ariaLabel="Comparison" value={c.op} onChange={(v) => set(i, { ...c, op: v as Condition["op"] })} options={OPS_FOR[kind]} />
            {kind !== "boolean" &&
              (values ? (
                <Select ariaLabel="Value" value={c.value ?? ""} onChange={(v) => set(i, { ...c, value: v })} options={values} blank="Choose…" />
              ) : (
                <input
                  aria-label="Value"
                  className={box}
                  type={kind === "number" ? "number" : "text"}
                  value={c.value ?? ""}
                  onChange={(e) => set(i, { ...c, value: e.target.value })}
                  placeholder={kind === "tags" ? "Tag name" : ""}
                />
              ))}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange({ ...node, conditions: [...conditions, { field: "has_owner", op: "is_true" }] })}
        className="inline-flex items-center gap-1 self-start text-[13px] text-signal hover:underline"
      >
        <Plus className="size-3.5" /> Add a check
      </button>
    </div>
  );
}

function ActionEditor({ action, onChange, options }: { action: Action; onChange: (a: Action) => void; options: BuilderOptions }) {
  const people = [{ value: "owner", label: "The lead's owner" }, ...options.people];
  return (
    <div className="flex flex-col gap-3">
      <Row title="Do this">
        <Select
          ariaLabel="Action"
          value={action.type}
          onChange={(v) => onChange(blankAction(v as Action["type"]))}
          options={Object.entries(ACTION_LABELS)
            .filter(([k]) => k !== "wait")
            .map(([value, l]) => ({ value, label: l }))}
        />
      </Row>
      {action.type === "create_task" && (
        <>
          <Row title="Task title">
            <input className={box} value={action.title} onChange={(e) => onChange({ ...action, title: e.target.value })} />
          </Row>
          <Row title="Type">
            <Select ariaLabel="Task type" value={action.task_type} onChange={(v) => onChange({ ...action, task_type: v })}
              options={["follow_up", "call", "whatsapp", "visit", "meeting", "email", "other"].map((t) => ({ value: t, label: t.replace("_", "-") }))} />
          </Row>
          <Row title="Due in (minutes)">
            <input className={box} type="number" min={0} value={action.due_in_minutes} onChange={(e) => onChange({ ...action, due_in_minutes: Number(e.target.value) })} />
          </Row>
          <Row title="For">
            <Select ariaLabel="Assignee" value={action.assignee} onChange={(v) => onChange({ ...action, assignee: v })} options={people} />
          </Row>
        </>
      )}
      {action.type === "notify" && (
        <>
          <Row title="Message">
            <input className={box} value={action.title} onChange={(e) => onChange({ ...action, title: e.target.value })} />
          </Row>
          <Row title="To">
            <Select ariaLabel="Notify" value={action.to} onChange={(v) => onChange({ ...action, to: v })}
              options={[{ value: "owner", label: "The lead's owner" }, { value: "managers", label: "Managers" }, ...options.people]} />
          </Row>
        </>
      )}
      {action.type === "assign_to" && (
        <Row title="Give the lead to">
          <Select ariaLabel="Person" value={action.user_id} onChange={(v) => onChange({ ...action, user_id: v })} options={options.people} blank="Choose…" />
        </Row>
      )}
      {action.type === "change_status" && (
        <Row title="Move the lead to">
          <Select ariaLabel="Stage" value={action.status_key} onChange={(v) => onChange({ ...action, status_key: v })} options={options.statuses} blank="Choose…" />
        </Row>
      )}
      {action.type === "add_tag" && (
        <Row title="Tag">
          <input className={box} value={action.tag} onChange={(e) => onChange({ ...action, tag: e.target.value })} />
        </Row>
      )}
      {action.type === "send_whatsapp_template" && (
        <Row title="Approved template">
          <Select ariaLabel="Template" value={action.template_id} onChange={(v) => onChange({ ...action, template_id: v })} options={options.templates} blank={options.templates.length ? "Choose…" : "No approved templates yet"} />
        </Row>
      )}
      {action.type === "send_email" && (
        <>
          <Row title="To">
            <Select ariaLabel="Email to" value={action.to} onChange={(v) => onChange({ ...action, to: v as "customer" | "owner" })}
              options={[{ value: "customer", label: "The customer" }, { value: "owner", label: "The lead's owner" }]} />
          </Row>
          <Row title="Subject">
            <input className={box} value={action.subject} onChange={(e) => onChange({ ...action, subject: e.target.value })} />
          </Row>
          <Row title="Message">
            <textarea className="min-h-[110px] w-full rounded-[var(--radius-control)] border border-line bg-surface p-2 text-[13px]" value={action.body} onChange={(e) => onChange({ ...action, body: e.target.value })} />
          </Row>
          <p className="text-[12px] text-muted">
            Use <code>{"{{customer_name}}"}</code>, <code>{"{{business_name}}"}</code>, <code>{"{{lead_number}}"}</code>, <code>{"{{owner_name}}"}</code>. Each email counts as a message on your plan.
          </p>
        </>
      )}
      {action.type === "set_custom_field" && (
        <>
          <Row title="Field">
            <Select
              ariaLabel="Custom field"
              value={action.key ? `${action.entity}:${action.key}` : ""}
              onChange={(v) => {
                const [entity, key] = v.split(":");
                onChange({ ...action, entity: entity as "lead" | "customer" | "order", key });
              }}
              options={options.customFields}
              blank={options.customFields.length ? "Choose…" : "No custom fields yet"}
            />
          </Row>
          <Row title="Set it to">
            <input className={box} value={String(action.value ?? "")} onChange={(e) => onChange({ ...action, value: e.target.value })} />
          </Row>
        </>
      )}
      {action.type === "call_webhook" && (
        <>
          <Row title="Endpoint">
            <Select ariaLabel="Endpoint" value={action.endpoint_id} onChange={(v) => onChange({ ...action, endpoint_id: v })} options={options.endpoints} blank={options.endpoints.length ? "Choose…" : "Add one in Settings → Webhooks"} />
          </Row>
          <Row title="Label (sent with the event)">
            <input className={box} value={action.label ?? ""} onChange={(e) => onChange({ ...action, label: e.target.value })} />
          </Row>
        </>
      )}
    </div>
  );
}

/** The settings of the selected step. */
export function NodeEditor({
  node,
  onChange,
  onDelete,
  options,
}: {
  node: GraphNode;
  onChange: (n: GraphNode) => void;
  onDelete: () => void;
  options: BuilderOptions;
}) {
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold">{KIND_LABELS[node.kind]}</h3>
        {node.kind !== "trigger" && (
          <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-danger">
            <Trash2 className="size-3.5" /> Remove
          </button>
        )}
      </div>

      {node.kind === "trigger" && (
        <>
          <Row title="Starts when">
            <Select ariaLabel="Trigger" value={node.trigger ?? ""} onChange={(v) => onChange({ ...node, trigger: v, config: v === "lead_idle" ? { days: 3 } : {} })}
              options={Object.entries(TRIGGERS).map(([value, l]) => ({ value, label: l }))} />
          </Row>
          {node.trigger === "lead_idle" && (
            <Row title="Days without activity">
              <input className={box} type="number" min={1} max={90} value={Number(node.config?.days ?? 3)} onChange={(e) => onChange({ ...node, config: { days: Number(e.target.value) } })} />
            </Row>
          )}
          {node.trigger === "lead_status_changed" && (
            <Row title="Only for the stage">
              <Select ariaLabel="Stage" value={String(node.config?.status_key ?? "")} onChange={(v) => onChange({ ...node, config: v ? { status_key: v } : {} })} options={options.statuses} blank="Any stage" />
            </Row>
          )}
          {node.trigger === "order_stage_changed" && (
            <Row title="Only for the stage">
              <Select ariaLabel="Order stage" value={String(node.config?.stage_key ?? "")} onChange={(v) => onChange({ ...node, config: v ? { stage_key: v } : {} })} options={options.stages} blank="Any stage" />
            </Row>
          )}
        </>
      )}

      {node.kind === "condition" && <ConditionsEditor node={node} onChange={onChange} options={options} />}

      {node.kind === "wait" && (
        <Row title="Wait (minutes)">
          <input className={box} type="number" min={1} value={node.minutes ?? 60} onChange={(e) => onChange({ ...node, minutes: Number(e.target.value) })} />
          <span className="mt-1 block text-[12px] text-muted">60 = an hour, 1440 = a day.</span>
        </Row>
      )}

      {node.kind === "wait_until" && (
        <>
          <Row title="Wait until">
            <Select ariaLabel="Mode" value={node.mode ?? "time"} onChange={(v) => onChange({ ...node, mode: v as "time" | "business_hours", time: node.time ?? "10:00", open: node.open ?? "10:00", close: node.close ?? "20:00" })}
              options={[{ value: "time", label: "A time of day" }, { value: "business_hours", label: "Opening hours" }]} />
          </Row>
          {node.mode === "time" ? (
            <Row title="Time">
              <input className={box} type="time" value={node.time ?? "10:00"} onChange={(e) => onChange({ ...node, time: e.target.value })} />
            </Row>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Row title="Opens">
                <input className={box} type="time" value={node.open ?? "10:00"} onChange={(e) => onChange({ ...node, open: e.target.value })} />
              </Row>
              <Row title="Closes">
                <input className={box} type="time" value={node.close ?? "20:00"} onChange={(e) => onChange({ ...node, close: e.target.value })} />
              </Row>
            </div>
          )}
          <Row title="On">
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d, i) => {
                const day = i + 1;
                const on = (node.days ?? [1, 2, 3, 4, 5, 6, 7]).includes(day);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const days = node.days ?? [1, 2, 3, 4, 5, 6, 7];
                      onChange({ ...node, days: on ? days.filter((x) => x !== day) : [...days, day].sort() });
                    }}
                    className={`h-8 rounded-[var(--radius-control)] border px-2 text-[12.5px] ${on ? "border-signal bg-signal-soft" : "border-line"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </Row>
          <p className="text-[12px] text-muted">In the business&apos;s time zone.</p>
        </>
      )}

      {node.kind === "wait_for_reply" && (
        <Row title="Give up after (minutes)">
          <input className={box} type="number" min={5} value={node.timeout_minutes ?? 1440} onChange={(e) => onChange({ ...node, timeout_minutes: Number(e.target.value) })} />
          <span className="mt-1 block text-[12px] text-muted">A WhatsApp reply from the customer takes the Replied branch at once.</span>
        </Row>
      )}

      {node.kind === "action" && node.action && (
        <ActionEditor action={node.action} onChange={(a) => onChange({ ...node, action: a })} options={options} />
      )}
    </div>
  );
}
