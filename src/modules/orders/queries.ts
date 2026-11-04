import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { CustomValues } from "@/modules/custom-fields/engine";

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

const NONE = "00000000-0000-0000-0000-000000000000";

// ------------------------------------------------------------------ configuration

export type OrderStage = { id: string; key: string; name: string; category: "open" | "done" | "cancelled"; position: number; isActive: boolean };

export const listOrderStages = cache(async (businessId: string): Promise<OrderStage[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_stages")
    .select("id, key, name, category, position, is_active")
    .eq("business_id", businessId)
    .order("position");
  if (error) fail("fulfilment stages", error);
  return (data ?? []).map((s) => ({ id: s.id, key: s.key, name: s.name, category: s.category, position: s.position, isActive: s.is_active }));
});

export type CatalogItem = {
  id: string;
  kind: "product" | "service";
  sku: string | null;
  name: string;
  category: string | null;
  unitPrice: string;
  taxRate: string;
  isActive: boolean;
};

export const listCatalog = cache(async (businessId: string): Promise<CatalogItem[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .select("id, kind, sku, name, category, unit_price, tax_rate, is_active")
    .eq("business_id", businessId)
    .order("category", { nullsFirst: true })
    .order("name");
  if (error) fail("catalogue", error);
  return (data ?? []).map((c) => ({
    id: c.id,
    kind: c.kind,
    sku: c.sku,
    name: c.name,
    category: c.category,
    unitPrice: String(c.unit_price),
    taxRate: String(c.tax_rate),
    isActive: c.is_active,
  }));
});

// ------------------------------------------------------------------ orders

export type OrderListItem = {
  id: string;
  orderNumber: string;
  stageId: string;
  total: string;
  netPaid: string;
  balance: string;
  dueDate: string | null;
  ownerId: string | null;
  branchId: string | null;
  createdAt: string;
  customer: { id: string; fullName: string; phone: string | null } | null;
};

export const ORDERS_PAGE_SIZE = 25;

export type OrderFilters = { stage?: string; view?: "open" | "closed" | "all"; owner?: string; q?: string; page?: number; due?: "overdue" | "" };

type OrderRow = {
  id: string;
  order_number: string;
  stage_id: string;
  total: number | string;
  due_date: string | null;
  owner_id: string | null;
  branch_id: string | null;
  created_at: string;
  customer_id: string;
};

async function hydrateOrders(rows: OrderRow[]): Promise<OrderListItem[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const ids = rows.map((r) => r.id);
  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  const [{ data: balances }, { data: customers }] = await Promise.all([
    supabase.from("order_balances").select("order_id, net_paid, balance").in("order_id", ids),
    supabase.from("customers").select("id, full_name, primary_phone").in("id", customerIds),
  ]);
  const bal = new Map((balances ?? []).map((b) => [b.order_id, b]));
  const cust = new Map((customers ?? []).map((c) => [c.id, { id: c.id, fullName: c.full_name, phone: c.primary_phone }]));
  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    stageId: r.stage_id,
    total: String(r.total),
    netPaid: String(bal.get(r.id)?.net_paid ?? "0"),
    balance: String(bal.get(r.id)?.balance ?? r.total),
    dueDate: r.due_date,
    ownerId: r.owner_id,
    branchId: r.branch_id,
    createdAt: r.created_at,
    customer: cust.get(r.customer_id) ?? null,
  }));
}

const ORDER_COLUMNS = "id, order_number, stage_id, total, due_date, owner_id, branch_id, created_at, customer_id";

export async function listOrders(
  businessId: string,
  userId: string,
  filters: OrderFilters,
  stages: OrderStage[],
  customerIds?: string[] | null,
) {
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase
    .from("orders")
    .select(ORDER_COLUMNS, { count: "exact" })
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .range((page - 1) * ORDERS_PAGE_SIZE, page * ORDERS_PAGE_SIZE - 1);
  const open = stages.filter((s) => s.category === "open").map((s) => s.id);
  const view = filters.view ?? "open";
  if (view === "open") query = query.in("stage_id", open.length ? open : [NONE]);
  if (view === "closed") query = query.not("stage_id", "in", `(${open.join(",") || NONE})`);
  if (filters.stage) query = query.eq("stage_id", filters.stage);
  if (filters.owner === "me") query = query.eq("owner_id", userId);
  else if (filters.owner) query = query.eq("owner_id", filters.owner);
  if (filters.due === "overdue") query = query.lt("due_date", new Date().toISOString().slice(0, 10)).in("stage_id", open.length ? open : [NONE]);
  if (customerIds) {
    const term = filters.q?.trim() ?? "";
    const ors = [`order_number.ilike.%${term.replace(/[%,()]/g, "")}%`];
    if (customerIds.length) ors.push(`customer_id.in.(${customerIds.join(",")})`);
    query = query.or(ors.join(","));
  }
  const { data, error, count } = await query.returns<OrderRow[]>();
  if (error) fail("orders", error);
  return { total: count ?? 0, items: await hydrateOrders(data ?? []) };
}

