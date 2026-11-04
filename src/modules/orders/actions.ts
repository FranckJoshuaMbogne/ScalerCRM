"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, echo, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { readCustomFields } from "@/modules/custom-fields/engine";
import { listFieldDefinitions } from "@/modules/custom-fields/queries";
import { guard } from "@/modules/tenancy/guard";
import { can, getContext, requirePermission } from "@/modules/tenancy/session";
import { toScaled } from "./money";

const decimal = (scale: number, label: string, opts: { min?: bigint; max?: bigint } = {}) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ""))
    .refine((v) => {
      const n = toScaled(v, scale);
      return n !== null && (opts.min === undefined || n >= opts.min) && (opts.max === undefined || n <= opts.max);
    }, label);

const itemSchema = z
  .object({
    catalogItemId: z.union([z.uuid(), z.literal("")]).nullish(),
    description: z.string().trim().min(1, "Describe each line.").max(300),
    quantity: decimal(3, "Quantity must be a number above zero, up to 3 decimals.", { min: BigInt(1) }),
    unitPrice: decimal(2, "Price must be an amount like 1250 or 1250.50.", { min: BigInt(0), max: BigInt("99999999999999") }),
    discount: decimal(2, "Discount must be an amount like 100 or 99.50.", { min: BigInt(0) }).default("0"),
    taxRate: decimal(2, "Tax must be a percentage between 0 and 100.", { min: BigInt(0), max: BigInt(10000) }).default("0"),
    garment: z.string().trim().max(60).nullish(),
    fabric: z.string().trim().max(120).nullish(),
    measurementId: z.union([z.uuid(), z.literal("")]).nullish(),
  });

const itemsSchema = z.array(itemSchema).min(1, "Add at least one line.").max(100, "Keep it under 100 lines.");

/** The line editor posts its rows as JSON in one hidden field. */
function readItems(form: FormData): { ok: true; items: Record<string, unknown>[] } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("items") ?? "[]"));
  } catch {
    return { ok: false, message: "The lines couldn't be read. Try again." };
  }
  const parsed = itemsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const row = typeof issue.path[0] === "number" ? `Line ${issue.path[0] + 1}: ` : "";
    return { ok: false, message: row + issue.message };
  }
  for (const [i, l] of parsed.data.entries()) {
    const gross = ((toScaled(l.quantity, 3) ?? BigInt(0)) * (toScaled(l.unitPrice, 2) ?? BigInt(0))) / BigInt(1000);
    if ((toScaled(l.discount, 2) ?? BigInt(0)) > gross) {
      return { ok: false, message: `Line ${i + 1}: the discount is more than the line.` };
    }
  }
  return {
    ok: true,
    items: parsed.data.map((l) => ({
      catalog_item_id: l.catalogItemId || null,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      discount: l.discount,
      tax_rate: l.taxRate,
      garment: l.garment || null,
      fabric: l.fabric || null,
      measurement_id: l.measurementId || null,
    })),
  };
}

const optionalId = z
  .union([z.uuid(), z.literal("")])
  .nullish()
  .transform((v) => v || null);
const optionalDate = z
  .union([z.iso.date("Pick a valid date."), z.literal("")])
  .nullish()
  .transform((v) => v || null);

const headerSchema = z.object({
  kind: z.enum(["order", "quotation"]),
  customerId: z.uuid("Choose a customer."),
  leadId: optionalId,
  branchId: optionalId,
  ownerId: optionalId,
  dueDate: optionalDate,
  validUntil: optionalDate,
  notes: z.string().trim().max(4000).optional(),
});

export async function createSalesDocument(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("orders.create");
    const parsed = headerSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message, values: echo(form) };
    const d = parsed.data;
    const items = readItems(form);
    if (!items.ok) return { ok: false, message: items.message, values: echo(form) };

    const supabase = await createClient();
    if (d.kind === "quotation") {
      const { data, error } = await supabase.rpc("create_quotation", {
        p_business_id: ctx.business.businessId,
        p_input: {
          customer_id: d.customerId,
          lead_id: d.leadId,
          branch_id: d.branchId,
          valid_until: d.validUntil,
          notes: d.notes,
          items: items.items,
        },
      });
      if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
      redirect(`/orders/quotations/${(data as { quotation_id: string }).quotation_id}?created=1`);
    }

    const defs = await listFieldDefinitions(ctx.business.businessId, "order");
    const custom = readCustomFields(defs, form);
    if (Object.keys(custom.errors).length) {
      return { ok: false, message: "Check the highlighted fields.", fieldErrors: custom.errors, values: echo(form) };
    }
    const { data, error } = await supabase.rpc("create_order", {
      p_business_id: ctx.business.businessId,
      p_input: {
        customer_id: d.customerId,
        lead_id: d.leadId,
        branch_id: d.branchId,
        owner_id: d.ownerId,
        due_date: d.dueDate,
        notes: d.notes,
        custom_fields: custom.values,
        items: items.items,
      },
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    redirect(`/orders/${(data as { order_id: string }).order_id}?created=1`);
  });
}

