/** Keep these rules aligned with server/src/utils/tags.ts. */
export const MAX_TAGS_PER_ARTICLE = 5;
export const MAX_TAG_NAME_LENGTH = 30;

export function normalizeTagName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let name = raw.normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .replace(/\p{Cc}/gu, "")
    .replace(/[^\p{L}\p{M}\p{N}\s\-_+#.]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  // The schema and HTML maxlength count UTF-16 units; never split a surrogate pair.
  name = name.slice(0, MAX_TAG_NAME_LENGTH).replace(/[\uD800-\uDBFF]$/, "").trim();
  return /[\p{L}\p{N}]/u.test(name) ? name : null;
}

export function toTagSlug(raw: string): string | null {
  const name = normalizeTagName(raw);
  if (!name) return null;
  const slug = name.toLowerCase().normalize("NFKC")
    .replace(/[\s_.]+/g, "-")
    .replace(/[^\p{L}\p{M}\p{N}\-+#]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /[\p{L}\p{N}]/u.test(slug) ? slug : null;
}

/** The first spelling wins; slug-equivalent tags only consume one slot. */
export function normalizeTagNames(raw: readonly unknown[]): string[] {
  const names = new Map<string, string>();
  for (const value of raw) {
    const name = normalizeTagName(value);
    if (!name) continue;
    const slug = toTagSlug(name);
    if (!slug || names.has(slug)) continue;
    names.set(slug, name);
    if (names.size === MAX_TAGS_PER_ARTICLE) break;
  }
  return [...names.values()];
}
