<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRouter, useRoute } from "vue-router";
import {
  ArrowLeftIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  SparklesIcon,
} from "@heroicons/vue/24/outline";
import { PaperAirplaneIcon, StopIcon } from "@heroicons/vue/24/solid";
import type { AiRoleCard, DmConversationSummary, DmMessage } from "~/types/entities";
import { buildWorkflowSteps, extractCitations } from "~/utils/workflow";
import type { WorkflowStepView } from "~/utils/workflow";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const loginDialog = useLoginDialog();
const postModal = usePostModal();

const {
  conversations: allConversations,
  isLoading,
  refresh,
  ensureMessages,
  sendMessage,
  createAiSession,
  deleteConversation,
  updateConversation,
  stopAiStream,
  isStreamingMessage,
  workflowEventsOf,
  startStream,
  stopStream,
  messageStateOf,
} = useDmConversations();

const { characters: aiCharacters, loading: aiCharsLoading, refresh: refreshAiCharacters } = useAiCharacters();

const activeCharacterSlug = ref<string | null>(null);
const activeConversationId = ref<string | null>(null);
const draft = ref("");
const composerRef = ref<HTMLTextAreaElement | null>(null);
const messagesRef = ref<HTMLElement | null>(null);
const reasoningMessageId = ref<string | null>(null);
const showReasoningSidebar = ref(false);
const creatingSession = ref(false);
const deletingSessionId = ref<string | null>(null);
const editingTitleId = ref<string | null>(null);
const editingTitle = ref("");
const wasNearBottom = ref(true);
const backToBottomVisible = ref(false);

const selfUserId = computed<number | null>(() => {
  const id = auth.user?.id;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return null;
});

const aiCards = computed(() => aiCharacters.value);
const activeCard = computed<AiRoleCard | null>(() =>
  aiCards.value.find((c) => c.slug === activeCharacterSlug.value) ?? null,
);

const aiPeerUserIds = computed(() => {
  const set = new Set<number>();
  for (const card of aiCards.value) {
    const uid = card.boundUser?.id;
    if (typeof uid === "number") set.add(uid);
  }
  return set;
});

const isOfficialAiPeer = (conv: DmConversationSummary): boolean => {
  if (conv.peer?.isAiAgent === true) return true;
  const uid = conv.peer?.userId;
  return typeof uid === "number" && aiPeerUserIds.value.has(uid);
};

const sessions = computed<DmConversationSummary[]>(() => {
  const uid = activeCard.value?.boundUser?.id;
  if (typeof uid !== "number") return [];
  return allConversations.value
    .filter((c) => c.peer?.userId === uid && isOfficialAiPeer(c))
    .sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
});

const activeSession = computed<DmConversationSummary | null>(() => {
  if (!activeConversationId.value) return null;
  return allConversations.value.find((c) => c.documentId === activeConversationId.value) ?? null;
});

const messages = computed<DmMessage[]>(() => {
  const id = activeConversationId.value;
  if (!id) return [];
  return messageStateOf(id).items;
});

const messageLoading = computed(() => {
  const id = activeConversationId.value;
  if (!id) return false;
  return messageStateOf(id).loading;
});

const activeStreamingMessageId = computed<string | null>(() => {
  for (const m of messages.value) {
    if (isAiMessage(m) && isStreamingMessage(m.documentId)) return m.documentId;
  }
  return null;
});

const isStreaming = computed(() => activeStreamingMessageId.value !== null);

const latestReasoningMessage = computed<DmMessage | null>(() => {
  const list = messages.value;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m) continue;
    if (isAiMessage(m) && (m.workflow?.length || workflowEventsOf(m.documentId).length)) {
      return m;
    }
  }
  return null;
});

function isAiMessage(msg: DmMessage): boolean {
  const uid = msg.sender?.userId;
  if (msg.sender?.isAiAgent === true) return true;
  return typeof uid === "number" && aiPeerUserIds.value.has(uid);
}

