<script setup lang="ts">
/**
 * 敲敲通话 右栏面板（在 KnockKnockModal 的 calls tab 渲染）
 *
 * 职责：
 *  - 切换 sessionId 时拉取消息 + 滚到底部
 *  - 渲染 user / assistant 气泡（assistant 流式 pending 时实时拼接）
 *  - 输入 + 发送（SSE 流），sending 期间禁用 composer
 *  - 错误态：assistant 气泡显示重试按钮
 *
 * 注意 active id 由父级（KnockKnockModal）维护并通过 prop 传入；
 * pseudo:char:X → 真 session 的迁移由 useKkCall.sendMessage 内部完成，
 * 但本组件需要在迁移完成后把外部的 activeId 同步到真 id（通过 emit）。
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import {
  ChatBubbleLeftIcon,
  PaperAirplaneIcon,
  LightBulbIcon,
  WrenchIcon,
  ChevronDownIcon,
} from "@heroicons/vue/24/solid";
import type { KkCallSessionSummary, KkCallMessage } from "~/types/entities";
import { formatTime } from "~/utils/time";
import { formatChatMarkdown } from "~/utils/format-chat";

const props = defineProps<{
  /** 真 session documentId 或 pseudo:char:X */
  sessionId: string | null;
  /** 父级提供 sessions 数组，用于查 active 角色信息 */
  sessions: KkCallSessionSummary[];
}>();

const emit = defineEmits<{
  /** pseudo → real 实质化后回传真 id 给父级，父级负责同步 URL / activeId */
  (e: "session-materialized", realId: string): void;
}>();

const {
  ensureMessages,
  messageStateOf,
  sendMessage,
  refresh,
} = useKkCall();

// 自己消息使用当前登录用户头像；auth.user 可能未 hydrate 完成,空时退回默认
const auth = useAuthStore();
const myAvatar = computed<string>(() => auth.user?.avatar || "/images/default-avatar.webp");

/** 当前会话摘要 */
const activeSession = computed<KkCallSessionSummary | null>(() => {
  const id = props.sessionId;
  if (!id) return null;
  return props.sessions.find((s) => s.documentId === id) ?? null;
});

/** 当前会话消息状态 */
const messageState = computed(() => {
  const id = props.sessionId;
  if (!id) return null;
  return messageStateOf(id);
});
const messages = computed(() => messageState.value?.items ?? []);
const messagesLoading = computed(
  () => !!messageState.value && messageState.value.loading && !messageState.value.hydrated,
);

/** 是否有 assistant 处于 pending（用于禁用 composer） */
const hasPendingAssistant = computed(() =>
  messages.value.some((m) => m.role === "assistant" && m.pending),
);

/** 消息是否有正在执行（尚无 result）的工具调用 */
function hasRunningToolCall(msg: KkCallMessage): boolean {
  return msg.pending && !!msg.toolCalls?.some((tc) => tc.result == null);
}

/* ───────── 思考面板展开状态 ─────────
 * 原生 <details> 既不支持过渡动画，又会被 :open 的反复 patch 覆盖用户的手动切换；
 * 这里改为自管状态：默认跟随 hasRunningToolCall（运行中自动展开），用户一旦手动切换
 * 就以 thinkingUserToggle 中的显式值为准，不再被流式重渲染覆盖。
 */
const thinkingUserToggle = ref<Record<string, boolean>>({});
/**
 * 默认展开规则："AI 正在思考"期间自动打开，思考一结束（不必等整条消息完成）就自动关上。
 *
 * "正在思考"的判定（满足任一即视为思考中）：
 *   1) 思考链流式中：pending && thinkingContent 在累积 && thinkingDone 未到 && 正文 content 还没开始
 *      —— 这里加 content==='' 是关键：很多 provider（含 AstrBot 的部分流式格式）不会在
 *      chain 切换时发 thinking_done complete 帧，但只要正文 token 一开始流，思考阶段就
 *      事实上结束了；以"content 是否出现"作为冗余信号，避免要等 pending=false 才关上。
 *   2) 有未完成的 tool call。
 * 用户一旦手动切换则锁定为显式值，不再被流式状态覆盖。
 */
function isThinkingOpen(msg: KkCallMessage): boolean {
  const explicit = thinkingUserToggle.value[msg.documentId];
  const active = isThinkingActive(msg);
  if (active) return explicit !== false;
  return explicit === true;
}
function isThinkingActive(msg: KkCallMessage): boolean {
  const thinkingStreaming =
    msg.pending
    && !!msg.thinkingContent
    && !msg.thinkingDone
    && msg.content.trim().length === 0;
  return thinkingStreaming || hasRunningToolCall(msg);
}
function toggleThinking(msg: KkCallMessage, e: MouseEvent) {
  const next = !isThinkingOpen(msg);
  thinkingUserToggle.value = {
    ...thinkingUserToggle.value,
    [msg.documentId]: next,
  };

  // 收起时浏览器会自动把 scrollTop clamp 到新的 scrollHeight，无需手动处理
  if (!next) return;

  const container = messagesRef.value;
  const button = e.currentTarget as HTMLElement | null;
  const thinkingEl = button?.closest<HTMLElement>(".ik-kkcall__thinking");
  if (!container || !thinkingEl) return;

  // 展开期间用 rAF 跟踪 grid-rows 0fr→1fr 过渡（CSS 过渡 280ms，多给一点缓冲到 340ms），
  // 每帧根据"用户是否贴底"做不同的滚动跟随。
  // - 贴底：scrollTop=scrollHeight，让面板看起来"自然把页面顶上去"
  // - 非贴底：仅在面板底部超出容器视口时按 overflow 量平移 scrollTop（相对滚动，
  //   每帧重新测量，避免浏览器位置反转引起的振荡）
  followThinkingPanel(thinkingEl, wasNearBottom.value);
}

let previousThinkingActiveIds = new Set<string>();
watch(
  () =>
    messages.value
      .map((msg) => `${msg.documentId}:${msg.role === "assistant" && isThinkingActive(msg) ? 1 : 0}`)
      .join("|"),
  () => {
    const nextActiveIds = new Set(
      messages.value
        .filter((msg) => msg.role === "assistant" && isThinkingActive(msg))
        .map((msg) => msg.documentId),
    );
    const endedIds = [...previousThinkingActiveIds].filter((id) => !nextActiveIds.has(id));
    if (endedIds.length) {
      const nextToggle = { ...thinkingUserToggle.value };
      let changed = false;
      for (const id of endedIds) {
        if (id in nextToggle) {
          delete nextToggle[id];
          changed = true;
        }
      }
      if (changed) thinkingUserToggle.value = nextToggle;
    }
    previousThinkingActiveIds = nextActiveIds;
  },
  { immediate: true },
);

