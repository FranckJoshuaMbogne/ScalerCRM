import { listMyDay } from "@/modules/tasks/queries";
import { startOfDay } from "@/modules/tasks/schedule";
import { getContext } from "@/modules/tenancy/session";

/**
 * My open tasks due by the end of today (overdue included), for the offline
 * screen. The service worker keeps the last copy on the phone.
 */
export async function GET() {
  const ctx = await getContext();
  const tz = ctx.business.timezone;
  const { open } = await listMyDay(ctx.business.businessId, { who: "me", userId: ctx.user.id }, tz);
  const endOfToday = startOfDay(new Date(), tz, 1).getTime();
  const tasks = open
    .filter((t) => new Date(t.dueAt).getTime() < endOfToday)
    .map((t) => ({
      id: t.id,
      title: t.title,
      type: t.type,
      dueAt: t.dueAt,
      customer: t.customer?.fullName ?? null,
      phone: t.customer?.phone ?? null,
      lead: t.lead?.leadNumber ?? null,
      link: t.leadId ? `/leads/${t.leadId}` : t.customerId ? `/customers/${t.customerId}` : "/tasks",
    }));
  return Response.json(
    { business: ctx.business.businessName, timeZone: tz, savedAt: new Date().toISOString(), tasks },
    { headers: { "cache-control": "private, no-store" } },
  );
}
