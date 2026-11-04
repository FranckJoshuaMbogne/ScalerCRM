import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";
import { listFieldDefinitions } from "@/modules/custom-fields/queries";
import { saveFormMapping } from "@/modules/integrations/ads-actions";
import { defaultTarget } from "@/modules/integrations/leads/mapping";
import { listSources } from "@/modules/leads/config";
import { listBranches } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Lead form mapping" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const select = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13.5px]";

export default async function FormMappingPage({ params }: PageProps<"/integrations/forms/[id]">) {
  const ctx = await getContext();
  if (!can(ctx, "integrations.manage")) return <NoAccess what="integrations" />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: form } = await supabase
    .from("lead_forms")
    .select("id, provider, external_form_id, name, fields, mapping, source_id, branch_id, leads_received")
    .eq("id", id)
    .maybeSingle();
  if (!form) notFound();
  const businessId = ctx.business.businessId;
  const [fields, sources, branches] = await Promise.all([listFieldDefinitions(businessId, "lead"), listSources(businessId), listBranches(businessId)]);
  const mapping = (form.mapping ?? {}) as Record<string, string>;
  const targets = [
    { value: "full_name", label: "Full name" },
    { value: "first_name", label: "First name" },
    { value: "last_name", label: "Last name" },
    { value: "phone", label: "Phone (matched to customer files)" },
    { value: "email", label: "Email" },
    { value: "note", label: "Add to the lead's notes" },
    ...fields.map((f) => ({ value: `custom:${f.key}`, label: `Custom field: ${f.label}` })),
    { value: "ignore", label: "Ignore" },
  ];

  return (
    <>
      <Link href="/integrations" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Integrations</Link>
      <PageHeader
        title={form.name ?? `Form ${form.external_form_id}`}
        description={`${form.provider === "meta" ? "Meta Lead Ads" : "Google Ads"} form · ${form.leads_received} leads so far. Fields appear here after the first lead arrives.`}
      />
      <Panel className="max-w-3xl p-5">
        <ActionForm action={saveFormMapping} className="flex flex-col gap-4">
          <input type="hidden" name="formId" value={form.id} />
          <table className="w-full text-[13.5px]">
            <thead className="text-left text-[12.5px] text-muted">
              <tr><th className="py-2 font-medium">Form field</th><th className="py-2 font-medium">Goes to</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(form.fields as string[]).map((f) => (
                <tr key={f}>
                  <td className="py-2 pr-3 font-mono text-[12.5px]">{f}</td>
                  <td className="py-2">
                    <select name={`map:${f}`} defaultValue={mapping[f] ?? defaultTarget(f)} aria-label={`Map ${f}`} className={`${select} w-full`}>
                      {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[13px] font-medium">Lead source
              <select name="sourceId" defaultValue={form.source_id ?? ""} className={select}>
                <option value="">Automatic (Meta ads, Instagram or Google ads)</option>
                {sources.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {branches.length > 1 && (
              <label className="flex flex-col gap-1 text-[13px] font-medium">Branch
                <select name="branchId" defaultValue={form.branch_id ?? ""} className={select}>
                  <option value="">No particular branch</option>
                  {branches.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <div><SubmitButton pendingLabel="Saving…">Save mapping</SubmitButton></div>
        </ActionForm>
      </Panel>
    </>
  );
}
