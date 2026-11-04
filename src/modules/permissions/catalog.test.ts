import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, SYSTEM_ROLES } from "./catalog";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const sql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

/** Keys from every `-- BEGIN <name>` … `-- END <name>` block, across all migrations. */
function block(name: string, keyPattern: RegExp) {
  const matches = [...sql.matchAll(new RegExp(`-- BEGIN ${name}([\\s\\S]*?)-- END ${name}`, "g"))];
  if (!matches.length) throw new Error(`Missing ${name} block in migrations`);
  return matches.flatMap((m) => [...m[1].matchAll(keyPattern)].map((k) => k[1]));
}

describe("permission catalogue", () => {
  it("matches the database permission seed exactly", () => {
    const keys = block("permissions", /\('([a-z_.]+)'/g);
    expect(new Set(keys)).toEqual(new Set(PERMISSIONS));
  });

  it("matches the database system roles exactly", () => {
    const keys = block("system_roles", /\(null, '([a-z_]+)'/g);
    expect(new Set(keys)).toEqual(new Set(SYSTEM_ROLES));
  });

  it("has no duplicate keys", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });
});
