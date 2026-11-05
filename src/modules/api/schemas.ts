import { z } from "zod";
import { WEBHOOK_EVENT_TYPES } from "@/modules/webhooks/events";
import { leadPayloadSchema } from "./lead-payload";

/**
 * Schemas of the public API. The OpenAPI document (openapi.ts) is generated
 * from these, and the contract tests check real database responses against
 * them, so they are the API's single description.
 */
export const apiRegistry = z.registry<{ id: string; description?: string }>();

const byId = new Map<string, z.ZodType>();

const reg = <T extends z.ZodType>(schema: T, id: string, description?: string): T => {
  (schema as z.ZodType).register(apiRegistry, description ? { id, description } : { id });
  byId.set(id, schema);
  return schema;
};

// Any 8-4-4-4-12 hex id (user ids from older auth systems are not always RFC 4122 v4).
const id = z.guid();
const ts = z.iso.datetime({ offset: true });
const date = z.iso.date();
const money = z.string().regex(/^-?\d+\.\d{2}$/).describe('Amount as a decimal string with two places, e.g. "1250.00". Never a float.');
const moneyIn = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "use a decimal string, e.g. \"1250.00\"").describe('Decimal string, e.g. "1250.00".');
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const key = z.string().regex(/^[a-z0-9_]+$/).max(40);
const fields = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------- resources
export const Customer = reg(
  z.strictObject({
    object: z.literal("customer"),
    id,
    cif_number: z.string(),
    full_name: z.string(),
    phone: z.string().nullable().describe("E.164, e.g. +919849012345"),
    email: z.string().nullable(),
    gender: z.enum(["female", "male", "other"]).nullable(),
    date_of_birth: date.nullable(),
    preferred_language: z.string().nullable(),
    branch_id: id.nullable(),
    owner_id: id.nullable(),
    custom_fields: fields,
    tags: z.array(z.string()),
    merged_into_id: id.nullable().describe("Set when this file was merged into another; read that one instead."),
    created_at: ts,
    updated_at: ts,
  }),
  "Customer",
);

export const Lead = reg(
  z.strictObject({
    object: z.literal("lead"),
    id,
    lead_number: z.string(),
    customer_id: id,
    branch_id: id.nullable(),
    owner_id: id.nullable(),
    status: key.describe("Pipeline stage key, e.g. new, contacted, won"),
    status_name: z.string(),
    status_category: z.enum(["open", "won", "lost"]),
    title: z.string().nullable(),
    description: z.string().nullable(),
    expected_value: money.nullable(),
    source: key.nullable().describe("First source key, e.g. website, meta_ads"),
    campaign: z.string().nullable(),
    first_touch: fields,
    latest_source: key.nullable(),
    latest_campaign: z.string().nullable(),
    latest_touch: fields,
    lost_reason_id: id.nullable(),
    lost_note: z.string().nullable(),
    next_follow_up_at: ts.nullable(),
    custom_fields: fields,
    closed_at: ts.nullable(),
    archived_at: ts.nullable(),
    created_at: ts,
    updated_at: ts,
  }),
  "Lead",
);

export const OrderItem = reg(
  z.strictObject({
    id,
    description: z.string(),
    quantity: decimal,
    unit_price: money,
    discount: money,
    tax_rate: decimal.describe("Percent, e.g. \"5.00\""),
    tax_amount: money,
    line_total: money,
    catalog_item_id: id.nullable(),
  }),
  "OrderItem",
);

export const Order = reg(
  z.strictObject({
    object: z.literal("order"),
    id,
    order_number: z.string(),
    customer_id: id,
    lead_id: id.nullable(),
    branch_id: id.nullable(),
    owner_id: id.nullable(),
    stage: key.describe("Order stage key, e.g. confirmed, ready, delivered"),
    stage_name: z.string(),
    stage_category: z.enum(["open", "done", "cancelled"]),
    due_date: date.nullable(),
    notes: z.string().nullable(),
    subtotal: money,
    discount_total: money,
    tax_total: money,
    total: money,
    paid: money.describe("Payments less refunds"),
    balance: money.describe("Still owed"),
    items: z.array(OrderItem),
    custom_fields: fields,
    closed_at: ts.nullable(),
    created_at: ts,
    updated_at: ts,
  }),
  "Order",
);

