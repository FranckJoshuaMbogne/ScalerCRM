/**
 * Workflow graphs (ADR 0015). Pure: the editor and the tests use it; the
 * database (private.automation_graph_errors) checks the same rules on publish.
 */
import { type Action, type Condition, TRIGGERS } from "./definitions";

export type NodeKind = "trigger" | "condition" | "wait" | "wait_until" | "wait_for_reply" | "action";
export type EdgeField = "next" | "yes" | "no" | "replied" | "timeout";

export type GraphNode = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  next?: string | null;
  yes?: string | null;
  no?: string | null;
  replied?: string | null;
  timeout?: string | null;
  trigger?: string;
  config?: Record<string, unknown>;
  match?: "all" | "any";
  conditions?: Condition[];
  minutes?: number;
  mode?: "time" | "business_hours";
  time?: string;
  open?: string;
  close?: string;
  days?: number[];
  timeout_minutes?: number;
  action?: Action;
};

export type Graph = { nodes: GraphNode[] };

/** The outgoing connections each kind of step has, with their labels. */
export const OUTPUTS: Record<NodeKind, { field: EdgeField; label: string }[]> = {
  trigger: [{ field: "next", label: "" }],
  condition: [
    { field: "yes", label: "Yes" },
    { field: "no", label: "No" },
  ],
  wait: [{ field: "next", label: "" }],
  wait_until: [{ field: "next", label: "" }],
  wait_for_reply: [
    { field: "replied", label: "Replied" },
    { field: "timeout", label: "No reply" },
  ],
  action: [{ field: "next", label: "" }],
};

export const KIND_LABELS: Record<NodeKind, string> = {
  trigger: "Trigger",
  condition: "If / else",
  wait: "Wait",
  wait_until: "Wait until",
  wait_for_reply: "Wait for a reply",
  action: "Action",
};

export const MAX_NODES = 50;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const UUID = /^[0-9a-f-]{36}$/;

export function edgesOf(n: GraphNode): string[] {
  return (["next", "yes", "no", "replied", "timeout"] as EdgeField[]).map((f) => n[f]).filter((t): t is string => Boolean(t));
}

export function startNode(g: Graph) {
  return g.nodes.find((n) => n.kind === "trigger");
}

function actionErrors(a: Action | undefined): string[] {
  if (!a) return ["Unknown action missing."];
  switch (a.type) {
    case "create_task":
      return a.title?.trim() ? [] : ["Tasks need a title."];
    case "notify":
      return a.title?.trim() ? [] : ["Notifications need a title."];
    case "assign_round_robin":
      return [];
    case "assign_to":
      return UUID.test(a.user_id ?? "") ? [] : ["Choose who gets the lead."];
    case "change_status":
      return /^[a-z0-9_]+$/.test(a.status_key ?? "") ? [] : ["Choose the stage to move to."];
    case "add_tag":
      return a.tag?.trim() ? [] : ["Name the tag."];
    case "send_whatsapp_template":
      return UUID.test(a.template_id ?? "") ? [] : ["Choose an approved template."];
    case "send_email":
      return ["customer", "owner"].includes(a.to) && a.subject?.trim() && a.body?.trim()
        ? []
        : ["Emails need a recipient, a subject and a message."];
    case "set_custom_field":
      return ["lead", "customer", "order"].includes(a.entity) && /^[a-z0-9_]+$/.test(a.key ?? "") ? [] : ["Choose the field to update."];
    case "call_webhook":
      return UUID.test(a.endpoint_id ?? "") ? [] : ["Choose the webhook endpoint to call."];
    default:
      return [`Unknown action ${(a as { type?: string }).type ?? "missing"}.`];
  }
}