/* ───────── 时间分隔（间隔 > 5 分钟） ───────── */
const TIME_GAP_MS = 5 * 60 * 1000;
/**
 * 已知消息 ID 快照。切会话 / hydrate 完成后把当前消息全部记为"已知"，
 * 此后增量到达的消息（user 输入 + assistant 占位 + SSE 推送的新消息）
 * 会被识别为 isNew=true，播一次入场动画。与 KnockKnockModal 私聊机制
 * 完全对齐，避免两个聊天模块的入场体验不一致。
 */
const knownMessageIds = ref(new Set<string>());

interface EnrichedMessage {
  msg: (typeof messages.value)[number];
  showTime: boolean;
  isMine: boolean;
  isNew: boolean;
}
const enriched = computed<EnrichedMessage[]>(() => {
  const list = messages.value;
  const known = knownMessageIds.value;
  return list.map((msg, idx) => {
    let showTime = idx === 0;
    if (!showTime && idx > 0) {
      const prev = list[idx - 1];
      if (prev) {
        const dCurr = new Date(msg.createdAt).getTime();
        const dPrev = new Date(prev.createdAt).getTime();
        if (!Number.isNaN(dCurr) && !Number.isNaN(dPrev)) {
          showTime = dCurr - dPrev > TIME_GAP_MS;
        }
      }
    }
    return {
      msg,
      showTime,
      isMine: msg.role === "user",
      // 不在快照里就是增量到达，触发 .is-new 入场动画
      isNew: !known.has(msg.documentId),
    };
  });
});

/* ───────── 滚动控制 ───────── */
const messagesRef = ref<HTMLElement | null>(null);
const messagesSettling = ref(false);
const NEAR_BOTTOM_THRESHOLD_PX = 80;
const wasNearBottom = ref(true);
const THINKING_ANIMATION_MS = 340;
const PROMPT_TOP_OFFSET_PX = 12;
const PROMPT_SPACER_SYNC_THRESHOLD_PX = 1;
let thinkingFollowRaf = 0;
let thinkingFollowUntil = 0;
let thinkingFollowWasBottom = false;
let thinkingFollowTarget: HTMLElement | null = null;
let promptAnchorRaf = 0;
let promptSpacerRaf = 0;

interface PendingPromptAnchor {
  id: number;
  content: string;
  knownIds: Set<string>;
  allowedSessionIds: Set<string>;
}

interface ActivePromptAnchor {
  id: number;
  messageId: string;
  allowedSessionIds: Set<string>;
}

const pendingPromptAnchor = ref<PendingPromptAnchor | null>(null);
const activePromptAnchor = ref<ActivePromptAnchor | null>(null);
const promptSpacerHeight = ref(0);
const messagesPaddingBottom = computed(() => `${10 + promptSpacerHeight.value}px`);
let promptAnchorSeq = 0;

const isNearBottom = (el: HTMLElement): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;

const setMessagesScrollBottom = (el: HTMLElement) => {
  el.scrollTop = el.scrollHeight;
  wasNearBottom.value = true;
};

const scrollToBottom = (el: HTMLElement) => {
  const doScroll = () => {
    setMessagesScrollBottom(el);
  };
  doScroll();
  requestAnimationFrame(doScroll);
  setTimeout(doScroll, 200);
};

const findPromptMessageElement = (container: HTMLElement, messageId: string): HTMLElement | null => {
  const nodes = container.querySelectorAll<HTMLElement>("[data-kk-call-message-id]");
  for (const node of nodes) {
    if (node.dataset.kkCallMessageId === messageId) return node;
  }
  return null;
};

const clearPromptAnchorState = () => {
  pendingPromptAnchor.value = null;
  activePromptAnchor.value = null;
  promptSpacerHeight.value = 0;
};

const calculatePromptSpacerHeight = (container: HTMLElement, target: HTMLElement): number => {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetTopInContent = container.scrollTop + targetRect.top - containerRect.top;
  const contentAfterTargetTop =
    container.scrollHeight - promptSpacerHeight.value - targetTopInContent;
  return Math.ceil(
    Math.max(0, container.clientHeight - PROMPT_TOP_OFFSET_PX - contentAfterTargetTop),
  );
};

const syncPromptSpacerForTarget = (container: HTMLElement, target: HTMLElement): boolean => {
  const nextHeight = calculatePromptSpacerHeight(container, target);
  if (Math.abs(promptSpacerHeight.value - nextHeight) <= PROMPT_SPACER_SYNC_THRESHOLD_PX) {
    return false;
  }
  promptSpacerHeight.value = nextHeight;
  return true;
};

const scheduleMessageScrollRetry = (messageId: string) => {
  if (!import.meta.client || promptAnchorRaf) return;
  promptAnchorRaf = requestAnimationFrame(() => {
    promptAnchorRaf = 0;
    scrollMessageToTop(messageId);
  });
};

