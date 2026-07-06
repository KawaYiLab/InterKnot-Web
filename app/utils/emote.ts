/**
 * Emote token 解析工具（前端）。
 *
 * 评论正文里的行内小表情以 shortcode 风格存储：
 *   `:ik-<code>:`
 * 例：:ik-smile:  :ik-cry:  :ik-zzz-happy:
 *
 * 与 `server/src/api/comment/utils/emote.ts` 的正则 / 行为保持一致。
 * 两端独立维护避免跨仓引用；改动时务必同步两侧。
 */

import { parseMentions, type ContentSegment } from "~/utils/mention";

/**
 * 表情 token 的匹配正则。与后端 emote.ts 必须一字不差。
 *
 * 捕获组为完整 code（含 ik- 前缀），与 DB schema 的 code 字段一致：
 *   :ik-smile: → 捕获 "ik-smile"
 *   :ik-zzz-happy: → 捕获 "ik-zzz-happy"
 */
export const EMOTE_REGEX = /:(ik-[a-z0-9-]{1,32}):/g;

export interface EmoteToken {
  /** 不含前后冒号的完整 code（如 `ik-smile`） */
  code: string;
  /** token 在原字符串中的起止下标（半开区间） */
  start: number;
  end: number;
}

/**
 * 解析评论正文里的所有 emote token。
 * 返回顺序与出现顺序一致；不去重。
 */
export function parseEmotes(content: string): EmoteToken[] {
  if (typeof content !== "string" || !content) return [];
  const re = new RegExp(EMOTE_REGEX.source, EMOTE_REGEX.flags);
  const out: EmoteToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push({
      code: m[1] ?? "",
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/**
 * 把所有 emote token 替换为 `[表情:name]` 形式，给预览 / 摘要用。
 * name 从 manifest 查找；查不到时降级为 `[表情]`。
 */
export function stripEmotesToPlain(
  content: string,
  nameLookup?: (code: string) => string | undefined,
): string {
  if (typeof content !== "string" || !content) return "";
  const re = new RegExp(EMOTE_REGEX.source, EMOTE_REGEX.flags);
  return content.replace(re, (_match, code: string) => {
    const name = nameLookup?.(code);
    return name ? `[表情:${name}]` : "[表情]";
  });
}

/**
 * 拼装一个 emote token。供 picker 选中后插入到编辑器里使用。
 */
export function buildEmoteToken(code: string): string {
  return `:${code}:`;
}

// ── 统一分段器 ────────────────────────────────────────

/**
 * 统一分段器返回的渲染段类型。
 * 在 ContentSegment 基础上扩展 emote 变体——discriminated union 扩展
 * 不破坏现有的 switch / v-if 分支。
 */
export type UnifiedSegment = ContentSegment | { type: "emote"; code: string };

/**
 * 把评论正文切成 text / mention / emote 段，便于在模板里 v-for 渲染。
 *
 * 同时识别 `@[name](docId)` mention token 和 `:ik-code:` emote token，
 * 按出现顺序切分，其余为 text 段。
 *
 * 与 `splitContentWithMentions` 的关系：
 * - `splitContentWithMentions` 只识别 mention，保持原样不动（被测试覆盖）；
 * - `splitContent` 是升级版，额外识别 emote，供 `CommentBody.vue` 使用。
 */
export function splitContent(content: string): UnifiedSegment[] {
  if (typeof content !== "string" || !content) return [];

  const mentionTokens = parseMentions(content);
  const emoteTokens = parseEmotes(content);

  if (mentionTokens.length === 0 && emoteTokens.length === 0) {
    return [{ type: "text", value: content }];
  }

  // 合并所有 token 并按 start 排序
  const allTokens: Array<
    | { kind: "mention"; start: number; end: number; name: string; authorDocumentId: string }
    | { kind: "emote"; start: number; end: number; code: string }
  > = [
    ...mentionTokens.map((t) => ({
      kind: "mention" as const,
      start: t.start,
      end: t.end,
      name: t.name,
      authorDocumentId: t.authorDocumentId,
    })),
    ...emoteTokens.map((t) => ({
      kind: "emote" as const,
      start: t.start,
      end: t.end,
      code: t.code,
    })),
  ].sort((a, b) => a.start - b.start);

  const segments: UnifiedSegment[] = [];
  let cursor = 0;

  for (const tok of allTokens) {
    // 跳过与前一个 token 重叠的（理论上不应发生，但防御性处理）
    if (tok.start < cursor) continue;

    if (tok.start > cursor) {
      segments.push({ type: "text", value: content.slice(cursor, tok.start) });
    }

    if (tok.kind === "mention") {
      segments.push({
        type: "mention",
        name: tok.name,
        authorDocumentId: tok.authorDocumentId,
      });
    } else {
      segments.push({ type: "emote", code: tok.code });
    }

    cursor = tok.end;
  }

  if (cursor < content.length) {
    segments.push({ type: "text", value: content.slice(cursor) });
  }

  return segments;
}

// 保持与 mention.ts 的 ContentSegment 类型兼容（re-export）
export type { ContentSegment } from "~/utils/mention";
