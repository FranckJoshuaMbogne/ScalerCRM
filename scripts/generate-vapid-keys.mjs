#!/usr/bin/env node
// Prints a new VAPID key pair for web push, in the format .env.example expects.
// Keep VAPID_PRIVATE_KEY secret (server-only env var); the public key ships to browsers.
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${pub.toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
