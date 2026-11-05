import { z } from "zod";
import { WEBHOOK_EVENTS } from "@/modules/webhooks/events";
import type { ApiScope } from "./scopes";
import { API_SCOPES } from "./scopes";
import { apiRegistry, AutomationCalledEvent, WEBHOOK_EVENT_SCHEMAS } from "./schemas";

/**
 * Every /api/v1 operation. The OpenAPI document, the Postman collection and
 * the developer page are built from this table, and contract.test.ts checks
 * it against the route files.
 */
export type Operation = {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description?: string;
  scope: ApiScope;
  kind: "list" | "get" | "write" | "delete";
  query?: { name: string; description: string; schema: Record<string, unknown> }[];
  body?: string;
  responses: { status: number; schema: string; description: string }[];
  example?: Record<string, unknown>;
};

const id = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const keyFilter = (name: string, description: string) => ({ name, description, schema: { type: "string", pattern: "^[a-z0-9_]+$" } });
const idFilter = (name: string, description: string) => ({ name, description, schema: { type: "string", format: "uuid" } });

export const OPERATIONS: Operation[] = [
  {
    method: "get", path: "/customers", operationId: "listCustomers", tag: "Customers", scope: "customers:read", kind: "list",
    summary: "List customers",
    query: [
      { name: "phone", description: "Find by phone (any format; numbers without a country code use the business's country)", schema: { type: "string" } },
      { name: "email", description: "Find by email", schema: { type: "string", format: "email" } },
    ],
    responses: [{ status: 200, schema: "CustomerList", description: "A page of customers, oldest change first" }],
  },
  {
    method: "get", path: "/customers/{id}", operationId: "getCustomer", tag: "Customers", scope: "customers:read", kind: "get",
    summary: "Get a customer",
    responses: [{ status: 200, schema: "Customer", description: "The customer" }],
  },
  {
    method: "get", path: "/leads", operationId: "listLeads", tag: "Leads", scope: "leads:read", kind: "list",
    summary: "List leads",
    query: [idFilter("customer_id", "Only this customer's leads"), keyFilter("status", "Only leads in this stage (its key)")],
    responses: [{ status: 200, schema: "LeadList", description: "A page of leads, oldest change first" }],
  },
  {
    method: "post", path: "/leads", operationId: "createLead", tag: "Leads", scope: "leads:write", kind: "write",
    summary: "Send an enquiry",
    description:
      "Matches the customer by phone, then email, and creates a lead in the default stage. A repeat enquiry from a customer with an open lead is added to that lead instead.",
    body: "LeadCreate",
    responses: [
      { status: 201, schema: "LeadCreated", description: "New lead" },
      { status: 200, schema: "LeadCreated", description: "Added to the customer's open lead, or a replay of the same Idempotency-Key" },
    ],
    example: { name: "Ravi Kumar", phone: "98490 12345", interest: "Wedding sherwani", utm_source: "google", utm_campaign: "diwali" },
  },
  {
    method: "get", path: "/leads/{id}", operationId: "getLead", tag: "Leads", scope: "leads:read", kind: "get",
    summary: "Get a lead",
    responses: [{ status: 200, schema: "Lead", description: "The lead" }],
  },
  {
    method: "patch", path: "/leads/{id}", operationId: "updateLead", tag: "Leads", scope: "leads:write", kind: "write",
    summary: "Update a lead or move it to another stage",
    description: "The business's pipeline rules apply: stages that need an owner, lost reasons and allowed moves.",
    body: "LeadUpdate",
    responses: [{ status: 200, schema: "Lead", description: "The updated lead" }],
    example: { status: "contacted", expected_value: "15000.00" },
  },
  {
    method: "get", path: "/orders", operationId: "listOrders", tag: "Orders", scope: "orders:read", kind: "list",
    summary: "List orders",
    query: [idFilter("customer_id", "Only this customer's orders"), keyFilter("stage", "Only orders in this stage (its key)")],
    responses: [{ status: 200, schema: "OrderList", description: "A page of orders, oldest change first" }],
  },
  {
    method: "post", path: "/orders", operationId: "createOrder", tag: "Orders", scope: "orders:write", kind: "write",
    summary: "Create an order",
    description: "The order starts in the first open stage, in the customer's branch, with no owner.",
    body: "OrderCreate",
    responses: [{ status: 201, schema: "Order", description: "The new order (also the answer to a replayed request)" }],
    example: {
      customer_id: "00000000-0000-0000-0000-000000000000",
      due_date: "2027-06-30",
      items: [{ description: "Sherwani", quantity: 1, unit_price: "12000.00", tax_rate: 5 }],
    },
  },
  {
    method: "get", path: "/orders/{id}", operationId: "getOrder", tag: "Orders", scope: "orders:read", kind: "get",
    summary: "Get an order",
    responses: [{ status: 200, schema: "Order", description: "The order with its lines and balance" }],
  },
  {
    method: "patch", path: "/orders/{id}", operationId: "updateOrder", tag: "Orders", scope: "orders:write", kind: "write",
    summary: "Update an order or move it to another stage",
    body: "OrderUpdate",
    responses: [{ status: 200, schema: "Order", description: "The updated order" }],
    example: { stage: "ready" },
  },
  {
    method: "get", path: "/payments", operationId: "listPayments", tag: "Payments", scope: "orders:read", kind: "list",
    summary: "List payments and refunds",
    description: "Payments never change, so updated_since and the order of this list use the time they were recorded.",
    query: [idFilter("order_id", "Only this order's payments"), idFilter("customer_id", "Only this customer's payments")],
    responses: [{ status: 200, schema: "PaymentList", description: "A page of payments, oldest first" }],
  },
  {
    method: "get", path: "/payments/{id}", operationId: "getPayment", tag: "Payments", scope: "orders:read", kind: "get",
    summary: "Get a payment",
    responses: [{ status: 200, schema: "Payment", description: "The payment" }],
  },
  {
    method: "post", path: "/tasks", operationId: "createTask", tag: "Tasks", scope: "tasks:write", kind: "write",
    summary: "Create a task",
    description: "On a lead or a customer. Without assignee_id the lead's (or customer's) owner gets it.",
    body: "TaskCreate",
    responses: [{ status: 201, schema: "Task", description: "The new task" }],
    example: { lead_id: "00000000-0000-0000-0000-000000000000", title: "Call back about the fitting", due_at: "2027-06-01T10:00:00+05:30" },
  },
  {
    method: "get", path: "/webhooks", operationId: "listWebhookEndpoints", tag: "Webhooks", scope: "webhooks:manage", kind: "list",
    summary: "List webhook endpoints",
    responses: [{ status: 200, schema: "WebhookEndpointList", description: "All endpoints (secrets are never listed)" }],
  },
  {
    method: "post", path: "/webhooks", operationId: "createWebhookEndpoint", tag: "Webhooks", scope: "webhooks:manage", kind: "write",
    summary: "Add a webhook endpoint",
    description: "The answer carries the signing secret, once. A replayed request returns the endpoint without it.",
    body: "WebhookEndpointCreate",
    responses: [{ status: 201, schema: "WebhookEndpointCreated", description: "The endpoint and its signing secret" }],
    example: { url: "https://example.com/scaler-webhook", events: ["order.stage_changed"] },
  },
  {
    method: "patch", path: "/webhooks/{id}", operationId: "updateWebhookEndpoint", tag: "Webhooks", scope: "webhooks:manage", kind: "write",
    summary: "Change or switch an endpoint on or off",
    body: "WebhookEndpointUpdate",
    responses: [{ status: 200, schema: "WebhookEndpoint", description: "The endpoint" }],
    example: { is_active: true },
  },
  {
    method: "delete", path: "/webhooks/{id}", operationId: "deleteWebhookEndpoint", tag: "Webhooks", scope: "webhooks:manage", kind: "delete",
    summary: "Delete an endpoint",
    responses: [{ status: 200, schema: "Deleted", description: "Deleted, with its delivery log" }],
  },
];

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const rateHeaders = {
  "X-RateLimit-Limit": { description: "Requests allowed a minute on this plan", schema: { type: "integer" } },
  "X-RateLimit-Remaining": { description: "Requests left this minute", schema: { type: "integer" } },
  "X-RateLimit-Reset": { description: "Seconds until the limit resets", schema: { type: "integer" } },
};