export const Payment = reg(
  z.strictObject({
    object: z.literal("payment"),
    id,
    receipt_number: z.string(),
    order_id: id,
    customer_id: id,
    kind: z.enum(["payment", "refund"]),
    amount: money,
    method: z.enum(["cash", "upi", "card", "bank_transfer", "cheque", "other"]),
    reference: z.string().nullable(),
    received_at: ts,
    created_at: ts,
  }),
  "Payment",
);

export const TASK_TYPES = ["follow_up", "call", "whatsapp", "visit", "meeting", "email", "other"] as const;

export const Task = reg(
  z.strictObject({
    object: z.literal("task"),
    id,
    lead_id: id.nullable(),
    customer_id: id.nullable(),
    branch_id: id.nullable(),
    type: z.enum(TASK_TYPES),
    title: z.string(),
    notes: z.string().nullable(),
    due_at: ts,
    assignee_id: id,
    completed_at: ts.nullable(),
    cancelled_at: ts.nullable(),
    outcome: z.string().nullable(),
    created_at: ts,
    updated_at: ts,
  }),
  "Task",
);

const webhookEndpointShape = {
  object: z.literal("webhook_endpoint"),
  id,
  url: z.string(),
  description: z.string().nullable(),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)),
  secret_prefix: z.string(),
  is_active: z.boolean(),
  disabled_reason: z.string().nullable(),
  consecutive_failures: z.int(),
  last_success_at: ts.nullable(),
  last_failure_at: ts.nullable(),
  created_at: ts,
  updated_at: ts,
};
export const WebhookEndpoint = reg(z.strictObject(webhookEndpointShape), "WebhookEndpoint");
export const WebhookEndpointCreated = reg(
  z.strictObject({ ...webhookEndpointShape, secret: z.string().describe("Signing secret. Shown only in this response.") }),
  "WebhookEndpointCreated",
);

// ---------------------------------------------------------------- lists
const list = <T extends z.ZodType>(item: T, name: string) =>
  reg(
    z.strictObject({
      object: z.literal("list"),
      data: z.array(item),
      has_more: z.boolean(),
      next_cursor: z.string().nullable().describe("Pass as ?cursor= to get the next page."),
    }),
    name,
  );
export const CustomerList = list(Customer, "CustomerList");
export const LeadList = list(Lead, "LeadList");
export const OrderList = list(Order, "OrderList");
export const PaymentList = list(Payment, "PaymentList");
export const WebhookEndpointList = list(WebhookEndpoint, "WebhookEndpointList");

// ---------------------------------------------------------------- requests
export const LeadCreate = reg(leadPayloadSchema, "LeadCreate", "An enquiry. Send phone or email; unknown fields are ignored.");

export const LeadCreated = reg(
  z.strictObject({
    lead_id: id,
    lead_number: z.string(),
    customer_id: id,
    cif_number: z.string(),
    lead_created: z.boolean().describe("false when the enquiry was added to the customer's open lead"),
    customer_created: z.boolean(),
    replayed: z.boolean(),
  }),
  "LeadCreated",
);

const atLeastOne = (v: Record<string, unknown>) => Object.keys(v).length > 0;

export const LeadUpdate = reg(
  z
    .strictObject({
      status: key.optional().describe("Move to this stage (its key)"),
      title: z.string().trim().max(160).nullable().optional(),
      description: z.string().trim().max(4000).nullable().optional(),
      expected_value: moneyIn.nullable().optional(),
      owner_id: id.nullable().optional(),
      lost_reason_id: id.nullable().optional().describe("Required when moving to a lost stage"),
      lost_note: z.string().trim().max(1000).nullable().optional(),
      custom_fields: fields.optional().describe("Merged into the lead's fields; only defined keys are kept"),
    })
    .refine(atLeastOne, "send at least one field"),
  "LeadUpdate",
);

export const OrderItemInput = reg(
  z.strictObject({
    description: z.string().trim().min(1).max(300),
    quantity: z.number().positive().max(100000).optional().describe("Default 1"),
    unit_price: moneyIn,
    discount: moneyIn.optional().describe("Line discount before tax"),
    tax_rate: z.number().min(0).max(100).optional().describe("Percent"),
    catalog_item_id: id.optional(),
  }),
  "OrderItemInput",
);