const scrollMessageToTop = (messageId: string): boolean => {
  if (!import.meta.client) return false;
  const container = messagesRef.value;
  if (!container) return false;
  const target = findPromptMessageElement(container, messageId);
  if (!target) return false;
  if (syncPromptSpacerForTarget(container, target)) {
    scheduleMessageScrollRetry(messageId);
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextTop = Math.min(
    Math.max(0, container.scrollTop + targetRect.top - containerRect.top - PROMPT_TOP_OFFSET_PX),
    maxTop,
  );
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  container.scrollTo({
    top: nextTop,
    behavior: reduceMotion ? "auto" : "smooth",
  });
  const pending = pendingPromptAnchor.value;
  const currentActive = activePromptAnchor.value;
  activePromptAnchor.value = {
    id: pending?.id ?? currentActive?.id ?? promptAnchorSeq,
    messageId,
    allowedSessionIds: new Set(
      pending?.allowedSessionIds
      ?? currentActive?.allowedSessionIds
      ?? (props.sessionId ? [props.sessionId] : []),
    ),
  };
  pendingPromptAnchor.value = null;
  wasNearBottom.value = false;
  return true;
};

const resolvePendingPromptMessage = (): KkCallMessage | null => {
  const pending = pendingPromptAnchor.value;
  const sid = props.sessionId;
  if (!pending || !sid || !pending.allowedSessionIds.has(sid)) return null;
  return messages.value.find(
    (msg) =>
      msg.role === "user"
      && msg.content === pending.content
      && !pending.knownIds.has(msg.documentId),
  ) ?? null;
};

const schedulePromptAnchorScroll = () => {
  if (!import.meta.client || promptAnchorRaf) return;
  promptAnchorRaf = requestAnimationFrame(() => {
    promptAnchorRaf = 0;
    const target = resolvePendingPromptMessage();
    if (!target) return;
    if (scrollMessageToTop(target.documentId)) {
      pendingPromptAnchor.value = null;
    }
  });
};

const syncActivePromptSpacer = (): boolean => {
  const active = activePromptAnchor.value;
  const container = messagesRef.value;
  if (!active || !container) return false;
  const target = findPromptMessageElement(container, active.messageId);
  if (!target) return false;
  return syncPromptSpacerForTarget(container, target);
};

const scheduleActivePromptSpacerSync = () => {
  if (!import.meta.client || promptSpacerRaf || !activePromptAnchor.value) return;
  promptSpacerRaf = requestAnimationFrame(() => {
    promptSpacerRaf = 0;
    syncActivePromptSpacer();
  });
};

const addSessionIdToPromptAnchors = (id: number, realId: string) => {
  const pending = pendingPromptAnchor.value;
  if (pending?.id === id && !pending.allowedSessionIds.has(realId)) {
    pendingPromptAnchor.value = {
      ...pending,
      allowedSessionIds: new Set([...pending.allowedSessionIds, realId]),
    };
  }
  const active = activePromptAnchor.value;
  if (active?.id === id && !active.allowedSessionIds.has(realId)) {
    activePromptAnchor.value = {
      ...active,
      allowedSessionIds: new Set([...active.allowedSessionIds, realId]),
    };
  }
};

const followThinkingPanel = (thinkingEl: HTMLElement, wasBottom: boolean) => {
  if (!import.meta.client) return;
  thinkingFollowTarget = thinkingEl;
  thinkingFollowWasBottom = thinkingFollowWasBottom || wasBottom;
  thinkingFollowUntil = Math.max(thinkingFollowUntil, performance.now() + THINKING_ANIMATION_MS);
  if (thinkingFollowRaf) return;

  const tick = () => {
    const c = messagesRef.value;
    if (!c) {
      thinkingFollowRaf = 0;
      thinkingFollowTarget = null;
      thinkingFollowWasBottom = false;
      return;
    }

    if (thinkingFollowWasBottom) {
      setMessagesScrollBottom(c);
    } else if (thinkingFollowTarget) {
      const cRect = c.getBoundingClientRect();
      const tRect = thinkingFollowTarget.getBoundingClientRect();
      const overflow = tRect.bottom - cRect.bottom;
      if (overflow > 0) {
        c.scrollTop += overflow + 8;
      }
    }

    if (performance.now() < thinkingFollowUntil) {
      thinkingFollowRaf = requestAnimationFrame(tick);
      return;
    }

    thinkingFollowRaf = 0;
    thinkingFollowTarget = null;
    thinkingFollowWasBottom = false;
  };

  thinkingFollowRaf = requestAnimationFrame(tick);
};

const onMessagesScroll = () => {
  const el = messagesRef.value;
  if (!el) return;
  wasNearBottom.value = isNearBottom(el);
};

/* ───────── 切换会话 ───────── */
watch(
  () => props.sessionId,
  async (id) => {
    if (!id) {
      clearPromptAnchorState();
      return;
    }
    const pending = pendingPromptAnchor.value;
    const active = activePromptAnchor.value;
    const keepPromptAnchor =
      (!!pending && pending.allowedSessionIds.has(id))
      || (!!active && active.allowedSessionIds.has(id));
    if (!keepPromptAnchor) {
      clearPromptAnchorState();
    }
    wasNearBottom.value = !keepPromptAnchor;
    messagesSettling.value = true;
    try {
      await ensureMessages(id);
    } catch (err) {
      // 失败兜底：保持沉降态退出
      console.warn("[kk-call] load messages failed", err);
    }
    if (props.sessionId !== id) {
      messagesSettling.value = false;
      return;
    }
    if (!keepPromptAnchor) {
      // 切会话首屏的所有消息记为"已知"，避免一次性整屏闪动；
      // 之后发出的 user / assistant 消息都会被识别为新到达并播入场动画
      knownMessageIds.value = new Set(messages.value.map((m) => m.documentId));
    }
    nextTick(() => {
      const el = messagesRef.value;
      if (!el) {
        messagesSettling.value = false;
        return;
      }
      if (keepPromptAnchor) {
        const currentActive = activePromptAnchor.value;
        if (currentActive?.allowedSessionIds.has(id)) {
          scrollMessageToTop(currentActive.messageId);
        } else {
          schedulePromptAnchorScroll();
        }
      } else {
        scrollToBottom(el);
      }
      requestAnimationFrame(() => {
        messagesSettling.value = false;
      });
    });
  },
  { immediate: true },
);

/** 消息数变化时，靠底就跟随 */
watch(
  () => messages.value.length,
  (next, prev) => {
    if (next <= (prev ?? 0)) return;
    if (activePromptAnchor.value) {
      scheduleActivePromptSpacerSync();
    }
    if (!wasNearBottom.value) return;
    nextTick(() => {
      const el = messagesRef.value;
      if (el) scrollToBottom(el);
    });
  },
);

watch(
  () => messages.value.map((msg) => `${msg.documentId}:${msg.role}`).join("|"),
  () => {
    if (!pendingPromptAnchor.value) return;
    schedulePromptAnchorScroll();
  },
  { flush: "post" },
);

/**
 * 流式 delta 期间，最后一条 assistant 任意"会改变高度"的字段都要触发贴底跟随：
 *   - content：正文 token
 *   - thinkingContent：思考链 token（之前漏掉，导致思考面板被挤出视口）
 *   - toolCalls.length：新增的工具调用卡片
 *   - 每个 toolCall.result.length：工具返回结果填充
 * 任一长度变化都会让 sig 变化，watch 触发，sync 写 scrollTop。
 */
watch(
  () => {
    const list = messages.value;
    const last = list[list.length - 1];
    if (!last || last.role !== "assistant") return "";
    const tcLens = last.toolCalls?.map((tc) => tc.result?.length ?? 0) ?? [];
    return [
      last.content.length,
      last.thinkingContent?.length ?? 0,
      last.toolCalls?.length ?? 0,
      ...tcLens,
    ].join("/");
  },
  () => {
    if (activePromptAnchor.value) {
      scheduleActivePromptSpacerSync();
    }
    if (!wasNearBottom.value) return;
    const el = messagesRef.value;
    if (el) {
      // 流式过程中只 sync set，不再 rAF/setTimeout 兜底以减少重排开销
      setMessagesScrollBottom(el);
    }
  },
  { flush: "post" },
);

watch(
  () =>
    messages.value
      .map((msg) => {
        if (msg.role !== "assistant") return `${msg.documentId}:0`;
        if (!msg.thinkingContent && !msg.toolCalls?.length) return `${msg.documentId}:0`;
        return `${msg.documentId}:${isThinkingOpen(msg) ? 1 : 0}`;
      })
      .join("|"),
  () => {
    nextTick(() => {
      const container = messagesRef.value;
      if (activePromptAnchor.value) {
        scheduleActivePromptSpacerSync();
      }
      if (!container || !wasNearBottom.value) return;
      const openPanels = container.querySelectorAll<HTMLElement>(".ik-kkcall__thinking.is-open");
      const latestOpenPanel = openPanels[openPanels.length - 1];
      if (latestOpenPanel) {
        followThinkingPanel(latestOpenPanel, true);
      } else {
        setMessagesScrollBottom(container);
      }
    });
  },
  { flush: "post" },
);

/**
 * 思考链流式期间，思考面板自身有 max-height + overflow-y:auto，
 * 当 thinkingContent 超过容器高度后会出现内部滚动条。
 * 这里把"最近一个" .ik-kkcall__thinking-body 也贴底跟随，
 * 让用户始终看到最新 token；如果用户主动往上翻读旧内容（已远离底部），
 * 就尊重 ta 的位置，不强行拽回。
 */
const THINKING_INNER_NEAR_BOTTOM_PX = 30;
watch(
  () => {
    const list = messages.value;
    const last = list[list.length - 1];
    if (!last || last.role !== "assistant") return 0;
    return last.thinkingContent?.length ?? 0;
  },
  (next, prev) => {
    if (next <= (prev ?? 0)) return;
    const container = messagesRef.value;
    if (!container) return;
    // 流式中只可能存在一个"未结束"的思考面板（最后一条 assistant）；
    // 直接取最后一个 DOM 节点即可，省去额外的 ref map。
    const bodies = container.querySelectorAll<HTMLElement>(".ik-kkcall__thinking-body");
    const lastBody = bodies[bodies.length - 1];
    if (!lastBody) return;
    const innerNearBottom =
      lastBody.scrollHeight - lastBody.scrollTop - lastBody.clientHeight
      <= THINKING_INNER_NEAR_BOTTOM_PX;
    if (innerNearBottom) {
      lastBody.scrollTop = lastBody.scrollHeight;
    }
  },
  // flush:'post' 确保在 DOM 完成新 token 渲染后再读 scrollHeight，
  // 否则默认 pre 时机读到的是旧高度，scrollTop 会少一帧的差额。
  { flush: "post" },
);

/* ───────── 发送 ───────── */
const draft = ref("");
const sending = ref(false);
const sendError = ref<string | null>(null);
const composerRef = ref<HTMLTextAreaElement | null>(null);

let currentSendAbort: (() => void) | null = null;

const composerDisabled = computed(() => !props.sessionId || sending.value);

const placeholder = computed(() => {
  if (!props.sessionId) return "选择左侧角色开始通话";
  if (sending.value) return "等待回复中…";
  if (activeSession.value?.isPseudo) return `开启与 ${activeSession.value.character.name} 的对话`;
  return `继续与 ${activeSession.value?.character.name ?? ""} 对话…`;
});

const onComposerKeyDown = (e: KeyboardEvent) => {
  if (e.key !== "Enter") return;
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  doSend();
};

const doSend = async () => {
  if (composerDisabled.value) return;
  const text = draft.value.trim();
  if (!text) return;
  const sid = props.sessionId;
  if (!sid) return;

  sendError.value = null;
  sending.value = true;
  draft.value = "";
  // 让用户输入后立即看到自己的消息进入"置顶锚定"态
  wasNearBottom.value = false;
  activePromptAnchor.value = null;
  promptSpacerHeight.value = 0;
  const promptAnchorId = ++promptAnchorSeq;
  pendingPromptAnchor.value = {
    id: promptAnchorId,
    content: text,
    knownIds: new Set(messages.value.map((m) => m.documentId)),
    allowedSessionIds: new Set([sid]),
  };

  const handle = sendMessage(sid, text);
  currentSendAbort = handle.abort;

  // pseudo → real：第一时间通知父级切换 activeId
  handle.realId
    .then((realId) => {
      addSessionIdToPromptAnchors(promptAnchorId, realId);
      if (sid !== realId) emit("session-materialized", realId);
    })
    .catch(() => {
      /* 错误已经在 done 链路里被处理，这里静默 */
    });

  try {
    await handle.done;
  } catch (err: any) {
    sendError.value = err?.message || "发送失败";
  } finally {
    sending.value = false;
    currentSendAbort = null;
    nextTick(() => {
      composerRef.value?.focus();
    });
  }
};

/** 重试单条 assistant：把上一条 user 的内容重发一次 */
const retryLastUser = () => {
  if (sending.value) return;
  const list = messages.value;
  // 从后往前找最近一条 user
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.role === "user") {
      draft.value = list[i]!.content;
      doSend();
      return;
    }
  }
};

