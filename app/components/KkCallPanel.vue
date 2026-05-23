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
} from "@heroicons/vue/24/solid";
import type { KkCallSessionSummary } from "~/types/entities";
import { formatTime } from "~/utils/time";

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

const isNearBottom = (el: HTMLElement): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;

const scrollToBottom = (el: HTMLElement) => {
  const doScroll = () => {
    el.scrollTop = el.scrollHeight;
  };
  doScroll();
  requestAnimationFrame(doScroll);
  setTimeout(doScroll, 200);
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
    if (!id) return;
    wasNearBottom.value = true;
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
    // 切会话首屏的所有消息记为"已知"，避免一次性整屏闪动；
    // 之后发出的 user / assistant 消息都会被识别为新到达并播入场动画
    knownMessageIds.value = new Set(messages.value.map((m) => m.documentId));
    nextTick(() => {
      const el = messagesRef.value;
      if (!el) {
        messagesSettling.value = false;
        return;
      }
      scrollToBottom(el);
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
    if (!wasNearBottom.value) return;
    nextTick(() => {
      const el = messagesRef.value;
      if (el) scrollToBottom(el);
    });
  },
);

/** 流式 delta 期间，最后一条 assistant content 长度变化也要跟随 */
watch(
  () => {
    const list = messages.value;
    const last = list[list.length - 1];
    if (!last || last.role !== "assistant") return 0;
    return last.content.length;
  },
  () => {
    if (!wasNearBottom.value) return;
    const el = messagesRef.value;
    if (el) {
      // 流式过程中只 sync set，不再 rAF/setTimeout 兜底以减少重排开销
      el.scrollTop = el.scrollHeight;
    }
  },
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
  // 让用户输入后立即看到自己的消息进入"靠底"态
  wasNearBottom.value = true;

  const handle = sendMessage(sid, text);
  currentSendAbort = handle.abort;

  // pseudo → real：第一时间通知父级切换 activeId
  handle.realId
    .then((realId) => {
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
  if (currentSendAbort) {
    try {
      currentSendAbort();
    } catch {
      /* noop */
    }
    currentSendAbort = null;
  }
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
                    v-if="entry.msg.pending && !entry.msg.content"
                    class="ik-kkcall__msg-dots"
                    aria-label="正在输入"
                  >
                    <span class="ik-kkcall__msg-dot" />
                    <span class="ik-kkcall__msg-dot" />
                    <span class="ik-kkcall__msg-dot" />
                  </span>
                  <template v-else>
                    <span class="ik-kkcall__msg-content">{{ entry.msg.content }}</span>
                    <!-- 流式有内容后保留尾部闪烁光标，提示仍在生成 -->
                    <span
                      v-if="entry.msg.pending"
                      class="ik-kkcall__msg-cursor"
                      aria-hidden="true"
                    >▋</span>
                  </template>
                </template>
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

.ik-kkcall__msg-cursor {
  display: inline-block;
  margin-left: 2px;
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
</style>
