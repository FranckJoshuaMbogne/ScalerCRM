/** URL-safe business slug: lowercase letters, digits and single hyphens, 3–48 chars. */
export function slugify(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Machine key for a custom role: lowercase with underscores. */
export function roleKey(name: string) {
  return slugify(name).replace(/-/g, "_").slice(0, 40) || "custom_role";
}
