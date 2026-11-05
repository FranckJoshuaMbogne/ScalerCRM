/** What automations can react to, check and do. Pure: validation and plain-language summaries. */

export const TRIGGERS = {
  lead_created: "A new lead arrives",
  lead_status_changed: "A lead moves to a stage",
  lead_assigned: "A lead is assigned",
  lead_idle: "A lead has no activity for some days",
  order_created: "An order is created",
  order_stage_changed: "An order moves to a stage",
  appointment_no_show: "A customer misses an appointment",
} as const;
export type Trigger = keyof typeof TRIGGERS;

export const CONDITION_FIELDS = {
  source_key: "Lead source",
  status_key: "Lead stage",
  status_category: "Stage type (open / won / lost)",
  has_owner: "Has an owner",
  expected_value: "Expected value",
  score: "Lead score",
  has_email: "Customer has an email",
  has_phone: "Customer has a phone",
  whatsapp_opt_in: "Customer opted in to WhatsApp",
  customer_tags: "Customer tags",
  replied: "Customer replied on WhatsApp since the run started",
  order_total: "Order total",
  order_balance: "Order balance due",
  stage_key: "Order stage",
} as const;
export type ConditionField = keyof typeof CONDITION_FIELDS;
export type ConditionOp = "eq" | "neq" | "gte" | "lte" | "is_true" | "is_false" | "contains" | "not_contains";
export type Condition = { field: ConditionField; op: ConditionOp; value?: string };

/** Which comparisons make sense for each field. */
export const FIELD_KIND: Record<ConditionField, "key" | "number" | "boolean" | "tags"> = {
  source_key: "key",
  status_key: "key",
  status_category: "key",
  has_owner: "boolean",
  expected_value: "number",
  score: "number",
  has_email: "boolean",
  has_phone: "boolean",
  whatsapp_opt_in: "boolean",
  customer_tags: "tags",
  replied: "boolean",
  order_total: "number",
  order_balance: "number",
  stage_key: "key",
};

export const OPS_FOR: Record<(typeof FIELD_KIND)[ConditionField], { value: ConditionOp; label: string }[]> = {
  key: [{ value: "eq", label: "is" }, { value: "neq", label: "is not" }],
  number: [{ value: "gte", label: "is at least" }, { value: "lte", label: "is at most" }],
  boolean: [{ value: "is_true", label: "yes" }, { value: "is_false", label: "no" }],
  tags: [{ value: "contains", label: "include" }, { value: "not_contains", label: "don't include" }],
};

export type Action =
  | { type: "create_task"; task_type: string; title: string; due_in_minutes: number; assignee: "owner" | string }
  | { type: "notify"; to: "owner" | "managers" | string; title: string }
  | { type: "assign_round_robin" }
  | { type: "assign_to"; user_id: string }
  | { type: "change_status"; status_key: string }
  | { type: "add_tag"; tag: string }
  | { type: "wait"; minutes: number }
  | { type: "send_whatsapp_template"; template_id: string; variables?: { source: string; value?: string }[] }
  | { type: "send_email"; to: "customer" | "owner"; subject: string; body: string }
  | { type: "set_custom_field"; entity: "lead" | "customer" | "order"; key: string; value: string | number | boolean }
  | { type: "call_webhook"; endpoint_id: string; label?: string };

export const ACTION_LABELS: Record<Action["type"], string> = {
  create_task: "Create a task",
  notify: "Send a notification",
  assign_round_robin: "Assign by round-robin",
  assign_to: "Assign to a person",
  change_status: "Move the lead to a stage",
  add_tag: "Tag the customer",
  wait: "Wait",
  send_whatsapp_template: "Send a WhatsApp template",
  send_email: "Send an email",
  set_custom_field: "Update a custom field",
  call_webhook: "Call a webhook",
};

