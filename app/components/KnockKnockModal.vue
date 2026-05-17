<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import {
  PhoneIcon,
  UserIcon,
  UserGroupIcon,
  ChatBubbleLeftIcon,
} from "@heroicons/vue/24/solid";
import { XCircleIcon, DocumentTextIcon } from "@heroicons/vue/24/outline";
import type { KnockConversation, NotificationDto } from "~/types/entities";
import { formatTime } from "~/utils/time";

const { visible, close } = useKnockKnockModal();
const discussionModal = useDiscussionModal();

/** 顶部 tab：通话记录（未来 AI 对话占位） / 私聊 / 群聊（未来占位） */
type KnockTab = "calls" | "contacts" | "groups";

const activeTab = ref<KnockTab>("contacts");

const {
  conversations: allConversations,
  isLoading,
  error: loadError,
  refresh,
  ensureMessages,
  messageStateOf,
  markConversationAsRead,
  /** 当前选中的会话 ID（共享自 composable；null 表示右栏显示 EMPTY 占位） */
  activeConversationId,
  startStream,
  stopStream,
} = useKnockKnockConversations();

/** 弹窗打开：拉会话列表 + 开 SSE；关闭：清空选中 + 关 SSE */
watch(visible, (next) => {
  if (next) {
    refresh();
    startStream();
  } else {
    activeConversationId.value = null;
    stopStream();
  }
});

/**
 * 当前 tab 应展示的会话列表。
 * "私聊" tab 默认展示 contacts；其他两个 tab 暂留空。
 */
const conversations = computed<KnockConversation[]>(() => {
  if (activeTab.value !== "contacts") return [];
  return allConversations.value.filter((c) => c.category === "contacts");
});

const activeConversation = computed<KnockConversation | null>(() => {
  if (!activeConversationId.value) return null;
  return conversations.value.find((c) => c.id === activeConversationId.value) ?? null;
});

/**
 * 当前会话的消息流：后端已按 createdAt ASC 返回，直接使用。
 * 消息由 ensureMessages(id) 懒加载到 composable 内部缓存。
 */
const activeMessages = computed<NotificationDto[]>(() => {
  const id = activeConversationId.value;
  if (!id) return [];
  return messageStateOf(id).value.items;
});

/** 右栏 loading 占位用：当前会话首次加载消息中且本地尚无缓存 */
const activeMessageLoading = computed<boolean>(() => {
  const id = activeConversationId.value;
  if (!id) return false;
  const state = messageStateOf(id).value;
  return state.loading && !state.hydrated;
});

/** 消息流容器，用于切换会话时自动滚到底部 */
const messagesRef = ref<HTMLElement | null>(null);

/** 时间戳显隐：只在“首条”或与前一条间隔 > 5 分钟时展示，避免逐条时间戳过于嘈杂 */
const TIME_GAP_MS = 5 * 60 * 1000;
const shouldShowTime = (index: number): boolean => {
  const list = activeMessages.value;
  const curr = list[index];
  if (!curr) return false;
  if (index === 0) return true;
  const prev = list[index - 1];
  if (!prev) return true;
  const dCurr = new Date(curr.createdAt).getTime();
  const dPrev = new Date(prev.createdAt).getTime();
  if (Number.isNaN(dCurr) || Number.isNaN(dPrev)) return false;
  return dCurr - dPrev > TIME_GAP_MS;
};

/**
 * 用户在切换/打开会话前是否处于"接近底部"。
 * SSE 触发的新消息只有在 wasNearBottom 时才自动滚动，
 * 否则保持用户当前的滚动位置（避免打断用户读历史）。
 * 切换会话时重置为 true（新会话默认看最新）。
 */
const NEAR_BOTTOM_THRESHOLD_PX = 80;
const wasNearBottom = ref(true);

const isNearBottom = (el: HTMLElement): boolean => {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;
};

