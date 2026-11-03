import type { CountryCode } from "libphonenumber-js";
import { normalisePhone } from "./phone";

export type SearchTerm = {
  /** Safe to embed in a PostgREST `or=(…)` filter. */
  text: string;
  /** E.164 when the query is a phone number. */
  phone: string | null;
  /** Trailing digits, for partial phone search ("98490"). */
  digits: string | null;
};

/**
 * Prepares a free-text search box value. Strips characters that have
 * meaning in PostgREST filters so user input can't change the query.
 */
export function parseSearch(raw: string | null | undefined, country: CountryCode = "IN"): SearchTerm | null {
  const text = (raw ?? "").replace(/[,()*%\\:"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!text) return null;
  const onlyDigits = text.replace(/[\s+\-.]/g, "");
  const isNumeric = /^\d{4,15}$/.test(onlyDigits);
  return {
    text,
    phone: /[\d]{7,}/.test(onlyDigits) ? normalisePhone(text, country) : null,
    digits: isNumeric ? onlyDigits : null,
  };
}
