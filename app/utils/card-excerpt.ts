import { EMOTE_REGEX } from "~/utils/emote";
import { stripMentionsToPlain } from "~/utils/mention";

/**
 * 把列表接口的 `excerpt`（后端截取的前 120 字原始 Markdown，只合并了空白）
 * 清洗成卡片上展示的纯文本摘要。截断处可能落在图片 / 链接语法中间，一并去掉。
 */
export function toCardExcerpt(raw: string | null | undefined): string {
  if (!raw) return "";
  return stripMentionsToPlain(raw)
    .replace(new RegExp(EMOTE_REGEX.source, EMOTE_REGEX.flags), "")
    .replace(/!\[[^\]]*\]\([^)]*\)?/g, "")
    .replace(/!\[[^\]]*$/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)?/g, "$1")
    .replace(/<[^>]*>?/g, "")
    // 嵌套 / 残缺标签去一轮后仍可能拼出 `<script`，残留的尖括号一律删掉
    .replace(/[<>]/g, "")
    .replace(/(^|\s)(#{1,6}|>|[-*+]|\d+\.)(?=\s)/g, "$1")
    .replace(/[*_~`]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