/**
 * 滚到底部。用 rAF 双重 + 一次延后探测，覆盖：
 * - Vue patch 之后 DOM 已就位但浏览器尚未布局（rAF1）
 * - 布局完成但 inline 图片仍在加载导致 scrollHeight 后涨（200ms 兜底）
 */
const scrollToBottom = (el: HTMLElement) => {
  const doScroll = () => {
    el.scrollTop = el.scrollHeight;
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(doScroll);
  });
  // 兜底：等待图片等异步资源完成布局后再校正一次
  setTimeout(doScroll, 200);
};

/** 选中会话时：懒加载消息 → 批量 mark-read → 滚到最新消息 */
watch(activeConversationId, async (id) => {
  if (!id) return;
  // 新会话默认看最新消息
  wasNearBottom.value = true;
  try {
    await ensureMessages(id);
  } catch {
    /* 加载失败不阅出，错误与会话列表一并在右栏提示 */
  }
  markConversationAsRead(id);
  nextTick(() => {
    const el = messagesRef.value;
    if (el) scrollToBottom(el);
  });
});

/**
 * 用户滚动时持续更新 wasNearBottom；
 * 这是 SSE/合并刷新后决定「是否自动跟随到底」的依据。
 */
const onMessagesScroll = () => {
  const el = messagesRef.value;
  if (!el) return;
  wasNearBottom.value = isNearBottom(el);
};

/**
 * 消息流变化时，如果用户原本就靠底，跟随到新底部。
 * 否则保持当前 scrollTop，让用户继续读历史。
 */
watch(
  () => activeMessages.value.length,
  (next, prev) => {
    if (next <= (prev ?? 0)) return;
    if (!wasNearBottom.value) return;
    nextTick(() => {
      const el = messagesRef.value;
      if (el) scrollToBottom(el);
    });
  },
);

/** 不同 notification 类型在没有 comment.content 时的兜底正文 */
const fallbackBubbleText = (item: NotificationDto): string => {
  if (item.type === "like") return "赞了你的内容";
  if (item.type === "favorite") return "收藏了你的帖子";
  if (item.type === "mention") return "在帖子中提到了你";
  if (item.type === "system") return "系统消息";
  return "";
};

/** 点击评论帖子卡：保留敲敲弹窗，帖子弹窗叠加显示（项目已有路由级弹窗机制） */
const goDiscussion = (articleDocumentId: string, articleTitle: string) => {
  discussionModal.open(articleDocumentId, {
    preview: { title: articleTitle },
  });
};

/** ESC 关闭敲敲弹窗：若帖子弹窗叠加在上层，则让其优先消费 ESC */
const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== "Escape" || !visible.value) return;
  if (discussionModal.isOpen.value) return;
  close();
};

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
});

const handleClose = () => {
  close();
};

const handleBackdropMouseDown = (e: MouseEvent) => {
  if (e.target === e.currentTarget) handleClose();
};

const handleTabClick = (tab: KnockTab) => {
  activeTab.value = tab;
  // 切换 tab 时清掉右栏，避免显示其他 tab 的会话
  activeConversationId.value = null;
};

const handleConversationClick = (id: string) => {
  activeConversationId.value = id;
};
</script>

