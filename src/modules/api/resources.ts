import "server-only";
import type { CountryCode } from "libphonenumber-js";
import type { z } from "zod";
import { normalisePhone } from "@/modules/crm/phone";
import { ApiFailure, type ApiContext, readJsonBody, rpc, writeHash } from "./http";
import { type DbList, decodeCursor, presentList, presentWrite } from "./present";
import {
  LeadUpdate,
  OrderCreate,
  OrderUpdate,
  TaskCreate,
  WebhookEndpointCreate,
  WebhookEndpointUpdate,
} from "./schemas";
import { checkWebhookUrl } from "@/modules/webhooks/url-guard";

export type Resource = "customers" | "leads" | "orders" | "payments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9_]{1,40}$/;

/** Filters each list accepts, besides limit, cursor and updated_since. */
export const LIST_FILTERS: Record<Resource, string[]> = {
  customers: ["phone", "email"],
  leads: ["customer_id", "status"],
  orders: ["customer_id", "stage"],
  payments: ["customer_id", "order_id"],
};

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const details: Record<string, string> = {};
  for (const issue of parsed.error.issues) details[issue.path.join(".") || "body"] ??= issue.message;
  throw new ApiFailure(422, "invalid_request", "The request body is not valid.", details);
}

export function requireId(id: string) {
  if (!UUID.test(id)) throw new ApiFailure(404, "not_found");
  return id;
}

async function businessCountry(ctx: ApiContext): Promise<CountryCode> {
  const data = await rpc<{ country_code: string }[] | null>(ctx.supabase, "api_key_business", { p_api_key: ctx.apiKey });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ApiFailure(401, "invalid_api_key", "The API key is wrong or revoked.");
  return row.country_code as CountryCode;
}

export async function listResource(ctx: ApiContext, resource: Resource) {
  const q = new URL(ctx.request.url).searchParams;
  const details: Record<string, string> = {};

  const limitRaw = q.get("limit");
  const limit = limitRaw === null ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) details.limit = "limit is a whole number from 1 to 100";

  const cursorRaw = q.get("cursor");
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) details.cursor = "cursor is not one this API gave you";

  const since = q.get("updated_since");
  if (since && Number.isNaN(Date.parse(since))) details.updated_since = "updated_since is an ISO 8601 date-time";

  const filters: Record<string, string> = {};
  for (const name of LIST_FILTERS[resource]) {
    const value = q.get(name)?.trim();
    if (!value) continue;
    if (name.endsWith("_id") && !UUID.test(value)) details[name] = `${name} is an id`;
    else if ((name === "status" || name === "stage") && !KEY.test(value)) details[name] = `${name} is a key, e.g. contacted`;
    else filters[name] = value;
  }
  if (filters.phone) {
    const phone = normalisePhone(filters.phone, await businessCountry(ctx));
    if (!phone) details.phone = "phone is not a valid number";
    else filters.phone = phone;
  }
  if (filters.email) filters.email = filters.email.toLowerCase();
  if (Object.keys(details).length) throw new ApiFailure(422, "invalid_request", "Some query parameters are not valid.", details);

  const db = await rpc<DbList>(ctx.supabase, "api_list", {
    p_api_key: ctx.apiKey,
    p_resource: resource,
    p_after_ts: cursor?.t ?? null,
    p_after_id: cursor?.id ?? null,
    p_updated_since: since ? new Date(since).toISOString() : null,
    p_limit: limit,
    p_filters: filters,
  });
  return { status: 200, body: presentList(db) };
}

export async function getResource(ctx: ApiContext, resource: Resource, id: string) {
  requireId(id);
  const row = await rpc<unknown>(ctx.supabase, "api_get", { p_api_key: ctx.apiKey, p_resource: resource, p_id: id });
  if (!row) throw new ApiFailure(404, "not_found");
  return { status: 200, body: row };
}

async function write(
  ctx: ApiContext,
  fn: string,
  resource: string,
  body: Record<string, unknown>,
  input: unknown,
  extra: Record<string, unknown> = {},
) {
  const db = await rpc<Record<string, unknown>>(ctx.supabase, fn, {
    p_api_key: ctx.apiKey,
    p_idempotency_key: ctx.idempotencyKey,
    p_request_hash: writeHash(ctx.request, body),
    p_input: input,
    ...extra,
  });
  const out = presentWrite(db, resource);
  return { status: out.status, body: out.body, headers: out.replayed ? { "idempotent-replayed": "true" } : undefined };
}

export async function updateLead(ctx: ApiContext, id: string) {
  requireId(id);
  const body = await readJsonBody(ctx.request);
  return write(ctx, "api_update_lead", "lead", body, parseBody(LeadUpdate, body), { p_lead_id: id });
}

export async function createOrder(ctx: ApiContext) {
  const body = await readJsonBody(ctx.request);
  return write(ctx, "api_create_order", "order", body, parseBody(OrderCreate, body));
}

export async function updateOrder(ctx: ApiContext, id: string) {
  requireId(id);
  const body = await readJsonBody(ctx.request);
  return write(ctx, "api_update_order", "order", body, parseBody(OrderUpdate, body), { p_order_id: id });
}

export async function createTask(ctx: ApiContext) {
  const body = await readJsonBody(ctx.request);
  return write(ctx, "api_create_task", "task", body, parseBody(TaskCreate, body));
}

export async function listWebhooks(ctx: ApiContext) {
  const db = await rpc<DbList>(ctx.supabase, "api_list_webhooks", { p_api_key: ctx.apiKey });
  return { status: 200, body: presentList(db) };
}

export async function createWebhook(ctx: ApiContext) {
  const body = await readJsonBody(ctx.request);
  const input = parseBody(WebhookEndpointCreate, body);
  const problem = checkWebhookUrl(input.url);
  if (problem) throw new ApiFailure(422, "invalid_request", problem, { url: problem });
  return write(ctx, "api_create_webhook", "webhook_endpoint", body, input);
}

export async function updateWebhook(ctx: ApiContext, id: string) {
  requireId(id);
  const body = await readJsonBody(ctx.request);
  const input = parseBody(WebhookEndpointUpdate, body);
  const problem = input.url ? checkWebhookUrl(input.url) : null;
  if (problem) throw new ApiFailure(422, "invalid_request", problem, { url: problem });
  return write(ctx, "api_update_webhook", "webhook_endpoint", body, input, { p_id: id });
}

export async function deleteWebhook(ctx: ApiContext, id: string) {
  requireId(id);
  await rpc(ctx.supabase, "api_delete_webhook", { p_api_key: ctx.apiKey, p_id: id });
  return { status: 200, body: { id, deleted: true } };
}
