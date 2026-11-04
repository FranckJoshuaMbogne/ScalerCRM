import "server-only";
import type { ActionState } from "@/lib/forms";
import { PermissionError } from "./session";

/** Runs an action body so permission failures come back as a message, not a crash. */
export async function guard(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, message: e.message };
    throw e;
  }
}
