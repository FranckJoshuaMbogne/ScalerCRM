"use client";

import { useActionState } from "react";
import { CustomFieldInputs } from "@/components/crm/custom-field-inputs";
import { type CatalogOption, type EditorLine, LineItemsEditor, type MeasurementOption } from "@/components/crm/line-items-editor";
import { Field, FormMessage, SelectField, SubmitButton, TextAreaField } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import type { CustomValues, FieldDefinition } from "@/modules/custom-fields/engine";
import {
  convertQuotation,
  createSalesDocument,
  moveOrderStage,
  recordPayment,
  saveDocumentItems,
  updateOrderDetails,
} from "@/modules/orders/actions";

type Option = { value: string; label: string };

export function NewDocumentForm({
  kind,
  customerId,
  leadId,
  branches,
  owners,
  fields,
  catalog,
  measurements,
  currency,
  tailoring,
}: {
  kind: "order" | "quotation";
  customerId: string;
  leadId: string | null;
  branches: Option[];
  owners: Option[];
  fields: FieldDefinition[];
  catalog: CatalogOption[];
  measurements: MeasurementOption[];
  currency: string;
  tailoring: boolean;
}) {
  const [state, action] = useActionState(createSalesDocument, initialState);
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="customerId" value={customerId} />
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      <LineItemsEditor catalog={catalog} measurements={measurements} currency={currency} tailoring={tailoring} />
      <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
        {kind === "order" ? (
          <Field label="Delivery date" name="dueDate" type="date" state={state} />
        ) : (
          <Field label="Valid until" name="validUntil" type="date" hint="Defaults to 15 days from today." state={state} />
        )}
        {branches.length > 1 && (
          <SelectField label="Branch" name="branchId" state={state} options={[{ value: "", label: "Customer's branch" }, ...branches]} />
        )}
        {kind === "order" && owners.length > 0 && (
          <SelectField label="Salesperson" name="ownerId" state={state} options={[{ value: "", label: "Me" }, ...owners]} />
        )}
        <TextAreaField label="Notes" name="notes" className="sm:col-span-2" state={state} />
        {kind === "order" && <CustomFieldInputs definitions={fields} state={state} idPrefix="order" />}
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Saving…">{kind === "order" ? "Create order" : "Create quotation"}</SubmitButton>
      </div>
    </form>
  );
}

export function EditLinesForm({
  kind,
  documentId,
  lines,
  catalog,
  measurements,
  currency,
  tailoring,
}: {
  kind: "order" | "quotation";
  documentId: string;
  lines: EditorLine[];
  catalog: CatalogOption[];
  measurements: MeasurementOption[];
  currency: string;
  tailoring: boolean;
}) {
  const [state, action] = useActionState(saveDocumentItems, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="documentId" value={documentId} />
      <LineItemsEditor initial={lines} catalog={catalog} measurements={measurements} currency={currency} tailoring={tailoring} />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">Save lines</SubmitButton>
      </div>
    </form>
  );
}

export function StageForm({ orderId, stageId, stages }: { orderId: string; stageId: string; stages: Option[] }) {
  const [state, action] = useActionState(moveOrderStage, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <div className="flex gap-2">
        <SelectField label="Stage" name="stageId" id="order-stage" defaultValue={stageId} options={stages} className="flex-1" />
        <SubmitButton variant="secondary" className="mt-auto" pendingLabel="…">Move</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function PaymentForm({ orderId, kind, balance }: { orderId: string; kind: "payment" | "refund"; balance: string }) {
  const [state, action] = useActionState(recordPayment, initialState);
  const p = `pay-${kind}`;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" name="amount" id={`${p}-amount`} inputMode="decimal" required
          placeholder={kind === "payment" ? balance : ""} state={state} />
        <SelectField label="Method" name="method" id={`${p}-method`} state={state}
          options={[
            { value: "upi", label: "UPI" },
            { value: "cash", label: "Cash" },
            { value: "card", label: "Card" },
            { value: "bank_transfer", label: "Bank transfer" },
            { value: "cheque", label: "Cheque" },
            { value: "other", label: "Other" },
          ]} />
        <Field label="Reference" name="reference" id={`${p}-ref`} placeholder="UPI or cheque number" state={state} />
        <Field label="Note" name="notes" id={`${p}-notes`} state={state} />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={kind === "refund" ? "danger" : "primary"} pendingLabel="Saving…">
          {kind === "refund" ? "Record refund" : "Record payment"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function OrderDetailsForm({
  order,
  branches,
  owners,
  fields,
}: {
  order: { id: string; dueDate: string | null; notes: string | null; branchId: string | null; ownerId: string | null; customFields: CustomValues };
  branches: Option[];
  owners: Option[];
  fields: FieldDefinition[];
}) {
  const [state, action] = useActionState(updateOrderDetails, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="orderId" value={order.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Delivery date" name="dueDate" type="date" defaultValue={order.dueDate ?? ""} state={state} />
        {branches.length > 1 ? (
          <SelectField label="Branch" name="branchId" defaultValue={order.branchId ?? ""} state={state}
            options={[{ value: "", label: "No particular branch" }, ...branches]} />
        ) : (
          <input type="hidden" name="branchId" value={order.branchId ?? ""} />
        )}
        {owners.length > 0 && (
          <SelectField label="Salesperson" name="ownerId" defaultValue={order.ownerId ?? ""} state={state} options={owners} />
        )}
        <TextAreaField label="Notes" name="notes" defaultValue={order.notes ?? ""} className="sm:col-span-2" state={state} />
        <CustomFieldInputs definitions={fields} values={order.customFields} state={state} idPrefix="orderedit" />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">Save details</SubmitButton>
      </div>
    </form>
  );
}

export function ConvertForm({ quotationId }: { quotationId: string }) {
  const [state, action] = useActionState(convertQuotation, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="quotationId" value={quotationId} />
      <Field label="Delivery date" name="dueDate" id="convert-due" type="date" />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Creating order…">Accept and create order</SubmitButton>
      </div>
    </form>
  );
}
