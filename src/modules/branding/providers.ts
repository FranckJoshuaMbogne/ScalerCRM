import "server-only";

/**
 * The hosting provider (custom domains, TLS) and Resend (sender domains).
 * Without credentials both fall back to "manual": the DNS records to add are
 * shown, and nothing is called. Never throws; errors come back as text.
 */
export type DnsRecord = { type: string; name: string; value: string; status?: string };
export type DomainResult = { status: "pending" | "active" | "failed"; instructions: DnsRecord[]; error: string | null };
export type EmailDomainResult = { providerId: string | null; status: "pending" | "verified" | "failed"; records: DnsRecord[]; error: string | null };

const TIMEOUT = 10_000;

function vercel() {
  const token = process.env.VERCEL_API_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID;
  if (!token || !project) return null;
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  return {
    url: (path: string) => `https://api.vercel.com${path.replace("{project}", encodeURIComponent(project))}${team}`,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  };
}

/** What to tell people when the provider isn't connected. */
export function manualInstructions(hostname: string): DnsRecord[] {
  const parts = hostname.split(".");
  const apex = parts.length <= 2;
  return apex
    ? [{ type: "A", name: "@", value: "76.76.21.21" }]
    : [{ type: "CNAME", name: parts.slice(0, -2).join("."), value: "cname.vercel-dns.com" }];
}

type VercelDomain = { verified?: boolean; verification?: { type: string; domain: string; value: string }[]; error?: { message?: string } };

function fromVercel(hostname: string, body: VercelDomain, misconfigured: boolean | null): DomainResult {
  const verification = (body.verification ?? []).map((v) => ({ type: v.type, name: v.domain, value: v.value }));
  const instructions = [...manualInstructions(hostname), ...verification];
  if (body.error?.message) return { status: "failed", instructions, error: body.error.message };
  const active = Boolean(body.verified) && misconfigured === false;
  return { status: active ? "active" : "pending", instructions, error: null };
}

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/** Adds the domain to the project (TLS is issued once DNS points at it). */
export async function addHostDomain(hostname: string): Promise<DomainResult> {
  const v = vercel();
  if (!v) return { status: "pending", instructions: manualInstructions(hostname), error: null };
  try {
    const r = await call(v.url("/v10/projects/{project}/domains"), { method: "POST", headers: v.headers, body: JSON.stringify({ name: hostname }) });
    if (!r.ok && r.status !== 409) return { status: "failed", instructions: manualInstructions(hostname), error: String((r.body as VercelDomain).error?.message ?? `HTTP ${r.status}`) };
    return checkHostDomain(hostname);
  } catch (e) {
    return { status: "pending", instructions: manualInstructions(hostname), error: e instanceof Error ? e.message : "could not reach the hosting provider" };
  }
}

/** Verified with the provider and DNS pointing at us: the domain is live. */
export async function checkHostDomain(hostname: string): Promise<DomainResult> {
  const v = vercel();
  if (!v) return { status: "pending", instructions: manualInstructions(hostname), error: null };
  try {
    const d = await call(v.url(`/v9/projects/{project}/domains/${encodeURIComponent(hostname)}`), { headers: v.headers });
    let body = d.body as VercelDomain;
    if (d.ok && !body.verified) {
      const verify = await call(v.url(`/v9/projects/{project}/domains/${encodeURIComponent(hostname)}/verify`), { method: "POST", headers: v.headers });
      if (verify.ok) body = verify.body as VercelDomain;
    }
    const config = await call(v.url(`/v6/domains/${encodeURIComponent(hostname)}/config`), { headers: v.headers });
    const misconfigured = config.ok ? Boolean((config.body as { misconfigured?: boolean }).misconfigured) : null;
    return fromVercel(hostname, body, misconfigured);
  } catch (e) {
    return { status: "pending", instructions: manualInstructions(hostname), error: e instanceof Error ? e.message : "could not reach the hosting provider" };
  }
}

export async function removeHostDomain(hostname: string): Promise<void> {
  const v = vercel();
  if (!v) return;
  await call(v.url(`/v9/projects/{project}/domains/${encodeURIComponent(hostname)}`), { method: "DELETE", headers: v.headers }).catch(() => null);
}

// ---------------------------------------------------------------- Resend sender domains
type ResendDomain = { id?: string; status?: string; records?: { record?: string; type: string; name: string; value: string; status?: string }[]; message?: string };

function fromResend(body: ResendDomain): EmailDomainResult {
  const status = body.status === "verified" ? "verified" : body.status === "failed" || body.status === "temporary_failure" ? "failed" : "pending";
  return {
    providerId: body.id ?? null,
    status,
    records: (body.records ?? []).map((r) => ({ type: r.type, name: r.name, value: r.value, status: r.status })),
    error: body.message ?? null,
  };
}

function resendKey() {
  return process.env.RESEND_API_KEY ?? null;
}

export async function addEmailDomain(domain: string): Promise<EmailDomainResult> {
  const key = resendKey();
  if (!key) return { providerId: null, status: "pending", records: [], error: "Email isn't connected yet (RESEND_API_KEY), so the records can't be generated." };
  try {
    const r = await call("https://api.resend.com/domains", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ name: domain, region: "ap-northeast-1" }),
    });
    const out = fromResend(r.body as ResendDomain);
    return r.ok ? out : { ...out, status: "failed", error: out.error ?? `HTTP ${r.status}` };
  } catch (e) {
    return { providerId: null, status: "pending", records: [], error: e instanceof Error ? e.message : "could not reach Resend" };
  }
}

export async function checkEmailDomain(providerId: string): Promise<EmailDomainResult> {
  const key = resendKey();
  if (!key) return { providerId, status: "pending", records: [], error: null };
  const auth = { authorization: `Bearer ${key}` };
  try {
    await call(`https://api.resend.com/domains/${encodeURIComponent(providerId)}/verify`, { method: "POST", headers: auth });
    const r = await call(`https://api.resend.com/domains/${encodeURIComponent(providerId)}`, { headers: auth });
    return fromResend({ id: providerId, ...(r.body as ResendDomain) });
  } catch (e) {
    return { providerId, status: "pending", records: [], error: e instanceof Error ? e.message : "could not reach Resend" };
  }
}

export async function removeEmailDomainAtProvider(providerId: string): Promise<void> {
  const key = resendKey();
  if (!key) return;
  await call(`https://api.resend.com/domains/${encodeURIComponent(providerId)}`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } }).catch(() => null);
}

export const forTests = { fromVercel, fromResend };
