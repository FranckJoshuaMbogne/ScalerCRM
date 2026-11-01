import { type CountryCode, parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Normalise a phone number to E.164 — the primary CIF matching key.
 * Returns null when the number cannot be parsed as a valid number,
 * so callers never match customers on garbage input.
 */
export function normalisePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "IN",
): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^00/, "+");
  if (!cleaned) return null;
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}
