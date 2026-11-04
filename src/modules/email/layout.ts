/** Shared pieces of every transactional email: layout, escaping, dates. */

export type RenderedEmail = { subject: string; html: string; text: string };

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function str(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

/** Plain, single-column layout that renders the same in every mail client. */
export function layout(title: string, lines: string[], action: { label: string; url: string }, footer: string) {
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
