import Link from "next/link";
import { ChevronLeft, ChevronRight, Footprints, Plus } from "lucide-react";
import { QuickContact } from "@/components/crm/quick-contact";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { type Appointment, listAppointments, listWalkIns } from "@/modules/appointments/queries";
import { localDateKey, parseLocalDate, startOfDay, startOfWeek } from "@/modules/tasks/schedule";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { OutcomeButtons } from "./appointment-forms";

export const metadata = { title: "Appointments" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const KIND: Record<string, string> = { consultation: "Consultation", measurement: "Measurement", trial: "Trial", alteration: "Alteration", delivery: "Delivery", other: "Appointment" };
const STATUS: Record<string, string> = { scheduled: "Scheduled", confirmed: "Confirmed", completed: "Arrived", no_show: "No-show", cancelled: "Cancelled" };
const selectClass = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13.5px]";

function Entry({ a, tz, people, canManage, compact }: { a: Appointment; tz: string; people: Map<string, string>; canManage: boolean; compact?: boolean }) {
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const done = a.status === "completed" || a.status === "no_show" || a.status === "cancelled";
  return (
    <li className={cn("flex flex-col gap-2 px-4 py-3 text-[13.5px]", done && "opacity-70")}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="w-[4.5rem] font-medium tabular-nums">{time.format(new Date(a.startsAt))}</span>
        <span className="font-medium">
          {a.customer ? <Link href={`/customers/${a.customer.id}`} className="hover:text-signal">{a.customer.fullName}</Link> : "Customer"}
        </span>
        <span className="text-muted">{KIND[a.kind]}{a.title ? ` · ${a.title}` : ""}</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11.5px] font-medium",
          a.status === "completed" ? "bg-stage-won/15" : a.status === "no_show" ? "bg-danger/10 text-danger" : a.status === "confirmed" ? "bg-stage-new/15" : "bg-line")}>
          {STATUS[a.status]}
        </span>
      </div>
      {!compact && (
        <>
          <p className="text-[12.5px] text-muted">
            {a.staffId ? `With ${people.get(a.staffId) ?? "former member"}` : "Nobody assigned"}
            {a.orderId && <> · <Link href={`/orders/${a.orderId}`} className="hover:text-signal">order</Link></>}
            {a.leadId && <> · <Link href={`/leads/${a.leadId}`} className="hover:text-signal">lead</Link></>}
          </p>
          {a.notes && <p className="text-[12.5px] whitespace-pre-line text-muted">{a.notes}</p>}
          <div className="flex flex-wrap items-start gap-2">
            <QuickContact phone={a.customer?.phone ?? null} compact />
            {canManage && <OutcomeButtons appointmentId={a.id} status={a.status} />}
          </div>
        </>
      )}
    </li>
  );
}

