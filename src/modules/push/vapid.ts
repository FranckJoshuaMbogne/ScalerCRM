import { createPrivateKey, type KeyObject, sign } from "node:crypto";

/**
 * VAPID (RFC 8292) for Web Push, with Node's crypto instead of a library.
 * SCALER's pushes carry no payload, so no message encryption is needed: only
 * the signed JWT that proves the push comes from this server.
 */
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

/** Public key: 65-byte uncompressed P-256 point; private key: 32-byte scalar; both base64url. */
export function vapidPrivateKey(keys: Pick<VapidKeys, "publicKey" | "privateKey">): KeyObject {
  const pub = Buffer.from(keys.publicKey, "base64url");
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be an uncompressed P-256 point");
  return createPrivateKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)), d: keys.privateKey },
  });
}

/** The Authorization header for one push endpoint, valid for 12 hours. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, key: KeyObject, now = Date.now()) {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject }),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}
