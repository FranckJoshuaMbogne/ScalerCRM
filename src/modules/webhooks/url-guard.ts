import { isIP } from "node:net";

/**
 * Webhook URLs must be public https addresses: SCALER must never be usable to
 * reach its own network. Checked when an endpoint is saved (also in Postgres)
 * and again on every send, after DNS resolution.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return true;
}

/** Null when the URL is acceptable, otherwise a message for the person. */
export function checkWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL, e.g. https://example.com/scaler-webhook.";
  }
  if (url.protocol !== "https:") return "The URL must start with https://.";
  if (url.username || url.password) return "Remove the user name and password from the URL.";
  if (raw.length > 2000) return "The URL is too long.";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host) ? isPrivateAddress(host) : /(^localhost$|\.localhost$|\.local$|\.internal$)/.test(host) || !host.includes(".")) {
    return "The URL must be a public address.";
  }
  return null;
}
