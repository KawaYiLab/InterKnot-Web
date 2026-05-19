/**
 * Mention token 解析工具（前端）。
 *
 * 评论正文里的 @ 提及以 markdown-style 标记存储：
 *   `@[显示名](authorDocumentId)`
 *
 * 与 `server/src/api/comment/utils/mention.ts` 的正则 / 行为保持一致。
 * 两端独立维护避免跨仓引用；改动时务必同步两侧。
 */

export const MENTION_REGEX = /@\[([^\[\]\n]{1,40})\]\(([A-Za-z0-9]{6,32})\)/g;

export interface MentionToken {
  /** token 内书写的显示名（写入时的快照，不一定等于现在的 author.name） */
  name: string;
  /** 被 @ 的 author.documentId */
  authorDocumentId: string;
  /** token 在原字符串中的起止下标（半开区间） */
  start: number;
  end: number;
}

/** 评论正文按 mention token 切分后的渲染段。 */
export type ContentSegment =
  | { type: "text"; value: string }
  | { type: "mention"; name: string; authorDocumentId: string };

/**
 * 解析评论正文里的所有 mention token。
 * 返回顺序与出现顺序一致；不去重（去重交给调用方按业务语义处理）。
 */
export function parseMentions(content: string): MentionToken[] {
  if (typeof content !== "string" || !content) return [];
  // RegExp 是带 /g 的全局正则，必须先重置 lastIndex 再用，否则多次调用结果会漂。
  const re = new RegExp(MENTION_REGEX.source, MENTION_REGEX.flags);
  const out: MentionToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push({
      name: m[1] ?? "",
      authorDocumentId: m[2] ?? "",
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/**
 * 把所有 mention token 替换成 `@显示名` 形式，给会话列表 / 摘要预览用。
 * 不做 HTML 转义；调用方按需处理（在 Vue 模板里 {{ }} 插值已自动转义）。
 */
export function stripMentionsToPlain(content: string): string {
  if (typeof content !== "string" || !content) return "";
  return content.replace(
    new RegExp(MENTION_REGEX.source, MENTION_REGEX.flags),
    (_match, name: string) => `@${name}`,
  );
}

/**
 * 把评论正文切成一个段数组，便于在模板里 v-for 渲染。
 * - text 段：原样保留（包括其中的换行）
 * - mention 段：含 name / authorDocumentId，用于渲染芯片
 *
 * 设计上不去重——同一 documentId 在文中出现多次也都各自渲染成芯片。
 */
export function splitContentWithMentions(content: string): ContentSegment[] {
  if (typeof content !== "string" || !content) return [];
  const tokens = parseMentions(content);
  if (tokens.length === 0) return [{ type: "text", value: content }];

  const segments: ContentSegment[] = [];
  let cursor = 0;
  for (const t of tokens) {
    if (t.start > cursor) {
      segments.push({ type: "text", value: content.slice(cursor, t.start) });
    }
    segments.push({
      type: "mention",
      name: t.name,
      authorDocumentId: t.authorDocumentId,
    });
    cursor = t.end;
  }
  if (cursor < content.length) {
    segments.push({ type: "text", value: content.slice(cursor) });
  }
  return segments;
}

/**
 * 拼装一个 mention token。供 picker 选中后插入到编辑器里使用。
 * - name 截断到 40 字以匹配后端正则
 * - documentId 不做校验（调用方应保证来自后端搜索结果）
 */
export function buildMentionToken(name: string, authorDocumentId: string): string {
  const safeName = (name || "").slice(0, 40).replace(/[\[\]\n]/g, "");
  return `@[${safeName}](${authorDocumentId})`;
}
