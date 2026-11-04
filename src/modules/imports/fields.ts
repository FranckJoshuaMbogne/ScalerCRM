/**
 * CSV import rules: which columns each import understands, how headers are
 * recognised, and how a file row becomes the JSON row `import_rows()` takes.
 * Pure, so the checks shown before an import are the ones applied during it.
 */
export const IMPORT_KINDS = ["customers", "leads", "orders"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type Field = {
  key: string;
  label: string;
  /** Header spellings recognised, compared without case, spaces or punctuation. */
  aliases: string[];
  hint?: string;
};

const contact: Field[] = [
  { key: "full_name", label: "Name", aliases: ["name", "fullname", "customer", "customername", "clientname", "client"] },
  { key: "phone", label: "Phone", aliases: ["phone", "mobile", "mobileno", "mobilenumber", "phonenumber", "whatsapp", "contact", "contactno"], hint: "With or without the country code" },
  { key: "email", label: "Email", aliases: ["email", "emailid", "emailaddress", "mail"] },
  { key: "branch", label: "Branch", aliases: ["branch", "store", "showroom", "location"], hint: "Branch name as in Settings" },
];

export const FIELDS: Record<ImportKind, Field[]> = {
  customers: [
    ...contact,
    { key: "gender", label: "Gender", aliases: ["gender", "sex"] },
    { key: "date_of_birth", label: "Date of birth", aliases: ["dateofbirth", "dob", "birthday", "birthdate"] },
    { key: "tags", label: "Tags", aliases: ["tags", "tag", "labels"], hint: "Separate tags with ; or |" },
    { key: "created_at", label: "Customer since", aliases: ["customersince", "createdat", "created", "since", "firstvisit", "date"] },
  ],
  leads: [
    { key: "external_ref", label: "Reference", aliases: ["reference", "ref", "leadid", "leadno", "leadnumber", "enquiryno", "id"], hint: "Rows with a reference already imported are skipped" },
    ...contact,
    { key: "source", label: "Source", aliases: ["source", "leadsource", "channel"] },
    { key: "stage", label: "Stage", aliases: ["stage", "status", "leadstatus", "leadstage"] },
    { key: "lost_reason", label: "Lost reason", aliases: ["lostreason", "reason"] },
    { key: "owner", label: "Owner", aliases: ["owner", "assignedto", "salesperson", "pic", "executive"], hint: "Email or name of a team member" },
    { key: "title", label: "Interest", aliases: ["interest", "title", "product", "requirement", "enquiry"] },
    { key: "expected_value", label: "Expected value", aliases: ["expectedvalue", "value", "budget", "amount"] },
    { key: "campaign", label: "Campaign", aliases: ["campaign", "campaignname", "utmcampaign"] },
    { key: "created_at", label: "Enquiry date", aliases: ["enquirydate", "createdat", "created", "date", "leaddate"] },
    { key: "closed_at", label: "Closed date", aliases: ["closeddate", "closedat", "converteddate", "wondate"] },
  ],
  orders: [
    { key: "external_ref", label: "Order number", aliases: ["ordernumber", "orderno", "orderid", "invoiceno", "invoicenumber", "billno", "reference", "ref"], hint: "Rows with a number already imported are skipped" },
    ...contact,
    { key: "owner", label: "Salesperson", aliases: ["salesperson", "owner", "staff", "assignedto", "executive"] },
    { key: "description", label: "Description", aliases: ["description", "items", "item", "product", "garment", "details"] },
    { key: "total", label: "Total", aliases: ["total", "amount", "ordervalue", "billamount", "grandtotal", "nettotal"] },
    { key: "paid", label: "Paid", aliases: ["paid", "amountpaid", "advance", "received", "paidamount"] },
    { key: "payment_method", label: "Payment method", aliases: ["paymentmethod", "paymentmode", "mode", "method"] },
    { key: "stage", label: "Stage", aliases: ["stage", "status", "orderstatus"] },
    { key: "created_at", label: "Order date", aliases: ["orderdate", "date", "createdat", "billdate", "invoicedate"] },
    { key: "due_date", label: "Due date", aliases: ["duedate", "deliverydate", "promiseddate", "trialdate"] },
    { key: "closed_at", label: "Delivered date", aliases: ["delivereddate", "deliveredon", "closedat", "closeddate"] },
    { key: "notes", label: "Notes", aliases: ["notes", "remarks", "comments"] },
  ],
};

export const REQUIRED: Record<ImportKind, string[]> = {
  customers: [],
  leads: [],
  orders: ["total"],
};

export type Lookups = {
  branches: { id: string; name: string }[];
  sources: { id: string; key: string; name: string }[];
  leadStages: { id: string; key: string; name: string; category: string }[];
  lostReasons: { id: string; name: string }[];
  orderStages: { id: string; key: string; name: string }[];
  members: { id: string; name: string; email: string }[];
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Maps each field key to a column index, from the header row. */
export function detectColumns(kind: ImportKind, header: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const taken = new Set<number>();
  for (const field of FIELDS[kind]) {
    const idx = header.findIndex((h, i) => !taken.has(i) && [field.key, ...field.aliases].map(squash).includes(squash(h)));
    if (idx >= 0) {
      out[field.key] = idx;
      taken.add(idx);
    }
  }
  return out;
}

/** "2024-03-05", "05/03/2024", "5-3-2024", "05.03.2024" → noon UTC that day (stays on that date in any Indian or Gulf timezone). */
export function parseDate(raw: string): string | null | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?: .*)?$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1900 || y > 2100) return null;
  return date.toISOString().replace(".000Z", "Z");
}

/** "₹1,20,000.50", "Rs. 500", "INR 99" → "120000.50". */
export function parseAmount(raw: string): string | null | undefined {
  const s = raw.replace(/₹|rs\.?|inr|,|\s/gi, "");
  if (!s) return undefined;
  return /^\d{1,12}(\.\d{1,2})?$/.test(s) ? s : null;
}

export function parseGender(raw: string): string | null | undefined {
  const s = squash(raw);
  if (!s) return undefined;
  if (["f", "female", "woman", "w"].includes(s)) return "female";
  if (["m", "male", "man"].includes(s)) return "male";
  if (["o", "other", "nonbinary"].includes(s)) return "other";
  return null;
}

export function parsePaymentMethod(raw: string): string {
  const s = squash(raw);
  if (!s) return "other";
  if (s === "cash") return "cash";
  if (/upi|gpay|googlepay|phonepe|paytm|bhim/.test(s)) return "upi";
  if (/card|visa|mastercard|rupay|pos/.test(s)) return "card";
  if (/neft|imps|rtgs|bank|transfer/.test(s)) return "bank_transfer";
  if (/cheque|check/.test(s)) return "cheque";
  return "other";
}
