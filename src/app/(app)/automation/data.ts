import "server-only";
import { listTemplates } from "@/modules/campaigns/queries";
import { listStatuses } from "@/modules/leads/config";
import { listOrderStages } from "@/modules/orders/queries";
import { listMembers } from "@/modules/team/queries";

export async function builderOptions(businessId: string) {
  const [statuses, stages, members, templates] = await Promise.all([
    listStatuses(businessId),
    listOrderStages(businessId),
    listMembers(businessId),
    listTemplates(businessId),
  ]);
  return {
    statuses: statuses.filter((s) => s.isActive).map((s) => ({ value: s.key, label: s.name })),
    stages: stages.filter((s) => s.isActive).map((s) => ({ value: s.key, label: s.name })),
    people: members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name })),
    templates: templates.filter((t) => t.status === "approved").map((t) => ({ value: t.id, label: `${t.name} (${t.language})`, variables: t.variableCount })),
  };
}
