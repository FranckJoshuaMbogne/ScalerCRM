import { randomUUID } from "node:crypto";

/**
 * Error reporting to Sentry over its HTTP envelope API: no SDK, nothing sent
 * unless SENTRY_DSN is set. Reports carry the error, the route and the request
 * path without its query string; never headers, cookies or bodies, so customer
 * data (phones searched for, form contents) stays out of the error tracker.
 */
export type Dsn = { url: string; publicKey: string };

export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!u.username || !/^\d+$/.test(project)) return null;
    return { url: `${u.protocol}//${u.host}/api/${project}/envelope/`, publicKey: u.username };
  } catch {
    return null;
  }
}

export function buildEnvelope(error: unknown, tags: Record<string, string>, now = new Date(), id = randomUUID().replace(/-/g, "")) {
  const err = error instanceof Error ? error : new Error(String(error));
  const digest = typeof error === "object" && error && "digest" in error ? String((error as { digest: unknown }).digest) : undefined;
  const event = {
    event_id: id,
    timestamp: now.toISOString(),
    platform: "node",
    level: "error",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    exception: { values: [{ type: err.name, value: err.message.slice(0, 1000) }] },
    tags: { ...tags, ...(digest ? { digest } : {}) },
    extra: { stack: err.stack?.split("\n").slice(0, 30).join("\n") },
  };
  return [
    JSON.stringify({ event_id: id, sent_at: now.toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

export async function reportError(error: unknown, tags: Record<string, string> = {}) {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) {
    console.error(error);
    return;
  }
  try {
    await fetch(dsn.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=scaler/1.0`,
      },
      body: buildEnvelope(error, tags),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    console.error(error);
  }
}
