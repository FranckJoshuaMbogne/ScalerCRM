"use client";

import { useActionState } from "react";
import { Field, FormMessage, SelectField, SubmitButton, TextAreaField } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { saveCatalogItem, saveMeasurementTemplate, saveOrderStage } from "@/modules/orders/settings-actions";

export function CatalogItemForm({
  item,
}: {
  item?: { id: string; name: string; kind: string; sku: string | null; category: string | null; unitPrice: string; taxRate: string };
}) {
  const [state, action] = useActionState(saveCatalogItem, initialState);
  const p = item?.id ?? "new";
  return (
    <form action={action} className="flex flex-col gap-3">
      {item && <input type="hidden" name="itemId" value={item.id} />}
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Name" name="name" id={`ci-name-${p}`} defaultValue={item?.name} required maxLength={120} className="sm:col-span-2" state={state} />
        <SelectField label="Type" name="kind" id={`ci-kind-${p}`} defaultValue={item?.kind ?? "product"} state={state}
          options={[{ value: "product", label: "Product" }, { value: "service", label: "Service" }]} />
        <Field label="Category" name="category" id={`ci-cat-${p}`} defaultValue={item?.category ?? ""} placeholder="Suits" state={state} />
        <Field label="Price" name="unitPrice" id={`ci-price-${p}`} defaultValue={item?.unitPrice} inputMode="decimal" required state={state} />
        <Field label="Tax %" name="taxRate" id={`ci-tax-${p}`} defaultValue={item?.taxRate ?? "0"} inputMode="decimal" state={state} />
        <Field label="SKU" name="sku" id={`ci-sku-${p}`} defaultValue={item?.sku ?? ""} maxLength={40} state={state} />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={item ? "secondary" : "primary"} pendingLabel="Saving…">{item ? "Save item" : "Add item"}</SubmitButton>
      </div>
    </form>
  );
}

export function OrderStageForm({ stage }: { stage?: { id: string; name: string } }) {
  const [state, action] = useActionState(saveOrderStage, initialState);
  const p = stage?.id ?? "new";
  return (
    <form action={action} className="flex flex-col gap-2">
      {stage && <input type="hidden" name="stageId" value={stage.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={stage ? "Name" : "New stage"} name="name" id={`os-${p}`} defaultValue={stage?.name} required maxLength={60} className="min-w-40 flex-1" state={state} />
        {!stage && (
          <SelectField label="Type" name="category" id="os-cat" state={state}
            options={[{ value: "open", label: "In progress" }, { value: "done", label: "Delivered" }, { value: "cancelled", label: "Cancelled" }]} />
        )}
        <SubmitButton variant="secondary" pendingLabel="…">{stage ? "Rename" : "Add"}</SubmitButton>
      </div>
      {state.message && <FormMessage state={state} />}
    </form>
  );
}

export function TemplateForm({ template }: { template?: { id: string; garment: string; fields: { key: string; label: string }[] } }) {
  const [state, action] = useActionState(saveMeasurementTemplate, initialState);
  const p = template?.id ?? "new";
  return (
    <form action={action} className="flex flex-col gap-3">
      {template && <input type="hidden" name="templateId" value={template.id} />}
      <Field label="Garment" name="garment" id={`mt-g-${p}`} defaultValue={template?.garment} required maxLength={60} state={state} />
      <TextAreaField label="Measurements, one per line" name="fields" id={`mt-f-${p}`} rows={5}
        defaultValue={template?.fields.map((f) => f.label).join("\n")} placeholder={"Chest\nWaist\nSleeve"} state={state}
        hint="Renaming keeps saved readings; removing a line hides it from new sessions only." />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={template ? "secondary" : "primary"} pendingLabel="Saving…">{template ? "Save template" : "Add template"}</SubmitButton>
      </div>
    </form>
  );
}