/** Why a graph can't be published, in plain words (same rules as the database). */
export function graphErrors(g: Graph): string[] {
  const e: string[] = [];
  if (!g || !Array.isArray(g.nodes)) return ["The workflow is empty."];
  if (g.nodes.length > MAX_NODES) e.push(`Use at most ${MAX_NODES} steps.`);
  const ids = g.nodes.map((n) => n.id);
  if (ids.some((i) => !/^[A-Za-z0-9_-]{1,40}$/.test(i ?? "")) || new Set(ids).size !== ids.length) e.push("Every step needs its own id.");
  const triggers = g.nodes.filter((n) => n.kind === "trigger");
  if (triggers.length !== 1) return [...e, "A workflow starts with exactly one trigger."];

  for (const n of g.nodes) {
    if (edgesOf(n).some((t) => !ids.includes(t))) e.push("A connection points at a step that no longer exists.");
    if (edgesOf(n).includes(n.id)) e.push("A step cannot lead to itself.");
    switch (n.kind) {
      case "trigger":
        if (!n.trigger || !(n.trigger in TRIGGERS)) e.push("Choose what starts the workflow.");
        if (n.trigger === "lead_idle") {
          const d = Number(n.config?.days);
          if (!(d >= 1 && d <= 90)) e.push("Idle days must be between 1 and 90.");
        }
        if (!n.next) e.push("Connect the trigger to a first step.");
        break;
      case "condition":
        if (!n.conditions?.length) e.push("A condition needs at least one check.");
        if (!n.yes && !n.no) e.push("Connect at least one branch of each condition.");
        break;
      case "wait":
        if (!(Number(n.minutes) >= 1 && Number(n.minutes) <= 86400)) e.push("Waits are between 1 minute and 60 days.");
        break;
      case "wait_until":
        if (
          !(n.mode === "time" && TIME.test(n.time ?? "")) &&
          !(n.mode === "business_hours" && TIME.test(n.open ?? "") && TIME.test(n.close ?? "") && (n.open ?? "") < (n.close ?? ""))
        ) {
          e.push("Set the time (or opening hours) to wait for.");
        }
        break;
      case "wait_for_reply":
        if (!(Number(n.timeout_minutes) >= 5 && Number(n.timeout_minutes) <= 43200)) e.push("Wait for a reply for between 5 minutes and 30 days.");
        break;
      case "action":
        e.push(...actionErrors(n.action));
        break;
      default:
        e.push(`Unknown step type ${(n as { kind?: string }).kind ?? "missing"}.`);
    }
  }
  if (!g.nodes.some((n) => n.kind === "action")) e.push("Add at least one action.");

  // Loops and loose steps: walk forward from the trigger.
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const reached = new Set<string>([triggers[0].id]);
  let frontier = [triggers[0].id];
  for (let i = 1; i <= g.nodes.length + 1 && frontier.length; i++) {
    const next = [...new Set(frontier.flatMap((id) => (byId.get(id) ? edgesOf(byId.get(id)!) : [])))];
    next.forEach((id) => reached.add(id));
    frontier = next;
    if (i === g.nodes.length + 1 && next.length) e.push("The workflow loops back on itself. Steps can only lead forward.");
  }
  if (ids.some((id) => !reached.has(id))) e.push("Some steps are not connected to the trigger.");
  return [...new Set(e)];
}

/** Sprint 8's list format as a graph (same as private.linear_to_graph). */
export function linearToGraph(trigger: string, config: Record<string, unknown>, conditions: Condition[], actions: Action[]): Graph {
  const nodes: GraphNode[] = [];
  const first = actions.length ? "a1" : null;
  nodes.push({ id: "t", kind: "trigger", trigger, config, next: conditions.length ? "c" : first, x: 0, y: 0 });
  let row = 1;
  if (conditions.length) {
    nodes.push({ id: "c", kind: "condition", match: "all", conditions, yes: first, no: null, x: 0, y: 120 });
    row = 2;
  }
  actions.forEach((a, i) => {
    const next = i < actions.length - 1 ? `a${i + 2}` : null;
    const y = (row + i) * 120;
    if (a.type === "wait") nodes.push({ id: `a${i + 1}`, kind: "wait", minutes: Math.max(1, a.minutes ?? 60), next, x: 0, y });
    else nodes.push({ id: `a${i + 1}`, kind: "action", action: a, next, x: 0, y });
  });
  return { nodes };
}

/** A fresh step of a kind, with sensible defaults. */
export function newNode(kind: Exclude<NodeKind, "trigger">, id: string, x: number, y: number, action?: Action): GraphNode {
  switch (kind) {
    case "condition":
      return { id, kind, x, y, match: "all", conditions: [{ field: "has_owner", op: "is_true" }], yes: null, no: null };
    case "wait":
      return { id, kind, x, y, minutes: 60, next: null };
    case "wait_until":
      return { id, kind, x, y, mode: "business_hours", open: "10:00", close: "20:00", days: [1, 2, 3, 4, 5, 6], next: null };
    case "wait_for_reply":
      return { id, kind, x, y, timeout_minutes: 1440, replied: null, timeout: null };
    case "action":
      return { id, kind, x, y, action: action ?? { type: "create_task", task_type: "follow_up", title: "Follow up", due_in_minutes: 60, assignee: "owner" }, next: null };
  }
}

/** Removes a step and every connection into it. The trigger stays. */
export function removeNode(g: Graph, id: string): Graph {
  const target = g.nodes.find((n) => n.id === id);
  if (!target || target.kind === "trigger") return g;
  return {
    nodes: g.nodes
      .filter((n) => n.id !== id)
      .map((n) => {
        const copy = { ...n };
        for (const f of ["next", "yes", "no", "replied", "timeout"] as EdgeField[]) if (copy[f] === id) copy[f] = null;
        return copy;
      }),
  };
}

export function connect(g: Graph, from: string, field: EdgeField, to: string | null): Graph {
  return { nodes: g.nodes.map((n) => (n.id === from ? { ...n, [field]: to } : n)) };
}

export function nextId(g: Graph): string {
  let i = g.nodes.length + 1;
  const ids = new Set(g.nodes.map((n) => n.id));
  while (ids.has(`n${i}`)) i++;
  return `n${i}`;
}