onBeforeUnmount(() => {
  // 不中断 SSE：useState 全局状态在组件卸载后仍有效，让流在后台跑完，
  // 用户重新打开弹窗时直接看到最新结果。避免 abort 导致的 "生成失败" 误报。
  if (thinkingFollowRaf) cancelAnimationFrame(thinkingFollowRaf);
  if (promptAnchorRaf) cancelAnimationFrame(promptAnchorRaf);
  if (promptSpacerRaf) cancelAnimationFrame(promptSpacerRaf);
  clearPromptAnchorState();
  currentSendAbort = null;
});

// 首次挂载拉一次列表（避免父级未先 refresh 时 sessions 为空）
if (import.meta.client && props.sessions.length === 0) {
  void refresh();
}
</script>

<template>
  <section class="ik-knock__main ik-kkcall__main">
    <header class="ik-knock__main-header">
      <ChatBubbleLeftIcon class="ik-knock__main-icon" aria-hidden="true" />
      <div class="ik-knock__main-title-wrap">
        <span class="ik-knock__main-title">
          {{ activeSession?.character.name || "NoData" }}
        </span>
        <span
          v-if="activeSession?.character.tagline"
          class="ik-kkcall__main-subtitle"
        >
          {{ activeSession.character.tagline }}
        </span>
      </div>
    </header>

    <div class="ik-knock__main-body">
      <div
        v-if="activeSession && messages.length"
        ref="messagesRef"
        class="ik-knock__messages"
        :class="{ 'is-settling': messagesSettling }"
        :style="{ paddingBottom: messagesPaddingBottom }"
        @scroll.passive="onMessagesScroll"
      >
        <template v-for="entry in enriched" :key="entry.msg.documentId">
          <div
            v-if="entry.showTime"
            class="ik-knock__time-divider"
            :class="{ 'is-new': entry.isNew }"
          >
            {{ formatTime(entry.msg.createdAt) }}
          </div>
          <div
            class="ik-knock__msg"
            :class="{ 'is-new': entry.isNew, 'is-mine': entry.isMine }"
            :data-kk-call-message-id="entry.msg.documentId"
          >
            <div class="ik-knock__msg-avatar" aria-hidden="true">
              <!-- 自己消息用当前登录用户头像；对方消息用角色头像 -->
              <img
                v-if="entry.isMine"
                :src="myAvatar"
                alt=""
                class="ik-knock__msg-avatar-img"
                draggable="false"
              />
              <img
                v-else-if="activeSession.character.avatar"
                :src="activeSession.character.avatar"
                :alt="activeSession.character.name"
                class="ik-knock__msg-avatar-img"
                draggable="false"
              />
              <img
                v-else
                src="/images/default-avatar.webp"
                alt=""
                class="ik-knock__msg-avatar-img"
                draggable="false"
              />
            </div>
            <div class="ik-knock__msg-body">
              <div
                class="ik-knock__msg-bubble"
                :class="{
                  'is-pending': entry.msg.pending,
                  'is-error': !!entry.msg.errorReason,
                }"
              >
                <template v-if="entry.msg.errorReason && !entry.msg.content">
                  <span class="ik-kkcall__msg-error">
                    生成失败（{{ entry.msg.errorReason }}）
                  </span>
                  <button
                    type="button"
                    class="ik-kkcall__msg-retry"
                    :disabled="sending"
                    @click="retryLastUser"
                  >
                    重试
                  </button>
                </template>
                <template v-else>
                  <!-- 等待 token 中（content 仍为空）：复用私聊 typing-dot 的跳动动画，
                       避免静态"…"或闪烁光标在白底气泡上观感生硬 -->
                  <span
                    v-if="entry.msg.pending && !entry.msg.content && !entry.msg.thinkingContent && !entry.msg.toolCalls?.length"
                    class="ik-kkcall__msg-dots"
                    aria-label="正在输入"
                  >
                    <span class="ik-kkcall__msg-dot" />
                    <span class="ik-kkcall__msg-dot" />
                    <span class="ik-kkcall__msg-dot" />
                  </span>
                  <template v-else>
                    <!-- assistant：把 markdown 渲染成结构化 HTML，对齐 ChatUI 观感。
                         流式期间每个 token 到达都重渲染一次，markdown-it parse 单次 <5ms 不会成为瓶颈。
                         user：保持纯文本，避免用户输入被意外解析（也防止用户输入端的 markdown 注入）。 -->
                    <div
                      v-if="entry.msg.role === 'assistant'"
                      class="ik-kkcall__msg-md"
                      v-html="formatChatMarkdown(entry.msg.content)"
                    />
                    <span
                      v-else
                      class="ik-kkcall__msg-content"
                    >{{ entry.msg.content }}</span>
                    <!-- 流式有内容后保留尾部闪烁光标，提示仍在生成 -->
                    <span
                      v-if="entry.msg.pending"
                      class="ik-kkcall__msg-cursor"
                      aria-hidden="true"
                    >▋</span>
                    <!-- PR4: 引用角标 -->
                    <div
                      v-if="entry.msg.role === 'assistant' && entry.msg.refs?.length"
                      class="ik-kkcall__refs"
                    >
                      <span
                        v-for="(rid, rIdx) in entry.msg.refs"
                        :key="rIdx"
                        class="ik-kkcall__ref-badge"
                        :title="rid"
                      >{{ rIdx + 1 }}</span>
                    </div>
                  </template>
                </template>
              </div>
              <!-- PR4: 思考过程 pill（气泡外部，与私聊 .ik-knock__msg-quote 同层级） -->
              <div
                v-if="entry.msg.role === 'assistant' && (entry.msg.thinkingContent || entry.msg.toolCalls?.length)"
                class="ik-kkcall__thinking"
                :class="{ 'is-open': isThinkingOpen(entry.msg) }"
              >
                <button
                  type="button"
                  class="ik-kkcall__thinking-summary"
                  :aria-expanded="isThinkingOpen(entry.msg)"
                  @click="toggleThinking(entry.msg, $event)"
                >
                  <LightBulbIcon class="ik-kkcall__thinking-icon" aria-hidden="true" />
                  <span class="ik-kkcall__thinking-label">{{ isThinkingActive(entry.msg) ? '思考中…' : '思考过程' }}</span>
                  <span
                    v-if="isThinkingActive(entry.msg)"
                    class="ik-kkcall__thinking-spinner"
                  />
                  <ChevronDownIcon class="ik-kkcall__thinking-chevron" aria-hidden="true" />
                </button>
                <!-- grid-template-rows 0fr → 1fr 实现任意高度的平滑过渡。
                     外 wrap 负责裁剪（overflow:hidden + min-height:0），
                     内 body 才有 padding/max-height/scroll，避免裁剪与滚动条互相干扰。 -->
                <div class="ik-kkcall__thinking-body-wrap">
                  <div class="ik-kkcall__thinking-body-clip">
                    <div class="ik-kkcall__thinking-body">
                      <div v-if="entry.msg.thinkingContent" class="ik-kkcall__thinking-text">
                        {{ entry.msg.thinkingContent }}
                      </div>
                      <div
                        v-for="(tc, tcIdx) in entry.msg.toolCalls"
                        :key="tcIdx"
                        class="ik-kkcall__tool-card"
                      >
                        <div class="ik-kkcall__tool-header">
                          <WrenchIcon class="ik-kkcall__tool-icon" aria-hidden="true" />
                          <span class="ik-kkcall__tool-name">{{ tc.name }}</span>
                          <span
                            v-if="tc.result != null"
                            class="ik-kkcall__tool-badge is-done"
                          >完成</span>
                          <span
                            v-else
                            class="ik-kkcall__tool-badge is-running"
                          >执行中…</span>
                        </div>
                        <div v-if="tc.result != null" class="ik-kkcall__tool-result">
                          <span class="ik-kkcall__tool-result-label">返回：</span>
                          <code>{{ tc.result.length > 200 ? tc.result.slice(0, 200) + '…' : tc.result }}</code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
      <div v-else-if="!messagesLoading" class="ik-knock__empty-pill">
        EMPTY
      </div>

      <div v-if="activeSession" class="ik-knock__composer">
        <div
          v-if="sendError"
          class="ik-knock__composer-error"
          role="alert"
        >
          {{ sendError }}
        </div>
        <div class="ik-knock__composer-row" :class="{ 'is-disabled': composerDisabled }">
          <textarea
            ref="composerRef"
            v-model="draft"
            class="ik-knock__composer-input"
            :placeholder="placeholder"
            rows="1"
            maxlength="4000"
            :disabled="composerDisabled"
            @keydown="onComposerKeyDown"
          />
          <button
            type="button"
            class="ik-knock__composer-send"
            :disabled="composerDisabled || !draft.trim()"
            aria-label="发送"
            @click="doSend"
          >
            <PaperAirplaneIcon
              class="ik-knock__composer-send-icon"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * 项目惯例：每个组件 scoped 内重复定义公共 .ik-knock__* 类，
 * 这里把 KnockKnockModal 私聊主栏所需的样式段全部复制进来，
 * 保证视觉与原 DM 主栏完全一致；KKCall 专属样式以 .ik-kkcall__* 前缀附加。
 */