<template>
  <Teleport to="body">
    <Transition name="ik-overlay">
      <div
        v-if="visible"
        class="ik-overlay"
        @mousedown.self="handleBackdropMouseDown"
      >
        <!-- 斜线纹理背景（与帖子弹窗一致） -->
        <div class="ik-overlay__stripe" aria-hidden="true"></div>

        <div class="ik-dialog ik-dialog--knock" @click.stop>
          <!-- 外边框（半透明白色，三圆角） -->
          <div class="ik-dialog__outer">
            <!-- 内边框（纯黑，三圆角） -->
            <div class="ik-dialog__inner">
              <!-- Header Bar -->
              <div class="ik-dialog__header ik-knock__header">
                <div class="ik-knock__brand">
                  <span class="ik-knock__brand-icon" aria-hidden="true">
                    <!-- 自绘 phone + signal wave，匹配截图中的黄色 logo -->
                    <svg viewBox="0 0 32 32" width="28" height="28" fill="none">
                      <!-- 手机外壳 -->
                      <rect
                        x="9"
                        y="9"
                        width="14"
                        height="22"
                        rx="3"
                        fill="#fbfe00"
                        stroke="#000"
                        stroke-width="1.5"
                      />
                      <!-- 屏幕高光 -->
                      <rect
                        x="11"
                        y="11.5"
                        width="10"
                        height="14"
                        rx="1"
                        fill="#000"
                      />
                      <!-- Home 指示点 -->
                      <circle cx="16" cy="28.5" r="0.9" fill="#000" />
                      <!-- 信号弧线 -->
                      <path
                        d="M22 8 q3 -1 5 1"
                        stroke="#fbfe00"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        fill="none"
                      />
                      <path
                        d="M22 5 q5 -1.5 8 1.5"
                        stroke="#fbfe00"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        fill="none"
                      />
                    </svg>
                  </span>
                  <span class="ik-knock__brand-text">knock knock</span>
                </div>
                <button
                  class="ik-dialog__close"
                  aria-label="关闭"
                  @click="handleClose"
                >
                  <img
                    src="/images/close-btn.webp"
                    alt="关闭"
                    class="ik-dialog__close-img"
                    draggable="false"
                  />
                </button>
              </div>

              <!-- Body：双栏布局 -->
              <div class="ik-dialog__body ik-knock__body">
                <!-- 左栏：tab + 会话列表 + 活动信息 -->
                <aside class="ik-knock__sidebar">
                  <div class="ik-knock__tabs" role="tablist" aria-label="敲敲分类">
                    <button
                      type="button"
                      role="tab"
                      class="ik-knock__tab"
                      :class="{ 'is-active': activeTab === 'calls' }"
                      :aria-selected="activeTab === 'calls'"
                      aria-label="通话记录"
                      @click="handleTabClick('calls')"
                    >
                      <PhoneIcon class="ik-knock__tab-icon" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      role="tab"
                      class="ik-knock__tab"
                      :class="{ 'is-active': activeTab === 'contacts' }"
                      :aria-selected="activeTab === 'contacts'"
                      aria-label="私聊"
                      @click="handleTabClick('contacts')"
                    >
                      <UserIcon class="ik-knock__tab-icon" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      role="tab"
                      class="ik-knock__tab"
                      :class="{ 'is-active': activeTab === 'groups' }"
                      :aria-selected="activeTab === 'groups'"
                      aria-label="群聊"
                      @click="handleTabClick('groups')"
                    >
                      <UserGroupIcon class="ik-knock__tab-icon" aria-hidden="true" />
                    </button>
                  </div>

                  <div class="ik-knock__list" role="listbox">
                    <button
                      v-for="item in conversations"
                      :key="item.id"
                      type="button"
                      role="option"
                      class="ik-knock__list-item"
                      :class="{
                        'is-active': activeConversationId === item.id,
                        'has-unread': item.unread > 0,
                      }"
                      :aria-selected="activeConversationId === item.id"
                      @click="handleConversationClick(item.id)"
                    >
                      <span class="ik-knock__avatar" aria-hidden="true">
                        <img
                          v-if="item.peerAvatar"
                          :src="item.peerAvatar"
                          :alt="item.peerName"
                          class="ik-knock__avatar-img"
                          draggable="false"
                        />
                        <XCircleIcon v-else class="ik-knock__avatar-icon" />
                      </span>
                      <span class="ik-knock__item-text">
                        <span class="ik-knock__item-title">{{ item.peerName }}</span>
                        <span class="ik-knock__item-subtitle">
                          {{ item.lastPreview || "暂无消息" }}
                        </span>
                      </span>
                      <span
                        v-if="item.unread > 0"
                        class="ik-knock__item-badge"
                        aria-label="未读"
                      >
                        {{ item.unread > 99 ? "99+" : item.unread }}
                      </span>
                    </button>
                    <div
                      v-if="!conversations.length && activeTab === 'contacts'"
                      class="ik-knock__list-empty"
                    >
                      <span v-if="isLoading">加载中…</span>
                      <span v-else-if="loadError">{{ loadError }}</span>
                      <span v-else>暂无消息</span>
                    </div>
                  </div>

                </aside>

                <!-- 右栏：会话标题 + 内容 -->
                <section class="ik-knock__main">
                  <header class="ik-knock__main-header">
                    <ChatBubbleLeftIcon
                      class="ik-knock__main-icon"
                      aria-hidden="true"
                    />
                    <span class="ik-knock__main-title">
                      {{ activeConversation?.peerName ?? "NoData" }}
                    </span>
                  </header>
                  <div class="ik-knock__main-body">
                    <!-- 会话消息流 -->
                    <div
                      v-if="activeConversation && activeMessages.length"
                      ref="messagesRef"
                      class="ik-knock__messages"
                      @scroll.passive="onMessagesScroll"
                    >
                      <template
                        v-for="(msg, idx) in activeMessages"
                        :key="msg.documentId"
                      >
                        <!-- 时间分隔行：首条或与上条间隔 > 5min 时显示 -->
                        <div
                          v-if="shouldShowTime(idx)"
                          class="ik-knock__time-divider"
                        >
                          {{ formatTime(msg.createdAt) }}
                        </div>
                        <div class="ik-knock__msg">
                          <div class="ik-knock__msg-avatar" aria-hidden="true">
                            <img
                              v-if="activeConversation.peerAvatar"
                              :src="activeConversation.peerAvatar"
                              :alt="activeConversation.peerName"
                              class="ik-knock__msg-avatar-img"
                              draggable="false"
                            />
                            <XCircleIcon v-else class="ik-knock__msg-avatar-icon" />
                          </div>
                          <div class="ik-knock__msg-body">
                            <div class="ik-knock__msg-bubble">
                              {{ msg.comment?.content || fallbackBubbleText(msg) }}
                            </div>
                            <button
                              v-if="msg.article"
                              type="button"
                              class="ik-knock__msg-quote"
                              @click="goDiscussion(msg.article.documentId, msg.article.title)"
                            >
                              <DocumentTextIcon
                                class="ik-knock__msg-quote-icon"
                                aria-hidden="true"
                              />
                              <span class="ik-knock__msg-quote-text">
                                <span class="ik-knock__msg-quote-label">评论帖子</span>
                                <span class="ik-knock__msg-quote-title">
                                  {{ msg.article.title }}
                                </span>
                              </span>
                            </button>
                          </div>
                        </div>
                      </template>
                    </div>
                    <!-- 占位 / 加载态 -->
                    <div v-else class="ik-knock__empty-pill">
                      {{ activeMessageLoading ? "加载中…" : "EMPTY" }}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Overlay 外壳 —— 与帖子弹窗 / 登录弹窗完全一致
   ═══════════════════════════════════════════════ */
