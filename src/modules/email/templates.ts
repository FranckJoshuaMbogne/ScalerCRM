/** Transactional email templates. Pure: payload in, subject/html/text out. */
import { billingEmail } from "@/modules/billing/emails";
import { escapeHtml, formatDue, layout, type RenderedEmail, str } from "./layout";

export { escapeHtml, formatDue, layout, str };
export type { RenderedEmail };

const TASK_TYPE_LABEL: Record<string, string> = {
  follow_up: "Follow-up",
  call: "Call",
  whatsapp: "WhatsApp",
  visit: "Store visit",
  meeting: "Meeting",
  email: "Email",
  other: "Task",
};

export function taskReminderEmail(p: Record<string, unknown>, origin: string): RenderedEmail {
  const title = str(p.task_title) || "Follow-up";
  const type = TASK_TYPE_LABEL[str(p.task_type)] ?? "Task";
  const due = formatDue(str(p.due_at), str(p.timezone) || "UTC");
  const business = str(p.business_name) || "your business";
  const who = [str(p.lead_number), str(p.customer_name)].filter(Boolean).join(" · ");
  const phone = str(p.customer_phone);
  const notes = str(p.notes);
  const path = str(p.path).startsWith("/") ? str(p.path) : "/tasks";
  const url = `${origin}${path}`;

  const subject = `${type} due ${due}: ${title}`;
  const lines = [
    `<strong>${escapeHtml(title)}</strong> is due at ${escapeHtml(due)}.`,
    ...(who ? [`Customer: ${escapeHtml(who)}${phone ? ` (${escapeHtml(phone)})` : ""}`] : []),
    ...(notes ? [`Notes: ${escapeHtml(notes)}`] : []),
  ];
  const text = [
    `${title} is due at ${due}.`,
    who ? `Customer: ${who}${phone ? ` (${phone})` : ""}` : "",
    notes ? `Notes: ${notes}` : "",
    "",
    `Open it in SCALER: ${url}`,
    "",
    `You get this because the task is assigned to you in ${business}.`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");

  return {
    subject,
    html: layout(`${type} reminder`, lines, { label: "Open in SCALER", url },
      `You get this because the task is assigned to you in ${escapeHtml(business)}.`),
    text,
  };
}

export function invitationEmail(p: { businessName: string; inviterName: string; roleName: string; link: string }): RenderedEmail {
  const subject = `${p.inviterName} invited you to ${p.businessName} on SCALER`;
  const lines = [
    `${escapeHtml(p.inviterName)} invited you to join <strong>${escapeHtml(p.businessName)}</strong> as ${escapeHtml(p.roleName)}.`,
    "The link works once and expires in 7 days. Sign in or create an account with this email address to accept.",
  ];
  const text = [
    `${p.inviterName} invited you to join ${p.businessName} as ${p.roleName}.`,
    "",
    `Accept the invitation: ${p.link}`,
    "",
    "The link works once and expires in 7 days. Sign in or create an account with this email address to accept.",
  ].join("\n");
  return {
    subject,
    html: layout("You're invited", lines, { label: "Accept invitation", url: p.link },
      "If you weren't expecting this, you can ignore this email."),
    text,
  };
}

const APPOINTMENT_KIND: Record<string, string> = {
  consultation: "Consultation",
  measurement: "Measurement",
  trial: "Trial",
  alteration: "Alteration",
  delivery: "Delivery",
  other: "Appointment",
};

export function appointmentReminderEmail(p: Record<string, unknown>, origin: string): RenderedEmail {
  const kind = APPOINTMENT_KIND[str(p.kind)] ?? "Appointment";
  const when = formatDue(str(p.starts_at), str(p.timezone) || "UTC");
  const customer = str(p.customer_name) || "a customer";
  const phone = str(p.customer_phone);
  const branch = str(p.branch_name);
  const title = str(p.title);
  const notes = str(p.notes);
  const business = str(p.business_name) || "your business";
  const path = str(p.path).startsWith("/") ? str(p.path) : "/appointments";
  const url = `${origin}${path}`;
  const subject = `${kind} with ${customer} at ${when}`;
  const lines = [
    `<strong>${escapeHtml(kind)}</strong> with ${escapeHtml(customer)}${phone ? ` (${escapeHtml(phone)})` : ""} at ${escapeHtml(when)}${branch ? `, ${escapeHtml(branch)}` : ""}.`,
    ...(title ? [escapeHtml(title)] : []),
    ...(notes ? [`Notes: ${escapeHtml(notes)}`] : []),
  ];
  const text = [
    `${kind} with ${customer}${phone ? ` (${phone})` : ""} at ${when}${branch ? `, ${branch}` : ""}.`,
    title,
    notes ? `Notes: ${notes}` : "",
    "",
    `Open the calendar: ${url}`,
    "",
    `You get this because the appointment is with you in ${business}.`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
  return {
    subject,
    html: layout(`${kind} coming up`, lines, { label: "Open the calendar", url },
      `You get this because the appointment is with you in ${escapeHtml(business)}.`),
    text,
  };
}

/** Renders an outbox row. Unknown templates return null and are marked failed. */
export function renderOutboxEmail(template: string, payload: Record<string, unknown>, origin: string): RenderedEmail | null {
  switch (template) {
    case "task_reminder":
      return taskReminderEmail(payload, origin);
    case "appointment_reminder":
      return appointmentReminderEmail(payload, origin);
    default:
      return template.startsWith("billing_") ? billingEmail(template, payload, origin) : null;
  }
}
