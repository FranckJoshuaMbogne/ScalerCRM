/**
 * Verification samples published on the developer page and in docs/api.md.
 * sign.test.ts runs the Node sample against real signatures, so the published
 * code is known to work.
 */
export const VERIFY_SAMPLE_NODE = `const crypto = require("node:crypto");

// rawBody: the request body exactly as received (a string, before JSON.parse).
// header:  the Scaler-Signature header.  secret: the endpoint's whsec_… secret.
function verifyScalerSignature(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(
    String(header || "").split(",").map((p) => p.trim().split("=", 2)),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(t + "." + rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`;

export const VERIFY_SAMPLE_PYTHON = `import hashlib, hmac, time

def verify_scaler_signature(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = dict(p.strip().split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        t = int(parts["t"])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > tolerance or "v1" not in parts:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])`;