.ik-overlay {
  position: fixed;
  inset: 0;
  /* 低于帖子弹窗 (9000)，保证点击评论帖子后帖子弹窗叠加在上方 */
  z-index: 8900;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.ik-overlay__stripe {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    40deg,
    transparent,
    transparent 3.5px,
    rgba(255, 255, 255, 0.09) 4.5px,
    rgba(255, 255, 255, 0.09) 7.5px,
    transparent 8.5px
  );
}

/* ── Dialog Shell ──────────────────────────────── */
.ik-dialog {
  position: relative;
}

.ik-dialog--knock {
  width: min(1300px, 86vw);
  height: min(760px, 86vh);
}

.ik-dialog__outer {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #2d2c2d;
  border-radius: 24px;
  overflow: hidden;
}

.ik-dialog__inner {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #000;
  border-radius: 22px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Header ────────────────────────────────────── */
.ik-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  flex-shrink: 0;
  border-radius: 18px 18px 0 0;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #161616 0%, #080808 100%);
}

.ik-knock__brand {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.ik-knock__brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.ik-knock__brand-icon > svg {
  width: 100%;
  height: 100%;
}

.ik-knock__brand-text {
  font-size: 26px;
  font-weight: 800;
  font-style: normal;
  color: #fff;
  letter-spacing: -0.4px;
  line-height: 1;
}

.ik-dialog__close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: opacity 140ms ease, transform 140ms ease;
}

