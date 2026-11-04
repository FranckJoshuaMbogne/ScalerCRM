import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Records a WhatsApp marketing opt-in ticked on a form. Best effort: the main action already succeeded. */
export async function recordFormOptIn(businessId: string, customerId: string, userId: string, where: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("customer_consents").insert({
    business_id: businessId,
    customer_id: customerId,
    channel: "whatsapp",
    purpose: "marketing",
    status: "opted_in",
    source: "form",
    evidence: `Customer agreed; ticked on the ${where} form`,
    captured_by: userId,
  });
  if (error) console.warn("[consent] opt-in not recorded:", error.message);
}
