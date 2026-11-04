import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { FIELD_TYPE_LABELS, type FieldEntity } from "@/modules/custom-fields/engine";
import { setFieldActive } from "@/modules/custom-fields/actions";
import { listFieldDefinitions } from "@/modules/custom-fields/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { FieldDefinitionForm } from "./field-form";

export const metadata = { title: "Custom fields" };

const ENTITIES: { value: FieldEntity; title: string; note: string }[] = [
  { value: "lead", title: "Lead fields", note: "Asked when an enquiry comes in, e.g. garment type or occasion date." },
  { value: "customer", title: "Customer fields", note: "Kept on the customer file, e.g. body type or preferred fit." },
  { value: "order", title: "Order fields", note: "Asked on every order, e.g. occasion date, trial date or delivery instructions." },
];

export default async function CustomFieldsPage() {
  const ctx = await getContext();
  if (!can(ctx, "settings.custom_fields.manage")) return <NoAccess what="custom fields" />;
  const all = await listFieldDefinitions(ctx.business.businessId, undefined, { includeInactive: true });

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Settings
      </Link>
      <PageHeader
        title="Custom fields"
        description="Extra details your business tracks on leads, customers and orders. Hiding a field keeps the values already saved."
      />
      {ENTITIES.map((e) => {
        const defs = all.filter((d) => d.entity === e.value);
        return (
          <Panel key={e.value} className="mb-6">
            <div className="border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">{e.title}</h2>
              <p className="text-[13px] text-muted">{e.note}</p>
            </div>
            {defs.length === 0 ? (
              <EmptyState title="No fields yet" />
            ) : (
              <ul className="divide-y divide-line">
                {defs.map((d) => (
                  <li key={d.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <p className="min-w-[160px] flex-1 text-[14px] font-medium">
                        {d.label}
                        {d.required && <span className="ml-1 text-danger">*</span>}
                        {!d.isActive && <span className="ml-2 text-[12px] font-normal text-muted">Hidden</span>}
                      </p>
                      <p className="w-32 text-[13px] text-muted">{FIELD_TYPE_LABELS[d.type]}</p>
                      <p className="flex-1 truncate text-[13px] text-muted">{d.options.join(", ")}</p>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[13px] font-medium text-signal select-none">Edit</summary>
                      <div className="mt-3 flex flex-col gap-4 rounded-[var(--radius-control)] border border-line p-4">
                        <FieldDefinitionForm entity={e.value} field={d} />
                        <ActionForm action={setFieldActive} className="border-t border-line pt-4">
                          <input type="hidden" name="fieldId" value={d.id} />
                          <input type="hidden" name="active" value={String(!d.isActive)} />
                          <SubmitButton variant={d.isActive ? "danger" : "secondary"}>
                            {d.isActive ? "Hide field" : "Show field again"}
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <details className="border-t border-line px-5 py-3">
              <summary className="cursor-pointer text-[13px] font-medium text-signal select-none">Add a field</summary>
              <div className="mt-3">
                <FieldDefinitionForm entity={e.value} />
              </div>
            </details>
          </Panel>
        );
      })}
    </>
  );
}
