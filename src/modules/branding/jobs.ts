import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkEmailDomain, checkHostDomain } from "./providers";

/** Re-checks pending custom and sender domains (job route; each at most every 5 minutes, for 3 days). */
export async function runDomainChecks() {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("domains_to_check", { p_limit: 20 });
  if (error) throw new Error(`domains_to_check failed: ${error.message}`);
  const due = (data ?? { custom: [], email: [] }) as {
    custom: { id: string; hostname: string }[];
    email: { business_id: string; provider_id: string | null }[];
  };
  let live = 0;
  for (const d of due.custom) {
    const r = await checkHostDomain(d.hostname);
    await admin.rpc("record_custom_domain", { p_id: d.id, p_status: r.status, p_instructions: r.instructions, p_error: r.error });
    if (r.status === "active") live++;
  }
  let verified = 0;
  for (const e of due.email) {
    if (!e.provider_id) continue;
    const r = await checkEmailDomain(e.provider_id);
    await admin.rpc("record_email_domain", {
      p_business_id: e.business_id,
      p_provider_id: r.providerId,
      p_status: r.status,
      p_records: r.records.length ? r.records : null,
      p_error: r.error,
    });
    if (r.status === "verified") verified++;
  }
  return { domains: due.custom.length, live, senders: due.email.length, verified };
}
