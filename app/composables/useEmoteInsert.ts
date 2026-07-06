/**
 * useEmoteInsert —— 评论输入框里的行内表情管理。
 *
 * 与 useMentionInput 同构：编辑器仍是普通 textarea，v-model 绑定的是"显示串"。
 * 表情在显示串中占位为两个 EM SPACE（`\u2003\u2003`），真实图片由
 * MentionHighlightOverlay 在占位区间上绘制；发送时 serializeWith 把占位区间
 * 替换回真值 token（`:ik-xxx:`）。
 *
 * 维护 `emotes: EmoteRange[]` 真值表（下标基于显示串）：
 * - 插入：光标处写入占位符并登记 range，平移其后的 range
 * - 编辑：refresh() 用 lastText → 当前文本的单段 diff 平移 range，
 *   占位符被破坏的 range 直接剔除（降级为普通空白，无害）
 * - 删除：onKeyDown 里 Backspace/Delete 命中 range 时整段删除（原子性）
 *
 * 供 pages/post/[id].vue 与 PostOverlay.vue 共用。
 */

import { computed, nextTick, ref, type Ref } from "vue";
import { buildEmoteToken } from "~/utils/emote";
import { buildMentionToken } from "~/utils/mention";
import type { MentionRange } from "~/composables/useMentionInput";

/** 表情在显示串中的占位符：两个 EM SPACE，宽约 2em，正好容纳一个方形表情图 */
export const EMOTE_PLACEHOLDER = "\u2003\u2003";

export interface EmoteRange {
  /** 显示串里的起止下标（半开区间），end - start === EMOTE_PLACEHOLDER.length */
  start: number;
  end: number;
  code: string;
}

export interface UseEmoteInsertOptions {
  /** v-model 绑定的正文（显示串）ref */
  text: Ref<string>;
  /** textarea 元素 ref */
  textareaRef: Ref<HTMLTextAreaElement | null>;
  /** 表情数量上限，默认 20（与后端一致） */
  maxEmotes?: number;
  /**
   * 插入完成后回调：(被替换选区起点, 被替换选区终点, 实际插入长度)。
   * 供调用方同步其它基于下标的状态（如 useMentionInput 的 mention range）——
   * 程序化改 text 不会触发 textarea 的 input 事件，range 不会自动重校。
   */
  onInsert?: (start: number, end: number, insertedLength: number) => void;
}

const DEFAULT_MAX_EMOTES = 20;

