import { toCsv } from "@/lib/csv";
import { FIELDS, type ImportKind } from "./fields";

const EXAMPLES: Record<ImportKind, Record<string, string>> = {
  customers: {
    full_name: "Asha Rao", phone: "98200 12345", email: "asha@example.com", branch: "Main",
    gender: "female", date_of_birth: "14/08/1992", tags: "VIP; Bridal", created_at: "05/03/2024",
  },
  leads: {
    external_ref: "ENQ-1042", full_name: "Kiran Mehta", phone: "98490 12345", email: "", branch: "Main",
    source: "Walk-in", stage: "Converted", lost_reason: "", owner: "sam@yourshop.in", title: "Wedding sherwani",
    expected_value: "45,000", campaign: "", created_at: "10/01/2024", closed_at: "01/02/2024",
  },
  orders: {
    external_ref: "INV-2291", full_name: "Asha Rao", phone: "98200 12345", email: "", branch: "Main",
    owner: "sam@yourshop.in", description: "Bridal lehenga", total: "45,000", paid: "45,000",
    payment_method: "UPI", stage: "Delivered", created_at: "01/04/2024", due_date: "25/04/2024",
    closed_at: "02/05/2024", notes: "",
  },
};

/** Header row plus one example row, in the column order the importer prefers. */
export function templateCsv(kind: ImportKind) {
  const fields = FIELDS[kind];
  return toCsv([EXAMPLES[kind]], fields.map((f) => ({ header: f.label, value: (r: Record<string, string>) => r[f.key] ?? "" })));
}
