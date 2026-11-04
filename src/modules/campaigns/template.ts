/**
 * WhatsApp message templates: our stored shape, validation, and conversion to
 * the provider payloads (Meta and 360dialog share the Cloud API format). Pure.
 */

export type HeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
export type Button =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string };

export type TemplateComponents = {
  header?: { format: HeaderFormat; text?: string; handle?: string };
  body: { text: string; examples?: string[] };
  footer?: { text: string };
  buttons?: Button[];
};

const VAR = /\{\{(\d+)\}\}/g;

/** Variables must be {{1}}…{{n}} with no gaps. Returns n, or an error. */
export function countVariables(text: string): { ok: true; count: number } | { ok: false; error: string } {
  const nums = [...text.matchAll(VAR)].map((m) => Number(m[1]));
  if (!nums.length) return { ok: true, count: 0 };
  const max = Math.max(...nums);
  for (let i = 1; i <= max; i++) {
    if (!nums.includes(i)) return { ok: false, error: `Variables must be numbered {{1}} to {{${max}}} without gaps; {{${i}}} is missing.` };
  }
  if (/^\s*\{\{\d+\}\}/.test(text) || /\{\{\d+\}\}\s*$/.test(text)) {
    return { ok: false, error: "Meta rejects templates that start or end with a variable. Add words around it." };
  }
  return { ok: true, count: max };
}

export function validateTemplate(name: string, c: TemplateComponents): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9_]{1,250}$/.test(name)) errors.push("Name: lowercase letters, numbers and underscores only.");
  const body = c.body?.text?.trim() ?? "";
  if (!body) errors.push("The message body is required.");
  if (body.length > 1024) errors.push("The body is limited to 1,024 characters.");
  const vars = countVariables(body);
  if (!vars.ok) errors.push(vars.error);
  else if (vars.count > 20) errors.push("Use at most 20 variables.");
  else if (vars.count && (c.body.examples?.filter((e) => e.trim()).length ?? 0) < vars.count) {
    errors.push("Give an example value for every variable; Meta reviews them.");
  }
  if (c.header?.format === "TEXT") {
    if (!c.header.text?.trim()) errors.push("A text header needs text.");
    else if (c.header.text.length > 60) errors.push("Headers are limited to 60 characters.");
    else if (VAR.test(c.header.text)) errors.push("Header variables aren't supported here; put them in the body.");
  }
  if (c.footer?.text && c.footer.text.length > 60) errors.push("Footers are limited to 60 characters.");
  const buttons = c.buttons ?? [];
  if (buttons.length > 3) errors.push("Use at most 3 buttons.");
  for (const b of buttons) {
    if (!b.text.trim() || b.text.length > 25) errors.push("Button labels need 1 to 25 characters.");
    if (b.type === "URL" && !/^https:\/\/\S+$/.test(b.url)) errors.push("Website buttons need a full https:// address.");
    if (b.type === "PHONE_NUMBER" && !/^\+[1-9]\d{6,14}$/.test(b.phone_number)) errors.push("Call buttons need a number like +919849012345.");
  }
  return errors;
}

/** Payload for POST /{waba_id}/message_templates (Meta) or /v1/configs/templates (360dialog). */
export function toProviderTemplate(name: string, language: string, category: string, c: TemplateComponents) {
  const components: Record<string, unknown>[] = [];
  if (c.header) {
    components.push(
      c.header.format === "TEXT"
        ? { type: "HEADER", format: "TEXT", text: c.header.text }
        : { type: "HEADER", format: c.header.format, example: { header_handle: [c.header.handle] } },
    );
  }
  const examples = c.body.examples?.filter((e) => e.trim()) ?? [];
  components.push({
    type: "BODY",
    text: c.body.text,
    ...(examples.length ? { example: { body_text: [examples] } } : {}),
  });
  if (c.footer?.text) components.push({ type: "FOOTER", text: c.footer.text });
  if (c.buttons?.length) components.push({ type: "BUTTONS", buttons: c.buttons });
  return { name, language, category, components };
}

/** The "components" of a template message send: body parameters and a media header. */
export function toSendComponents(c: TemplateComponents, params: string[], headerMediaUrl?: string | null) {
  const out: Record<string, unknown>[] = [];
  if (c.header && c.header.format !== "TEXT") {
    const kind = c.header.format.toLowerCase();
    if (headerMediaUrl) out.push({ type: "header", parameters: [{ type: kind, [kind]: { link: headerMediaUrl } }] });
  }
  if (params.length) {
    out.push({ type: "body", parameters: params.map((p) => ({ type: "text", text: p || "-" })) });
  }
  return out;
}

/** The text a customer sees, for the inbox and previews. */
export function renderBody(text: string, params: string[]) {
  return text.replace(VAR, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}
