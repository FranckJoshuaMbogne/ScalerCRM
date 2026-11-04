import Link from "next/link";
import { LeadViewSwitch } from "@/components/crm/lead-view-switch";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader } from "@/components/ui/primitives";
import { listLostReasons, listSources, listStatuses, listTransitions } from "@/modules/leads/config";
import { BOARD_CLOSED_DAYS, BOARD_LIMIT, countUnassignedLeads, listBoardLeads } from "@/modules/leads/queries";
import { describeDue } from "@/modules/tasks/schedule";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { Board, type BoardCard } from "./board";

export const metadata = { title: "Pipeline board" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const selectClass =
  "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13.5px] focus:border-signal focus:outline-none";

export default async function BoardPage({ searchParams }: PageProps<"/leads/board">) {
  const ctx = await getContext();
  const canAll = can(ctx, "leads.view_all");
  if (!canAll && !can(ctx, "leads.view_assigned")) return <NoAccess what="leads" />;
  const sp = await searchParams;
  const filters = {
    owner: one(sp.owner) || undefined,
    branch: one(sp.branch) || undefined,
    source: one(sp.source) || undefined,
  };

  const businessId = ctx.business.businessId;
  const [statuses, transitions, reasons, sources, branches, members] = await Promise.all([
    listStatuses(businessId),
    listTransitions(businessId),
    listLostReasons(businessId),
    listSources(businessId),
    listBranches(businessId),
    listMembers(businessId),
  ]);
  const openIds = statuses.filter((s) => s.category === "open").map((s) => s.id);
  const [{ items, truncated }, unassigned] = await Promise.all([
    listBoardLeads(businessId, ctx.user.id, filters, openIds),
    canAll ? countUnassignedLeads(businessId, openIds) : Promise.resolve(0),
  ]);

  const now = new Date();
  const tz = ctx.business.timezone;
  const person = new Map(members.map((m) => [m.userId, m.name]));
  const cards: BoardCard[] = items.map((l) => ({
    id: l.id,
    statusId: l.statusId,
    leadNumber: l.leadNumber,
    customerName: l.customer?.fullName ?? "Unknown customer",
    title: l.title,
    expectedValue: l.expectedValue,
    ownerId: l.ownerId,
    ownerName: l.ownerId ? (person.get(l.ownerId) ?? "Former member") : null,
    followUp: l.nextFollowUpAt
      ? { label: describeDue(new Date(l.nextFollowUpAt), now, tz), overdue: new Date(l.nextFollowUpAt) < now }
      : null,
  }));
  const filtered = Boolean(filters.owner || filters.branch || filters.source);

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={`Drag a lead to move it to another stage. Won and lost columns show the last ${BOARD_CLOSED_DAYS} days.`}
        actions={<LeadViewSwitch current="/leads/board" unassigned={unassigned} />}
      />

      <form className="mb-4 flex flex-wrap items-end gap-2">
        {canAll && (
          <select name="owner" defaultValue={filters.owner ?? ""} aria-label="Owner" className={selectClass}>
            <option value="">Anyone</option>
            <option value="me">Mine</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </select>
        )}
        {branches.length > 1 && (
          <select name="branch" defaultValue={filters.branch ?? ""} aria-label="Branch" className={selectClass}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        <select name="source" defaultValue={filters.source ?? ""} aria-label="Source" className={selectClass}>
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button type="submit" className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 text-[13.5px] font-medium hover:bg-paper">
          Apply
        </button>
        {filtered && (
          <Link href="/leads/board" className="px-2 text-[13px] text-muted hover:text-text">Clear</Link>
        )}
      </form>

      {truncated && (
        <p className="mb-3 rounded-[var(--radius-control)] bg-line/60 px-3 py-2 text-[13px]">
          Showing the {BOARD_LIMIT} most recently active leads. Filter by owner, branch or source to see the rest.
        </p>
      )}

      <Board
        statuses={statuses}
        cards={cards}
        transitions={transitions}
        lostReasons={reasons.filter((r) => r.isActive).map((r) => ({ value: r.id, label: r.name }))}
        currency={ctx.business.currency}
        canEdit={can(ctx, "leads.edit")}
      />
    </>
  );
}