const errorResponse = (description: string, extraHeaders: Record<string, unknown> = {}) => ({
  description,
  headers: { ...rateHeaders, ...extraHeaders },
  content: { "application/json": { schema: ref("Error") } },
});

function componentSchemas() {
  const { schemas } = z.toJSONSchema(apiRegistry, {
    uri: (name) => `#/components/schemas/${name}`,
    unrepresentable: "any",
  });
  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    const rest = { ...(schema as Record<string, unknown>) };
    delete rest.$schema;
    delete rest.$id;
    out[name] = rest;
  }
  return out;
}

function operationObject(op: Operation) {
  const scope = API_SCOPES.find((s) => s.key === op.scope)!;
  const parameters: unknown[] = [];
  if (op.path.includes("{id}")) parameters.push(id);
  if (op.kind === "list" && op.path !== "/webhooks") {
    parameters.push(
      { $ref: "#/components/parameters/Limit" },
      { $ref: "#/components/parameters/Cursor" },
      { $ref: "#/components/parameters/UpdatedSince" },
    );
  }
  for (const q of op.query ?? []) parameters.push({ name: q.name, in: "query", required: false, description: q.description, schema: q.schema });
  if (op.kind === "write") parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });

  const responses: Record<string, unknown> = {};
  for (const r of op.responses) {
    responses[String(r.status)] = { description: r.description, headers: rateHeaders, content: { "application/json": { schema: ref(r.schema) } } };
  }
  if (op.body || op.kind === "list") responses["422"] = errorResponse("invalid_request (with details per field), or invalid_lead");
  if (op.kind === "get" || op.path.includes("{id}")) responses["404"] = errorResponse("not_found: no such record in this business");
  if (op.kind === "write") responses["409"] = errorResponse("idempotency_key_reused: the same Idempotency-Key with a different request");
  responses["401"] = errorResponse("missing_api_key or invalid_api_key");
  responses["403"] = errorResponse(`insufficient_scope (needs ${op.scope}), or business_read_only for writes`);
  responses["429"] = errorResponse("rate_limited", { "Retry-After": { description: "Seconds to wait", schema: { type: "integer" } } });

  return {
    operationId: op.operationId,
    tags: [op.tag],
    summary: op.summary,
    description: [op.description, `Needs the \`${op.scope}\` scope (${scope.label.toLowerCase()}).`].filter(Boolean).join("\n\n"),
    "x-scope": op.scope,
    security: [{ apiKey: [] }],
    parameters,
    ...(op.body
      ? { requestBody: { required: true, content: { "application/json": { schema: ref(op.body), ...(op.example ? { example: op.example } : {}) } } } }
      : {}),
    responses,
  };
}