const KEY = /^[a-z0-9_]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Errors for an automation definition, in plain words. Empty when it can be saved. */
export function validateAutomation(a: { name: string; trigger: string; triggerConfig: Record<string, unknown>; conditions: Condition[]; actions: Action[] }): string[] {
  const e: string[] = [];
  if (!a.name.trim()) e.push("Name the automation.");
  if (!(a.trigger in TRIGGERS)) e.push("Choose what starts it.");
  if (a.trigger === "lead_idle") {
    const d = Number(a.triggerConfig.days);
    if (!Number.isInteger(d) || d < 1 || d > 90) e.push("Idle days must be between 1 and 90.");
  }
  if ((a.trigger === "lead_status_changed" && a.triggerConfig.status_key && !KEY.test(String(a.triggerConfig.status_key))) ||
      (a.trigger === "order_stage_changed" && a.triggerConfig.stage_key && !KEY.test(String(a.triggerConfig.stage_key)))) {
    e.push("Pick a stage from the list.");
  }
  for (const c of a.conditions) {
    if (!(c.field in CONDITION_FIELDS)) e.push("A condition uses an unknown field.");
    if (["gte", "lte"].includes(c.op) && !Number.isFinite(Number(c.value))) e.push(`${CONDITION_FIELDS[c.field] ?? "A condition"} needs a number.`);
  }
  if (!a.actions.length) e.push("Add at least one action.");
  if (a.actions.length > 10) e.push("Use at most 10 actions.");
  if (a.actions.length && a.actions.every((x) => x.type === "wait")) e.push("Add an action after the wait.");
  for (const x of a.actions) {
    if (x.type === "wait" && (!Number.isInteger(x.minutes) || x.minutes < 1 || x.minutes > 60 * 24 * 60)) e.push("Waits are between 1 minute and 60 days.");
    if (x.type === "create_task" && (!x.title.trim() || !(x.due_in_minutes >= 0))) e.push("Tasks need a title and a due time.");
    if (x.type === "notify" && !x.title.trim()) e.push("Notifications need a title.");
    if (x.type === "assign_to" && !UUID.test(x.user_id)) e.push("Choose who gets the lead.");
    if (x.type === "add_tag" && !x.tag.trim()) e.push("Name the tag.");
    if (x.type === "change_status" && !KEY.test(x.status_key)) e.push("Choose the stage to move to.");
    if (x.type === "send_whatsapp_template" && !UUID.test(x.template_id)) e.push("Choose an approved template.");
  }
  return [...new Set(e)];
}

function minutes(n: number) {
  if (n % 1440 === 0) return `${n / 1440} day${n === 1440 ? "" : "s"}`;
  if (n % 60 === 0) return `${n / 60} hour${n === 60 ? "" : "s"}`;
  return `${n} minutes`;
}

/** "When a new lead arrives, if it has an owner: create a task due in 15 minutes." */
export function describeAction(x: Action, names: { person: (id: string) => string | undefined } = { person: () => undefined }) {
  switch (x.type) {
    case "create_task":
      return `create the task “${x.title}” due in ${minutes(x.due_in_minutes)} for ${x.assignee === "owner" ? "the owner" : (names.person(x.assignee) ?? "someone")}`;
    case "notify":
      return `notify ${x.to === "owner" ? "the owner" : x.to === "managers" ? "managers" : (names.person(x.to) ?? "someone")}: “${x.title}”`;
    case "assign_round_robin":
      return "assign by round-robin if nobody owns it";
    case "assign_to":
      return `assign to ${names.person(x.user_id) ?? "a person"}`;
    case "change_status":
      return `move the lead to ${x.status_key.replace(/_/g, " ")}`;
    case "add_tag":
      return `tag the customer “${x.tag}”`;
    case "wait":
      return `wait ${minutes(x.minutes)}`;
    case "send_whatsapp_template":
      return "send a WhatsApp template (opted-in customers only)";
    case "send_email":
      return `email ${x.to === "owner" ? "the owner" : "the customer"}: “${x.subject}”`;
    case "set_custom_field":
      return `set the ${x.entity} field ${x.key} to ${String(x.value)}`;
    case "call_webhook":
      return `call a webhook${x.label ? ` (${x.label})` : ""}`;
  }
}