function isMine(msg: DmMessage): boolean {
  return selfUserId.value != null && msg.sender?.userId === selfUserId.value;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function shouldShowTime(index: number): boolean {
  if (index === 0) return true;
  const list = messages.value;
  const curr = list[index];
  const prev = list[index - 1];
  if (!curr || !prev) return false;
  const gap = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime();
  return gap > 5 * 60 * 1000;
}

function workflowFor(msg: DmMessage) {
  const live = workflowEventsOf(msg.documentId);
  if (live.length) return live;
  return msg.workflow ?? [];
}

function stepsFor(msg: DmMessage): WorkflowStepView[] {
  return buildWorkflowSteps(workflowFor(msg));
}

function citationsFor(msg: DmMessage) {
  return extractCitations(workflowFor(msg));
}

function onOpenPost(documentId: string) {
  postModal.open(documentId);
}

function scrollToBottom() {
  nextTick(() => {
    const el = messagesRef.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  });
}

function onScroll() {
  const el = messagesRef.value;
  if (!el) return;
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  wasNearBottom.value = near;
  backToBottomVisible.value = !near && isStreaming.value;
}

watch(messages, () => {
  if (wasNearBottom.value) scrollToBottom();
});

watch(activeConversationId, (id) => {
  if (!id) return;
  ensureMessages(id).then(() => {
    wasNearBottom.value = true;
    scrollToBottom();
  });
});

function selectCharacter(card: AiRoleCard) {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  activeCharacterSlug.value = card.slug;
  activeConversationId.value = null;
  const list = sessions.value;
  if (list.length) {
    activeConversationId.value = list[0]!.documentId;
  } else {
    void createSession();
  }
}

async function createSession() {
  const uid = activeCard.value?.boundUser?.id;
  if (!uid || creatingSession.value) return;
  creatingSession.value = true;
  try {
    const summary = await createAiSession(uid);
    activeConversationId.value = summary.documentId;
  } finally {
    creatingSession.value = false;
  }
}

async function deleteSession(id: string) {
  if (deletingSessionId.value) return;
  deletingSessionId.value = id;
  try {
    await deleteConversation(id);
    if (activeConversationId.value === id) {
      const remaining = sessions.value.filter((s) => s.documentId !== id);
      activeConversationId.value = remaining[0]?.documentId ?? null;
    }
  } finally {
    deletingSessionId.value = null;
  }
}

function startEditTitle(conv: DmConversationSummary) {
  editingTitleId.value = conv.documentId;
  editingTitle.value = conv.title || conv.peer?.name || "新会话";
}

async function saveEditTitle(id: string) {
  const title = editingTitle.value.trim();
  if (!title) return;
  await updateConversation(id, { title });
  editingTitleId.value = null;
}

async function send() {
  const text = draft.value.trim();
  if (!text) return;
  const id = activeConversationId.value;
  if (!id) return;
  draft.value = "";
  composerAutoGrow();
  try {
    await sendMessage(id, { content: text });
    wasNearBottom.value = true;
    scrollToBottom();
  } catch {
    // TODO: toast
  }
}

function stop() {
  const id = activeStreamingMessageId.value;
  if (id) stopAiStream(id);
}

function onComposerKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter") return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  if (isStreaming.value) stop();
  else send();
}

function composerAutoGrow() {
  const el = composerRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function openReasoning(msg: DmMessage) {
  if (reasoningMessageId.value === msg.documentId && showReasoningSidebar.value) {
    showReasoningSidebar.value = false;
    return;
  }
  reasoningMessageId.value = msg.documentId;
  showReasoningSidebar.value = true;
}

const reasoningTargetMessage = computed<DmMessage | null>(() => {
  if (!reasoningMessageId.value) return null;
  return messages.value.find((m) => m.documentId === reasoningMessageId.value) ?? null;
});

const reasoningTargetSteps = computed<WorkflowStepView[]>(() => {
  if (!reasoningTargetMessage.value) return [];
  return stepsFor(reasoningTargetMessage.value);
});

onMounted(() => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  startStream();
  void refresh();
  void refreshAiCharacters().then(() => {
    const slug = route.query.character as string | undefined;
    const sessionId = route.query.session as string | undefined;
    if (sessionId) {
      const conv = allConversations.value.find((c) => c.documentId === sessionId);
      const card = conv
        ? aiCards.value.find((c) => c.boundUser?.id === conv.peer?.userId)
        : null;
      activeCharacterSlug.value = card?.slug ?? aiCards.value[0]?.slug ?? null;
      activeConversationId.value = sessionId;
    } else if (slug) {
      const card = aiCards.value.find((c) => c.slug === slug);
      if (card) selectCharacter(card);
    } else {
      activeCharacterSlug.value = aiCards.value[0]?.slug ?? null;
      const uid = activeCard.value?.boundUser?.id;
      if (uid) {
        const first = allConversations.value.find((c) => c.peer?.userId === uid);
        activeConversationId.value = first?.documentId ?? null;
      }
    }
  });
});

