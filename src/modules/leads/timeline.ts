/** Turns timeline rows into sentences. Pure, so it can be unit tested. */

type Lookup = (id: unknown) => string | undefined;

const FIELD_LABELS: Record<string, string> = {
  title: "interest",
  description: "notes",
  expected_value: "expected value",
  branch_id: "branch",
  owner_id: "owner",
  custom_fields: "custom fields",
};

export const ACTIVITY_LABELS: Record<string, string> = {
  note: "Note",
  call: "Call",
  whatsapp: "WhatsApp",
  email: "Email",
  meeting: "Meeting",
  visit: "Store visit",
};

export function describeLeadActivity(
  a: { type: string; meta: Record<string, unknown> },
  names: { status: Lookup; source: Lookup; person: Lookup },
): string {
  switch (a.type) {
    case "created": {
      const source = names.source(a.meta.source_id);
      return source ? `created the lead from ${source}` : "created the lead";
    }
    case "status_changed":
      return `moved it from ${names.status(a.meta.from) ?? "?"} to ${names.status(a.meta.to) ?? "?"}`;
    case "enquiry": {
      const source = names.source(a.meta.source_id);
      return `sent another enquiry${source ? ` via ${source}` : ""}`;
    }
    case "assigned": {
      const to = (a.meta.changes as Record<string, { to: unknown }> | undefined)?.owner_id?.to;
      return to ? `assigned it to ${names.person(to) ?? "a former member"}` : "unassigned it";
    }
    case "archived":
      return "archived the lead";
    case "restored":
      return "restored the lead";
    case "customer_merged":
      return "moved it to another customer file during a merge";
    case "updated": {
      const keys = Object.keys((a.meta.changes as object) ?? {});
      return `changed ${keys.map((k) => FIELD_LABELS[k] ?? k.replace(/_/g, " ")).join(", ") || "the lead"}`;
    }
    default:
      return `logged a ${ACTIVITY_LABELS[a.type]?.toLowerCase() ?? a.type.replace(/_/g, " ")}`;
  }
}

const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  full_name: "name",
  date_of_birth: "date of birth",
  preferred_language: "language",
  branch_id: "branch",
  owner_id: "owner",
  custom_fields: "custom fields",
  merged_into_id: "merge status",
  merged_at: "merge date",
};

export function describeCustomerEvent(e: { type: string; changes: Record<string, unknown> | null; body: string | null }) {
  switch (e.type) {
    case "created":
      return "created the customer file";
    case "note":
      return "added a note";
    case "merged":
      return e.body ?? "merged another file into this one";
    case "contact_added":
      return `added ${String(e.changes?.kind ?? "contact")} ${String(e.changes?.value ?? "")}`.trim();
    case "contact_removed":
      return `removed ${String(e.changes?.kind ?? "contact")} ${String(e.changes?.value ?? "")}`.trim();
    case "updated": {
      const keys = Object.keys(e.changes ?? {});
      return `changed ${keys.map((k) => CUSTOMER_FIELD_LABELS[k] ?? k.replace(/_/g, " ")).join(", ")}`;
    }
    default:
      return e.type.replace(/_/g, " ");
  }
}