/* ── 主栏共享面板装饰（背景渐变 + 圆角 + 阴影） ── */
.ik-knock__main {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.85) 0%,
    rgba(0, 0, 0, 0) 100%
  );
  border-radius: 12px;
  box-shadow: 0 5px 8px rgba(0, 0, 0, 0.85);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.ik-knock__main-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 58px;
  padding: 0 18px;
  border-bottom: 3px solid #202020;
}

.ik-knock__main-icon {
  width: 22px;
  height: 22px;
  color: #454545;
  flex-shrink: 0;
}

.ik-knock__main-title-wrap {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-width: 0;
}

.ik-knock__main-title {
  font-size: 17px;
  font-weight: 900;
  color: #fff;
}

.ik-knock__main-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 18px;
  overflow: hidden;
}

.ik-knock__empty-pill {
  margin: auto;
  padding: 16px 88px;
  min-width: 360px;
  text-align: center;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.32);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 6px;
  user-select: none;
}

/* ── 消息流 ── */
.ik-knock__messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 6px;
  /* 底部留呼吸空间，避免最后一条 AI 气泡贴着 composer 输入框 */
  padding-bottom: 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  /* 滚到底后阻断滚动事件向父级冒泡，避免外层弹窗/页面跟随回弹抖动 */
  overscroll-behavior: contain;
  /*
   * 禁用浏览器原生 scroll anchoring：当容器内有动画 / 流式 token 不断追加 /
   * 入场动画 transform 等内容变化时，浏览器会自动调整 scrollTop 维持某个
   * "锚定元素"的可见位置，结果就是用户拉到底瞬间页面悄悄往上挪一点点，
   * "永远到不了最底"。我们已经在流式 delta watch 里手动 scrollTop=scrollHeight，
   * 不需要浏览器再插一手。
   */
  overflow-anchor: none;
}