onBeforeUnmount(() => {
  stopStream();
});

function goHome() {
  router.push("/").catch(() => undefined);
}

function cardAvatarUrl(card: AiRoleCard): string | null {
  return card.avatar ?? card.boundUser?.avatar ?? null;
}

function conversationPreview(conv: DmConversationSummary): string {
  const last = conv.lastMessage;
  if (!last) return "暂无消息";
  return last.content || "[图片]";
}

function formatSessionTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
</script>

<template>
  <div class="ai-chat">
    <aside class="ai-chat__sidebar">
      <div class="ai-chat__brand">
        <button class="ai-chat__back" @click="goHome">
          <ArrowLeftIcon class="ai-chat__icon" />
        </button>
        <span class="ai-chat__brand-text">AI Chat</span>
      </div>

      <button
        type="button"
        class="ai-chat__new-session-btn"
        :disabled="!activeCard || creatingSession"
        @click="createSession"
      >
        <PlusIcon class="ai-chat__icon" />
        <span>新建会话</span>
      </button>

      <div class="ai-chat__section-title">角色</div>
      <div class="ai-chat__characters">
        <button
          v-for="card in aiCards"
          :key="card.slug"
          class="ai-chat__character"
          :class="{ active: activeCharacterSlug === card.slug }"
          @click="selectCharacter(card)"
        >
          <img
            v-if="cardAvatarUrl(card)"
            :src="cardAvatarUrl(card)!"
            class="ai-chat__character-avatar"
            alt=""
          />
          <span v-else class="ai-chat__character-avatar ai-chat__character-avatar--fallback">
            {{ (card.displayName || card.slug || "?")[0] }}
          </span>
          <span class="ai-chat__character-name">{{ card.displayName || card.slug }}</span>
        </button>
      </div>

      <div class="ai-chat__section-header">
        <span class="ai-chat__section-title">会话</span>
        <button class="ai-chat__icon-btn" :disabled="creatingSession" @click="createSession">
          <PlusIcon class="ai-chat__icon" />
        </button>
      </div>

      <div class="ai-chat__sessions">
        <div v-if="!sessions.length" class="ai-chat__empty">选择一个角色开始</div>
        <div
          v-for="conv in sessions"
          :key="conv.documentId"
          class="ai-chat__session"
          :class="{ active: activeConversationId === conv.documentId }"
          @click="activeConversationId = conv.documentId"
        >
          <div class="ai-chat__session-main">
            <span class="ai-chat__session-title">
              <template v-if="editingTitleId === conv.documentId">
                <input
                  v-model="editingTitle"
                  class="ai-chat__title-input"
                  @keydown.enter="saveEditTitle(conv.documentId)"
                  @blur="saveEditTitle(conv.documentId)"
                  @click.stop
                />
              </template>
              <template v-else>{{ conv.title || conv.peer?.name || "新会话" }}</template>
            </span>
            <span class="ai-chat__session-preview">{{ conversationPreview(conv) }}</span>
          </div>
          <div class="ai-chat__session-meta">
            <span class="ai-chat__session-time">{{ formatSessionTime(conv.lastMessageAt) }}</span>
            <button class="ai-chat__icon-btn ai-chat__icon-btn--small" @click.stop="startEditTitle(conv)">
              <PencilIcon class="ai-chat__icon" />
            </button>
            <button class="ai-chat__icon-btn ai-chat__icon-btn--small" @click.stop="deleteSession(conv.documentId)">
              <TrashIcon class="ai-chat__icon" />
            </button>
          </div>
        </div>
      </div>
    </aside>

    <main class="ai-chat__main">
      <header class="ai-chat__header">
        <div class="ai-chat__header-left">
          <button v-if="activeCard" class="ai-chat__header-avatar" @click="goHome">
            <img v-if="cardAvatarUrl(activeCard)" :src="cardAvatarUrl(activeCard)!" alt="" />
            <span v-else class="ai-chat__header-avatar-fallback">{{ (activeCard.displayName || activeCard.slug || "?")[0] }}</span>
          </button>
          <div v-if="activeSession" class="ai-chat__header-info">
            <span class="ai-chat__header-title">{{ activeSession.title || activeSession.peer?.name || "新会话" }}</span>
            <span v-if="activeCard" class="ai-chat__header-sub">{{ activeCard.displayName }}</span>
          </div>
          <div v-else class="ai-chat__header-info">
            <span class="ai-chat__header-title">AI Chat</span>
          </div>
        </div>

        <button
          v-if="latestReasoningMessage"
          type="button"
          class="ai-chat__header-action"
          :class="{ active: showReasoningSidebar }"
          title="查看推理过程"
          @click="openReasoning(latestReasoningMessage)"
        >
          <SparklesIcon class="ai-chat__icon" />
          <span>推理</span>
        </button>
      </header>

      <div ref="messagesRef" class="ai-chat__messages" @scroll="onScroll">
        <div v-if="messageLoading && !messages.length" class="ai-chat__center">加载中…</div>
        <div v-else-if="!messages.length" class="ai-chat__welcome">
          <div class="ai-chat__welcome-title">有什么可以帮你？</div>
          <div class="ai-chat__welcome-hint">下方输入框发送消息，AI 会实时展示思考与工具调用过程。</div>
        </div>

        <template v-for="(msg, idx) in messages" :key="msg.documentId">
          <div v-if="shouldShowTime(idx)" class="ai-chat__time">{{ formatTime(msg.createdAt) }}</div>

          <div
            class="ai-chat__row"
            :class="{ 'is-user': isMine(msg), 'is-ai': !isMine(msg) }"
          >
            <div v-if="!isMine(msg)" class="ai-chat__avatar">
              <img
                v-if="msg.sender?.avatar"
                :src="msg.sender.avatar"
                alt=""
              />
              <span v-else class="ai-chat__avatar-fallback">{{ (msg.sender?.name || "AI")[0] }}</span>
            </div>

            <div class="ai-chat__bubble-col" :class="{ 'is-user': isMine(msg), 'is-ai': !isMine(msg) }">
              <AiReasoningBlock
                v-if="isAiMessage(msg) && (msg.workflow?.length || workflowEventsOf(msg.documentId).length || isStreamingMessage(msg.documentId))"
                :msg="msg"
                :streaming="isStreamingMessage(msg.documentId)"
                @open-sidebar="openReasoning"
              />

              <div class="ai-chat__bubble" :class="{ 'is-user': isMine(msg), 'is-ai': !isMine(msg) }">
                <AiMessageBody
                  v-if="isAiMessage(msg) && !msg.deletedAt"
                  :text="msg.content || ''"
                  :streaming="isStreamingMessage(msg.documentId)"
                  @open-post="onOpenPost"
                />
                <span v-else-if="msg.deletedAt">消息已撤回</span>
                <span v-else>{{ msg.content }}</span>
              </div>

              <div v-if="citationsFor(msg).length" class="ai-chat__citations">
                <span class="ai-chat__citations-label">参考：</span>
                <button
                  v-for="cite in citationsFor(msg)"
                  :key="cite.documentId"
                  class="ai-chat__citation"
                  @click="onOpenPost(cite.documentId)"
                >
                  {{ cite.title }}
                </button>
              </div>
            </div>

          </div>
        </template>

        <button
          v-if="backToBottomVisible"
          class="ai-chat__back-to-bottom"
          @click="scrollToBottom"
        >
          回到底部
        </button>
      </div>

      <div class="ai-chat__composer">
        <div class="ai-chat__composer-inner">
          <button type="button" class="ai-chat__composer-plus" title="添加附件">
            <PlusIcon class="ai-chat__icon" />
          </button>
          <textarea
            ref="composerRef"
            v-model="draft"
            class="ai-chat__textarea"
            rows="1"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            :disabled="!activeConversationId"
            @input="composerAutoGrow"
            @keydown="onComposerKeydown"
          />
          <button
            v-if="isStreaming"
            class="ai-chat__send-btn ai-chat__send-btn--stop"
            @click="stop"
          >
            <StopIcon class="ai-chat__send-icon" />
          </button>
          <button
            v-else
            class="ai-chat__send-btn"
            :disabled="!draft.trim() || !activeConversationId"
            @click="send"
          >
            <PaperAirplaneIcon class="ai-chat__send-icon" />
          </button>
        </div>
      </div>
    </main>

    <aside
      v-if="showReasoningSidebar && reasoningTargetMessage"
      class="ai-chat__reasoning-sidebar"
    >
      <div class="ai-chat__reasoning-sidebar-head">
        <span>推理过程</span>
        <button class="ai-chat__icon-btn" @click="showReasoningSidebar = false">
          <XMarkIcon class="ai-chat__icon" />
        </button>
      </div>
      <div class="ai-chat__reasoning-sidebar-body">
        <AiReasoningTimeline :steps="reasoningTargetSteps" />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.ai-chat {
  display: flex;
  height: 100vh;
  height: 100dvh;
  background: #0a0a0a;
  color: #e8e8e8;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.ai-chat__sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: #111111;
}