.ik-dialog__close:hover {
  opacity: 0.85;
  transform: scale(1.08);
}

.ik-dialog__close:active {
  transform: scale(0.95);
}

.ik-dialog__close-img {
  height: 40px;
  width: auto;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

/* ── Body：左右两栏 ────────────────────────────── */
.ik-dialog__body {
  flex: 1;
  min-height: 0;
  background: #121212;
  border-radius: 0 0 18px 18px;
}

.ik-knock__body {
  display: flex;
  gap: 18px;
  padding: 20px 24px 24px;
  position: relative;
}

/* 右栏背景的 INTER KNOT 水印（淡色装饰） */
.ik-knock__body::before {
  content: "INTER KNOT INTER KNOT";
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(100px, 13vw, 200px);
  font-weight: 900;
  font-style: italic;
  color: rgba(255, 255, 255, 0.03);
  letter-spacing: -4px;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  overflow: hidden;
}

/* ── 侧栏 / 主栏 共享面板装饰 ────────────────── */
.ik-knock__sidebar,
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
}

/* ── Sidebar ──────────────────────────────── */
.ik-knock__sidebar {
  flex: 0 0 292px;
  padding: 14px 12px;
  gap: 14px;
  min-height: 0;
  /* 防止长昵称 / 长文本撑大 sidebar，影响顶部 tabs 对齐 */
  min-width: 0;
}

/* tabs 胶囊：与项目顶部 tab 风格一致；宽度与下方列表项对齐 */
.ik-knock__tabs {
  display: flex;
  align-items: stretch;
  width: 100%;
  padding: 5px;
  gap: 6px;
  border-radius: 999px;
  border: 3px solid #313131;
  background: #050505 url("/images/tab-bg-point.webp") repeat;
}

.ik-knock__tab {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #d9d9d9;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.ik-knock__tab:hover {
  color: #fff;
}

.ik-knock__tab.is-active {
  background: #fbfe00;
  color: #000;
}

.ik-knock__tab-icon {
  width: 22px;
  height: 22px;
}

/* 列表 */
.ik-knock__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* 不预留滚动条轨道，让 list-item 与 tabs 同宽 */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.ik-knock__list::-webkit-scrollbar {
  width: 4px;
}

.ik-knock__list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}

.ik-knock__list-item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  /* 配合父级 min-width:0，让 ellipsis 真正生效 */
  min-width: 0;
  /* 原 border 4px 补入 padding，保证内容距可见边缘距离不变 */
  padding: 10px 16px;
  border: 0;
  border-radius: 999px;
  /* 内层：棋盘格 chessboard pattern（= <z-pattern type="squares">） */
  background-color: transparent;
  background-image:
    linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.06) 25%,
      transparent 0 75%,
      rgba(255, 255, 255, 0.06) 0
    ),
    linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.06) 25%,
      transparent 0 75%,
      rgba(255, 255, 255, 0.06) 0
    );
  background-position: 0 0, 3px 3px;
  background-size: 6px 6px;
  background-repeat: repeat;
  /* 三层边框全部内缩于元素本身 box 内，确保与 tabs 宽度一致 */
  /* 最外 1px 黑描边 + 内侧 4px 灰描边 */
  box-shadow:
    inset 0 0 0 1px #000,
    inset 0 0 0 5px #3a3a3a;
  color: #888;
  text-align: left;
  cursor: pointer;
  transition: background-color 140ms ease, box-shadow 140ms ease,
    color 140ms ease;
}