export function openApiDocument(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) (paths[op.path] ??= {})[op.method] = operationObject(op);

  const webhooks: Record<string, unknown> = {};
  for (const e of WEBHOOK_EVENTS) {
    const schema = WEBHOOK_EVENT_SCHEMAS[e.type];
    const name = apiRegistry.get(schema)!.id;
    webhooks[e.type] = {
      post: {
        summary: e.label,
        description: `${e.description}\n\nSigned with the endpoint's secret in the \`Scaler-Signature\` header: \`t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">\`. Answer 2xx within 10 seconds; anything else is retried with back-off for 24 hours.`,
        parameters: [
          { name: "Scaler-Signature", in: "header", required: true, schema: { type: "string" } },
          { name: "Scaler-Event", in: "header", required: true, schema: { type: "string", const: e.type } },
          { name: "Scaler-Delivery", in: "header", required: true, description: "Unique per delivery attempt chain; a replay gets a new one", schema: { type: "string" } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: ref(name) } } },
        responses: { "2XX": { description: "Received" } },
      },
    };
  }

  webhooks["automation.called"] = {
    post: {
      summary: "Workflow step",
      description:
        "Sent by a workflow's \"Call a webhook\" step to the endpoint it names, with the lead, customer and order the run is about. Signed and retried like every other event.",
      requestBody: { required: true, content: { "application/json": { schema: ref(apiRegistry.get(AutomationCalledEvent)!.id) } } },
      responses: { "2XX": { description: "Received" } },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "SCALER API",
      version: "1.0.0",
      description:
        "Read and write a business's customers, leads, orders, payments and tasks, and receive signed webhooks. Keys are made in Settings → API keys and carry scopes. /v1 is stable: breaking changes only come in /v2, with 6 months' notice. Times are ISO 8601 with offset; money is a decimal string.",
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ apiKey: [] }],
    tags: ["Customers", "Leads", "Orders", "Payments", "Tasks", "Webhooks"].map((name) => ({ name })),
    paths,
    webhooks,
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", description: "Authorization: Bearer sk_live_… (or the X-API-Key header)" },
      },
      parameters: {
        Limit: { name: "limit", in: "query", required: false, description: "Page size (default 50)", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
        Cursor: { name: "cursor", in: "query", required: false, description: "next_cursor from the previous page", schema: { type: "string" } },
        UpdatedSince: {
          name: "updated_since", in: "query", required: false,
          description: "Only records changed at or after this time. Lists run oldest change first, so a sync can resume from the last updated_at it saw.",
          schema: { type: "string", format: "date-time" },
        },
        IdempotencyKey: {
          name: "Idempotency-Key", in: "header", required: false,
          description: "Unique per write (e.g. a UUID). Retrying with the same key returns the first answer and never writes twice; the same key with a different request is refused (409).",
          schema: { type: "string", maxLength: 200 },
        },
      },
      schemas: componentSchemas(),
    },
  };
}