export async function listCustomerOrders(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<OrderRow[]>();
  if (error) fail("orders", error);
  return hydrateOrders(data ?? []);
}

export type LineItem = {
  id: string;
  catalogItemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
  gross: string;
  taxAmount: string;
  lineTotal: string;
  garment: string | null;
  fabric: string | null;
  measurementId: string | null;
};

const ITEM_COLUMNS =
  "id, catalog_item_id, description, quantity, unit_price, discount, tax_rate, gross, tax_amount, line_total, garment, fabric, measurement_id";

type ItemRow = {
  id: string;
  catalog_item_id: string | null;
  description: string;
  quantity: number | string;
  unit_price: number | string;
  discount: number | string;
  tax_rate: number | string;
  gross: number | string;
  tax_amount: number | string;
  line_total: number | string;
  garment: string | null;
  fabric: string | null;
  measurement_id: string | null;
};

const toItem = (i: ItemRow): LineItem => ({
  id: i.id,
  catalogItemId: i.catalog_item_id,
  description: i.description,
  quantity: String(i.quantity),
  unitPrice: String(i.unit_price),
  discount: String(i.discount),
  taxRate: String(i.tax_rate),
  gross: String(i.gross),
  taxAmount: String(i.tax_amount),
  lineTotal: String(i.line_total),
  garment: i.garment,
  fabric: i.fabric,
  measurementId: i.measurement_id,
});

export type Payment = {
  id: string;
  receiptNumber: string;
  kind: "payment" | "refund";
  amount: string;
  method: string;
  reference: string | null;
  notes: string | null;
  receivedAt: string;
  recordedBy: string | null;
};

export type OrderDetail = {
  id: string;
  orderNumber: string;
  stageId: string;
  customerId: string;
  leadId: string | null;
  quotationId: string | null;
  branchId: string | null;
  ownerId: string | null;
  dueDate: string | null;
  notes: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  netPaid: string;
  balance: string;
  customFields: CustomValues;
  closedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  items: LineItem[];
  payments: Payment[] | null; // null when the viewer can't see payments
  history: { id: number; fromStageId: string | null; toStageId: string; changedBy: string | null; changedAt: string }[];
};

export async function getOrder(id: string, canSeePayments: boolean): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const { data: o, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, stage_id, customer_id, lead_id, quotation_id, branch_id, owner_id, due_date, notes, subtotal, discount_total, tax_total, total, custom_fields, closed_at, created_at, created_by",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) fail("order", error);
  if (!o) return null;
  const [{ data: items }, { data: balance }, payments, { data: history }] = await Promise.all([
    supabase.from("order_items").select(ITEM_COLUMNS).eq("order_id", id).order("position").returns<ItemRow[]>(),
    supabase.from("order_balances").select("net_paid, balance").eq("order_id", id).maybeSingle(),
    canSeePayments
      ? supabase
          .from("payments")
          .select("id, receipt_number, kind, amount, method, reference, notes, received_at, recorded_by")
          .eq("order_id", id)
          .order("received_at")
      : Promise.resolve({ data: null }),
    supabase
      .from("order_status_history")
      .select("id, from_stage_id, to_stage_id, changed_by, changed_at")
      .eq("order_id", id)
      .order("changed_at"),
  ]);
  return {
    id: o.id,
    orderNumber: o.order_number,
    stageId: o.stage_id,
    customerId: o.customer_id,
    leadId: o.lead_id,
    quotationId: o.quotation_id,
    branchId: o.branch_id,
    ownerId: o.owner_id,
    dueDate: o.due_date,
    notes: o.notes,
    subtotal: String(o.subtotal),
    discountTotal: String(o.discount_total),
    taxTotal: String(o.tax_total),
    total: String(o.total),
    netPaid: String(balance?.net_paid ?? 0),
    balance: String(balance?.balance ?? o.total),
    customFields: o.custom_fields ?? {},
    closedAt: o.closed_at,
    createdAt: o.created_at,
    createdBy: o.created_by,
    items: (items ?? []).map(toItem),
    payments: payments.data
      ? payments.data.map((p) => ({
          id: p.id,
          receiptNumber: p.receipt_number,
          kind: p.kind,
          amount: String(p.amount),
          method: p.method,
          reference: p.reference,
          notes: p.notes,
          receivedAt: p.received_at,
          recordedBy: p.recorded_by,
        }))
      : null,
    history: (history ?? []).map((h) => ({
      id: h.id,
      fromStageId: h.from_stage_id,
      toStageId: h.to_stage_id,
      changedBy: h.changed_by,
      changedAt: h.changed_at,
    })),
  };
}

