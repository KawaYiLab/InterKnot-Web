/**
 * useMentionInput —— 评论编辑器里的 @ 触发逻辑。
 *
 * 设计要点：
 * 1. 编辑器仍是普通 textarea，但与 v-model 绑定的"显示态"使用紧凑形式 `@<显示名>`
 *    （而非真值 token `@[显示名](docId)`）。这样用户视觉上只看到一个干净的 `@张三`。
 * 2. composable 内部维护 `mentions: MentionRange[]`：每个元素记录 token 在显示串里
 *    的 `[start, end)`、显示名、authorDocumentId。这是真值表，发送评论时才把显示串里
 *    的 mention 区段替换成 `@[显示名](docId)` 后传给后端。
 * 3. 触发激活：光标前最近的 `@`（紧邻位置或前面只跟着可识别的搜索字符）→ 进入激活，
 *    把 `@` 之后到光标的内容当作搜索 q 调后端。
 * 4. 选中候选：把 `@<query>` 替换为 `@<显示名> `（注意末尾一个空格便于继续输入），
 *    并在 `mentions` 表里登记一段不可拆分区间。
 * 5. 不可拆分：当用户的删除/选择落在某个 mention range 内部（不含正好等于 range 的末尾）
 *    时，把整段一并删除——通过监听 `keydown.Backspace` / `keydown.Delete` 调整选区实现。
 * 6. 编辑器内的覆盖层（高亮芯片）由父组件持有 `mentions` + 文本同步绘制，本 composable 不绘制。
 *
 * 暴露 API 主要给两个评论编辑器入口（pages/discussion/[id].vue 与 DiscussionOverlay.vue）共用。
 */
import { computed, nextTick, ref, type Ref } from "vue";
import { buildMentionToken, parseMentions } from "~/utils/mention";

/**
 * @ 候选项的统一数据结构。后端 `/api/authors/search` 返回此形状，
 * MentionPicker 渲染、useMentionInput 选中插入也复用同一类型，避免重复定义。
 */
export interface MentionCandidate {
  documentId: string;
  name: string;
  username: string | null;
  level: number | null;
  avatar: string | null;
}

export interface MentionRange {
  /** 显示串里的起止下标（半开区间） */
  start: number;
  end: number;
  /** 写入时的显示名（不含前导 @） */
  name: string;
  authorDocumentId: string;
}

export interface MentionAnchor {
  top: number;
  left: number;
  lineHeight: number;
}

export interface UseMentionInputOptions {
  /** v-model 绑定的显示串 ref */
  text: Ref<string>;
  /** textarea 元素 ref */
  textareaRef: Ref<HTMLTextAreaElement | null>;
  /** 搜索回调；调用方注入 useApi().searchAuthors */
  search: (q: string) => Promise<MentionCandidate[]>;
  /** 防抖毫秒，默认 220ms */
  debounceMs?: number;
  /** 单评论 mention 上限，默认 10 */
  maxMentions?: number;
}

const DEFAULT_DEBOUNCE_MS = 220;
const DEFAULT_MAX_MENTIONS = 10;

/**
 * `@` 触发后允许出现在搜索 query 里的字符：
 * - 中英文 / 数字 / 下划线 / 短横线
 * - 不允许空格、换行、@ 之类，碰到这些立即退出激活
 */
const QUERY_RE = /^[\p{L}\p{N}_\-]*$/u;

