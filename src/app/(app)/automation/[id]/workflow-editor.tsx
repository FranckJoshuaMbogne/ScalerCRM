"use client";

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import { Clock, GitBranch, MessageCircle, Play, Plus, Zap } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { type DryRun, dryRunWorkflow, publishWorkflow, saveWorkflowDraft } from "@/modules/automation/actions";
import { ACTION_LABELS, CONDITION_FIELDS, describeAction, TRIGGERS } from "@/modules/automation/definitions";
import {
  connect,
  type EdgeField,
  type Graph,
  type GraphNode,
  graphErrors,
  KIND_LABELS,
  newNode,
  nextId,
  type NodeKind,
  OUTPUTS,
  removeNode,
} from "@/modules/automation/graph";
import type { NodeStats } from "@/modules/automation/queries";
import type { BuilderOptions } from "../data";
import { blankAction, NodeEditor } from "./node-editor";

type StepData = {
  node: GraphNode;
  title: string;
  detail: string;
  stats?: NodeStats;
  dry?: string;
};
type StepNodeType = Node<StepData, "step">;

const ICONS: Record<NodeKind, typeof Zap> = {
  trigger: Zap,
  condition: GitBranch,
  wait: Clock,
  wait_until: Clock,
  wait_for_reply: MessageCircle,
  action: Play,
};

function minutes(n: number) {
  if (n % 1440 === 0) return `${n / 1440} day${n === 1440 ? "" : "s"}`;
  if (n % 60 === 0) return `${n / 60} hour${n === 60 ? "" : "s"}`;
  return `${n} min`;
}

function describe(n: GraphNode, people: Map<string, string>): { title: string; detail: string } {
  switch (n.kind) {
    case "trigger": {
      const extra = n.config?.days ? ` (${String(n.config.days)} days)` : n.config?.status_key || n.config?.stage_key ? ` (${String(n.config.status_key ?? n.config.stage_key).replace(/_/g, " ")})` : "";
      return { title: "When", detail: `${TRIGGERS[n.trigger as keyof typeof TRIGGERS] ?? "Choose a trigger"}${extra}` };
    }
    case "condition":
      return {
        title: "If",
        detail:
          (n.conditions ?? [])
            .map((c) => `${CONDITION_FIELDS[c.field] ?? c.field}${c.value ? ` ${c.op === "neq" || c.op === "not_contains" ? "≠" : c.op === "gte" ? "≥" : c.op === "lte" ? "≤" : "="} ${c.value}` : c.op === "is_false" ? ": no" : ""}`)
            .join(n.match === "any" ? " or " : " and ") || "Add a check",
      };
    case "wait":
      return { title: "Wait", detail: minutes(Number(n.minutes ?? 0)) };
    case "wait_until":
      return { title: "Wait until", detail: n.mode === "time" ? `${n.time ?? ""}` : `open (${n.open}–${n.close})` };
    case "wait_for_reply":
      return { title: "Wait for a reply", detail: `up to ${minutes(Number(n.timeout_minutes ?? 0))}` };
    case "action":
      return n.action
        ? { title: ACTION_LABELS[n.action.type] ?? "Action", detail: describeAction(n.action, { person: (id) => people.get(id) }) }
        : { title: "Action", detail: "" };
  }
}

function StepNode({ data, selected }: NodeProps<StepNodeType>) {
  const { node, title, detail, stats, dry } = data;
  const Icon = ICONS[node.kind];
  const outputs = OUTPUTS[node.kind];
  return (
    <div
      className={cn(
        "w-[230px] rounded-[10px] border bg-surface px-3 py-2.5 text-left shadow-sm",
        selected ? "border-signal ring-2 ring-signal/30" : "border-line",
        dry && "border-stage-won ring-2 ring-stage-won/40",
        node.kind === "trigger" && "bg-signal-soft",
      )}
    >
      {node.kind !== "trigger" && <Handle type="target" position={Position.Top} className="!size-2.5 !bg-muted" />}
      <div className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </div>
      <p className="mt-0.5 line-clamp-3 text-[13px] leading-snug">{detail}</p>
      {stats && (
        <p className="mt-1.5 text-[11.5px] text-muted tabular-nums">
          {stats.reached} reached
          {node.kind === "condition" && ` · ${stats.yes} yes / ${stats.no} no`}
          {node.kind === "condition" && (stats.won_after_yes || stats.won_after_no) ? ` · won ${stats.won_after_yes}/${stats.won_after_no}` : ""}
          {node.kind === "wait_for_reply" && ` · ${stats.replied} replied / ${stats.timeout} no reply`}
          {stats.failed > 0 && <span className="text-danger"> · {stats.failed} failed</span>}
        </p>
      )}
      {dry && <p className="mt-1.5 text-[11.5px] font-medium text-stage-won">Dry run: {dry}</p>}
      {outputs.map((o, i) => (
        <Handle
          key={o.field}
          id={o.field}
          type="source"
          position={Position.Bottom}
          style={outputs.length > 1 ? { left: `${i === 0 ? 28 : 72}%` } : undefined}
          className="!size-2.5 !bg-signal"
        >
          {o.label && (
            <span className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 text-[10.5px] font-medium whitespace-nowrap text-muted">
              {o.label}
            </span>
          )}
        </Handle>
      ))}
    </div>
  );
}

