/**
 * useEmoteInsert —— 在评论输入框光标处插入表情 token。
 *
 * 供 pages/post/[id].vue 与 PostOverlay.vue 共用，
 * 与 useMentionInput 的 insertAtTrigger 同构。
 *
 * 表情 token 就是真值态（:ik-smile:），不需要像 mention 那样做
 * 显示态/真值态分离——serializeForSend 对它透传即可。
 */

import { computed, nextTick, type Ref } from "vue";
import { buildEmoteToken } from "~/utils/emote";

export interface UseEmoteInsertOptions {
  /** v-model 绑定的正文 ref */
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

  /**
   * 统计当前正文里已有多少个表情 token。
   * 使用正则简单计数——无需精确去重，只防刷屏。
   */
  function countEmotes(): number {
    const re = /:ik-[a-z0-9-]{1,32}:/g;
    const matches = (text.value || "").match(re);
    return matches ? matches.length : 0;
  }

  /** 当前是否已达表情上限。computed 以便模板里用 .value 访问。 */
  const isAtLimit = computed(() => countEmotes() >= maxEmotes);

  /**
   * 在光标处插入一个表情 token。
   * 如果光标前一个字符不是空白，自动补一个空格再插入，保持可读性。
   *
   * 返回 true 表示成功插入，false 表示已达上限。
   */
  async function insertEmote(code: string): Promise<boolean> {
    if (countEmotes() >= maxEmotes) return false;

    const el = textareaRef.value;
    const start = el?.selectionStart ?? text.value.length;
    const end = el?.selectionEnd ?? start;

    // 光标前补空格（与 useMentionInput.insertAtTrigger 同逻辑）
    const prev = start > 0 ? text.value[start - 1] : "";
    const prefix = prev && !/\s/.test(prev) ? " " : "";

    const token = buildEmoteToken(code);
    const insertion = `${prefix}${token}`;

    const newText = text.value.slice(0, start) + insertion + text.value.slice(end);
    text.value = newText;

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

  return {
    insertEmote,
    countEmotes,
    isAtLimit,
  };
}
