import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signatures. Each request carries
 *   Scaler-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 * keyed with the endpoint's signing secret (whsec_…). Receivers recompute the
 * HMAC over the raw body and reject old timestamps to stop replays.
 */
export const SIGNATURE_HEADER = "scaler-signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, body: string, timestamp: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

export function verifySignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  nowSeconds: number,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(signPayload(secret, body, t).split("v1=")[1], "hex");
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