.ik-knock__list-item:hover {
  /* 只调底色，保留棋盘纹理；灰描边适度提亮 */
  background-color: rgba(255, 255, 255, 0.04);
  box-shadow:
    inset 0 0 0 1px #000,
    inset 0 0 0 5px rgba(255, 255, 255, 0.35);
}

.ik-knock__list-item.is-active {
  /* 选中态：整块实底主题色，去边框、去 chessboard */
  background-color: #fbfe00;
  background-image: none;
  box-shadow: none;
  color: #000;
}

.ik-knock__list-item.is-active .ik-knock__item-title {
  color: #000;
  font-weight: 800;
}

.ik-knock__list-item.is-active .ik-knock__item-subtitle {
  color: #3a3a3a;
  font-weight: 700;
}

.ik-knock__avatar {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: transparent;
  color: #4a4a4a;
  /* 黑色描边圈：选中/未选中都保留 */
  border: 3px solid #000;
  box-sizing: border-box;
  overflow: hidden;
}

.ik-knock__avatar-icon {
  width: 40px;
  height: 40px;
}

.ik-knock__avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  object-fit: cover;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-knock__item-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  background: #fbfe00;
  color: #000;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.ik-knock__list-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
}

.ik-knock__item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  line-height: 1.2;
}

.ik-knock__item-title {
  font-size: 16px;
  font-weight: 800;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-knock__item-subtitle {
  font-size: 13px;
  font-weight: 700;
  color: #5a5a5a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Main column ───────────────────────────────── */
.ik-knock__main {
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
  /* 空态在主区域内居中 */
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

/* ── 消息流 ────────────────────────────────── */
.ik-knock__messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 消息间距适中，不太拥挤 */
  gap: 14px;
  overflow-y: auto;
  padding-right: 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.ik-knock__messages::-webkit-scrollbar {
  width: 4px;
}
.ik-knock__messages::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}

.ik-knock__msg {
  display: flex;
  /* 参考 chat-generator：头像与气泡间留出昵尖角的位置 */
  gap: 10px;
  align-items: flex-start;
}

.ik-knock__msg-avatar {
  flex-shrink: 0;
  /* 与侧栏会话列表头像保持同尺寸 */
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

.ik-knock__msg-avatar-icon {
  width: 40px;
  height: 40px;
}

.ik-knock__msg-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 限制气泡最大宽度，长消息换行不顶满整列 */
  max-width: min(560px, 92%);
}

/* 时间分隔行（QQ 风格）：居中、灰色、小字 */
.ik-knock__time-divider {
  align-self: center;
  margin: 6px 0 2px;
  padding: 2px 10px;
  color: rgba(255, 255, 255, 0.32);
  font-size: 12px;
  letter-spacing: 0.5px;
  user-select: none;
}

.ik-knock__msg-bubble {
  position: relative;
  /* w-fit 自适应内容宽度 */
  align-self: flex-start;
  max-width: 100%;
  /* 参考 chat-generator： 0.3125em 0.75em、圆角 0.9375em，与气泡字号成比 */
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

/*
 * 左上昵尖角（bubble nipple）：复用 zenless-tools/chat-generator 原版 webp
 * 参考 ChatGeneratorItemArrow.tsx：top: 0.125em; left: -0.4375em; width/height: 0.75em
 */
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

/* 引用帖子卡片：与正常 DM 区分，hint 标签 + 标题 + 文档图标 */
.ik-knock__msg-quote {
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
  text-align: left;
  transition: background-color 140ms ease, box-shadow 140ms ease;
}

.ik-knock__msg-quote:hover {
  /* 与侧栏会话项 hover 一致：浅白底 + 黑/白双层 inset ring */
  background-color: rgba(255, 255, 255, 0.04);
  box-shadow:
    inset 0 0 0 1px #000,
    inset 0 0 0 5px rgba(255, 255, 255, 0.35);
}

.ik-knock__msg-quote-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: rgba(251, 254, 0, 0.85);
}

.ik-knock__msg-quote-text {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.ik-knock__msg-quote-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 1px;
}

.ik-knock__msg-quote-title {
  font-size: 13px;
  color: #fff;
  font-weight: 600;
  /* 单行 ellipsis，避免长标题撑爆气泡 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}


/* ═══════════════════════════════════════════════
   Animations —— 与帖子弹窗完全一致
   ═══════════════════════════════════════════════ */
@keyframes stripe-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes stripe-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}

.ik-overlay-enter-active {
  transition: background-color 80ms ease-out,
    backdrop-filter 80ms ease-out,
    -webkit-backdrop-filter 80ms ease-out;
}

.ik-overlay-enter-from {
  background-color: transparent !important;
  backdrop-filter: blur(0) !important;
  -webkit-backdrop-filter: blur(0) !important;
}

.ik-overlay-enter-active .ik-overlay__stripe {
  animation: stripe-fade-in 250ms ease-out both;
}

.ik-overlay-enter-active .ik-dialog {
  transition: transform 250ms cubic-bezier(0.165, 0.84, 0.44, 1),
    opacity 200ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.ik-overlay-enter-from .ik-overlay__stripe {
  opacity: 0;
}

.ik-overlay-enter-from .ik-dialog {
  opacity: 0;
  transform: translateX(5%);
}

.ik-overlay-leave-active {
  transition: background-color 160ms ease-out,
    backdrop-filter 160ms ease-out,
    -webkit-backdrop-filter 160ms ease-out;
}

.ik-overlay-leave-active .ik-overlay__stripe {
  animation: stripe-fade-out 180ms ease-in both;
}

.ik-overlay-leave-active .ik-dialog {
  transition: transform 200ms cubic-bezier(0.55, 0, 1, 0.45),
    opacity 180ms ease-in;
}

.ik-overlay-leave-to {
  background-color: transparent !important;
  backdrop-filter: blur(0) !important;
  -webkit-backdrop-filter: blur(0) !important;
}

.ik-overlay-leave-to .ik-dialog {
  opacity: 0;
  transform: translateX(-5%);
}

/* ── Mobile ───────────────────────────────────── */
@media (max-width: 768px) {
  .ik-dialog--knock {
    width: 94vw;
    height: 80vh;
  }

  .ik-knock__body {
    padding: 14px 16px 16px;
    gap: 12px;
  }

  .ik-knock__sidebar {
    flex: 0 0 236px;
    padding: 12px 10px;
    gap: 10px;
  }

  .ik-knock__brand-icon {
    width: 38px;
    height: 38px;
  }

  .ik-knock__brand-text {
    font-size: 20px;
  }

  .ik-dialog__close-img {
    height: 32px;
  }

  .ik-knock__tab {
    height: 32px;
  }

  .ik-knock__tab-icon {
    width: 18px;
    height: 18px;
  }

  .ik-knock__list-item {
    padding: 10px 12px;
    gap: 12px;
  }

  .ik-knock__avatar {
    width: 36px;
    height: 36px;
  }

  .ik-knock__avatar-icon {
    width: 32px;
    height: 32px;
  }

  .ik-knock__item-title {
    font-size: 14px;
  }

  .ik-knock__item-subtitle {
    font-size: 12px;
  }

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

@media (max-width: 560px) {
  .ik-dialog--knock {
    width: 96vw;
    height: 86vh;
  }

  .ik-knock__body {
    flex-direction: column;
    padding: 12px;
    gap: 12px;
  }

  .ik-knock__sidebar {
    flex: 0 0 auto;
    height: 50%;
  }

  .ik-knock__main {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-overlay-enter-active,
  .ik-overlay-enter-active .ik-dialog,
  .ik-overlay-leave-active,
  .ik-overlay-leave-active .ik-dialog {
    transition: none;
  }

  .ik-overlay-enter-active .ik-overlay__stripe,
  .ik-overlay-leave-active .ik-overlay__stripe {
    animation: none;
  }
}
</style>