.ik-knock__messages.is-settling {
  visibility: hidden;
}

.ik-knock__messages::-webkit-scrollbar {
  width: 4px;
}
.ik-knock__messages::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}

/* ── 单条消息 ── */
.ik-knock__msg {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.ik-knock__msg-avatar {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  color: #4a4a4a;
  overflow: hidden;
}

.ik-knock__msg-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-knock__msg-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: min(560px, 92%);
}

.ik-knock__time-divider {
  align-self: center;
  margin: 6px 0 2px;
  padding: 2px 10px;
  color: rgba(255, 255, 255, 0.32);
  font-size: 12px;
  letter-spacing: 0.5px;
  user-select: none;
}

/* ── 气泡（白底 + 左上昵尖角） ── */
.ik-knock__msg-bubble {
  position: relative;
  align-self: flex-start;
  max-width: 100%;
  padding: 6px 14px;
  background: #ffffff;
  border-radius: 16px;
  color: #4d4d4d;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
  white-space: pre-wrap;
}

.ik-knock__msg-bubble::before {
  content: "";
  position: absolute;
  top: 0.125em;
  left: -0.4375em;
  width: 0.75em;
  height: 0.75em;
  background-image: url("/images/chat_message_arrow_left.webp");
  background-size: contain;
  background-repeat: no-repeat;
  pointer-events: none;
}

/* ── 自己消息：右对齐 + 蓝底白字 + 右尖角 ── */
.ik-knock__msg.is-mine {
  flex-direction: row-reverse;
}

.ik-knock__msg.is-mine .ik-knock__msg-body {
  align-items: flex-end;
}

.ik-knock__msg.is-mine .ik-knock__msg-bubble {
  align-self: flex-end;
  background: #2c58e2;
  color: #fff;
}

.ik-knock__msg.is-mine .ik-knock__msg-bubble::before {
  left: auto;
  right: -0.34375em;
  background-image: url("/images/chat_message_arrow_right.webp");
  transform: none;
}

/* ── Composer ── */
.ik-knock__composer {
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 10px;
  border-top: 2px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-knock__composer-error {
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 80, 80, 0.15);
  color: #ff8080;
  font-size: 12px;
  font-weight: 600;
}

.ik-knock__composer-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 14px;
  border: 2px solid rgba(255, 255, 255, 0.08);
  transition: border-color 140ms ease;
}

.ik-knock__composer-row:focus-within {
  border-color: rgba(251, 254, 0, 0.5);
}

.ik-knock__composer-row.is-disabled {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.05);
  cursor: not-allowed;
}

.ik-knock__composer-row.is-disabled .ik-knock__composer-input {
  cursor: not-allowed;
  color: rgba(255, 255, 255, 0.35);
}

.ik-knock__composer-input {
  flex: 1;
  min-height: 36px;
  max-height: 140px;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.45;
  resize: none;
  outline: none;
}

.ik-knock__composer-input::placeholder {
  color: rgba(255, 255, 255, 0.32);
}

.ik-knock__composer-send {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: #fbfe00;
  color: #000;
  cursor: pointer;
  transition: background 140ms ease, transform 100ms ease, opacity 140ms ease;
}

.ik-knock__composer-send:hover:not(:disabled) {
  background: #e8eb00;
}

.ik-knock__composer-send:active:not(:disabled) {
  transform: scale(0.94);
}

.ik-knock__composer-send:disabled {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.3);
  cursor: not-allowed;
}

.ik-knock__composer-send-icon {
  width: 18px;
  height: 18px;
}

/* ── 响应式（与 KnockKnockModal 一致） ── */
@media (max-width: 768px) {
  .ik-knock__main-header {
    height: 50px;
    padding: 0 14px;
  }
  .ik-knock__main-body {
    padding: 14px;
  }
  .ik-knock__main-title {
    font-size: 16px;
  }
  .ik-knock__empty-pill {
    padding: 12px 64px;
    min-width: 280px;
    font-size: 16px;
    letter-spacing: 4px;
  }
}

/* ═══════════════════════════════════════════════
   KKCall 专属：副标题 / 流式光标 / 错误重试按钮
   ═══════════════════════════════════════════════ */

