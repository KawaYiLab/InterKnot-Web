export interface HighlightPart {
  text: string;
  hit: boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 把文本按搜索词切成片段，命中部分 hit=true（不区分大小写，空格分隔的多个词分别匹配）。
 * 交给模板逐段渲染，不用 v-html。
 */
export function splitHighlight(text: string, keyword: string | null | undefined): HighlightPart[] {
  if (!text) return [];
  const terms = (keyword || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (!terms.length) return [{ text, hit: false }];
  const re = new RegExp(`(${terms.join("|")})`, "gi");
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (!m[0]) continue;
    if (start > last) parts.push({ text: text.slice(last, start), hit: false });
    parts.push({ text: m[0], hit: true });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts;
}

/**
 * 长文本围绕第一个命中词截一段，保证命中处出现在可见范围里。
 */
export function excerptAround(text: string, keyword: string | null | undefined, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const terms = (keyword || "").trim().split(/\s+/).filter(Boolean);
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0 || at < max / 3) return `${flat.slice(0, max)}…`;
  const start = Math.max(0, at - Math.floor(max / 3));
  const end = Math.min(flat.length, start + max);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}