export async function saveDocumentItems(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const kind = z.enum(["order", "quotation"]).parse(form.get("kind"));
    await requirePermission(kind === "order" ? "orders.edit" : "orders.create");
    const id = z.uuid().parse(form.get("documentId"));
    const items = readItems(form);
    if (!items.ok) return { ok: false, message: items.message };
    const supabase = await createClient();
    const { error } =
      kind === "order"
        ? await supabase.rpc("replace_order_items", { p_order_id: id, p_items: items.items })
        : await supabase.rpc("replace_quotation_items", { p_quotation_id: id, p_items: items.items });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Lines saved." };
  });
}

export async function moveOrderStage(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, "orders.edit") && !can(ctx, "orders.fulfil")) {
      return { ok: false, message: "You don't have permission to move orders." };
    }
    const id = z.uuid().parse(form.get("orderId"));
    const stageId = z.uuid().parse(form.get("stageId"));
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("orders")
      .update({ stage_id: stageId })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "You can't move this order." };
    refresh();
    return { ok: true, message: "Stage updated." };
  });
}

const detailsSchema = z.object({
  orderId: z.uuid(),
  dueDate: optionalDate,
  notes: z.string().trim().max(4000).optional(),
  branchId: optionalId,
  ownerId: optionalId,
});

export async function updateOrderDetails(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("orders.edit");
    const parsed = detailsSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = parsed.data;
    const defs = await listFieldDefinitions(ctx.business.businessId, "order");
    const custom = readCustomFields(defs, form);
    if (Object.keys(custom.errors).length) {
      return { ok: false, message: "Check the highlighted fields.", fieldErrors: custom.errors };
    }
    const supabase = await createClient();
    const { data: current } = await supabase.from("orders").select("custom_fields").eq("id", d.orderId).maybeSingle();
    const active = new Set(defs.map((f) => f.key));
    const kept = Object.fromEntries(Object.entries(current?.custom_fields ?? {}).filter(([k]) => !active.has(k)));
    const row: Record<string, unknown> = {
      due_date: d.dueDate,
      notes: d.notes || null,
      branch_id: d.branchId,
      custom_fields: { ...kept, ...custom.values },
    };
    if (form.has("ownerId") && d.ownerId) row.owner_id = d.ownerId;
    const { data, error } = await supabase
      .from("orders")
      .update(row)
      .eq("id", d.orderId)
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "You can't edit this order." };
    refresh();
    return { ok: true, message: "Order saved." };
  });
}

const paymentSchema = z.object({
  orderId: z.uuid(),
  kind: z.enum(["payment", "refund"]),
  amount: decimal(2, "Enter an amount like 5000 or 5000.50.", { min: BigInt(1) }),
  method: z.enum(["cash", "upi", "card", "bank_transfer", "cheque", "other"]),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function recordPayment(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const kind = form.get("kind") === "refund" ? "refund" : "payment";
    const ctx = await requirePermission(kind === "refund" ? "payments.refund" : "payments.record");
    const parsed = paymentSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0].message, fieldErrors: { amount: parsed.error.issues[0].message }, values: echo(form) };
    }
    const d = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("payments")
      .insert({
        business_id: ctx.business.businessId,
        order_id: d.orderId,
        kind: d.kind,
        amount: d.amount,
        method: d.method,
        reference: d.reference || null,
        notes: d.notes || null,
      })
      .select("receipt_number")
      .single();
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    refresh();
    return { ok: true, message: `${d.kind === "refund" ? "Refund" : "Payment"} recorded. Receipt ${data.receipt_number}.` };
  });
}

export async function setQuotationStatus(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("orders.create");
    const id = z.uuid().parse(form.get("quotationId"));
    const status = z.enum(["draft", "sent", "declined", "expired"]).parse(form.get("status"));
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("quotations")
      .update({ status })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId)
      .in("status", ["draft", "sent"])
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "This quotation can't be changed." };
    refresh();
    return { ok: true, message: status === "sent" ? "Marked as sent." : "Quotation updated." };
  });
}

export async function convertQuotation(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission("orders.create");
    const id = z.uuid().parse(form.get("quotationId"));
    const dueDate = optionalDate.parse(form.get("dueDate") ?? "");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("convert_quotation", {
      p_quotation_id: id,
      p_input: { due_date: dueDate },
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    redirect(`/orders/${(data as { order_id: string }).order_id}?created=1`);
  });
}
