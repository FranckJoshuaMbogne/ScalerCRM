import Link from "next/link";
import type { CountryCode } from "libphonenumber-js";
import { Plus } from "lucide-react";
import { LeadViewSwitch } from "@/components/crm/lead-view-switch";
import { Pager } from "@/components/crm/pager";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel, StatusBadge } from "@/components/ui/primitives";
import { formatMoney, formatPhone } from "@/lib/format";
import { listSources, listStatuses } from "@/modules/leads/config";
import { countUnassignedLeads, type LeadFilters, LEADS_PAGE_SIZE, listLeads } from "@/modules/leads/queries";
import { describeDue } from "@/modules/tasks/schedule";
import { SavedViews } from "@/components/crm/saved-views";
import { listSavedViews } from "@/modules/analytics/queries";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Leads" };

const VIEWS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Won or lost" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "Everything" },
] as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const selectClass =
  "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13.5px] focus:border-signal focus:outline-none";

function FollowUp({
  at,
  now,
  tz,
  owner,
  className,
}: {
  at: string | null;
  now: Date;
  tz: string;
  owner?: string | null;
  className?: string;
}) {
  if (!at) {
    return owner === null ? <p className={`text-[12px] text-muted ${className ?? ""}`}>Unassigned</p> : <span className="text-[12.5px] text-muted">—</span>;
  }
  const overdue = new Date(at) < now;
  return (
    <p className={`text-[12.5px] tabular-nums ${overdue ? "font-medium text-danger" : "text-muted"} ${className ?? ""}`}>
      {describeDue(new Date(at), now, tz)}
    </p>
  );
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const ctx = await getContext();
  const canAll = can(ctx, "leads.view_all");
  if (!canAll && !can(ctx, "leads.view_assigned")) return <NoAccess what="leads" />;

  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.value === one(sp.view))?.value ?? "open") as LeadFilters["view"];
  const filters: LeadFilters = {
    q: one(sp.q) || undefined,
    status: one(sp.status) || undefined,
    source: one(sp.source) || undefined,
    branch: one(sp.branch) || undefined,
    owner: one(sp.owner) || undefined,
    view,
    sort: one(sp.sort) === "score" ? "score" : "recent",
    page: Number(one(sp.page)) || 1,
  };

  const businessId = ctx.business.businessId;
  const [statuses, sources, branches, members] = await Promise.all([
    listStatuses(businessId),
    listSources(businessId),
    listBranches(businessId),
    listMembers(businessId),
  ]);
  const closed = statuses.filter((s) => s.category !== "open").map((s) => s.id);
  const openIds = statuses.filter((s) => s.category === "open").map((s) => s.id);
  const [{ items, total }, unassigned, views] = await Promise.all([
    listLeads(businessId, ctx.user.id, ctx.business.countryCode as CountryCode, filters, closed),
    canAll ? countUnassignedLeads(businessId, openIds) : Promise.resolve(0),
    listSavedViews(businessId, "leads", ctx.user.id),
  ]);
  const savedQuery = new URLSearchParams(
    Object.entries({ view, q: filters.q, status: filters.status, source: filters.source, branch: filters.branch, owner: filters.owner, sort: filters.sort === "score" ? "score" : undefined })
      .filter(([, v]) => v) as [string, string][],
  ).toString();
  const now = new Date();
  const tz = ctx.business.timezone;

  const status = new Map(statuses.map((s) => [s.id, s]));
  const source = new Map(sources.map((s) => [s.id, s.name]));
  const branch = new Map(branches.map((b) => [b.id, b.name]));
  const person = new Map(members.map((m) => [m.userId, m.name]));
  const filtered = Boolean(filters.q || filters.status || filters.source || filters.branch || filters.owner);

  return (
    <>
      <PageHeader
        title="Leads"
        description={
          canAll
            ? "Every enquiry, newest activity first. Each lead belongs to one customer file."
            : "Leads assigned to you, newest activity first."
        }
        actions={
          <>
            <LeadViewSwitch current="/leads" unassigned={unassigned} />
            {can(ctx, "leads.create") && (
              <Link href="/leads/new" className={linkButton.primary}>
                <Plus className="size-4" /> Add lead
              </Link>
            )}
          </>
        }
      />

      <nav aria-label="Lead views" className="mb-3 flex gap-1 overflow-x-auto">
        {VIEWS.map((v) => {
          const params = new URLSearchParams({ ...(filters.q ? { q: filters.q } : {}), view: v.value });
          return (
            <Link
              key={v.value}
              href={`/leads?${params}`}
              aria-current={view === v.value ? "page" : undefined}
              className="rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap text-muted hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:font-medium aria-[current=page]:text-text aria-[current=page]:shadow-sm"
            >
              {v.label}
            </Link>
          );
        })}
      </nav>

      <SavedViews page="leads" path="/leads" views={views} query={savedQuery} />

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <input type="hidden" name="view" value={view} />
        <label className="min-w-[220px] flex-1">
          <span className="sr-only">Search leads</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Name, phone, CIF or lead number"
            className={`${selectClass} w-full px-3`}
          />
        </label>
        <select name="status" defaultValue={filters.status ?? ""} aria-label="Status" className={selectClass}>
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="source" defaultValue={filters.source ?? ""} aria-label="Source" className={selectClass}>
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {branches.length > 1 && (
          <select name="branch" defaultValue={filters.branch ?? ""} aria-label="Branch" className={selectClass}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {canAll && (
          <select name="owner" defaultValue={filters.owner ?? ""} aria-label="Owner" className={selectClass}>
            <option value="">Anyone</option>
            <option value="me">Mine</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <select name="sort" defaultValue={filters.sort} aria-label="Sort" className={selectClass}>
          <option value="recent">Recent activity</option>
          <option value="score">Hottest first</option>
        </select>
        <button type="submit" className={linkButton.secondary}>
          Apply
        </button>
        {filtered && (
          <Link href={`/leads?view=${view}`} className="px-2 text-[13px] text-muted hover:text-text">
            Clear
          </Link>
        )}
      </form>

      <Panel>
        {items.length === 0 ? (
          <EmptyState title={filtered ? "No leads match these filters" : "No leads here yet"}>
            {can(ctx, "leads.create") && !filtered && (
              <Link href="/leads/new" className="font-medium text-signal hover:underline">
                Add the first one
              </Link>
            )}
          </EmptyState>
        ) : (
          <>
            {/* Cards on phones, table from md up */}
            <ul className="divide-y divide-line md:hidden">
              {items.map((l) => {
                const s = status.get(l.statusId);
                return (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="block px-4 py-3 active:bg-paper">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[14px] font-medium">{l.customer?.fullName ?? "Unknown"}</p>
                        {s && <StatusBadge stage={s.stage} name={s.name} />}
                      </div>
                      <p className="mt-0.5 truncate text-[12.5px] text-muted">
                        {l.leadNumber} · {formatPhone(l.customer?.phone)}
                        {l.title ? ` · ${l.title}` : ""}
                      </p>
                      <FollowUp at={l.nextFollowUpAt} now={now} tz={tz} owner={l.ownerId} className="mt-1" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[13.5px]">
                <thead className="border-b border-line text-left text-[12.5px] text-muted">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Lead</th>
                    <th className="px-3 py-2.5 font-medium">Customer</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Source</th>
                    <th className="px-3 py-2.5 font-medium">Owner</th>
                    <th className="px-3 py-2.5 font-medium">Next follow-up</th>
                    <th className="px-5 py-2.5 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((l) => {
                    const s = status.get(l.statusId);
                    return (
                      <tr key={l.id} className="hover:bg-paper/60">
                        <td className="px-5 py-2.5">
                          <Link href={`/leads/${l.id}`} className="font-medium hover:text-signal">
                            {l.leadNumber}
                          </Link>
                          {l.score > 0 && <span title="Lead score" className="ml-1.5 rounded bg-stage-negotiation/15 px-1 text-[11px] font-semibold tabular-nums">{l.score}</span>}
                          <p className="max-w-[220px] truncate text-[12.5px] text-muted">{l.title ?? "—"}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          {l.customer ? (
                            <Link href={`/customers/${l.customer.id}`} className="hover:text-signal">
                              {l.customer.fullName}
                            </Link>
                          ) : (
                            "—"
                          )}
                          <p className="text-[12.5px] text-muted tabular-nums">{formatPhone(l.customer?.phone)}</p>
                        </td>
                        <td className="px-3 py-2.5">{s && <StatusBadge stage={s.stage} name={s.name} />}</td>
                        <td className="px-3 py-2.5 text-muted">
                          {(l.sourceId && source.get(l.sourceId)) ?? "—"}
                          {l.branchId && branches.length > 1 && (
                            <p className="text-[12px]">{branch.get(l.branchId)}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted">
                          {l.ownerId ? (person.get(l.ownerId) ?? "Former member") : "Unassigned"}
                        </td>
                        <td className="px-3 py-2.5">
                          <FollowUp at={l.nextFollowUpAt} now={now} tz={tz} />
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          {formatMoney(l.expectedValue, ctx.business.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Pager basePath="/leads" params={sp} page={filters.page ?? 1} pageSize={LEADS_PAGE_SIZE} total={total} />
    </>
  );
}
