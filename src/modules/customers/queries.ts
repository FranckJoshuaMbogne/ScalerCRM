import "server-only";
import type { CountryCode } from "libphonenumber-js";
import { createClient } from "@/lib/supabase/server";
import type { CustomValues } from "@/modules/custom-fields/engine";
import { matchingCustomerIds } from "@/modules/leads/queries";

export const CUSTOMERS_PAGE_SIZE = 25;

export type CustomerListItem = {
  id: string;
  cifNumber: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  branchId: string | null;
  createdAt: string;
  tags: { id: string; name: string }[];
};

type CustomerRow = {
  id: string;
  cif_number: string;
  full_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  branch_id: string | null;
  created_at: string;
};

export type Tag = { id: string; name: string; color: string | null };

export async function listTags(businessId: string): Promise<Tag[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("tags").select("id, name, color").eq("business_id", businessId).order("name");
  if (error) throw new Error(`Could not load tags: ${error.message}`);
  return data ?? [];
}

async function tagsFor(customerIds: string[]) {
  const map = new Map<string, { id: string; name: string }[]>();
  if (!customerIds.length) return map;
  const supabase = await createClient();
  const { data } = await supabase.from("customer_tags").select("customer_id, tag:tags(id, name)").in("customer_id", customerIds);
  for (const row of (data ?? []) as unknown as { customer_id: string; tag: { id: string; name: string } | null }[]) {
    if (!row.tag) continue;
    map.set(row.customer_id, [...(map.get(row.customer_id) ?? []), row.tag]);
  }
  return map;
}