.ik-kkcall__main-subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  margin-top: 2px;
  display: block;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-kkcall__msg-content {
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── assistant markdown 容器 ──
 * 气泡（.ik-knock__msg-bubble）默认 white-space: pre-wrap + font-weight: 600
 * 是为 user 纯文本气泡定的；markdown 渲染后内容已是结构化 HTML，必须复位
 * 这两项，否则会出现重复空行 + 整段过粗。
 *
 * v-html 注入的元素穿不过 scoped 选择器，所以下面统一用 :deep()。
 */
.ik-kkcall__msg-md {
  white-space: normal;
  word-break: break-word;
  font-weight: 600;
  font-size: 15px;
  line-height: 1.6;
}

/* 首尾块级元素去掉 margin，避免气泡内部出现额外空隙。
 * `>` 必须在 :deep() 之外——它是相对 .ik-kkcall__msg-md 自身的子选择器，
 * 而 :deep 的作用是让选择器穿透 v-html 注入的无 hash 属性子元素。 */
.ik-kkcall__msg-md > :deep(*:first-child) {
  margin-top: 0;
}
.ik-kkcall__msg-md > :deep(*:last-child) {
  margin-bottom: 0;
}

.ik-kkcall__msg-md :deep(p) {
  margin: 0.5em 0;
}

.ik-kkcall__msg-md :deep(strong),
.ik-kkcall__msg-md :deep(b) {
  font-weight: 700;
}

.ik-kkcall__msg-md :deep(em),
.ik-kkcall__msg-md :deep(i) {
  font-style: italic;
}

.ik-kkcall__msg-md :deep(del),
.ik-kkcall__msg-md :deep(s) {
  text-decoration: line-through;
  opacity: 0.7;
}

/* 标题：略大于正文，不要太抢眼 */
.ik-kkcall__msg-md :deep(h1),
.ik-kkcall__msg-md :deep(h2),
.ik-kkcall__msg-md :deep(h3),
.ik-kkcall__msg-md :deep(h4),
.ik-kkcall__msg-md :deep(h5),
.ik-kkcall__msg-md :deep(h6) {
  margin: 0.8em 0 0.4em;
  font-weight: 700;
  line-height: 1.3;
}
.ik-kkcall__msg-md :deep(h1) { font-size: 1.4em; }
.ik-kkcall__msg-md :deep(h2) { font-size: 1.25em; }
.ik-kkcall__msg-md :deep(h3) { font-size: 1.12em; }
.ik-kkcall__msg-md :deep(h4),
.ik-kkcall__msg-md :deep(h5),
.ik-kkcall__msg-md :deep(h6) { font-size: 1em; }

/* 列表：紧凑间距 + 适度缩进 */
.ik-kkcall__msg-md :deep(ul),
.ik-kkcall__msg-md :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.4em;
}
.ik-kkcall__msg-md :deep(li) {
  margin: 0.2em 0;
}
.ik-kkcall__msg-md :deep(li > p) {
  margin: 0.2em 0;
}

/* 引用：左色条 + 弱化文本 */
.ik-kkcall__msg-md :deep(blockquote) {
  margin: 0.6em 0;
  padding: 0.2em 0.9em;
  border-left: 3px solid rgba(44, 88, 226, 0.45);
  background: rgba(44, 88, 226, 0.06);
  color: rgba(77, 77, 77, 0.85);
  border-radius: 4px;
}
.ik-kkcall__msg-md :deep(blockquote > *:first-child) {
  margin-top: 0;
}
.ik-kkcall__msg-md :deep(blockquote > *:last-child) {
  margin-bottom: 0;
}

/* 行内代码：浅灰 chip */
.ik-kkcall__msg-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
  font-size: 0.92em;
  padding: 1px 6px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  word-break: break-all;
}

/* 代码块：暗底 + 横向滚动 + 顶角语言徽标 */
.ik-kkcall__msg-md :deep(pre) {
  position: relative;
  margin: 0.6em 0;
  padding: 12px 14px;
  background: #1e1e1e;
  color: #e4e4e4;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.88em;
  line-height: 1.5;
}
.ik-kkcall__msg-md :deep(pre code) {
  display: block;
  padding: 0;
  background: transparent;
  color: inherit;
  border-radius: 0;
  word-break: normal;
  white-space: pre;
}
/* 语言徽标：来自 markdown-it fence 钩子写入的 data-lang */
.ik-kkcall__msg-md :deep(pre[data-lang])::before {
  content: attr(data-lang);
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  pointer-events: none;
}

/* 链接：和气泡撞色 + 下划线，hover 加深 */
.ik-kkcall__msg-md :deep(a) {
  color: #2c58e2;
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}
.ik-kkcall__msg-md :deep(a:hover) {
  color: #1a3fb8;
}

/* 图片：自适应气泡宽度 */
.ik-kkcall__msg-md :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  display: block;
  margin: 0.4em 0;
}

/* 表格：紧凑边框 */
.ik-kkcall__msg-md :deep(table) {
  border-collapse: collapse;
  margin: 0.6em 0;
  font-size: 0.92em;
  display: block;
  overflow-x: auto;
}
.ik-kkcall__msg-md :deep(th),
.ik-kkcall__msg-md :deep(td) {
  border: 1px solid rgba(0, 0, 0, 0.12);
  padding: 4px 10px;
  text-align: left;
}
.ik-kkcall__msg-md :deep(thead th) {
  background: rgba(0, 0, 0, 0.04);
  font-weight: 700;
}

/* 分隔线 */
.ik-kkcall__msg-md :deep(hr) {
  margin: 0.8em 0;
  border: 0;
  border-top: 1px solid rgba(0, 0, 0, 0.12);
}

.ik-kkcall__msg-cursor {
  display: inline-block;
  margin-left: 1px;
  font-size: 0.75em;
  vertical-align: baseline;
  animation: ik-kkcall-blink 0.9s steps(2, start) infinite;
  opacity: 0.6;
}

@keyframes ik-kkcall-blink {
  to {
    opacity: 0;
  }
}

/*
 * 消息入场动画：与 KnockKnockModal 私聊 .ik-knock__msg.is-new 完全一致，
 * 仅对增量到达（user 输入 + assistant 占位 + SSE 推送）的消息播一次；
 * 切会话首屏的"已知"消息不会重复播放，避免整屏抖动。
 *
 * 只动 transform + opacity，不触发布局重排——长消息流也能 60fps。
 */
@keyframes ik-msg-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

.ik-knock__msg.is-new,
.ik-knock__time-divider.is-new {
  animation: ik-msg-enter 300ms ease-out both;
}

/*
 * 等待 token 时三点跳动动画：与 KnockKnockModal 私聊 .ik-knock__typing-dot
 * 同一节奏（1.2s ease-in-out, 0.2s 间隔），但底色用深灰适配白底气泡。
 */
.ik-kkcall__msg-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 1.4em;
  vertical-align: middle;
}

.ik-kkcall__msg-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(77, 77, 77, 0.55);
  animation: ik-kkcall-typing-bounce 1.2s ease-in-out infinite;
}