.ai-chat__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 10px;
}

.ai-chat__back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #e8e8e8;
  cursor: pointer;
}

.ai-chat__back:hover {
  background: rgba(255, 255, 255, 0.12);
}

.ai-chat__brand-text {
  font-weight: 700;
  font-size: 16px;
}

.ai-chat__new-session-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 10px 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  background: transparent;
  color: #b8b8b8;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 120ms ease;
}

.ai-chat__new-session-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  color: #e8e8e8;
}

.ai-chat__new-session-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.ai-chat__section-title {
  padding: 12px 14px 6px;
  font-size: 12px;
  font-weight: 600;
  color: #9a9a9a;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.ai-chat__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 8px;
}

.ai-chat__characters {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 10px;
}

.ai-chat__character {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 0;
  background: transparent;
  color: #e8e8e8;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

.ai-chat__character:hover,
.ai-chat__character.active {
  background: rgba(191, 255, 9, 0.12);
}

.ai-chat__character-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  background: #2a2a2a;
}

.ai-chat__character-avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #111;
  background: #bfff09;
}

.ai-chat__character-name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-chat__sessions {
  flex: 1;
  overflow-y: auto;
  padding: 4px 10px 12px;
}

.ai-chat__empty {
  padding: 20px 12px;
  color: #9a9a9a;
  font-size: 13px;
  text-align: center;
}