// ------------------------------------------------------------------ quotations

export type QuotationStatus = "draft" | "sent" | "accepted" | "declined" | "expired";

export type QuotationListItem = {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  total: string;
  validUntil: string | null;
  orderId: string | null;
  createdAt: string;
  customer: { id: string; fullName: string } | null;
};

type QuotationRow = {
  id: string;
  quotation_number: string;
  status: QuotationStatus;
  total: number | string;
  valid_until: string | null;
  order_id: string | null;
  created_at: string;
  customer_id: string;
};

async function hydrateQuotations(rows: QuotationRow[]): Promise<QuotationListItem[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, full_name")
    .in("id", [...new Set(rows.map((r) => r.customer_id))]);
  const cust = new Map((customers ?? []).map((c) => [c.id, { id: c.id, fullName: c.full_name }]));
  return rows.map((r) => ({
    id: r.id,
    quotationNumber: r.quotation_number,
    status: r.status,
    total: String(r.total),
    validUntil: r.valid_until,
    orderId: r.order_id,
    createdAt: r.created_at,
    customer: cust.get(r.customer_id) ?? null,
  }));
}

const QUOTATION_COLUMNS = "id, quotation_number, status, total, valid_until, order_id, created_at, customer_id";

export async function listQuotations(businessId: string, status?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("quotations")
    .select(QUOTATION_COLUMNS)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.returns<QuotationRow[]>();
  if (error) fail("quotations", error);
  return hydrateQuotations(data ?? []);
}

export async function listCustomerQuotations(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotations")
    .select(QUOTATION_COLUMNS)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<QuotationRow[]>();
  if (error) fail("quotations", error);
  return hydrateQuotations(data ?? []);
}

export async function getQuotation(id: string) {
  const supabase = await createClient();
  const { data: q, error } = await supabase
    .from("quotations")
    .select("id, quotation_number, status, customer_id, lead_id, branch_id, owner_id, valid_until, notes, subtotal, discount_total, tax_total, total, order_id, created_at, created_by")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("quotation", error);
  if (!q) return null;
  const { data: items } = await supabase
    .from("quotation_items")
    .select(ITEM_COLUMNS)
    .eq("quotation_id", id)
    .order("position")
    .returns<ItemRow[]>();
  return {
    id: q.id as string,
    quotationNumber: q.quotation_number as string,
    status: q.status as QuotationStatus,
    customerId: q.customer_id as string,
    leadId: q.lead_id as string | null,
    branchId: q.branch_id as string | null,
    ownerId: q.owner_id as string | null,
    validUntil: q.valid_until as string | null,
    notes: q.notes as string | null,
    subtotal: String(q.subtotal),
    discountTotal: String(q.discount_total),
    taxTotal: String(q.tax_total),
    total: String(q.total),
    orderId: q.order_id as string | null,
    createdAt: q.created_at as string,
    createdBy: q.created_by as string | null,
    items: (items ?? []).map(toItem),
  };
}

// ------------------------------------------------------------------ customer value

/** Lifetime value and what the customer still owes (cancelled orders excluded). */
export async function getCustomerValue(customerId: string, cancelledStageIds: string[]) {
  const supabase = await createClient();
  const [{ data: value }, { data: balances }] = await Promise.all([
    supabase.from("customer_value").select("orders_count, lifetime_value, first_order_at, last_order_at").eq("customer_id", customerId).maybeSingle(),
    supabase
      .from("order_balances")
      .select("balance")
      .eq("customer_id", customerId)
      .not("stage_id", "in", `(${cancelledStageIds.join(",") || NONE})`),
  ]);
  let due = BigInt(0);
  for (const b of balances ?? []) {
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(b.balance));
    if (!m) continue;
    const paise = BigInt(m[2]) * BigInt(100) + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
    if (!m[1]) due += paise;
  }
  return {
    ordersCount: Number(value?.orders_count ?? 0),
    lifetimeValue: String(value?.lifetime_value ?? "0"),
    firstOrderAt: (value?.first_order_at as string | null) ?? null,
    lastOrderAt: (value?.last_order_at as string | null) ?? null,
    outstanding: `${due / BigInt(100)}.${(due % BigInt(100)).toString().padStart(2, "0")}`,
  };
}