export const OrderCreate = reg(
  z.strictObject({
    customer_id: id,
    lead_id: id.optional(),
    due_date: date.optional(),
    notes: z.string().trim().max(4000).optional(),
    custom_fields: fields.optional(),
    items: z.array(OrderItemInput).min(1).max(100),
  }),
  "OrderCreate",
);

export const OrderUpdate = reg(
  z
    .strictObject({
      stage: key.optional().describe("Move to this stage (its key)"),
      due_date: date.nullable().optional(),
      notes: z.string().trim().max(4000).nullable().optional(),
      custom_fields: fields.optional(),
    })
    .refine(atLeastOne, "send at least one field"),
  "OrderUpdate",
);

export const TaskCreate = reg(
  z
    .strictObject({
      lead_id: id.optional(),
      customer_id: id.optional(),
      title: z.string().trim().min(1).max(200),
      notes: z.string().trim().max(4000).optional(),
      type: z.enum(TASK_TYPES).optional().describe("Default follow_up"),
      due_at: ts,
      assignee_id: id.optional().describe("Default: the lead's (or customer's) owner"),
    })
    .refine((v) => Boolean(v.lead_id || v.customer_id), "send lead_id or customer_id"),
  "TaskCreate",
);

export const WebhookEndpointCreate = reg(
  z.strictObject({
    url: z.url({ protocol: /^https$/ }).max(2000),
    events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
    description: z.string().trim().max(200).optional(),
  }),
  "WebhookEndpointCreate",
);

export const WebhookEndpointUpdate = reg(
  z
    .strictObject({
      url: z.url({ protocol: /^https$/ }).max(2000).optional(),
      events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).optional(),
      description: z.string().trim().max(200).nullable().optional(),
      is_active: z.boolean().optional().describe("Turning an endpoint back on clears its failure count"),
    })
    .refine(atLeastOne, "send at least one field"),
  "WebhookEndpointUpdate",
);

export const Deleted = reg(z.strictObject({ id, deleted: z.literal(true) }), "Deleted");

export const ApiError = reg(
  z.strictObject({
    error: z.string().describe("Machine-readable code, e.g. invalid_api_key, insufficient_scope, rate_limited"),
    message: z.string().optional(),
    details: z.record(z.string(), z.string()).optional(),
  }),
  "Error",
);

// ---------------------------------------------------------------- webhook events
const envelope = <T extends z.ZodType>(type: string, data: T, name: string) =>
  reg(
    z.strictObject({
      id: z.string().regex(/^evt_\d+$/),
      object: z.literal("event"),
      type: z.literal(type),
      api_version: z.literal("v1"),
      created_at: ts,
      business_id: id,
      data,
    }),
    name,
  );

export const WEBHOOK_EVENT_SCHEMAS = {
  "lead.created": envelope("lead.created", Lead, "LeadCreatedEvent"),
  "lead.stage_changed": envelope(
    "lead.stage_changed",
    z.strictObject({ lead: Lead, from_status: key.nullable(), to_status: key }),
    "LeadStageChangedEvent",
  ),
  "order.created": envelope("order.created", Order, "OrderCreatedEvent"),
  "order.stage_changed": envelope(
    "order.stage_changed",
    z.strictObject({ order: Order, from_stage: key.nullable(), to_stage: key }),
    "OrderStageChangedEvent",
  ),
  "payment.recorded": envelope("payment.recorded", Payment, "PaymentRecordedEvent"),
  "customer.merged": envelope(
    "customer.merged",
    z.strictObject({ merged_customer_id: id, customer: Customer }),
    "CustomerMergedEvent",
  ),
} as const;

/** Sent by a workflow's "Call a webhook" step to the endpoint it names (not subscribable). */
export const AutomationCalledEvent = envelope(
  "automation.called",
  z.strictObject({
    automation: z.strictObject({ id, name: z.string() }),
    label: z.string().nullable(),
    lead: Lead.nullable(),
    customer: Customer.nullable(),
    order: Order.nullable(),
  }),
  "AutomationCalledEvent",
);

/** Schema for any event type SCALER sends. */
export function eventSchema(type: string): z.ZodType | undefined {
  if (type === "automation.called") return AutomationCalledEvent;
  return (WEBHOOK_EVENT_SCHEMAS as Record<string, z.ZodType>)[type];
}

/** Every registered schema by its id (for the contract tests). */
export function schemaById(name: string): z.ZodType | undefined {
  return byId.get(name);
}