export function useMentionInput(opts: UseMentionInputOptions) {
  const {
    text,
    textareaRef,
    search,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    maxMentions = DEFAULT_MAX_MENTIONS,
  } = opts;

  /** 当前已确认的 mention 真值表，下标基于 text.value（显示串） */
  const mentions = ref<MentionRange[]>([]);

  /** picker 状态 */
  const pickerVisible = ref(false);
  const pickerLoading = ref(false);
  const pickerResults = ref<MentionCandidate[]>([]);
  const pickerActiveIndex = ref(0);
  const pickerAnchor = ref<MentionAnchor | null>(null);

  /** 当前激活区域：触发该次搜索的 `@` 起始位置与当前 query 文本 */
  const activeAt = ref<number | null>(null);
  const activeQuery = ref("");

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchSeq = 0;

  // ────────────────────────────── 工具函数

  /**
   * 计算光标所在位置在视口中的坐标。
   * 用一个隐藏的 mirror div 模拟 textarea 的样式，把光标前的文本放进去，
   * 再用末尾一个 marker span 拿到坐标。这是常见的浏览器原生 textarea 测量法。
   */
  function measureCaretAnchor(): MentionAnchor | null {
    if (typeof window === "undefined") return null;
    const el = textareaRef.value;
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const lineHeight = parsePxOrFallback(cs.lineHeight, parsePxOrFallback(cs.fontSize, 18) * 1.4);

    const mirror = document.createElement("div");
    const styleProps: Array<keyof CSSStyleDeclaration> = [
      "boxSizing",
      "width",
      "height",
      "overflow",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "letterSpacing",
      "textTransform",
      "wordSpacing",
      "textIndent",
      "lineHeight",
      "whiteSpace",
      "wordWrap",
      "wordBreak",
      "overflowWrap",
      "tabSize",
      "direction",
    ];
    for (const prop of styleProps) {
      // CSSStyleDeclaration index access is loose; cast accordingly.
      (mirror.style as unknown as Record<string, string>)[prop as string] =
        (cs as unknown as Record<string, string>)[prop as string] ?? "";
    }
    // 关键：保持换行/空白处理一致
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.top = "0";
    mirror.style.left = "0";
    mirror.style.zIndex = "-1";
    mirror.style.pointerEvents = "none";
    // 滚动状态由我们自己加 transform 修正（mirror 里没有滚动）

    const value = text.value;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);

    // 保留行尾换行的可视高度
    mirror.textContent = before;
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    const tail = document.createTextNode(after);
    mirror.appendChild(tail);

    document.body.appendChild(mirror);
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    // 把 marker 在 mirror 内的相对坐标换算到 textarea 的视口坐标
    const top = rect.top + (markerRect.top - mirrorRect.top) - el.scrollTop;
    const left = rect.left + (markerRect.left - mirrorRect.left) - el.scrollLeft;

    document.body.removeChild(mirror);

    return { top, left, lineHeight };
  }

  function parsePxOrFallback(raw: string, fallback: number): number {
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /**
   * 检查光标位置之前最近的 `@`，若它能形成一个合法 query 则返回相关信息。
   * 不合法（已含空白 / 已超长 / 不在词首）则返回 null。
   *
   * 读取 textarea.value 而非 text.value：z-input 包装层的 update:modelValue
   * 不保证在原生 input 事件触发前完成，直接读 DOM 值最稳。
   */
  function detectActive(): { atIndex: number; query: string } | null {
    const el = textareaRef.value;
    if (!el) return null;
    const value = el.value;
    const caret = el.selectionStart ?? value.length;
    if (caret <= 0) return null;

    // 从光标向前找最近的 @；在搜到换行 / 空白 / 已存在 token 边界前不允许跳过
    let atIndex = -1;
    for (let i = caret - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === "@") {
        atIndex = i;
        break;
      }
      if (ch === " " || ch === "\n" || ch === "\t") return null;
      // 落在已有 mention range 内部 → 不再触发新激活
      if (mentions.value.some((m) => i >= m.start && i < m.end)) return null;
      // 限制 query 长度（保护：避免一直往前匹配）
      if (caret - i > 32) return null;
    }
    if (atIndex < 0) return null;

    // @ 必须在词首：前一个字符是空白 / 换行 / 串首 / 标点
    const prev = atIndex === 0 ? "" : value[atIndex - 1];
    if (prev && !/[\s\(\[\{,，。；;:：!！?？]/.test(prev)) return null;

    // @ 落在已有 mention range 中时跳过
    if (mentions.value.some((m) => atIndex >= m.start && atIndex < m.end)) return null;

    const query = value.slice(atIndex + 1, caret);
    if (!QUERY_RE.test(query)) return null;
    if (query.length > 32) return null;

    return { atIndex, query };
  }

  function resetPicker() {
    pickerVisible.value = false;
    pickerResults.value = [];
    pickerActiveIndex.value = 0;
    pickerAnchor.value = null;
    pickerLoading.value = false;
    activeAt.value = null;
    activeQuery.value = "";
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  async function performSearch(q: string) {
    const seq = ++searchSeq;
    pickerLoading.value = true;
    try {
      const results = await search(q);
      // 防止过期请求覆盖最新结果
      if (seq !== searchSeq) return;
      pickerResults.value = results;
      pickerActiveIndex.value = 0;
    } catch {
      if (seq !== searchSeq) return;
      pickerResults.value = [];
    } finally {
      if (seq === searchSeq) pickerLoading.value = false;
    }
  }

  function scheduleSearch(q: string) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void performSearch(q);
    }, debounceMs);
  }

  // ────────────────────────────── 事件钩子（由父组件接到 textarea 上）

  /** 文本变化（input / paste / model 更新）后调用 */
  function refresh() {
    // 文本任意改动后都重新校准 mention range：丢弃在串里找不到对应 `@<name>` 前缀的项
    syncMentionsFromText();

    const detected = detectActive();
    if (!detected) {
      resetPicker();
      return;
    }

    activeAt.value = detected.atIndex;
    activeQuery.value = detected.query;

    pickerVisible.value = true;
    pickerAnchor.value = measureCaretAnchor();

    // query 为空也允许显示 picker（提示用户继续输入）
    if (detected.query.length === 0) {
      pickerResults.value = [];
      pickerLoading.value = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      return;
    }
    scheduleSearch(detected.query);
  }

  /**
   * 当文本编辑导致 mention range 失去对应文本时（用户编辑了显示名或删了一部分），
   * 直接把这一段从 mentions 表里剔除，避免后续发送时出现 stale token。
   *
   * 优先读 textarea.value：和 detectActive 同源，避免依赖 v-model 时序。
   */
  function syncMentionsFromText() {
    const el = textareaRef.value;
    const value = el?.value ?? text.value;
    if (!mentions.value.length) return;
    mentions.value = mentions.value.filter((m) => {
      const expected = `@${m.name}`;
      const slice = value.slice(m.start, m.end);
      return slice === expected;
    });
  }

  /**
   * 处理 keydown：
   * - Picker 可见时：↑/↓/Enter/Escape 转交 picker
   * - Picker 不可见时：Backspace/Delete 落在 mention range 内 → 整段删
   */
  function onKeyDown(e: KeyboardEvent): void {
    if (pickerVisible.value) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (pickerResults.value.length) {
          pickerActiveIndex.value =
            (pickerActiveIndex.value + 1) % pickerResults.value.length;
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (pickerResults.value.length) {
          pickerActiveIndex.value =
            (pickerActiveIndex.value - 1 + pickerResults.value.length) %
            pickerResults.value.length;
        }
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const cand = pickerResults.value[pickerActiveIndex.value];
        if (cand) {
          e.preventDefault();
          // stopPropagation 阻止 textarea 的 keydown.enter.exact.prevent="sendComment"
          // （pages/discussion 与 DiscussionOverlay 都绑了这个）触发发送
          e.stopPropagation();
          selectCandidate(cand);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        resetPicker();
        return;
      }
      return;
    }

    // picker 不可见时的删除处理：检查光标是否要踩进 mention range 内部
    if (e.key === "Backspace" || e.key === "Delete") {
      const el = textareaRef.value;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? start;
      // 仅处理无选区的情况；有选区时浏览器自然会删除整个范围
      if (start !== end) return;

      const targetStart = e.key === "Backspace" ? start - 1 : start;
      const targetEnd = e.key === "Backspace" ? start : start + 1;
      const hit = mentions.value.find(
        (m) => targetStart < m.end && targetEnd > m.start,
      );
      if (!hit) return;

      e.preventDefault();
      const value = text.value;
      const next = value.slice(0, hit.start) + value.slice(hit.end);
      text.value = next;
      mentions.value = mentions.value
        .filter((m) => m !== hit)
        .map((m) =>
          m.start >= hit.end
            ? { ...m, start: m.start - (hit.end - hit.start), end: m.end - (hit.end - hit.start) }
            : m,
        );
      nextTick(() => {
        if (textareaRef.value) {
          textareaRef.value.selectionStart = hit.start;
          textareaRef.value.selectionEnd = hit.start;
        }
        refresh();
      });
    }
  }

  /** 父组件主动调用：把候选写回 textarea */
  function selectCandidate(cand: MentionCandidate) {
    if (mentions.value.length >= maxMentions) {
      // 静默拒绝，避免在 picker 打开时弹消息打断输入。
      // 上限由 UX 提示（picker 顶部提示更适合，但 MVP 不做）。
      resetPicker();
      return;
    }
    const at = activeAt.value;
    if (at == null) return;

    const el = textareaRef.value;
    if (!el) return;

    const caret = el.selectionStart ?? text.value.length;
    const insertion = `@${cand.name} `;
    const newText = text.value.slice(0, at) + insertion + text.value.slice(caret);

    // 新 mention range 在显示串里：[at, at + 1 + name.length)
    const newRange: MentionRange = {
      start: at,
      end: at + 1 + cand.name.length,
      name: cand.name,
      authorDocumentId: cand.documentId,
    };

    // 现有 range 在 caret 之后的需要平移
    const delta = insertion.length - (caret - at);
    mentions.value = [
      ...mentions.value.map((m) =>
        m.start >= caret ? { ...m, start: m.start + delta, end: m.end + delta } : m,
      ),
      newRange,
    ].sort((a, b) => a.start - b.start);

    text.value = newText;

    nextTick(() => {
      if (textareaRef.value) {
        const newCaret = at + insertion.length;
        textareaRef.value.selectionStart = newCaret;
        textareaRef.value.selectionEnd = newCaret;
        textareaRef.value.focus();
      }
      resetPicker();
    });
  }

  /**
   * 父组件主动调用：用户点 @ 按钮时插入一个 `@` 并让 picker 立即激活。
   */
  function insertAtTrigger() {
    const el = textareaRef.value;
    const start = el?.selectionStart ?? text.value.length;
    const end = el?.selectionEnd ?? start;

    // 如果光标前一个字符不是空白，自动补一个空格再放 @，让 detectActive 认得
    const prev = start > 0 ? text.value[start - 1] : "";
    const prefix = prev && !/\s/.test(prev) ? " " : "";

    const insertion = `${prefix}@`;
    const newText = text.value.slice(0, start) + insertion + text.value.slice(end);
    const delta = insertion.length - (end - start);
    mentions.value = mentions.value.map((m) =>
      m.start >= end ? { ...m, start: m.start + delta, end: m.end + delta } : m,
    );
    text.value = newText;
    nextTick(() => {
      if (textareaRef.value) {
        const newCaret = start + insertion.length;
        textareaRef.value.selectionStart = newCaret;
        textareaRef.value.selectionEnd = newCaret;
        textareaRef.value.focus();
      }
      refresh();
    });
  }

  /**
   * 把当前显示串与 mention range 一起序列化为后端可解析的真值串
   * （`@<name>` → `@[<name>](<docId>)`）。
   *
   * 调用时机：sendComment 之前。注意：调用方仍可在用户的纯文本里碰巧出现
   * `@[xxx](yyy)` 字面量——这种情况按用户原意保留，不处理。
   */
  function serializeForSend(): string {
    if (!mentions.value.length) return text.value;
    const sorted = [...mentions.value].sort((a, b) => a.start - b.start);
    let out = "";
    let cursor = 0;
    for (const m of sorted) {
      if (m.start < cursor) continue; // 异常重叠：跳过
      out += text.value.slice(cursor, m.start);
      out += buildMentionToken(m.name, m.authorDocumentId);
      cursor = m.end;
    }
    out += text.value.slice(cursor);
    return out;
  }

  /**
   * 反向：从后端真值串还原显示串 + mention 表。
   * 用于"乐观更新后立刻把刚发的评论填进列表"的场景，本 composable 暂时不主动用——
   * 调用方拿到后端返回值时若需要继续展示编辑器内容可调。
   */
  function hydrateFromContent(content: string) {
    const tokens = parseMentions(content);
    if (tokens.length === 0) {
      text.value = content;
      mentions.value = [];
      return;
    }
    let display = "";
    let cursor = 0;
    const ranges: MentionRange[] = [];
    for (const t of tokens) {
      display += content.slice(cursor, t.start);
      const start = display.length;
      display += `@${t.name}`;
      ranges.push({
        start,
        end: display.length,
        name: t.name,
        authorDocumentId: t.authorDocumentId,
      });
      cursor = t.end;
    }
    display += content.slice(cursor);
    text.value = display;
    mentions.value = ranges;
  }

  function reset() {
    mentions.value = [];
    resetPicker();
  }

  // 暴露给父组件用于绘制覆盖层的派生数据
  const overlaySegments = computed(() => splitDisplayWithMentions(text.value, mentions.value));

  return {
    // picker 状态（直接绑定到 <MentionPicker>）
    pickerVisible,
    pickerLoading,
    pickerResults,
    pickerActiveIndex,
    pickerAnchor,

    // 给 textarea 接的事件
    refresh,
    onKeyDown,
    selectCandidate,
    insertAtTrigger,

    // 发送 / 重置 / 还原
    serializeForSend,
    hydrateFromContent,
    reset,
    mentions,
    overlaySegments,

    // 用于 UI 上限提示（如禁用 @ 按钮）
    isAtLimit: computed(() => mentions.value.length >= maxMentions),
  };
}

/**
 * 根据 text 与 mention range 切出显示用片段，给覆盖层渲染芯片用。
 * 与 utils/mention.ts 的 splitContentWithMentions 同形态，但作用对象是
 * 显示串（不含 markdown token）+ 外部 range 表，所以单独写。
 */
export interface DisplaySegment {
  type: "text" | "mention";
  value: string;
  authorDocumentId?: string;
}

function splitDisplayWithMentions(
  text: string,
  ranges: MentionRange[],
): DisplaySegment[] {
  if (!ranges.length) return [{ type: "text", value: text }];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: DisplaySegment[] = [];
  let cursor = 0;
  for (const m of sorted) {
    if (m.start < cursor) continue;
    if (m.start > cursor) {
      out.push({ type: "text", value: text.slice(cursor, m.start) });
    }
    out.push({
      type: "mention",
      value: text.slice(m.start, m.end),
      authorDocumentId: m.authorDocumentId,
    });
    cursor = m.end;
  }
  if (cursor < text.length) {
    out.push({ type: "text", value: text.slice(cursor) });
  }
  return out;
}
