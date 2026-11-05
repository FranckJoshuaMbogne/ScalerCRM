import "server-only";
import { listTemplates } from "@/modules/campaigns/queries";
import { listSources, listStatuses } from "@/modules/leads/config";
import { listOrderStages } from "@/modules/orders/queries";
import { listMembers } from "@/modules/team/queries";
import { editorFields, recentLeads } from "@/modules/automation/queries";

/** Choices the workflow editor offers (stages, people, templates, fields, endpoints, leads to dry-run). */
export async function builderOptions(businessId: string) {
  const [statuses, stages, members, templates, sources, fields, leads] = await Promise.all([
    listStatuses(businessId),
    listOrderStages(businessId),
    listMembers(businessId),
    listTemplates(businessId),
    listSources(businessId),
    editorFields(businessId),
    recentLeads(businessId),
  ]);
  return {
    statuses: statuses.filter((s) => s.isActive).map((s) => ({ value: s.key, label: s.name })),
    stages: stages.filter((s) => s.isActive).map((s) => ({ value: s.key, label: s.name })),
    sources: sources.map((s) => ({ value: s.key, label: s.name })),
    people: members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name })),
    templates: templates.filter((t) => t.status === "approved").map((t) => ({ value: t.id, label: `${t.name} (${t.language})` })),
    customFields: fields.customFields,
    endpoints: fields.endpoints,
    leads,
  };
}

export type BuilderOptions = Awaited<ReturnType<typeof builderOptions>>;