.ik-kkcall__msg-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.ik-kkcall__msg-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes ik-kkcall-typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30% { transform: translateY(-3px); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .ik-knock__msg.is-new,
  .ik-knock__time-divider.is-new {
    animation: none;
  }
  .ik-kkcall__msg-dot {
    animation: none;
  }
  .ik-kkcall__msg-cursor {
    animation: none;
  }
}

.ik-kkcall__msg-error {
  color: #ff8a80;
  font-size: 13px;
}

.ik-kkcall__msg-retry {
  margin-left: 8px;
  font-size: 12px;
  background: transparent;
  color: #fbfe00;
  border: 1px solid currentColor;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.ik-kkcall__msg-retry:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── PR4: 思考过程面板 ──
 * 该面板挂在白色气泡外、主栏暗色渐变上，所以整体走 dark glass 风格：
 *   - summary：黑底 pill，hover 微亮，展开时底圆角拉直与下方面板拼接
 *   - body：grid-template-rows 0fr ↔ 1fr 平滑过渡（兼容任意内容高度）
 *   - 文字均为浅色，避免在暗色背景上"看不清"
 */
.ik-kkcall__thinking {
  margin-top: 8px;
  font-size: 13px;
  align-self: flex-start;
  /* 限制宽度避免长 thinkingContent 把面板撑过气泡宽度 */
  max-width: 100%;
}

.ik-knock__msg.is-mine .ik-kkcall__thinking {
  align-self: flex-end;
}

/* summary 完全对齐私聊 .ik-knock__msg-quote：保持 pill 形态，圆角不变；
 * 展开/收起的视觉指示通过下方 body 面板和 chevron 图标的旋转传达，避免 pill 自身变形。 */
.ik-kkcall__thinking-summary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  margin: 0;
  padding: 7px 15px;
  border: 0;
  border-radius: 999px;
  background: #000;
  color: #c8c8c8;
  cursor: pointer;
  user-select: none;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  text-align: left;
  transition: background-color 140ms ease, box-shadow 140ms ease;
}

/* hover：与 .ik-knock__msg-quote 完全一致的浅白底 + 黑/白双层 inset ring */
.ik-kkcall__thinking-summary:hover {
  background-color: rgba(255, 255, 255, 0.04);
  box-shadow:
    inset 0 0 0 1px #000,
    inset 0 0 0 5px rgba(255, 255, 255, 0.35);
}

.ik-kkcall__thinking-summary:focus-visible {
  outline: 2px solid rgba(251, 254, 0, 0.6);
  outline-offset: 2px;
}

.ik-kkcall__thinking-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: rgba(251, 254, 0, 0.85);
}

.ik-kkcall__thinking-label {
  font-size: 13px;
  color: #fff;
  font-weight: 600;
}

.ik-kkcall__thinking-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: rgba(251, 254, 0, 0.7);
  border-radius: 50%;
  animation: ik-kkcall-spin 0.8s linear infinite;
}

@keyframes ik-kkcall-spin {
  to { transform: rotate(360deg); }
}

/* chevron 作为次要指示器：尺寸压低到 12px，颜色 dim 到 0.45，不与 16px 的 LightBulb 主图标抢权重 */
.ik-kkcall__thinking-chevron {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  color: rgba(255, 255, 255, 0.45);
  transition: transform 240ms cubic-bezier(0.4, 0, 0.2, 1);
}

.ik-kkcall__thinking.is-open .ik-kkcall__thinking-chevron {
  transform: rotate(180deg);
  color: rgba(255, 255, 255, 0.7);
}

/* 展开动画：grid-template-rows 0fr ↔ 1fr 是目前兼容性最好的"未知高度"过渡方案。
 * 浏览器把 1fr 解析为内容自然高度后再插值，无需 JS 量取 scrollHeight。 */
.ik-kkcall__thinking-body-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 280ms cubic-bezier(0.4, 0, 0.2, 1);
}

.ik-kkcall__thinking.is-open .ik-kkcall__thinking-body-wrap {
  grid-template-rows: 1fr;
}

/* 裁剪层：必须 overflow:hidden + min-height:0，否则 0fr 时子元素仍会撑出来 */
.ik-kkcall__thinking-body-clip {
  overflow: hidden;
  min-height: 0;
}

.ik-kkcall__thinking-body {
  margin-top: 4px;
  padding: 10px 14px;
  white-space: pre-wrap;
  word-break: break-word;
  color: rgba(255, 255, 255, 0.82);
  font-size: 12.5px;
  line-height: 1.55;
  /* 面板自身高度上限：之前 260px 偏紧，长 thinkingContent 太挤，
   * 提到 400px 给思考链 / 工具卡片更多展示空间；超出仍触发内部滚动。 */
  max-height: 400px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.ik-kkcall__thinking-body::-webkit-scrollbar {
  width: 4px;
}
.ik-kkcall__thinking-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}

/* ── PR4: 工具调用卡片（dark theme 适配） ── */
.ik-kkcall__thinking-text {
  margin-bottom: 6px;
  color: rgba(255, 255, 255, 0.78);
}

.ik-kkcall__tool-card {
  margin-top: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.03);
}

.ik-kkcall__tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.04);
}

.ik-kkcall__tool-icon {
  flex-shrink: 0;
  width: 13px;
  height: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.ik-kkcall__tool-name {
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.82);
}

.ik-kkcall__tool-badge {
  margin-left: auto;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.ik-kkcall__tool-badge.is-done {
  background: rgba(76, 175, 80, 0.18);
  color: #8be78f;
}

.ik-kkcall__tool-badge.is-running {
  background: rgba(255, 193, 7, 0.18);
  color: #ffd66b;
  animation: ik-kkcall-blink 1.2s steps(2, start) infinite;
}

.ik-kkcall__tool-args,
.ik-kkcall__tool-result {
  padding: 6px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  line-height: 1.45;
}

.ik-kkcall__tool-args code,
.ik-kkcall__tool-result code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.7);
  word-break: break-all;
  white-space: pre-wrap;
}

.ik-kkcall__tool-result-label {
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  margin-right: 4px;
}

/* ── PR4: 引用角标 ── */
.ik-kkcall__refs {
  display: inline-flex;
  gap: 4px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.ik-kkcall__ref-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font-size: 11px;
  font-weight: 600;
  color: #2c58e2;
  background: rgba(44, 88, 226, 0.08);
  border: 1px solid rgba(44, 88, 226, 0.2);
  border-radius: 9px;
  cursor: default;
  line-height: 1;
}

@media (prefers-reduced-motion: reduce) {
  .ik-kkcall__thinking-spinner {
    animation: none;
  }
  .ik-kkcall__thinking-chevron,
  .ik-kkcall__thinking-body-wrap,
  .ik-kkcall__thinking-summary {
    transition: none;
  }
}
</style>