export function useEmoteInsert(opts: UseEmoteInsertOptions) {
  const { text, textareaRef, maxEmotes = DEFAULT_MAX_EMOTES, onInsert } = opts;

  /** 当前已插入的表情真值表，下标基于 text.value（显示串） */
  const emotes = ref<EmoteRange[]>([]);

  /** 上一次已知的显示串，用于 refresh() 时做单段 diff 平移 range */
  let lastText = text.value;

  const isAtLimit = computed(() => emotes.value.length >= maxEmotes);
  const hasEmotes = computed(() => emotes.value.length > 0);

  /**
   * 文本任意变化后调用（input / click / keyup）。
   * 把 lastText → 当前文本视为一次连续替换（打字 / 粘贴 / 删除都是），
   * 据此平移 range；被编辑破坏的 range 剔除。
   */
  function refresh() {
    const el = textareaRef.value;
    const value = el?.value ?? text.value;
    if (value !== lastText) {
      shiftRangesByDiff(lastText, value);
      lastText = value;
    }
    // 校验占位符仍完整；不完整的直接剔除
    emotes.value = emotes.value.filter(
      (r) => value.slice(r.start, r.end) === EMOTE_PLACEHOLDER,
    );
  }

  /** 单段 diff：公共前缀 + 公共后缀，中间视为整体替换 */
  function shiftRangesByDiff(oldText: string, newText: string) {
    let p = 0;
    const maxP = Math.min(oldText.length, newText.length);
    while (p < maxP && oldText[p] === newText[p]) p++;
    let s = 0;
    const maxS = maxP - p;
    while (
      s < maxS &&
      oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]
    ) {
      s++;
    }
    const oldEnd = oldText.length - s; // 旧串中被替换区间 [p, oldEnd)
    const delta = newText.length - oldText.length;
    emotes.value = emotes.value
      .filter((r) => r.end <= p || r.start >= oldEnd)
      .map((r) =>
        r.start >= oldEnd ? { ...r, start: r.start + delta, end: r.end + delta } : r,
      );
  }

  /**
   * Backspace / Delete 命中表情占位区间时整段删除（与 mention 的原子删除同构）。
   * 供父组件挂在 textarea 原生 keydown 上；与 mention.onKeyDown 互不冲突
   * （两者的 range 不重叠，最多只有一方命中）。
   */
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    if (e.defaultPrevented) return;
    const el = textareaRef.value;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    if (start !== end) return; // 有选区时交给浏览器 + refresh 处理

    const targetStart = e.key === "Backspace" ? start - 1 : start;
    const targetEnd = e.key === "Backspace" ? start : start + 1;
    const hit = emotes.value.find((r) => targetStart < r.end && targetEnd > r.start);
    if (!hit) return;

    e.preventDefault();
    const value = text.value;
    const next = value.slice(0, hit.start) + value.slice(hit.end);
    const removed = hit.end - hit.start;
    text.value = next;
    lastText = next;
    emotes.value = emotes.value
      .filter((r) => r !== hit)
      .map((r) =>
        r.start >= hit.end ? { ...r, start: r.start - removed, end: r.end - removed } : r,
      );
    onInsert?.(hit.start, hit.end, 0);
    nextTick(() => {
      if (textareaRef.value) {
        textareaRef.value.selectionStart = hit.start;
        textareaRef.value.selectionEnd = hit.start;
      }
    });
  }

  /**
   * 在光标处插入一个表情（写入占位符 + 登记 range）。
   * 返回 true 表示成功插入，false 表示已达上限。
   */
  async function insertEmote(code: string): Promise<boolean> {
    if (emotes.value.length >= maxEmotes) return false;

    const el = textareaRef.value;
    const start = el?.selectionStart ?? text.value.length;
    const end = el?.selectionEnd ?? start;

    const insertion = EMOTE_PLACEHOLDER;
    const newText = text.value.slice(0, start) + insertion + text.value.slice(end);
    const delta = insertion.length - (end - start);

    emotes.value = [
      ...emotes.value
        .filter((r) => r.end <= start || r.start >= end)
        .map((r) =>
          r.start >= end ? { ...r, start: r.start + delta, end: r.end + delta } : r,
        ),
      { start, end: start + insertion.length, code },
    ].sort((a, b) => a.start - b.start);

    text.value = newText;
    lastText = newText;

    onInsert?.(start, end, insertion.length);

    await nextTick();
    if (textareaRef.value) {
      const newCaret = start + insertion.length;
      textareaRef.value.selectionStart = newCaret;
      textareaRef.value.selectionEnd = newCaret;
      textareaRef.value.focus();
    }

    return true;
  }

  /**
   * 把显示串序列化为后端真值串：
   * mention range → `@[name](docId)`，emote range → `:ik-xxx:`。
   * 两类 range 均基于同一显示串下标且互不重叠，合并排序后一次遍历完成。
   */
  function serializeWith(mentions: MentionRange[]): string {
    type Piece = { start: number; end: number; token: string };
    const pieces: Piece[] = [
      ...mentions.map((m) => ({
        start: m.start,
        end: m.end,
        token: buildMentionToken(m.name, m.authorDocumentId),
      })),
      ...emotes.value.map((r) => ({
        start: r.start,
        end: r.end,
        token: buildEmoteToken(r.code),
      })),
    ].sort((a, b) => a.start - b.start);
    if (!pieces.length) return text.value;

    let out = "";
    let cursor = 0;
    for (const p of pieces) {
      if (p.start < cursor) continue; // 异常重叠：跳过
      out += text.value.slice(cursor, p.start);
      out += p.token;
      cursor = p.end;
    }
    out += text.value.slice(cursor);
    return out;
  }

  function reset() {
    emotes.value = [];
    lastText = text.value;
  }

  return {
    emotes,
    insertEmote,
    refresh,
    onKeyDown,
    serializeWith,
    reset,
    isAtLimit,
    hasEmotes,
  };
}