const nodeTypes = { step: StepNode };

function toEdges(graph: Graph, taken: Set<string>): Edge[] {
  const edges: Edge[] = [];
  for (const n of graph.nodes) {
    for (const o of OUTPUTS[n.kind]) {
      const target = n[o.field];
      if (!target) continue;
      const id = `${n.id}:${o.field}`;
      edges.push({
        id,
        source: n.id,
        sourceHandle: o.field,
        target,
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: taken.has(id),
        style: taken.has(id) ? { strokeWidth: 2.5 } : undefined,
      });
    }
  }
  return edges;
}

export function WorkflowEditor({
  automationId,
  initialName,
  initialGraph,
  publishedGraph,
  options,
  stats,
}: {
  automationId: string;
  initialName: string;
  initialGraph: Graph;
  publishedGraph: Graph | null;
  options: BuilderOptions;
  stats: Record<string, NodeStats>;
}) {
  const [graph, setGraph] = useState<Graph>(initialGraph);
  const [name, setName] = useState(initialName);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);
  const [dryLead, setDryLead] = useState(options.leads[0]?.value ?? "");
  const [dry, setDry] = useState<DryRun | null>(null);
  const [pending, startTransition] = useTransition();

  const people = useMemo(() => new Map(options.people.map((p) => [p.value, p.label])), [options.people]);
  const errors = useMemo(() => graphErrors(graph), [graph]);
  const dirty = JSON.stringify(graph) !== JSON.stringify(publishedGraph);
  const dryByNode = useMemo(() => new Map((dry?.steps ?? []).map((s) => [s.node, s.outcome])), [dry]);
  const taken = useMemo(() => {
    const t = new Set<string>();
    const steps = dry?.steps ?? [];
    const start = graph.nodes.find((n) => n.kind === "trigger");
    if (start && steps[0]) t.add(`${start.id}:next`);
    steps.forEach((s, i) => {
      const n = graph.nodes.find((x) => x.id === s.node);
      const following = steps[i + 1];
      if (!n || !following) return;
      const field = OUTPUTS[n.kind].find((o) => n[o.field] === following.node)?.field;
      if (field) t.add(`${n.id}:${field}`);
    });
    return t;
  }, [dry, graph]);

  const toNodes = (g: Graph): StepNodeType[] =>
    g.nodes.map((n) => ({
      id: n.id,
      type: "step",
      position: { x: n.x, y: n.y },
      deletable: n.kind !== "trigger",
      data: {
        node: n,
        ...describe(n, people),
        stats: showStats ? stats[n.id] : undefined,
        dry: dryByNode.get(n.id),
      },
    }));

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<StepNodeType>(toNodes(graph));
  // Keep React Flow's measurements and selection when the graph changes.
  useEffect(() => {
    setRfNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return toNodes(graph).map((n) => ({ ...old.get(n.id), ...n, selected: n.id === selected }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, showStats, dryByNode, selected]);

  const edges = useMemo(() => toEdges(graph, taken), [graph, taken]);
  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;

  const update = (n: GraphNode) => setGraph((g) => ({ nodes: g.nodes.map((x) => (x.id === n.id ? n : x)) }));

  const add = (kind: Exclude<NodeKind, "trigger">) => {
    setGraph((g) => {
      const id = nextId(g);
      const from = g.nodes.find((n) => n.id === selected) ?? g.nodes[g.nodes.length - 1];
      const node = newNode(kind, id, from ? from.x : 0, from ? from.y + 160 : 0, kind === "action" ? blankAction("create_task") : undefined);
      let next: Graph = { nodes: [...g.nodes, node] };
      const free = from && OUTPUTS[from.kind].find((o) => !from[o.field]);
      if (from && free) next = connect(next, from.id, free.field, id);
      setSelected(id);
      return next;
    });
    setDry(null);
  };

  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    setGraph((g) => connect(g, c.source!, (c.sourceHandle ?? "next") as EdgeField, c.target!));
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    for (const ch of changes) {
      if (ch.type === "remove") {
        const [source, field] = ch.id.split(":");
        setGraph((g) => connect(g, source, field as EdgeField, null));
      }
    }
  };

  const save = () =>
    startTransition(async () => {
      const r = await saveWorkflowDraft(automationId, graph, name);
      setMessage({ ok: r.ok, text: r.message });
    });

  const publish = () =>
    startTransition(async () => {
      const r = await publishWorkflow(automationId, graph, name, note);
      setMessage({ ok: r.ok, text: r.message, errors: r.errors });
      if (r.ok) setNote("");
    });

  const runDry = () =>
    startTransition(async () => {
      if (!dryLead) return;
      const r = await dryRunWorkflow(automationId, dryLead, graph);
      if ("error" in r) setMessage({ ok: false, text: r.error });
      else setDry(r);
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="mb-1 block text-[12.5px] font-medium">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13.5px]" />
        </label>
        <label className="min-w-[200px]">
          <span className="mb-1 block text-[12.5px] font-medium">Note for this version</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="What changed" className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13.5px]" />
        </label>
        <Button variant="secondary" onClick={save} disabled={pending}>Save draft</Button>
        <Button onClick={publish} disabled={pending || errors.length > 0} title={errors.length ? "Fix the problems listed below first" : undefined}>
          Publish
        </Button>
      </div>

      {message && (
        <div role="status" className={cn("rounded-[var(--radius-control)] px-3 py-2 text-[13.5px]", message.ok ? "bg-signal-soft" : "bg-danger/10 text-danger")}>
          {message.text}
          {message.errors && <ul className="mt-1 list-disc pl-5">{message.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
      {dirty && !message && <p className="text-[12.5px] text-muted">Changes here are not live until you publish.</p>}

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">Add:</span>
        {(["action", "condition", "wait", "wait_until", "wait_for_reply"] as const).map((k) => (
          <button key={k} type="button" onClick={() => add(k)} className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 hover:bg-paper">
            <Plus className="size-3.5" /> {KIND_LABELS[k]}
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-1.5">
          <input type="checkbox" checked={showStats} onChange={(e) => setShowStats(e.target.checked)} /> Show what happened at each step
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="h-[620px] overflow-hidden rounded-[10px] border border-line bg-paper">
          <ReactFlow
            nodes={rfNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={(_, n) => setGraph((g) => ({ nodes: g.nodes.map((x) => (x.id === n.id ? { ...x, x: Math.round(n.position.x), y: Math.round(n.position.y) } : x)) }))}
            onNodesDelete={(ns) => {
              setGraph((g) => ns.reduce((acc, n) => removeNode(acc, n.id), g));
              setSelected(null);
            }}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-[10px] border border-line bg-surface p-4">
            {selectedNode ? (
              <NodeEditor
                node={selectedNode}
                onChange={(n) => {
                  update(n);
                  setDry(null);
                }}
                onDelete={() => {
                  setGraph((g) => removeNode(g, selectedNode.id));
                  setSelected(null);
                }}
                options={options}
              />
            ) : (
              <p className="text-[13px] text-muted">
                Click a step to change it. Drag from a dot at the bottom of a step to the top of another to connect them; select a connection and press Delete to remove it.
              </p>
            )}
          </div>

          {errors.length > 0 && (
            <div className="rounded-[10px] border border-line bg-surface p-4 text-[13px]">
              <h3 className="mb-1 font-semibold">Before you publish</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-muted">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}

          <div className="rounded-[10px] border border-line bg-surface p-4 text-[13px]">
            <h3 className="mb-1 font-semibold">Dry run</h3>
            <p className="mb-2 text-[12.5px] text-muted">See the path a real lead would take and what each step would do. Nothing is changed.</p>
            {options.leads.length === 0 ? (
              <p className="text-muted">No leads yet.</p>
            ) : (
              <div className="flex gap-2">
                <select aria-label="Lead" value={dryLead} onChange={(e) => setDryLead(e.target.value)} className="h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]">
                  {options.leads.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
                <Button variant="secondary" onClick={runDry} disabled={pending || !dryLead}>Try</Button>
              </div>
            )}
            {dry && (
              <div className="mt-3">
                {dry.errors.length > 0 ? (
                  <ul className="list-disc pl-5 text-danger">{dry.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                ) : (
                  <ol className="list-decimal space-y-1 pl-5">
                    {dry.steps.map((s, i) => <li key={i}>{s.summary}</li>)}
                    <li className="list-none text-muted">{dry.ended === "skipped" ? "The run would stop here (conditions not met)." : "Then the run would finish."}</li>
                  </ol>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