.ai-chat__session {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 120ms ease;
}

.ai-chat__session:hover,
.ai-chat__session.active {
  background: rgba(255, 255, 255, 0.06);
}

.ai-chat__session-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ai-chat__session-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #e8e8e8;
}

.ai-chat__session-preview {
  font-size: 12px;
  color: #9a9a9a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-chat__session-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 120ms ease;
}

.ai-chat__session:hover .ai-chat__session-meta {
  opacity: 1;
}

.ai-chat__session-time {
  font-size: 11px;
  color: #6a6a6a;
}

.ai-chat__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #9a9a9a;
  cursor: pointer;
}

.ai-chat__icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e8e8e8;
}

.ai-chat__icon-btn--small {
  width: 22px;
  height: 22px;
}

.ai-chat__icon {
  width: 18px;
  height: 18px;
}

.ai-chat__title-input {
  width: 100%;
  padding: 2px 4px;
  border: 1px solid rgba(191, 255, 9, 0.5);
  border-radius: 4px;
  background: #0a0a0a;
  color: #e8e8e8;
  font-size: 13px;
}

.ai-chat__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #0a0a0a;
}

.ai-chat__header {
  flex-shrink: 0;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ai-chat__header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ai-chat__header-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  border: 0;
  padding: 0;
  background: #2a2a2a;
  cursor: pointer;
  flex-shrink: 0;
}

.ai-chat__header-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ai-chat__header-avatar-fallback {
  width: 100%;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #111;
  background: #bfff09;
}

.ai-chat__header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ai-chat__header-title {
  font-weight: 700;
  font-size: 15px;
  color: #e8e8e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-chat__header-sub {
  font-size: 12px;
  color: #9a9a9a;
}

.ai-chat__header-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: #9a9a9a;
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 120ms ease;
}

