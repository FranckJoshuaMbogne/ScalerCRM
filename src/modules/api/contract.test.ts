import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { eventEnvelope, type EventRow } from "@/modules/webhooks/envelope";
import { WEBHOOK_EVENTS } from "@/modules/webhooks/events";
import { OPERATIONS, openApiDocument } from "./openapi";
import { postmanCollection } from "./postman";
import { type DbList, presentList, presentWrite } from "./present";
import { apiRegistry, schemaById, WEBHOOK_EVENT_SCHEMAS } from "./schemas";

/**
 * Contract tests: the route files, the OpenAPI document and (when
 * scripts/db-test.sh provides them) real database responses must agree.
 */
const API_DIR = join(process.cwd(), "src", "app", "api", "v1");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

function implemented(): Set<string> {
  const out = new Set<string>();
  for (const file of routeFiles(API_DIR)) {
    const rel = relative(API_DIR, file).split(sep).slice(0, -1).join("/");
    if (rel.endsWith(".json")) continue; // the documents themselves
    const path = `/${rel}`.replace(/\[(\w+)\]/g, "{$1}");
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/export (?:async )?function (GET|POST|PATCH|PUT|DELETE)\b/g)) out.add(`${m[1].toLowerCase()} ${path}`);
  }
  return out;
}

describe("the OpenAPI document", () => {
  const doc = openApiDocument("https://app.example.com");

  it("documents exactly the operations the routes implement", () => {
    const documented = new Set(OPERATIONS.map((o) => `${o.method} ${o.path}`));
    expect([...implemented()].sort()).toEqual([...documented].sort());
  });

  it("is OpenAPI 3.1 with every reference resolvable", () => {
    expect(doc.openapi).toBe("3.1.0");
    const text = JSON.stringify(doc);
    for (const [, kind, name] of text.matchAll(/"#\/components\/(schemas|parameters)\/([A-Za-z]+)"/g)) {
      expect((doc.components as Record<string, Record<string, unknown>>)[kind][name], `${kind}/${name}`).toBeDefined();
    }
  });

  it("gives every operation a scope, auth, rate-limit headers and error answers", () => {
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods) as [string, Record<string, unknown>][]) {
        const label = `${method} ${path}`;
        expect(op["x-scope"], label).toBeTruthy();
        expect(op.security, label).toEqual([{ apiKey: [] }]);
        const responses = op.responses as Record<string, { headers?: Record<string, unknown> }>;
        for (const status of ["401", "403", "429"]) expect(responses[status], `${label} ${status}`).toBeDefined();
        const ok = Object.keys(responses).find((s) => s.startsWith("2"))!;
        expect(Object.keys(responses[ok].headers ?? {}), label).toContain("X-RateLimit-Remaining");
      }
    }
  });

  it("has request examples that satisfy their own schemas", () => {
    for (const op of OPERATIONS.filter((o) => o.body)) {
      expect(op.example, op.operationId).toBeDefined();
      const result = schemaById(op.body!)!.safeParse(op.example);
      expect(result.success, `${op.operationId}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it("describes every webhook event", () => {
    expect(Object.keys(doc.webhooks).sort()).toEqual(WEBHOOK_EVENTS.map((e) => e.type).sort());
    for (const e of WEBHOOK_EVENTS) expect(apiRegistry.get(WEBHOOK_EVENT_SCHEMAS[e.type])).toBeDefined();
  });

  it("has a Postman request for every operation", () => {
    const names = postmanCollection("https://app.example.com").item.flatMap((g) => g.item.map((i) => i.request.method + " " + i.request.url.raw));
    expect(names).toHaveLength(OPERATIONS.length);
  });
});

/**
 * Real responses. scripts/db-test.sh runs supabase/tests/contract_samples.sql
 * against the test database and points API_CONTRACT_SAMPLES at the output:
 * { "<SchemaName>": <api_* function output>, ..., "events": [<webhook_events rows>] }.
 */
const samplesFile = process.env.API_CONTRACT_SAMPLES;

describe.runIf(Boolean(samplesFile))("database responses", () => {
  const samples = samplesFile ? (JSON.parse(readFileSync(samplesFile, "utf8")) as Record<string, unknown>) : {};

  const check = (schemaName: string, value: unknown) => {
    const result = schemaById(schemaName)!.safeParse(value);
    expect(result.success, `${schemaName}: ${JSON.stringify(result.error?.issues?.slice(0, 3))}`).toBe(true);
  };

  it("match the documented schemas", () => {
    const lists = ["CustomerList", "LeadList", "OrderList", "PaymentList", "WebhookEndpointList"];
    for (const name of lists) {
      const list = samples[name] as DbList;
      expect(list?.data?.length, `${name} has rows to check`).toBeGreaterThan(0);
      check(name, presentList(list));
    }
    for (const name of ["Customer", "Lead", "Order", "Payment"]) check(name, samples[name]);
    check("Lead", presentWrite(samples.LeadUpdated as Record<string, unknown>, "lead").body);
    check("Order", presentWrite(samples.OrderCreated as Record<string, unknown>, "order").body);
    check("Task", presentWrite(samples.TaskCreated as Record<string, unknown>, "task").body);
    check("WebhookEndpointCreated", presentWrite(samples.WebhookEndpointCreated as Record<string, unknown>, "webhook_endpoint").body);
  });

  it("send webhook events in the documented shape", () => {
    const events = samples.events as EventRow[];
    const seen = new Set(events.map((e) => e.event_type));
    for (const e of WEBHOOK_EVENTS) expect(seen, e.type).toContain(e.type);
    for (const row of events) {
      if (row.event_type === "ping") continue;
      const schema = WEBHOOK_EVENT_SCHEMAS[row.event_type as keyof typeof WEBHOOK_EVENT_SCHEMAS];
      const result = schema.safeParse(eventEnvelope(row));
      expect(result.success, `${row.event_type}: ${JSON.stringify(result.error?.issues?.slice(0, 3))}`).toBe(true);
    }
  });
});