export async function listCustomers(
  businessId: string,
  country: CountryCode,
  filters: { q?: string; tag?: string; page?: number },
): Promise<{ items: CustomerListItem[]; total: number }> {
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase
    .from("customers")
    .select("id, cif_number, full_name, primary_phone, primary_email, branch_id, created_at", { count: "exact" })
    .eq("business_id", businessId)
    .is("merged_into_id", null)
    .order("created_at", { ascending: false })
    .range((page - 1) * CUSTOMERS_PAGE_SIZE, page * CUSTOMERS_PAGE_SIZE - 1);

  if (filters.q) {
    const match = await matchingCustomerIds(businessId, filters.q, country, 1000);
    if (match) query = query.in("id", match.ids.length ? match.ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (filters.tag) {
    const { data: tagged } = await supabase.from("customer_tags").select("customer_id").eq("tag_id", filters.tag).limit(1000);
    const ids = (tagged ?? []).map((t) => t.customer_id);
    query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }

  const { data, error, count } = await query.returns<CustomerRow[]>();
  if (error) throw new Error(`Could not load customers: ${error.message}`);
  const tags = await tagsFor((data ?? []).map((c) => c.id));
  return {
    total: count ?? 0,
    items: (data ?? []).map((c) => ({
      id: c.id,
      cifNumber: c.cif_number,
      fullName: c.full_name,
      phone: c.primary_phone,
      email: c.primary_email,
      branchId: c.branch_id,
      createdAt: c.created_at,
      tags: tags.get(c.id) ?? [],
    })),
  };
}

export type Contact = { id: string; kind: "phone" | "email"; value: string; label: string | null; isPrimary: boolean };
export type Address = {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  isDefault: boolean;
};
export type ConsentState = { channel: string; purpose: string; status: "opted_in" | "opted_out"; source: string; capturedAt: string };
export type CustomerEvent = {
  id: number;
  type: string;
  body: string | null;
  changes: Record<string, unknown> | null;
  actorId: string | null;
  createdAt: string;
};
export type Attachment = {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storagePath: string;
  createdAt: string;
  uploadedBy: string | null;
};

export type CustomerProfile = {
  id: string;
  businessId: string;
  cifNumber: string;
  fullName: string;
  gender: string | null;
  dateOfBirth: string | null;
  preferredLanguage: string | null;
  branchId: string | null;
  ownerId: string | null;
  customFields: CustomValues;
  mergedIntoId: string | null;
  createdAt: string;
  contacts: Contact[];
  addresses: Address[];
  tags: Tag[];
  consents: ConsentState[];
  events: CustomerEvent[];
  attachments: Attachment[];
};

export async function getCustomer(id: string): Promise<CustomerProfile | null> {
  const supabase = await createClient();
  const { data: c, error } = await supabase
    .from("customers")
    .select(
      "id, business_id, cif_number, full_name, gender, date_of_birth, preferred_language, branch_id, owner_id, custom_fields, merged_into_id, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load customer: ${error.message}`);
  if (!c) return null;

  const [contacts, addresses, tags, consents, events, attachments] = await Promise.all([
    supabase.from("customer_contacts").select("id, kind, value, label, is_primary").eq("customer_id", id).order("created_at"),
    supabase
      .from("customer_addresses")
      .select("id, label, line1, line2, city, state, postal_code, is_default")
      .eq("customer_id", id)
      .order("created_at"),
    supabase.from("customer_tags").select("tag:tags(id, name, color)").eq("customer_id", id),
    supabase.from("customer_consent_state").select("channel, purpose, status, source, captured_at").eq("customer_id", id),
    supabase
      .from("customer_events")
      .select("id, type, body, changes, actor_id, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(200),
    supabase
      .from("customer_attachments")
      .select("id, file_name, content_type, size_bytes, storage_path, created_at, uploaded_by")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
  ]);
  for (const r of [contacts, addresses, tags, consents, events, attachments]) {
    if (r.error) throw new Error(`Could not load customer file: ${r.error.message}`);
  }

  return {
    id: c.id,
    businessId: c.business_id,
    cifNumber: c.cif_number,
    fullName: c.full_name,
    gender: c.gender,
    dateOfBirth: c.date_of_birth,
    preferredLanguage: c.preferred_language,
    branchId: c.branch_id,
    ownerId: c.owner_id,
    customFields: c.custom_fields ?? {},
    mergedIntoId: c.merged_into_id,
    createdAt: c.created_at,
    contacts: (contacts.data ?? []).map((x) => ({
      id: x.id,
      kind: x.kind,
      value: x.value,
      label: x.label,
      isPrimary: x.is_primary,
    })),
    addresses: (addresses.data ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      state: a.state,
      postalCode: a.postal_code,
      isDefault: a.is_default,
    })),
    tags: ((tags.data ?? []) as unknown as { tag: Tag | null }[]).flatMap((t) => (t.tag ? [t.tag] : [])),
    consents: (consents.data ?? []).map((x) => ({
      channel: x.channel,
      purpose: x.purpose,
      status: x.status,
      source: x.source,
      capturedAt: x.captured_at,
    })),
    events: (events.data ?? []).map((e) => ({
      id: e.id,
      type: e.type,
      body: e.body,
      changes: e.changes,
      actorId: e.actor_id,
      createdAt: e.created_at,
    })),
    attachments: (attachments.data ?? []).map((a) => ({
      id: a.id,
      fileName: a.file_name,
      contentType: a.content_type,
      sizeBytes: a.size_bytes,
      storagePath: a.storage_path,
      createdAt: a.created_at,
      uploadedBy: a.uploaded_by,
    })),
  };
}

export const ATTACHMENT_BUCKET = "customer-files";

/** Short-lived download links; storage RLS decides who gets one. */
export async function signedAttachmentUrls(paths: string[]) {
  const map = new Map<string, string>();
  if (!paths.length) return map;
  const supabase = await createClient();
  const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(paths, 600);
  for (const d of data ?? []) if (d.signedUrl && d.path) map.set(d.path, d.signedUrl);
  return map;
}

/** Candidate duplicates for the merge tool. */
export async function findCustomers(businessId: string, q: string, country: CountryCode, excludeId: string) {
  const match = await matchingCustomerIds(businessId, q, country, 20);
  if (!match || !match.ids.length) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, cif_number, full_name, primary_phone, primary_email, created_at")
    .in("id", match.ids)
    .is("merged_into_id", null)
    .neq("id", excludeId)
    .limit(20);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    cifNumber: c.cif_number as string,
    fullName: c.full_name as string,
    phone: c.primary_phone as string | null,
    email: c.primary_email as string | null,
    createdAt: c.created_at as string,
  }));
}
