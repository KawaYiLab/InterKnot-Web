import { EMOTE_REGEX } from "~/utils/emote";
import { stripMentionsToPlain } from "~/utils/mention";

/** 用惰性文档取纯文本：不执行脚本、不加载资源，残缺标签也按 HTML 规范丢弃。 */
function htmlToText(html: string): string {
  if (typeof DOMParser === "undefined") return html.replace(/[<>]/g, "");
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

// 瀑布流每次重排都会对全部卡片重新估高，按原文缓存清洗结果
const CACHE_LIMIT = 1000;
const cache = new Map<string, string>();

/**
 * 把列表接口的 `excerpt`（后端截取的前 120 字原始 Markdown，只合并了空白）
 * 清洗成卡片上展示的纯文本摘要。截断处可能落在图片 / 链接语法中间，一并去掉。
 */
export function toCardExcerpt(raw: string | null | undefined): string {
  if (!raw) return "";
  const cached = cache.get(raw);
  if (cached !== undefined) return cached;
  const markdown = stripMentionsToPlain(raw)
    .replace(new RegExp(EMOTE_REGEX.source, EMOTE_REGEX.flags), "")
    .replace(/!\[[^\]]*\]\([^)]*\)?/g, "")
    .replace(/!\[[^\]]*$/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)?/g, "$1");
  const text = htmlToText(markdown)
    .replace(/(^|\s)(#{1,6}|>|[-*+]|\d+\.)(?=\s)/g, "$1")
    .replace(/[*_~`]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(raw, text);
  return text;
}
