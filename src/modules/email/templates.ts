/** Transactional email templates. Pure: payload in, subject/html/text out. */

export type RenderedEmail = { subject: string; html: string; text: string };

const TASK_TYPE_LABEL: Record<string, string> = {
  follow_up: "Follow-up",
  call: "Call",
  whatsapp: "WhatsApp",
  visit: "Store visit",
  meeting: "Meeting",
  email: "Email",
  other: "Task",
};

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function str(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

/** Plain, single-column layout that renders the same in every mail client. */
function layout(title: string, lines: string[], action: { label: string; url: string }, footer: string) {
  const body = lines.map((l) => `<p style="margin:0 0 12px">${l}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1b1f">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e3dc;border-radius:10px;padding:24px">
<p style="margin:0 0 16px;font-size:12px;letter-spacing:.08em;font-weight:600">SCALER</p>
<h1 style="margin:0 0 16px;font-size:18px">${title}</h1>
<div style="font-size:14px;line-height:1.5">${body}</div>
<p style="margin:20px 0 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#1d5bd8;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600">${escapeHtml(action.label)}</a></p>
<p style="margin:24px 0 0;font-size:12px;color:#6b6b73">${footer}</p>
</div></body></html>`;
}

export function formatDue(iso: string, timeZone: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch {
    return d.toISOString();
  }
}

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

/** Renders an outbox row. Unknown templates return null and are marked failed. */
export function renderOutboxEmail(template: string, payload: Record<string, unknown>, origin: string): RenderedEmail | null {
  switch (template) {
    case "task_reminder":
      return taskReminderEmail(payload, origin);
    default:
      return null;
  }
}
