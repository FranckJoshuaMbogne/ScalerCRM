import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnonClient } from "@/lib/supabase/anon";
import { canonicalJson, readApiKey } from "./lead-payload";

export const MAX_BODY_BYTES = 64 * 1024;

export type RateInfo = { allowed: boolean; limit?: number; remaining?: number; reset?: number; window?: string };

export type ApiContext = {
  request: Request;
  apiKey: string;
  supabase: SupabaseClient;
  idempotencyKey: string | null;
};

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: Record<string, string>,
  ) {
    super(message ?? code);
  }
}

type DbError = { code?: string; message?: string };

/** Maps a database error from an api_* function to an HTTP answer. */
export function failureFromDb(error: DbError): ApiFailure {
  switch (error.code) {
    case "28000":
      return new ApiFailure(401, "invalid_api_key", "The API key is wrong or revoked.");
    case "42501":
      return new ApiFailure(403, "insufficient_scope", error.message);
    case "25006":
      return new ApiFailure(403, "business_read_only", "The business is read-only until its subscription is paid.");
    case "P0409":
      return new ApiFailure(409, "idempotency_key_reused", "This Idempotency-Key was used with a different request.");
    case "P0002":
      return new ApiFailure(404, "not_found", error.message);
    case "22023":
    case "23514":
    case "22P02":
    case "22007":
    case "22008":
    case "23503":
    case "22003":
      return new ApiFailure(422, "invalid_request", error.message);
    default:
      return new ApiFailure(500, "internal_error");
  }
}

function rateHeaders(rate: RateInfo | null): Record<string, string> {
  if (!rate || rate.limit === undefined) return {};
  return {
    "x-ratelimit-limit": String(rate.limit),
    "x-ratelimit-remaining": String(rate.remaining ?? 0),
    "x-ratelimit-reset": String(rate.reset ?? 60),
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

/**
 * Runs one API request: reads the key, applies the plan's rate limit, then
 * the handler. Every data check happens in Postgres (api_* functions).
 */
export async function handleApi(
  request: Request,
  handler: (ctx: ApiContext) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>,
): Promise<Response> {
  const apiKey = readApiKey(request.headers);
  if (!apiKey) return json(401, { error: "missing_api_key", message: "Send Authorization: Bearer <api key>." });

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200) return json(400, { error: "idempotency_key_too_long" });

  const supabase = createAnonClient();
  const { data: rateData } = await supabase.rpc("api_rate", { p_api_key: apiKey });
  const rate = (rateData ?? null) as RateInfo | null;
  const headers = rateHeaders(rate);
  if (rate && rate.allowed === false) {
    return json(429, { error: "rate_limited", message: `Too many requests this ${rate.window ?? "minute"}.` }, {
      ...headers,
      "retry-after": String(rate.reset ?? 60),
    });
  }

  try {
    const result = await handler({ request, apiKey, supabase, idempotencyKey });
    return json(result.status, result.body, { ...headers, ...result.headers });
  } catch (e) {
    if (e instanceof ApiFailure) {
      const body: Record<string, unknown> = { error: e.code };
      if (e.message && e.message !== e.code) body.message = e.message;
      if (e.details) body.details = e.details;
      return json(e.status, body, headers);
    }
    console.error("[api/v1]", e);
    return json(500, { error: "internal_error" }, headers);
  }
}

/** Reads a JSON object body (64 KB at most). */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new ApiFailure(415, "content_type_must_be_json");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new ApiFailure(413, "body_too_large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ApiFailure(400, "invalid_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiFailure(400, "body_must_be_an_object");
  return body as Record<string, unknown>;
}

/** Same method, path and body hash the same, so a retry is recognised. */
export function writeHash(request: Request, body: unknown): string {
  const { pathname } = new URL(request.url);
  return createHash("sha256").update(`${request.method} ${pathname}\n${canonicalJson(body)}`).digest("hex");
}

export async function rpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw failureFromDb(error);
  return data as T;
}