.ai-chat__header-action:hover,
.ai-chat__header-action.active {
  background: rgba(191, 255, 9, 0.12);
  border-color: rgba(191, 255, 9, 0.25);
  color: #bfff09;
}

.ai-chat__messages {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  scroll-behavior: smooth;
  position: relative;
}

.ai-chat__center {
  margin: auto;
  color: #9a9a9a;
  font-size: 14px;
}

.ai-chat__welcome {
  margin: auto;
  text-align: center;
  max-width: 420px;
  color: #9a9a9a;
}

.ai-chat__welcome-title {
  font-size: 22px;
  font-weight: 700;
  color: #e8e8e8;
  margin-bottom: 10px;
}

.ai-chat__welcome-hint {
  font-size: 14px;
  line-height: 1.55;
}

.ai-chat__time {
  align-self: center;
  font-size: 11px;
  color: #6a6a6a;
  padding: 4px 10px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
}

.ai-chat__row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  max-width: 820px;
  width: 100%;
  margin: 0 auto;
}

.ai-chat__row.is-user {
  flex-direction: row-reverse;
  justify-content: flex-start;
}

.ai-chat__row.is-ai {
  justify-content: flex-start;
}

.ai-chat__avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: #2a2a2a;
}

.ai-chat__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ai-chat__avatar-fallback {
  width: 100%;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #111;
  background: #bfff09;
}

.ai-chat__avatar--user .ai-chat__avatar-fallback {
  background: #2c58e2;
  color: #fff;
}

.ai-chat__bubble-col {
  max-width: min(720px, 84%);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ai-chat__bubble {
  padding: 12px 16px;
  border-radius: 18px;
  line-height: 1.55;
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-chat__bubble.is-user {
  background: #2c58e2;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.ai-chat__bubble.is-ai {
  background: #1a1a1a;
  color: #e8e8e8;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom-left-radius: 4px;
}

.ai-chat__citations {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: #9a9a9a;
}

.ai-chat__citations-label {
  flex-shrink: 0;
}

.ai-chat__citation {
  padding: 3px 8px;
  border-radius: 12px;
  border: 0;
  background: rgba(191, 255, 9, 0.12);
  color: #bfff09;
  font-size: 12px;
  cursor: pointer;
}

.ai-chat__citation:hover {
  background: rgba(191, 255, 9, 0.22);
}

.ai-chat__composer {
  flex-shrink: 0;
  padding: 14px 20px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.ai-chat__composer-inner {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: 760px;
  margin: 0 auto;
  padding: 8px 10px;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #111111;
}

.ai-chat__composer-plus {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 0;
  background: transparent;
  color: #9a9a9a;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 120ms ease;
}

.ai-chat__composer-plus:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #e8e8e8;
}

.ai-chat__textarea {
  flex: 1;
  max-height: 220px;
  min-height: 24px;
  padding: 10px 8px;
  border: 0;
  background: transparent;
  color: #e8e8e8;
  font-size: 15px;
  line-height: 1.5;
  resize: none;
  outline: none;
  field-sizing: content;
}

.ai-chat__textarea::placeholder {
  color: #6a6a6a;
}

.ai-chat__send-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 0;
  background: #bfff09;
  color: #111;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 120ms ease;
}

.ai-chat__send-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.ai-chat__send-btn--stop {
  background: #ff4d4f;
  color: #fff;
}

.ai-chat__send-icon {
  width: 18px;
  height: 18px;
}

.ai-chat__back-to-bottom {
  position: absolute;
  bottom: 90px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 20px;
  border: 0;
  background: rgba(44, 88, 226, 0.9);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

.ai-chat__reasoning-sidebar {
  width: 360px;
  flex-shrink: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  background: #111111;
  display: flex;
  flex-direction: column;
}

.ai-chat__reasoning-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-weight: 700;
  font-size: 15px;
}

.ai-chat__reasoning-sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

@media (max-width: 1024px) {
  .ai-chat__reasoning-sidebar {
    position: fixed;
    inset: 0;
    width: 100vw;
    z-index: 100;
  }
}

@media (max-width: 768px) {
  .ai-chat__sidebar {
    position: fixed;
    inset: 0;
    width: 100vw;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
  }

  .ai-chat__sidebar.is-open {
    transform: translateX(0);
  }

  .ai-chat__bubble-col {
    max-width: 88%;
  }
}
</style>