export default async function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  const ctx = await getContext();
  if (!can(ctx, "appointments.view")) return <NoAccess what="appointments" />;
  const sp = await searchParams;
  const tz = ctx.business.timezone;
  const now = new Date();
  const view = one(sp.view) === "week" ? "week" : "day";
  const day = parseLocalDate(one(sp.date), tz) ?? startOfDay(now, tz);
  const from = view === "week" ? startOfWeek(day, tz) : day;
  const to = startOfDay(from, tz, view === "week" ? 7 : 1);
  const filters = { branch: one(sp.branch) || undefined, staff: one(sp.staff) === "me" ? ctx.user.id : one(sp.staff) || undefined };

  const businessId = ctx.business.businessId;
  const [appointments, walkIns, branches, members] = await Promise.all([
    listAppointments(businessId, from, to, filters),
    view === "day" ? listWalkIns(businessId, from, to) : Promise.resolve([]),
    listBranches(businessId),
    listMembers(businessId),
  ]);
  const people = new Map(members.map((m) => [m.userId, m.name]));
  const canManage = can(ctx, "appointments.manage");
  const key = localDateKey(day, tz);
  const shift = (days: number) => localDateKey(startOfDay(from, tz, days), tz);
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ view, date: key, ...(filters.branch ? { branch: filters.branch } : {}), ...(one(sp.staff) ? { staff: one(sp.staff) } : {}), ...extra });
    return `/appointments?${p}`;
  };
  const fmtDay = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
  const fmtShort = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
  const todayKey = localDateKey(now, tz);
  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => startOfDay(from, tz, i)) : [day];
  const byDay = Object.groupBy(appointments, (a) => localDateKey(new Date(a.startsAt), tz));
  const noShows = appointments.filter((a) => a.status === "no_show").length;

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Consultations, measurements, trials and deliveries, plus everyone who walked in."
        actions={
          canManage ? (
            <>
              <Link href="/appointments/walk-in" className={linkButton.secondary}><Footprints className="size-4" /> Walk-in</Link>
              <Link href="/appointments/new" className={linkButton.primary}><Plus className="size-4" /> Book</Link>
            </>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link href={qs({ date: shift(view === "week" ? -7 : -1) })} aria-label="Previous" className="grid size-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface hover:bg-paper"><ChevronLeft className="size-4" /></Link>
          <Link href={qs({ date: todayKey })} className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] leading-9 font-medium hover:bg-paper">Today</Link>
          <Link href={qs({ date: shift(view === "week" ? 7 : 1) })} aria-label="Next" className="grid size-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface hover:bg-paper"><ChevronRight className="size-4" /></Link>
        </div>
        <h2 className="text-[15px] font-semibold">
          {view === "week" ? `Week of ${fmtShort.format(from)}` : fmtDay.format(day)}
        </h2>
        <nav aria-label="Calendar view" className="ml-auto inline-flex rounded-[var(--radius-control)] border border-line bg-surface p-0.5">
          {(["day", "week"] as const).map((v) => (
            <Link key={v} href={qs({ view: v })} aria-current={view === v ? "page" : undefined}
              className="h-8 rounded-[calc(var(--radius-control)-2px)] px-3 text-[13px] leading-8 text-muted capitalize aria-[current=page]:bg-paper aria-[current=page]:font-medium aria-[current=page]:text-text">
              {v}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={key} />
          {branches.length > 1 && (
            <select name="branch" defaultValue={filters.branch ?? ""} aria-label="Branch" className={selectClass}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <select name="staff" defaultValue={one(sp.staff)} aria-label="Staff" className={selectClass}>
            <option value="">Everyone</option>
            <option value="me">Mine</option>
            {members.filter((m) => m.status === "active").map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
          <button type="submit" className={linkButton.secondary}>Apply</button>
        </form>
      </div>

      {view === "week" ? (
        <div className="grid gap-3 md:grid-cols-7">
          {days.map((d) => {
            const k = localDateKey(d, tz);
            const list = byDay[k] ?? [];
            return (
              <Panel key={k} className={cn("min-w-0", k === todayKey && "border-signal")}>
                <Link href={qs({ view: "day", date: k })} className="block border-b border-line px-3 py-2 text-[13px] font-medium hover:text-signal">
                  {fmtShort.format(d)} <span className="font-normal text-muted">· {list.length}</span>
                </Link>
                {list.length ? (
                  <ul className="divide-y divide-line">
                    {list.map((a) => <Entry key={a.id} a={a} tz={tz} people={people} canManage={false} compact />)}
                  </ul>
                ) : (
                  <p className="px-3 py-3 text-[12.5px] text-muted">Free</p>
                )}
              </Panel>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Panel>
            <h3 className="flex justify-between border-b border-line px-4 py-3 text-[14px] font-semibold">
              Booked <span className="font-normal text-muted">{appointments.length}{noShows ? ` · ${noShows} no-show` : ""}</span>
            </h3>
            {appointments.length ? (
              <ul className="divide-y divide-line">
                {appointments.map((a) => <Entry key={a.id} a={a} tz={tz} people={people} canManage={canManage} />)}
              </ul>
            ) : (
              <EmptyState title="Nothing booked for this day" />
            )}
          </Panel>
          <Panel className="h-fit">
            <h3 className="flex justify-between border-b border-line px-4 py-3 text-[14px] font-semibold">
              Walk-ins <span className="font-normal text-muted">{walkIns.length}</span>
            </h3>
            {walkIns.length ? (
              <ul className="divide-y divide-line">
                {walkIns.map((w) => (
                  <li key={w.id} className="px-4 py-2.5 text-[13.5px]">
                    <p>
                      <span className="tabular-nums text-muted">{new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(w.visitedAt))}</span>{" "}
                      {w.leadId ? <Link href={`/leads/${w.leadId}`} className="font-medium hover:text-signal">{w.customer?.fullName ?? "Customer"}</Link> : w.customer?.fullName}
                    </p>
                    {w.purpose && <p className="text-[12.5px] text-muted">{w.purpose}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-[13px] text-muted">No walk-ins recorded.</p>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
