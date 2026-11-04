import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { vapidAuthorization, vapidPrivateKey } from "./vapid";

describe("VAPID", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  const keys = { publicKey: raw.toString("base64url"), privateKey: jwk.d!, subject: "mailto:ops@scaler.test" };

  it("signs a JWT for the push service's origin that the public key verifies", () => {
    const now = Date.UTC(2027, 2, 1);
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, vapidPrivateKey(keys), now);
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = token.split(".");
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: now / 1000 + 12 * 3600,
      sub: "mailto:ops@scaler.test",
    });
    const ok = verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });

  it("rejects a malformed public key", () => {
    expect(() => vapidPrivateKey({ publicKey: "AAAA", privateKey: keys.privateKey })).toThrow();
  });
});
