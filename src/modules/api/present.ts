/**
 * Turns database results into API responses. Pure, so the contract tests can
 * run real database output through exactly what the routes send.
 */
export type DbList = { object: "list"; data: unknown[]; has_more: boolean; next: { t: string; id: string } | null };

export function encodeCursor(next: { t: string; id: string }): string {
  return Buffer.from(JSON.stringify([next.t, next.id])).toString("base64url");
}

export function decodeCursor(cursor: string): { t: string; id: string } | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "string" &&
      !Number.isNaN(Date.parse(v[0])) && /^[0-9a-f-]{36}$/i.test(v[1])
    ) {
      return { t: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

export function presentList(db: DbList) {
  return {
    object: "list" as const,
    data: db.data,
    has_more: db.has_more,
    next_cursor: db.has_more && db.next ? encodeCursor(db.next) : null,
  };
}

/** Writes return { status, <resource>, replayed }; the response is the resource. */
export function presentWrite(db: Record<string, unknown>, resource: string) {
  return {
    status: Number(db.status) || 200,
    body: db[resource] as Record<string, unknown>,
    replayed: db.replayed === true,
  };
}
