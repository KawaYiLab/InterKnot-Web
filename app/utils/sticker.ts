/**
 * Sticker token 解析工具（前端）。
 *
 * 评论 / 私信正文里的表情以内联 token 存储：
 *   `::sticker[<sticker.documentId>]::`
 *
 * 与 `server/src/utils/sticker.ts` 的正则 / 行为保持一致。
 * 两端独立维护避免跨仓引用；改动时务必同步两侧。
 */

import type { ContentSegment } from "~/utils/mention";
import { splitContentWithMentions } from "~/utils/mention";

export const STICKER_TOKEN_REGEX = /::sticker\[([A-Za-z0-9]{6,40})\]::/g;

/** 单条正文里允许的表情数量上限（与后端一致） */
export const MAX_STICKERS_PER_CONTENT = 6;

/** 拼装一个 sticker token。picker 选中后插入到编辑器里使用。 */
export function buildStickerToken(documentId: string): string {
  return `::sticker[${documentId}]::`;
}

export function parseStickerTokens(content: string): string[] {
  if (typeof content !== "string" || !content) return [];
  const re = new RegExp(STICKER_TOKEN_REGEX.source, STICKER_TOKEN_REGEX.flags);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push(m[1] ?? "");
  }
  return out;
}

/** 把 sticker token 替换成 `[表情]`，给会话列表 / 摘要预览用。 */
export function stripStickersToPlain(content: string): string {
  if (typeof content !== "string" || !content) return "";
  return content.replace(
    new RegExp(STICKER_TOKEN_REGEX.source, STICKER_TOKEN_REGEX.flags),
    "[表情]",
  );
}

/** 正文含 mention + sticker 两种 token 时的渲染段。 */
export type RichContentSegment =
  | ContentSegment
  | { type: "sticker"; documentId: string };

/**
 * 把正文切成 text / mention / sticker 段：先按 mention 切分，
 * 再对 text 段做 sticker token 二次切分。
 */
export function splitContentWithTokens(content: string): RichContentSegment[] {
  const out: RichContentSegment[] = [];
  for (const seg of splitContentWithMentions(content)) {
    if (seg.type !== "text") {
      out.push(seg);
      continue;
    }
    const text = seg.value;
    const re = new RegExp(STICKER_TOKEN_REGEX.source, STICKER_TOKEN_REGEX.flags);
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > cursor) {
        out.push({ type: "text", value: text.slice(cursor, m.index) });
      }
      out.push({ type: "sticker", documentId: m[1] ?? "" });
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) {
      out.push({ type: "text", value: text.slice(cursor) });
    }
  }
  return out;
}

/** 正文是否只有表情（无其他可见文本）——用于放大展示单表情消息。 */
export function isStickerOnlyContent(content: string): boolean {
  if (typeof content !== "string" || !content) return false;
  const stripped = content.replace(
    new RegExp(STICKER_TOKEN_REGEX.source, STICKER_TOKEN_REGEX.flags),
    "",
  );
  return stripped.trim() === "" && parseStickerTokens(content).length > 0;
}
