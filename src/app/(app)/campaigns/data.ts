import "server-only";
import { listAccounts, listTemplates } from "@/modules/campaigns/queries";
import { listTags } from "@/modules/customers/queries";
import { listSources, listStatuses } from "@/modules/leads/config";
import { listBranches, listMembers } from "@/modules/team/queries";

/** Options for the campaign builder. */
export async function builderOptions(businessId: string) {
  const [accounts, templates, branches, tags, sources, statuses, members] = await Promise.all([
    listAccounts(businessId),
    listTemplates(businessId),
    listBranches(businessId),
    listTags(businessId),
    listSources(businessId),
    listStatuses(businessId),
    listMembers(businessId),
  ]);
  return {
    accounts: accounts.map((a) => ({ value: a.id, label: a.label, wabaId: a.wabaId })),
    templates: templates
      .filter((t) => t.status === "approved")
      .map((t) => ({
        value: t.id,
        label: `${t.name} (${t.language})`,
        body: t.components.body?.text ?? "",
        variableCount: t.variableCount,
        wabaId: t.wabaId,
        mediaHeader: t.components.header && t.components.header.format !== "TEXT" ? t.components.header.format : null,
      })),
    branches: branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: b.name })),
    tags: tags.map((t) => ({ value: t.id, label: t.name })),
    sources: sources.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name })),
    statuses: statuses.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name })),
    owners: members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name })),
  };
}
