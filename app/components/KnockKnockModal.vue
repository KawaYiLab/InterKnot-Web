<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import {
  PhoneIcon,
  UserIcon,
  UserGroupIcon,
  ChatBubbleLeftIcon,
} from "@heroicons/vue/24/solid";
import {
  ChevronLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import type { AiRoleCard, DmConversationSummary, DmMessage } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import { stripMentionsToPlain } from "~/utils/mention";
import { stripEmotesToPlain } from "~/utils/emote";
import { extractCitations, extractRelatedPosts, isWorkflowSettled } from "~/utils/workflow";
import type { BubbleRender, EnrichedMessage } from "~/utils/dm-view";
import type DmComposer from "~/components/DmComposer.vue";

const {
  visible,
  close,
  clearHistoryPushed,
  consumePendingDmConversationId,
  consumePendingKnockTab,
  updateUrl,
} = useKnockKnockModal();
const auth = useAuthStore();
const postModal = usePostModal();
const loginDialog = useLoginDialog();
const { characters: aiCharacters, loading: aiCharactersLoading, error: aiCharactersError, refresh: refreshAiCharacters } = useAiCharacters();
const {
  displayText: aiDisplayText,
  startReveal: startAiReveal,
  primeCompleted: primeAiRevealCompleted,
  resetSession: resetAiRevealSession,
  revealTick: aiRevealTick,
  isComplete: isAiRevealComplete,
} = useAiDmTypewriter();

/** 打开会话时已有的消息 id；不在此集合内的 AI 新消息才打字机 */
const historyBaselineIds = ref(new Set<string>());
const aiRevealSessionReady = ref(false);

/** 顶部 tab：通话 / 私聊 / 群聊（未来占位） */
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
  sendMessage,
  editMessage,
  withdrawMessage,
  /** 当前选中的会话 documentId（共享自 composable；null 表示右栏显示 EMPTY 占位） */
  activeConversationId,
  typingByConversation,
  sendTyping,
  startStream,
  stopStream,
  createAiSession,
  deleteConversation,
  isStreamingMessage,
  stopAiStream,
  regenerateAiReply,
  workflowEventsOf,
} = useDmConversations();

const AI_SLUG_STORAGE_KEY = "ik-knock-ai-slug";
const activeAiSlug = ref<string | null>(null);
/** 弹窗打开后 DM 列表 + AI 角色列表均就绪，再渲染私聊 Tab（避免 fairy 闪一下） */
const knockBootstrapDone = ref(false);

const isOfficialAiPeer = (conv: DmConversationSummary): boolean => {
  if (conv.peer?.isAiAgent === true) return true;
  const uid = conv.peer?.userId;
  return typeof uid === "number" && aiPeerUserIds.value.has(uid);
};

/** 当前登录用户的 user.id；用于区分消息气泡是「我发的」还是「对方发的」 */
const selfUserId = computed<number | null>(() => {
  const id = auth.user?.id;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return null;
});

/** 弹窗打开：拉会话列表 + 开 WS；关闭：清空选中 + 关 WS */
watch(visible, async (next) => {
  if (!next) {
    const closingId = activeConversationId.value;
    if (closingId) {
      void markConversationAsRead(closingId, { force: true });
    }
    activeTab.value = "contacts";
    activeAiSlug.value = null;
    activeConversationId.value = null;
    knockBootstrapDone.value = false;
    aiRevealSessionReady.value = false;
    historyBaselineIds.value = new Set();
    stopStream();
    return;
  }
  activeTab.value = "contacts";
  activeAiSlug.value = null;
  activeConversationId.value = null;
  knockBootstrapDone.value = false;
  aiRevealSessionReady.value = false;
  historyBaselineIds.value = new Set();
  // 拉列表 + 起 WS（startStream 内部对 SSR / 未登录都做了护栏）
  startStream();
  await Promise.all([refresh(), refreshAiCharacters()]);
  knockBootstrapDone.value = true;
  // 若是由 UserHoverCard「私信」打开，定位到指定会话
  const pendingDm = consumePendingDmConversationId();
  if (pendingDm) {
    const conv = allConversations.value.find((c) => c.documentId === pendingDm);
    const peerUid = conv?.peer?.userId;
    const aiCard =
      typeof peerUid === "number"
        ? aiCharacters.value.find((c) => c.boundUser?.id === peerUid)
        : undefined;
    if (conv && (conv.peer?.isAiAgent || aiCard)) {
      activeTab.value = "calls";
      activeAiSlug.value = aiCard?.slug ?? null;
      activeConversationId.value = pendingDm;
      updateUrl("calls", pendingDm);
      return;
    }
    activeTab.value = "contacts";
    activeConversationId.value = pendingDm;
    updateUrl("contacts", pendingDm);
    return;
  }
  const pendingTab = consumePendingKnockTab();
  if (pendingTab === "calls") {
    activeTab.value = "calls";
    await openCallsTab();
  }
});

/** 官方 AI 绑定的 userId（私聊 Tab 中隐藏，仅在「通话」展示） */
const aiPeerUserIds = computed(() => {
  const ids = new Set<number>();
  for (const card of aiCharacters.value) {
    const uid = card.boundUser?.id;
    if (typeof uid === "number") ids.add(uid);
  }
  return ids;
});

/** 私聊 Tab 列表是否仍在首屏加载（未就绪时不渲染会话项，防闪烁） */
const contactsListLoading = computed(
  () => !knockBootstrapDone.value || isLoading.value || aiCharactersLoading.value,
);

/**
 * 私聊 Tab：排除与官方 AI 角色的 direct 会话（避免与「通话」重复）。
 */
const conversations = computed<DmConversationSummary[]>(() => {
  if (activeTab.value !== "contacts" || contactsListLoading.value) return [];
  return allConversations.value.filter((c) => !isOfficialAiPeer(c));
});

const activeConversation = computed<DmConversationSummary | null>(() => {
  if (!activeConversationId.value) return null;
  return allConversations.value.find((c) => c.documentId === activeConversationId.value) ?? null;
});

/** 当前会话是否为官方 AI 角色（决定是否显示会话管理按钮） */
const isActiveAiConversation = computed<boolean>(() => {
  const conv = activeConversation.value;
  if (!conv) return false;
  const uid = conv.peer?.userId;
  return conv.peer?.isAiAgent === true || (typeof uid === "number" && aiPeerUserIds.value.has(uid));
});

/** 当前选中的 AI 角色卡（从 slug 或当前会话反推） */
const activeAiCard = computed<AiRoleCard | null>(() => {
  if (activeAiSlug.value) {
    return aiCharacters.value.find((c) => c.slug === activeAiSlug.value) ?? null;
  }
  const conv = activeConversation.value;
  const uid = conv?.peer?.userId;
  if (typeof uid === "number") {
    return aiCharacters.value.find((c) => c.boundUser?.id === uid) ?? null;
  }
  return null;
});

/** 当前 AI 角色的全部会话，按 lastMessageAt 降序 */
const aiSessionsForActiveCard = computed<DmConversationSummary[]>(() => {
  const card = activeAiCard.value;
  const uid = card?.boundUser?.id;
  if (typeof uid !== "number") return [];
  return allConversations.value
    .filter((c) => c.peer?.userId === uid)
    .sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
});

const creatingAiSession = ref(false);
const deletingSessionId = ref<string | null>(null);

/**
 * 对端个人主页 URL（不可跳转时为 null）。
 * 判断条件（非 AI、有 authorDocumentId）在此唯一维护，
 * canClickPeerProfile 从它派生，避免两处重复判断逻辑不同步。
 */
const peerProfileUrl = computed<string | null>(() => {
  const peer = activeConversation.value?.peer;
  if (!peer?.authorDocumentId || peer.isAiAgent) return null;
  return `/profile/${peer.authorDocumentId}`;
});

/** 当前会话对端是否可跳转个人主页——从 peerProfileUrl 派生 */
const canClickPeerProfile = computed<boolean>(() => peerProfileUrl.value !== null);

/** 通话 Tab：按 AI boundUserId 汇总该角色所有会话的未读 */
const aiUnreadByUserId = computed(() => {
  const map = new Map<number, number>();
  for (const c of allConversations.value) {
    const uid = c.peer?.userId;
    if (typeof uid === "number") {
      map.set(uid, (map.get(uid) ?? 0) + (c.unreadCount ?? 0));
    }
  }
  return map;
});

const aiCharacterRows = computed(() =>
  aiCharacters.value.map((card) => {
    const uid = card.boundUser?.id;
    const unread =
      typeof uid === "number" ? (aiUnreadByUserId.value.get(uid) ?? 0) : 0;
    return { card, unread };
  }),
);

const cardAvatarUrl = (card: AiRoleCard): string | null => {
  const raw = card.avatar || card.boundUser?.avatar;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
};

/** 选择 AI 角色：自动打开最近会话；没有则新建 */
const selectAiCharacter = async (card: AiRoleCard) => {
  const uid = card.boundUser?.id;
  if (!uid) return;
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  activeAiSlug.value = card.slug;
  if (import.meta.client) {
    localStorage.setItem(AI_SLUG_STORAGE_KEY, card.slug);
  }
  const sessions = aiSessionsForActiveCard.value.filter((s) => s.peer?.userId === uid);
  const first = sessions[0];
  if (first) {
    activeConversationId.value = first.documentId;
    updateUrl("calls", first.documentId);
  } else {
    await createNewAiSession();
  }
};

/** 为当前 AI 角色新建一个独立会话 */
const createNewAiSession = async () => {
  const card = activeAiCard.value;
  const uid = card?.boundUser?.id;
  if (!uid || creatingAiSession.value) return;
  creatingAiSession.value = true;
  try {
    const summary = await createAiSession(uid);
    if (card) activeAiSlug.value = card.slug;
    activeConversationId.value = summary.documentId;
    updateUrl("calls", summary.documentId);
  } finally {
    creatingAiSession.value = false;
  }
};

/** 从会话列表返回 AI 角色选择 */
const backToAiCharacters = () => {
  activeAiSlug.value = null;
  activeConversationId.value = null;
  updateUrl("calls");
};

/** 删除指定 AI 会话 */
const deleteAiSession = async (id: string) => {
  if (!id || deletingSessionId.value === id) return;
  if (!confirm("确定删除该会话？历史消息将不再出现在列表中。")) return;
  deletingSessionId.value = id;
  try {
    await deleteConversation(id);
    if (activeConversationId.value === id) {
      const remaining = aiSessionsForActiveCard.value.filter((s) => s.documentId !== id);
      const next = remaining[0];
      if (next) {
        activeConversationId.value = next.documentId;
        updateUrl("calls", next.documentId);
      } else {
        activeConversationId.value = null;
        updateUrl("calls");
      }
    }
  } finally {
    deletingSessionId.value = null;
  }
};

const openCallsTab = async () => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  if (!aiCharacters.value.length && !aiCharactersLoading.value) {
    await refreshAiCharacters();
  }
  activeConversationId.value = null;
  activeAiSlug.value = null;
  updateUrl("calls");
};

/**
 * 当前激活会话是否禁止发送消息：
 *  - pseudo:anonymous（匿名通知）：对端没有真实身份，无法回复
 *  - pseudo:system（系统通知）：单向通知，不可回复
 *  - pseudo:user：可发，发出去的瞬间会 lazy 实质化为真 DM（见 useDmConversations.sendMessage）
 */
const composerDisabled = computed<boolean>(() => {
  const conv = activeConversation.value;
  if (!conv) return true;
  return conv.pseudoKind === "anonymous" || conv.pseudoKind === "system";
});

/** 对端是否正在输入：当前会话的 typing 用户列表非空且不含自己 */
const peerIsTyping = computed<boolean>(() => {
  const cid = activeConversationId.value;
  if (!cid) return false;
  const list = typingByConversation.value[cid];
  if (!list || list.length === 0) return false;
  const self = selfUserId.value;
  return list.some((uid) => uid !== self);
});

/** 节流发送 typing 状态：2s 内最多触发一次（DmComposer @typing 触发） */
let typingThrottleLast = 0;
let typingThrottleTimer: ReturnType<typeof setTimeout> | null = null;
const handleComposerTyping = () => {
  const cid = activeConversationId.value;
  if (!cid) return;
  const now = Date.now();
  const remaining = 2000 - (now - typingThrottleLast);
  if (remaining <= 0) {
    typingThrottleLast = now;
    sendTyping(cid);
  } else if (!typingThrottleTimer) {
    typingThrottleTimer = setTimeout(() => {
      typingThrottleTimer = null;
      const currentCid = activeConversationId.value;
      if (currentCid) {
        typingThrottleLast = Date.now();
        sendTyping(currentCid);
      }
    }, remaining);
  }
};

/** 输入框 placeholder：根据 pseudoKind 给出更精确的提示 */
const composerPlaceholder = computed<string>(() => {
  const conv = activeConversation.value;
  if (!conv) return "";
  if (conv.pseudoKind === "anonymous") return "匿名用户的通知不可回复";
  if (conv.pseudoKind === "system") return conv.peer?.name ? `${conv.peer.name} 不可回复` : "系统通知不可回复";
  if (conv.pseudoKind === "user") return "发送将开启与该用户的私聊";
  return "输入消息，Enter 发送，Shift+Enter 换行";
});

/**
 * 当前会话的消息状态——一次 computed 复用给下面 activeMessages /
 * activeMessageLoading，避免多次访问 messageStateOf 工厂在响应式上下文
 * 反复创建对象。
 */
const activeMessageState = computed(() => {
  const id = activeConversationId.value;
  if (!id) return null;
  return messageStateOf(id);
});

/**
 * 当前会话的消息流（createdAt asc）。消息由 ensureMessages(id) 懒加载到
 * composable 内部缓存；WS 事件到达时按 documentId 去重合并。
 */
const activeMessages = computed<DmMessage[]>(
  () => activeMessageState.value?.items ?? [],
);

/** 右栏 loading 占位用：当前会话首次加载消息中且本地尚无缓存 */
const activeMessageLoading = computed<boolean>(() => {
  const s = activeMessageState.value;
  return !!s && s.loading && !s.hydrated;
});

/** 单条消息是否是我自己发的（通知类永远不是「我自己发的」，因此一直靠左） */
const isMine = (msg: DmMessage): boolean => {
  if (msg.kind === "notification") return false;
  const uid = selfUserId.value;
  return uid != null && msg.sender?.userId === uid;
};

/**
 * 气泡正文如何渲染：
 * - 通知 + comment/reply/mention + 有评论原文 → 走 CommentBody，做 @mention 高亮
 * - 其它一律 plain string（普通 DM 消息正文 / 通知预渲染文案）
 *
 * 返回值约定：
 *  - 字符串：直接 {{ }} 出
 *  - { mode: "rich", content } → 走 <CommentBody>
 *（类型定义随 Phase 4 拆分移至 ~/utils/dm-view.ts）
 */
const bubbleText = (msg: DmMessage): BubbleRender => {
  if (msg.deletedAt) return "消息已撤回";
  if (msg.kind === "notification") {
    const k = msg.notificationKind;
    // 评论 / 回复 / @提到：评论原文里可能含 @[name](id) token，让 CommentBody 渲染高亮
    if ((k === "comment" || k === "reply" || k === "mention") && msg.comment?.content) {
      return { mode: "rich", content: msg.comment.content };
    }
    // 互动类（like / favorite / denny / system）→ 走后端预渲染的 plain content
  }
  return msg.content ?? "";
};

/** 与官方 AI 私聊（通话 Tab 绑定的 fairy 等） */
const isAiPeerConversation = computed(() => {
  const conv = activeConversation.value;
  if (!conv) return false;
  if (conv.peer?.isAiAgent === true) return true;
  const uid = conv.peer?.userId;
  return typeof uid === "number" && aiPeerUserIds.value.has(uid);
});

const shouldAnimateAiMessage = (msg: DmMessage): boolean => {
  if (!aiRevealSessionReady.value || !isAiPeerConversation.value) return false;
  if (isMine(msg) || msg.kind !== "text" || msg.deletedAt) return false;
  // 流式消息（3.2.3）：增量本身就是逐段到达，直接展示累计文本，不再叠加打字机
  if (isStreamingMessage(msg.documentId)) return false;
  return !historyBaselineIds.value.has(msg.documentId);
};

const tryRevealNewAiMessages = () => {
  if (!aiRevealSessionReady.value || !isAiPeerConversation.value) return;
  // 基线未建立时勿扫描（消息已加载但 baseline 尚未写入会误伤历史）
  if (historyBaselineIds.value.size === 0) return;
  for (const msg of activeMessages.value) {
    if (historyBaselineIds.value.has(msg.documentId)) continue;
    if (isMine(msg) || msg.kind !== "text" || msg.deletedAt) continue;
    if (isAiRevealComplete(msg.documentId)) continue;
    // 流式消息由 message.delta 实时填充，跳过打字机扫描
    if (isStreamingMessage(msg.documentId)) continue;
    const text = msg.content?.trim();
    if (!text) continue;
    startAiReveal(msg.documentId, text);
  }
};

const bubbleTextForDisplay = (msg: DmMessage): BubbleRender => {
  const base = bubbleText(msg);
  if (typeof base !== "string") return base;
  // 流式接收中：直接展示当前累计文本
  if (isStreamingMessage(msg.documentId)) return base;
  // 打开会话时的历史消息：永远全文（不受打字机 state 影响）
  if (historyBaselineIds.value.has(msg.documentId)) return base;
  return aiDisplayText(msg.documentId, base, shouldAnimateAiMessage(msg));
};

/** 流式占位气泡：消息仍在流式中且内容尚为空（首个 delta 未到）→ 显示"正在输入"加载点 */
const isPendingStreamBubble = (msg: DmMessage): boolean =>
  isStreamingMessage(msg.documentId) && !(msg.content && msg.content.trim().length > 0);

// AI 回复内链接解析（hasBubbleLinks / parseBubbleSegments）已随
// Phase 4 拆分移至 ~/utils/dm-view.ts，由 DmMessageItem 直接消费。

const handleBubbleLink = (href: string, e: Event) => {
  e.preventDefault();
  const postMatch = href.match(/^\/post\/([a-zA-Z0-9_-]+)/);
  if (postMatch) {
    postModal.open(postMatch[1]!);
  }
};

/** AiMessageBody 内点击 /post/xxx 链接 → 打开委托弹窗 */
const openPostFromBubble = (documentId: string) => {
  postModal.open(documentId);
};

/** like-on-comment：通知关联委托+评论时，quote 卡引用「评论原文」而不是委托标题 */
const isLikeOnComment = (msg: DmMessage): boolean =>
  msg.notificationKind === "like" && !!msg.comment;

/** quote 卡左侧 label */
const quoteLabel = (msg: DmMessage): string => {
  if (isLikeOnComment(msg)) return "评论";
  if (msg.notificationKind === "like" || msg.notificationKind === "favorite" || msg.notificationKind === "denny") return "委托";
  if (msg.notificationKind === "system") return "委托";
  return "评论委托"; // comment / reply / mention：引用所在委托
};

/** quote 卡右侧主标题：like-on-comment 引用评论原文，其余引用委托标题 */
const quoteTitle = (msg: DmMessage): string => {
  // quote 卡是纯文本单行预览：mention/emote token 降级为可读文案
  if (isLikeOnComment(msg)) {
    return stripEmotesToPlain(stripMentionsToPlain(msg.comment?.content ?? ""));
  }
  return msg.article?.title ?? "";
};

/** quote 卡是否应该展示：comment/reply/mention 的主体已是评论原文，不再放卡 */
const shouldShowQuote = (msg: DmMessage): boolean => {
  if (msg.kind !== "notification") return false;
  // 有 article 引用就有卡片可点
  if (!msg.article && !msg.comment) return false;
  // comment/reply/mention：主气泡已是评论正文，再放 quote 委托卡
  // like / favorite / like-on-comment 都需要卡
  return true;
};

const goPost = (msg: DmMessage) => {
  if (!msg.article?.documentId) return;
  postModal.open(msg.article.documentId, {
    coverAspectRatio: msg.article.coverAspectRatio ?? undefined,
    preview: { title: msg.article.title },
    commentId: msg.comment?.documentId,
  });
};

/**
 * 跳转个人主页。
 * 敲敲用原生 pushState 占了一条 history，replace 掉 overlay 条目再导航，
 * 避免 navigateTo push 与 overlay 栈错位导致进度条挂起或拼出错误地址。
 * navigateTo 触发路由变化 → app.vue 的 router.beforeEach 守卫自动
 * 调用 knockModal.teardown() 关闭弹窗，无需手动 close()。
 */
const goToProfile = (profileUrl: string | null) => {
  if (!profileUrl) return;
  clearHistoryPushed();
  void navigateTo(profileUrl, { replace: true });
};

/** 列表预览文案：撤回 / 图片 / 系统 / 通知 / 正常 */
const conversationPreview = (conv: DmConversationSummary): string => {
  const last = conv.lastMessage;
  if (!last) return "";
  if (last.kind === "image") return "[图片]";
  if (last.kind === "system") return last.content || "";
  // notification 走后端预渲染的 content（"赞了你的评论" / 评论正文 等）
  return last.content || "";
};

/** 消息流容器，用于切换会话时自动滚到底部 */
const messagesRef = ref<HTMLElement | null>(null);

/**
 * 切换会话时的"沉降态"：在 DOM 渲染完成 → scrollTop 校正到底部之间，
 * 容器先 visibility: hidden，校正完成后才 visible。
 * 避免长消息流刚渲染时 paint 在顶部（默认 scrollTop=0），紧接着 rAF
 * 才滚到底部造成的"先看见最早消息一闪 → 瞬间跳底"抖动。
 */
const messagesSettling = ref(false);

/** 快照当前批量加载的消息 ID，仅增量到达的新消息才播入场动画 */
const knownMessageIds = ref(new Set<string>());

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
 * 消息头像是否可点击跳转个人主页：
 * - 有 sender 且 sender 有 authorDocumentId（匿名通知 / 系统消息无）
 * - 非 AI 代理（AI 角色无个人主页）
 */
const canClickAvatar = (msg: DmMessage): boolean => {
  if (!msg.sender) return false;
  if (!msg.sender.authorDocumentId) return false;
  if (msg.sender.isAiAgent) return false;
  return true;
};

/**
 * 一次性把每条消息的派生信息算好——避免 template v-for 内重复调用
 * isMine / bubbleText / shouldShowQuote / quoteLabel / quoteTitle 等
 * 函数。100 条消息每次 re-render 节省 ~1000 次函数调用。
 *
 * 注：依赖 activeMessages + knownMessageIds + selfUserId；任一变更 → re-eval。
 * EnrichedMessage 接口随 Phase 4 拆分定义在 ~/utils/dm-view.ts（DmMessageItem 消费）。
 */
const enrichedMessages = computed<EnrichedMessage[]>(() => {
  const list = activeMessages.value;
  const known = knownMessageIds.value;
  void aiRevealTick.value;
  return list.map((msg, idx) => {
    const avatarClickable = canClickAvatar(msg);
    const mine = isMine(msg);
    const rendered = bubbleTextForDisplay(msg);
    const aiRich =
      isAiPeerConversation.value &&
      !mine &&
      msg.kind === "text" &&
      !msg.deletedAt &&
      typeof rendered === "string";
    // 工作流事件：定稿后消息自带落库版本（权威）；流式期间读实时推送缓存
    const workflowEvents = aiRich
      ? (msg.workflow?.length ? msg.workflow : workflowEventsOf(msg.documentId))
      : [];
    return {
      msg,
      isMine: mine,
      isNew: !known.has(msg.documentId),
      showTime: shouldShowTime(idx),
      rendered,
      aiRich,
      aiStreaming:
        aiRich &&
        (isStreamingMessage(msg.documentId) ||
          (shouldAnimateAiMessage(msg) && !isAiRevealComplete(msg.documentId))),
      pendingStream: isPendingStreamBubble(msg),
      workflowEvents,
      citations:
        workflowEvents.length > 0 && isWorkflowSettled(workflowEvents)
          ? extractCitations(workflowEvents)
          : [],
      relatedPosts:
        workflowEvents.length > 0 && isWorkflowSettled(workflowEvents)
          ? extractRelatedPosts(workflowEvents)
          : [],
      copyable: canCopyMessage(msg),
      quote: shouldShowQuote(msg) && msg.article
        ? {
            label: quoteLabel(msg),
            title: quoteTitle(msg),
            article: msg.article,
          }
        : null,
      avatarClickable,
      // avatarClickable 为 true 时 canClickAvatar 已保证 authorDocumentId 存在
      profileUrl: avatarClickable
        ? `/profile/${msg.sender!.authorDocumentId}`
        : null,
    };
  });
});

/**
 * Phase 4 长会话性能：渲染窗口化。
 * 只渲染最近 renderWindow 条（含最新消息，scrollToBottom / 流式跟随不受影响），
 * 滚动到顶部附近时扩窗加载更早的消息。相比 content-visibility: auto，
 * 窗口化不会裁剪气泡操作条（absolute top:-12px 溢出）也无 findPage 复杂度。
 */
const RENDER_WINDOW_STEP = 80;
const renderWindow = ref(RENDER_WINDOW_STEP);

const visibleMessages = computed<EnrichedMessage[]>(() => {
  const list = enrichedMessages.value;
  if (list.length <= renderWindow.value) return list;
  return list.slice(list.length - renderWindow.value);
});

/** 窗口上方还有未渲染的更早消息（顶部提示条显隐） */
const hasHiddenAbove = computed(
  () => enrichedMessages.value.length > renderWindow.value,
);

/**
 * 扩窗并保持视口位置：渲染更早消息会增加 scrollHeight，
 * patch 后把增量补回 scrollTop，用户视野内的消息不跳动。
 */
const expandRenderWindow = () => {
  const el = messagesRef.value;
  if (!el) return;
  const prevHeight = el.scrollHeight;
  renderWindow.value += RENDER_WINDOW_STEP;
  nextTick(() => {
    el.scrollTop += el.scrollHeight - prevHeight;
  });
};

/** 5 分钟内自己发的、未撤回的文本消息可以编辑/撤回 */
const EDIT_WINDOW_MS = 5 * 60 * 1000;
const canModifyMessage = (msg: DmMessage): boolean => {
  if (!isMine(msg)) return false;
  if (msg.deletedAt) return false;
  if (msg.kind !== "text") return false;
  const ageMs = Date.now() - new Date(msg.createdAt).getTime();
  return ageMs < EDIT_WINDOW_MS;
};

/** 复制（1.4）：任何未撤回的非空文本消息（AI 消息复制的是原始 markdown） */
const canCopyMessage = (msg: DmMessage): boolean =>
  msg.kind === "text" && !msg.deletedAt && !!(msg.content ?? "").trim();

/**
 * 用户在切换/打开会话前是否处于"接近底部"。
 * SSE 触发的新消息只有在 wasNearBottom 时才自动滚动，
 * 否则保持用户当前的滚动位置（避免打断用户读历史）。
 * 切换会话时重置为 true（新会话默认看最新）。
 */
const NEAR_BOTTOM_THRESHOLD_PX = 80;
const wasNearBottom = ref(true);

/** 1.6 用户远离底部期间到达的新消息 → 亮起「回到底部」按钮 */
const hasUnseenBelow = ref(false);

const isNearBottom = (el: HTMLElement): boolean => {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;
};

/**
 * 滚到底部。先**同步**落一次 scrollTop，避免浏览器 paint 出 scrollTop=0
 * 的初始帧（用户会看到最早消息一闪）；再用 rAF + 200ms 兜底校正图片
 * 懒加载等异步资源完成布局后的 scrollHeight 增量。
 */
const scrollToBottom = (el: HTMLElement) => {
  const doScroll = () => {
    el.scrollTop = el.scrollHeight;
  };
  // 同步：nextTick 后 DOM 已 patch，此时 scrollHeight 即便不完全准确，
  // 也比"什么都不做让浏览器 paint 顶部"好
  doScroll();
  // 第一帧布局完成后校正（处理 paddings/margins/字体加载引起的 scrollHeight 微调）
  requestAnimationFrame(doScroll);
  // 兜底：等待图片等异步资源完成布局后再校正一次
  setTimeout(doScroll, 200);
};

/** 选中会话时：懒加载消息 → 批量 mark-read → 滚到最新消息 */
watch(activeConversationId, async (id) => {
  aiRevealSessionReady.value = false;
  historyBaselineIds.value = new Set();
  resetAiRevealSession();
  // 切换会话时关闭编辑态
  editingMessageId.value = null;
  editingDraft.value = "";
  // 渲染窗口与会话内搜索都是会话级状态 → 一并复位
  renderWindow.value = RENDER_WINDOW_STEP;
  closeDmSearch();
  if (!id) return;
  // 新会话默认看最新消息
  wasNearBottom.value = true;
  hasUnseenBelow.value = false;
  // 进入沉降态：隐藏容器直到完成首次滚到底（避免顶部 flash）
  messagesSettling.value = true;
  try {
    await ensureMessages(id);
  } catch (err) {
    sendError.value = resolveErrorMessage(err, "加载消息失败");
  }
  // 切换途中用户又点了别的会话 → 放弃后续操作，避免竞态
  if (activeConversationId.value !== id) {
    messagesSettling.value = false;
    return;
  }
  await nextTick();
  const historyIds = activeMessages.value
    .map((m) => m.documentId)
    .filter((docId): docId is string => typeof docId === "string" && docId.length > 0);
  historyBaselineIds.value = new Set(historyIds);
  knownMessageIds.value = new Set(historyIds);
  if (isAiPeerConversation.value) {
    primeAiRevealCompleted(historyIds);
  }
  await nextTick();
  aiRevealSessionReady.value = true;
  void markConversationAsRead(id, { force: true });
  nextTick(() => {
    const el = messagesRef.value;
    if (!el) {
      messagesSettling.value = false;
      return;
    }
    scrollToBottom(el);
    // 第一帧滚动校正完成后再 reveal——doScroll 同步先调一次足够把
    // scrollTop 设到当前 scrollHeight，后续 rAF / setTimeout 兜底进一步精修
    requestAnimationFrame(() => {
      messagesSettling.value = false;
    });
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
  // 自己滚回底部 → 新消息提示解除
  if (wasNearBottom.value) hasUnseenBelow.value = false;
  // 逼近顶部且窗口外还有更早消息 → 扩窗（120px 提前量，滚动不断流）
  if (el.scrollTop < 120 && hasHiddenAbove.value) {
    expandRenderWindow();
  }
};

/**
 * 消息流变化时（新消息加入 / 流式 delta 内容更新），
 * 如果用户原本靠底则跟随到底；否则仅在有新消息时亮起「回到底部」。
 */
watch(
  activeMessages,
  (next, prev) => {
    const prevLen = prev?.length ?? 0;
    const nextLen = next.length;
    if (nextLen > prevLen && !wasNearBottom.value) {
      // 用户在读历史 → 不打断，仅亮起「回到底部」（1.6）
      hasUnseenBelow.value = true;
      return;
    }
    if (!wasNearBottom.value) return;
    const el = messagesRef.value;
    if (el) scrollToBottom(el);
  },
  { flush: 'post' },
);

/** 补建历史基线：会话 watch 结束时若消息尚未写入缓存，会导致 baseline 为空 + 全员白框 */
const ensureHistoryBaselineIfNeeded = () => {
  if (!aiRevealSessionReady.value || historyBaselineIds.value.size > 0) return;
  const ids = activeMessages.value
    .map((m) => m.documentId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return;
  historyBaselineIds.value = new Set(ids);
  knownMessageIds.value = new Set(ids);
  if (isAiPeerConversation.value) {
    primeAiRevealCompleted(ids);
  }
};

/** 消息条数变化：补基线 / 新 AI 消息打字机 */
watch(
  () => activeMessages.value.length,
  (nextLen, prevLen) => {
    if (!aiRevealSessionReady.value) return;
    ensureHistoryBaselineIfNeeded();
    if (nextLen <= (prevLen ?? 0)) return;
    tryRevealNewAiMessages();
  },
);

/**
 * 流式消息不走打字机：增量已经逐字到达，bubbleTextForDisplay 直接展示累计文本。
 * 这里在它进入流式集合时立即标记 typewriter「已完成」，使其定稿后保持静态全文，
 * 避免后续新消息到来（activeMessages.length 增长）时被 tryRevealNewAiMessages 重放一遍动画。
 */
watch(
  () =>
    activeMessages.value
      .filter((m) => isStreamingMessage(m.documentId))
      .map((m) => m.documentId)
      .join(","),
  (joined) => {
    if (!joined) return;
    primeAiRevealCompleted(joined.split(","));
  },
  { immediate: true },
);

let aiRevealScrollRaf: number | null = null;
/** 打字机输出时跟随滚底（rAF 合并，避免每 tick 触发 layout） */
watch(aiRevealTick, () => {
  if (!wasNearBottom.value || !isAiPeerConversation.value) return;
  if (aiRevealScrollRaf != null) return;
  aiRevealScrollRaf = requestAnimationFrame(() => {
    aiRevealScrollRaf = null;
    const el = messagesRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
});

/** 当前会话是否有 AI 消息正在流式/打字机输出（1.6 显示回底按钮的条件之一） */
const activeHasStreaming = computed(() =>
  enrichedMessages.value.some((e) => e.aiStreaming),
);

/** 1.6 「回到底部」悬浮按钮：远离底部 且（有新消息 或 AI 正在输出）时显示 */
const showBackToBottom = computed(
  () => !wasNearBottom.value && (hasUnseenBelow.value || activeHasStreaming.value),
);

const handleBackToBottom = () => {
  const el = messagesRef.value;
  if (!el) return;
  scrollToBottom(el);
  wasNearBottom.value = true;
  hasUnseenBelow.value = false;
};

// ── 2.1 停止生成 ───────────────────────────────────────
/**
 * 当前会话正在流式接收中的 AI 占位消息 documentId。
 * 只认 isStreamingMessage（worker 仍在生成）；本地打字机动画不算——
 * 那时内容已定稿，停止 worker 没有意义。
 */
const activeStreamingMessageId = computed<string | null>(() => {
  for (const e of enrichedMessages.value) {
    if (e.aiRich && isStreamingMessage(e.msg.documentId)) return e.msg.documentId;
  }
  return null;
});

/** 已发出停止请求（防重复点击）；流式结束（streamingDone）后自动复位 */
const stoppingAi = ref(false);

const handleStopAi = async () => {
  const id = activeStreamingMessageId.value;
  if (!id || stoppingAi.value) return;
  stoppingAi.value = true;
  try {
    await stopAiStream(id);
  } catch {
    stoppingAi.value = false; // 失败允许重试
  }
};

watch(activeStreamingMessageId, (v) => {
  if (!v) stoppingAi.value = false;
});

// ── 2.2 重新生成 ───────────────────────────────────────
/** 会话最后一条 AI 回复的 documentId：只有它的操作条出现「重新生成」 */
const lastAiMessageId = computed<string | null>(() => {
  const list = enrichedMessages.value;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]!;
    if (e.aiRich) return e.msg.documentId;
  }
  return null;
});

const regeneratingAi = ref(false);

const handleRegenerate = async (msg: DmMessage) => {
  if (regeneratingAi.value) return;
  regeneratingAi.value = true;
  try {
    await regenerateAiReply(msg.documentId);
    // 旧气泡消失（message.deleted）与新占位（message.created）都走 WS 事件
  } catch {
    // 静默失败：用户可重试
  } finally {
    regeneratingAi.value = false;
  }
};

// （bubbleBody 已被 bubbleText 取代——见上方，支持富文本 mention 渲染）

// ── 输入 / 发送 / 编辑 / 撤回 ───────────────────────────
const draft = ref("");
const sending = ref(false);
const sendError = ref<string | null>(null);
/** DmComposer 实例（Phase 4 拆分）：自动增高/字数提示/Enter 发送已内聚到子组件 */
const composerRef = ref<InstanceType<typeof DmComposer> | null>(null);

/** 当前正在编辑的消息 documentId（null 表示无）；编辑时输入框临时改为修改模式 */
const editingMessageId = ref<string | null>(null);
const editingDraft = ref("");

/** 当前消息上下文菜单：右键/长按 触发 */
const contextMenuMessageId = ref<string | null>(null);
const contextMenuStyle = ref<Record<string, string>>({});
const showContextMenu = (e: MouseEvent, msg: DmMessage) => {
  // 可复制或可编辑/撤回其一即可弹出（1.4：所有文本消息支持复制）
  if (!canCopyMessage(msg) && !canModifyMessage(msg)) return;
  e.preventDefault();
  contextMenuMessageId.value = msg.documentId;
  // 菜单贴近鼠标位置；屏幕边缘 clamp
  const x = Math.min(e.clientX, window.innerWidth - 160);
  const y = Math.min(e.clientY, window.innerHeight - 140);
  contextMenuStyle.value = {
    left: `${x}px`,
    top: `${y}px`,
  };
};
const hideContextMenu = () => {
  contextMenuMessageId.value = null;
};

/** 上下文菜单对应的消息与可用操作（决定菜单项显隐） */
const contextMenuMessage = computed(() => {
  const id = contextMenuMessageId.value;
  if (!id) return null;
  return activeMessages.value.find((m) => m.documentId === id) ?? null;
});
const contextMenuCanCopy = computed(
  () => !!contextMenuMessage.value && canCopyMessage(contextMenuMessage.value),
);
const contextMenuCanModify = computed(
  () => !!contextMenuMessage.value && canModifyMessage(contextMenuMessage.value),
);

/** 1.4 复制消息原文到剪贴板（AI 消息即原始 markdown）；气泡操作条 + 上下文菜单共用 */
const copiedMessageId = ref<string | null>(null);
let copiedFlashTimer: ReturnType<typeof setTimeout> | null = null;
const copyMessageText = async (msg: DmMessage) => {
  hideContextMenu();
  const text = (msg.content ?? "").trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copiedMessageId.value = msg.documentId;
    if (copiedFlashTimer) clearTimeout(copiedFlashTimer);
    copiedFlashTimer = setTimeout(() => {
      copiedMessageId.value = null;
    }, 2000);
  } catch {
    // 剪贴板权限被拒（非 https / 权限策略）：静默失败，浏览器自身会提示
  }
};

const beginEdit = (msg: DmMessage) => {
  editingMessageId.value = msg.documentId;
  editingDraft.value = msg.content ?? "";
  hideContextMenu();
  nextTick(() => {
    composerRef.value?.focus();
  });
};

const cancelEdit = () => {
  editingMessageId.value = null;
  editingDraft.value = "";
};

const doWithdraw = async (msg: DmMessage) => {
  const cid = activeConversationId.value;
  if (!cid) return;
  hideContextMenu();
  try {
    await withdrawMessage(cid, msg.documentId);
  } catch (err) {
    sendError.value = resolveErrorMessage(err, "撤回失败");
  }
};

/** 上下文菜单操作的统一入口：根据当前 contextMenuMessageId 查到消息再分发 */
const onContextMenuAction = (action: "copy" | "edit" | "withdraw") => {
  const id = contextMenuMessageId.value;
  if (!id) return;
  const msg = activeMessages.value.find((m) => m.documentId === id);
  if (!msg) {
    hideContextMenu();
    return;
  }
  if (action === "copy") void copyMessageText(msg);
  else if (action === "edit") beginEdit(msg);
  else void doWithdraw(msg);
};

const doSend = async () => {
  if (sending.value) return;
  // 一次性快照所有响应式 ref——await 期间用户可能切会话 / 退出编辑态，
  // 直接读 .value 会拿到 stale 数据，把消息发到错误的会话里。
  const cid = activeConversationId.value;
  if (!cid) return;
  const editingId = editingMessageId.value;
  const newContent = (editingId ? editingDraft.value : draft.value).trim();
  if (!newContent) return;

  sending.value = true;
  sendError.value = null;
  try {
    if (editingId) {
      await editMessage(cid, editingId, newContent);
      // 仅当用户还在原编辑态时才清理，避免 race 时把别人的编辑态清掉
      if (editingMessageId.value === editingId) cancelEdit();
    } else {
      await sendMessage(cid, { content: newContent });
      // 同样：仅当用户还在原会话时才清 draft
      if (activeConversationId.value === cid) {
        draft.value = "";
        nextTick(() => {
          const el = messagesRef.value;
          if (el) scrollToBottom(el);
        });
      }
    }
  } catch (err) {
    sendError.value = resolveErrorMessage(err, editingId ? "编辑失败" : "发送失败");
  } finally {
    sending.value = false;
  }
};

// ── Phase 4 会话内搜索 ───────────────────────────
const dmSearchOpen = ref(false);
const dmSearchQuery = ref("");
/** 当前定位在第几个命中（0-based；query 变化时复位） */
const dmSearchIndex = ref(0);
const dmSearchInputRef = ref<HTMLInputElement | null>(null);

/** 命中消息 documentId 列表（时间正序）：纯文本消息小写包含匹配 */
const dmSearchHits = computed<string[]>(() => {
  const q = dmSearchQuery.value.trim().toLowerCase();
  if (!dmSearchOpen.value || !q) return [];
  const hits: string[] = [];
  for (const entry of enrichedMessages.value) {
    if (entry.msg.deletedAt) continue;
    if (typeof entry.rendered !== "string") continue;
    if (entry.rendered.toLowerCase().includes(q)) {
      hits.push(entry.msg.documentId);
    }
  }
  return hits;
});

/** 当前命中的消息 documentId：传给 DmMessageItem 打黄圈高亮 */
const currentSearchHitId = computed<string | null>(
  () => dmSearchHits.value[dmSearchIndex.value] ?? null,
);

const closeDmSearch = () => {
  dmSearchOpen.value = false;
  dmSearchQuery.value = "";
  dmSearchIndex.value = 0;
};

const toggleDmSearch = () => {
  if (dmSearchOpen.value) {
    closeDmSearch();
    return;
  }
  dmSearchOpen.value = true;
  nextTick(() => dmSearchInputRef.value?.focus());
};

/** 上一条 / 下一条命中（首尾循环） */
const goToSearchHit = (delta: number) => {
  const total = dmSearchHits.value.length;
  if (total === 0) return;
  dmSearchIndex.value = (dmSearchIndex.value + delta + total) % total;
};

/** 命中消息在渲染窗口之外时先扩窗到能渲染它（配合窗口化） */
const ensureMessageRendered = (documentId: string) => {
  const list = enrichedMessages.value;
  const idx = list.findIndex((e) => e.msg.documentId === documentId);
  if (idx === -1) return;
  const hiddenCount = list.length - renderWindow.value;
  if (idx < hiddenCount) {
    renderWindow.value = list.length - idx;
  }
};

/** 滚动到当前命中的消息（黄圈高亮由 DmMessageItem 按 searchHit prop 渲染） */
const scrollToSearchHit = (documentId: string) => {
  ensureMessageRendered(documentId);
  nextTick(() => {
    const target = messagesRef.value?.querySelector(`[data-mid="${documentId}"]`);
    target?.scrollIntoView({ block: "center" });
  });
};

// query 变化 → 复位到第一个命中；命中变化 → 滚动定位
watch(dmSearchQuery, () => {
  dmSearchIndex.value = 0;
});
watch(currentSearchHitId, (id) => {
  if (id) scrollToSearchHit(id);
});

// Enter 发送 / Shift+Enter 换行的键盘处理已随 Phase 4 拆分内聚到 DmComposer

/** ESC 优先关闭：上下文菜单 → 会话内搜索 → 编辑模式 → 弹窗本体 */
const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== "Escape" || !visible.value) return;
  // 如果有更上层的弹窗（如委托详情 overlay）处于打开状态，不关闭敲敲
  // 敲敲自身也是 .ik-overlay，所以检查数量 > 1
  if (document.querySelectorAll(".ik-overlay").length > 1) return;
  if (contextMenuMessageId.value) {
    hideContextMenu();
    return;
  }
  if (dmSearchOpen.value) {
    closeDmSearch();
    return;
  }
  if (editingMessageId.value) {
    cancelEdit();
    return;
  }
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
  activeConversationId.value = null;
  activeAiSlug.value = null;
  updateUrl(tab);
};

const handleConversationClick = (id: string) => {
  activeConversationId.value = id;
  updateUrl(activeTab.value, id);
};

/** 移动端是否处于「聊天」视图（选中了会话）；用于全屏单栏切换 list ↔ chat */
const mobileChatOpen = computed(() => !!activeConversationId.value);

/** 移动端聊天页返回：清空选中回到会话列表（不关闭弹窗） */
const handleMobileBack = () => {
  const id = activeConversationId.value;
  if (id) void markConversationAsRead(id, { force: true });
  activeConversationId.value = null;
  activeAiSlug.value = null;
  updateUrl(activeTab.value);
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
        <!-- 斜线纹理背景（与委托弹窗一致） -->
        <div class="ik-overlay__stripe" aria-hidden="true"></div>

        <div
          class="ik-dialog ik-dialog--knock"
          :class="{ 'is-mobile-chat': mobileChatOpen }"
          @click.stop
        >
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
                <IkZzzMarquee />
                <!-- 左栏：tab + 会话列表 + 活动信息 -->
                <aside class="ik-knock__sidebar">
                  <div class="ik-knock__tabs" role="tablist" aria-label="敲敲分类">
                    <button
                      type="button"
                      role="tab"
                      class="ik-knock__tab"
                      :class="{ 'is-active': activeTab === 'calls' }"
                      :aria-selected="activeTab === 'calls'"
                      aria-label="AI 助手"
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

                  <!-- 私聊：原 DM 会话列表 -->
                  <div
                    v-if="activeTab === 'contacts'"
                    class="ik-knock__list"
                    role="listbox"
                  >
                    <button
                      v-for="item in conversations"
                      :key="item.documentId"
                      type="button"
                      role="option"
                      class="ik-knock__list-item"
                      :class="{
                        'is-active': activeConversationId === item.documentId,
                        'has-unread': item.unreadCount > 0,
                      }"
                      :aria-selected="activeConversationId === item.documentId"
                      @click="handleConversationClick(item.documentId)"
                    >
                      <span class="ik-knock__avatar" aria-hidden="true">
                        <img
                          v-if="item.peer?.avatar || item.avatar"
                          :src="(item.peer?.avatar || item.avatar) as string"
                          :alt="item.peer?.name || item.title || ''"
                          class="ik-knock__avatar-img"
                          draggable="false"
                        />
                        <img v-else src="/images/default-avatar.webp" alt="" class="ik-knock__avatar-img" draggable="false" />
                      </span>
                      <span class="ik-knock__item-text">
                        <span class="ik-knock__item-title">{{ item.peer?.name || item.title || "未知会话" }}</span>
                        <span class="ik-knock__item-subtitle">
                          {{ conversationPreview(item) || "暂无消息" }}
                        </span>
                      </span>
                      <span
                        v-if="item.unreadCount > 0"
                        class="ik-knock__item-badge"
                        aria-label="未读"
                      >
                        {{ item.unreadCount > 99 ? "99+" : item.unreadCount }}
                      </span>
                    </button>
                    <div
                      v-if="!conversations.length"
                      class="ik-knock__list-empty"
                    >
                      <span v-if="contactsListLoading">加载中…</span>
                      <span v-else-if="loadError">{{ loadError }}</span>
                      <span v-else>暂无消息</span>
                    </div>
                  </div>

                  <!-- AI 角色（通话 Tab） -->
                  <div
                    v-else-if="activeTab === 'calls'"
                    class="ik-knock__list"
                    role="listbox"
                  >
                    <!-- 角色选择视图 -->
                    <template v-if="!activeAiSlug">
                      <button
                        v-for="{ card, unread } in aiCharacterRows"
                        :key="card.slug"
                        type="button"
                        role="option"
                        class="ik-knock__list-item"
                        :class="{
                          'is-active': activeAiSlug === card.slug,
                        }"
                        :aria-selected="activeAiSlug === card.slug"
                        @click="selectAiCharacter(card)"
                      >
                        <span class="ik-knock__avatar" aria-hidden="true">
                          <img
                            v-if="cardAvatarUrl(card)"
                            :src="cardAvatarUrl(card)!"
                            :alt="card.displayName"
                            class="ik-knock__avatar-img"
                            draggable="false"
                          />
                          <img v-else src="/images/default-avatar.webp" alt="" class="ik-knock__avatar-img" draggable="false" />
                        </span>
                        <span class="ik-knock__item-text">
                          <span class="ik-knock__item-title">{{ card.displayName }}</span>
                          <span class="ik-knock__item-subtitle">
                            {{ card.bio || "AI 助手" }}
                          </span>
                        </span>
                        <span
                          v-if="unread > 0"
                          class="ik-knock__item-badge"
                          aria-label="未读"
                        >
                          {{ unread > 99 ? "99+" : unread }}
                        </span>
                      </button>
                      <div
                        v-if="!aiCharacters.length"
                        class="ik-knock__list-empty"
                      >
                        <span v-if="aiCharactersLoading">加载中…</span>
                        <span v-else-if="aiCharactersError">{{ aiCharactersError }}</span>
                        <span v-else>暂无 AI 角色</span>
                      </div>
                    </template>

                    <!-- 某角色的会话列表 -->
                    <template v-else>
                      <div class="ik-knock__ai-session-header">
                        <button
                          type="button"
                          class="ik-knock__ai-session-back"
                          aria-label="返回角色"
                          @click="backToAiCharacters"
                        >
                          <ChevronLeftIcon class="ik-knock__ai-session-back-icon" aria-hidden="true" />
                        </button>
                        <span class="ik-knock__ai-session-title">{{ activeAiCard?.displayName || "AI 助手" }}</span>
                        <button
                          type="button"
                          class="ik-knock__new-session"
                          :disabled="creatingAiSession"
                          aria-label="新建会话"
                          title="新建会话"
                          @click="createNewAiSession"
                        >
                          <PlusIcon class="ik-knock__new-session-icon" aria-hidden="true" />
                        </button>
                      </div>
                      <button
                        v-for="session in aiSessionsForActiveCard"
                        :key="session.documentId"
                        type="button"
                        role="option"
                        class="ik-knock__list-item"
                        :class="{
                          'is-active': activeConversationId === session.documentId,
                          'has-unread': session.unreadCount > 0,
                        }"
                        :aria-selected="activeConversationId === session.documentId"
                        @click="handleConversationClick(session.documentId)"
                      >
                        <span class="ik-knock__avatar" aria-hidden="true">
                          <img
                            v-if="activeAiCard && cardAvatarUrl(activeAiCard)"
                            :src="cardAvatarUrl(activeAiCard)!"
                            :alt="activeAiCard.displayName"
                            class="ik-knock__avatar-img"
                            draggable="false"
                          />
                          <img v-else src="/images/default-avatar.webp" alt="" class="ik-knock__avatar-img" draggable="false" />
                        </span>
                        <span class="ik-knock__item-text">
                          <span class="ik-knock__item-title">{{ session.title || activeAiCard?.displayName || "AI 会话" }}</span>
                          <span class="ik-knock__item-subtitle">
                            {{ conversationPreview(session) || "暂无消息" }}
                          </span>
                        </span>
                        <span class="ik-knock__item-actions">
                          <button
                            type="button"
                            class="ik-knock__delete-session"
                            :disabled="deletingSessionId === session.documentId"
                            aria-label="删除会话"
                            title="删除会话"
                            @click.stop="deleteAiSession(session.documentId)"
                          >
                            <TrashIcon class="ik-knock__delete-session-icon" aria-hidden="true" />
                          </button>
                        </span>
                        <span
                          v-if="session.unreadCount > 0"
                          class="ik-knock__item-badge"
                          aria-label="未读"
                        >
                          {{ session.unreadCount > 99 ? "99+" : session.unreadCount }}
                        </span>
                      </button>
                      <div
                        v-if="!aiSessionsForActiveCard.length && !creatingAiSession"
                        class="ik-knock__list-empty"
                      >
                        <span>暂无会话，点击上方 + 新建</span>
                      </div>
                      <div
                        v-else-if="creatingAiSession"
                        class="ik-knock__list-empty"
                      >
                        <span>创建中…</span>
                      </div>
                    </template>
                  </div>

                  <!-- 群聊（占位） -->
                  <div
                    v-else
                    class="ik-knock__list"
                    role="listbox"
                  >
                    <div class="ik-knock__list-empty">
                      <span>暂未开放</span>
                    </div>
                  </div>

                </aside>

                <!-- 右栏：会话标题 + 内容 -->
                <section class="ik-knock__main">
                  <header class="ik-knock__main-header">
                    <!-- 移动端返回箭头：回到会话列表（仅手机端显示） -->
                    <button
                      type="button"
                      class="ik-knock__back"
                      aria-label="返回"
                      @click="handleMobileBack"
                    >
                      <ChevronLeftIcon
                        class="ik-knock__back-icon"
                        aria-hidden="true"
                      />
                    </button>
                    <ChatBubbleLeftIcon
                      class="ik-knock__main-icon"
                      aria-hidden="true"
                    />
                    <div
                      class="ik-knock__main-title-wrap"
                      :class="{ 'is-clickable': canClickPeerProfile }"
                      :role="canClickPeerProfile ? 'button' : undefined"
                      :tabindex="canClickPeerProfile ? 0 : undefined"
                      :aria-label="canClickPeerProfile ? `查看${activeConversation?.peer?.name || '用户'}的主页` : undefined"
                      @click="goToProfile(peerProfileUrl)"
                      @keydown.enter="goToProfile(peerProfileUrl)"
                    >
                      <span class="ik-knock__main-title">
                        {{ activeConversation?.title || activeConversation?.peer?.name || "NoData" }}
                      </span>
                      <Transition name="ik-typing">
                        <span v-if="peerIsTyping" class="ik-knock__typing-indicator" aria-live="polite">
                          <span class="ik-knock__typing-dot" />
                          <span class="ik-knock__typing-dot" />
                          <span class="ik-knock__typing-dot" />
                          <span class="ik-knock__typing-label">正在输入</span>
                        </span>
                      </Transition>
                    </div>
                    <!-- Phase 4 会话内搜索：仅选中会话时显示 -->
                    <button
                      v-if="activeConversation"
                      type="button"
                      class="ik-knock__search-toggle"
                      :class="{ 'is-active': dmSearchOpen }"
                      aria-label="搜索聊天记录"
                      title="搜索聊天记录"
                      @click="toggleDmSearch"
                    >
                      <MagnifyingGlassIcon class="ik-knock__search-toggle-icon" aria-hidden="true" />
                    </button>
                    <!-- AI 会话管理：新建 / 删除 -->
                    <template v-if="isActiveAiConversation">
                      <button
                        type="button"
                        class="ik-knock__session-action"
                        :disabled="creatingAiSession"
                        aria-label="新建会话"
                        title="新建会话"
                        @click="createNewAiSession"
                      >
                        <PlusIcon class="ik-knock__session-action-icon" aria-hidden="true" />
                      </button>
                      <button
                        v-if="activeConversationId"
                        type="button"
                        class="ik-knock__session-action"
                        :disabled="deletingSessionId === activeConversationId"
                        aria-label="删除当前会话"
                        title="删除当前会话"
                        @click="deleteAiSession(activeConversationId)"
                      >
                        <TrashIcon class="ik-knock__session-action-icon" aria-hidden="true" />
                      </button>
                    </template>
                  </header>
                  <!-- Phase 4 会话内搜索条：命中计数 + 上下跳转 -->
                  <div v-if="dmSearchOpen" class="ik-knock__search-bar">
                    <MagnifyingGlassIcon class="ik-knock__search-bar-icon" aria-hidden="true" />
                    <input
                      ref="dmSearchInputRef"
                      v-model="dmSearchQuery"
                      type="text"
                      class="ik-knock__search-input"
                      placeholder="搜索聊天记录…"
                      @keydown.enter.prevent="goToSearchHit(1)"
                    />
                    <span class="ik-knock__search-count" aria-live="polite">
                      {{ dmSearchHits.length ? `${dmSearchIndex + 1}/${dmSearchHits.length}` : (dmSearchQuery.trim() ? "0 条" : "") }}
                    </span>
                    <button
                      type="button"
                      class="ik-knock__search-nav"
                      :disabled="!dmSearchHits.length"
                      aria-label="上一条"
                      @click="goToSearchHit(-1)"
                    >
                      <ChevronUpIcon class="ik-knock__search-nav-icon" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="ik-knock__search-nav"
                      :disabled="!dmSearchHits.length"
                      aria-label="下一条"
                      @click="goToSearchHit(1)"
                    >
                      <ChevronDownIcon class="ik-knock__search-nav-icon" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="ik-knock__search-nav"
                      aria-label="关闭搜索"
                      @click="closeDmSearch"
                    >
                      <XMarkIcon class="ik-knock__search-nav-icon" aria-hidden="true" />
                    </button>
                  </div>
                  <div class="ik-knock__main-body">
                    <!-- 会话消息流（wrap 承载「回到底部」悬浮按钮的定位上下文） -->
                    <div
                      v-if="activeConversation && activeMessages.length"
                      class="ik-knock__messages-wrap"
                    >
                    <div
                      ref="messagesRef"
                      class="ik-knock__messages"
                      :class="{ 'is-settling': messagesSettling }"
                      @scroll.passive="onMessagesScroll"
                    >
                      <!-- Phase 4 渲染窗口化：更早消息滚顶自动加载（也可点击） -->
                      <button
                        v-if="hasHiddenAbove"
                        type="button"
                        class="ik-knock__load-earlier"
                        @click="expandRenderWindow"
                      >
                        加载更早的消息
                      </button>
                      <DmMessageItem
                        v-for="entry in visibleMessages"
                        :key="entry.msg.documentId"
                        :entry="entry"
                        :copied-id="copiedMessageId"
                        :show-regenerate="entry.aiRich && entry.msg.documentId === lastAiMessageId && !activeStreamingMessageId"
                        :regenerating="regeneratingAi"
                        :search-hit="entry.msg.documentId === currentSearchHitId"
                        @contextmenu="showContextMenu"
                        @profile="goToProfile"
                        @open-post="openPostFromBubble"
                        @bubble-link="handleBubbleLink"
                        @copy="copyMessageText"
                        @regenerate="handleRegenerate"
                        @quote-click="goPost"
                      />
                    </div>
                    <!-- 1.6 回到底部：远离底部且（有新消息 / AI 输出中）时浮现 -->
                    <Transition name="ik-b2b">
                      <button
                        v-if="showBackToBottom"
                        type="button"
                        class="ik-knock__back-to-bottom"
                        aria-label="回到底部"
                        @click="handleBackToBottom"
                      >
                        <ChevronDownIcon class="ik-knock__back-to-bottom-icon" aria-hidden="true" />
                      </button>
                    </Transition>
                    </div>
                    <!-- 占位：仅在非加载态时显示，避免切换会话时闪烁 -->
                    <div v-else-if="!activeMessageLoading" class="ik-knock__empty-pill">
                      EMPTY
                    </div>

                    <!-- 输入框：仅在有选中会话且非匿名/系统会话时显示（Phase 4 拆分为 DmComposer） -->
                    <DmComposer
                      v-if="activeConversation && !composerDisabled"
                      ref="composerRef"
                      v-model:draft="draft"
                      v-model:editing-draft="editingDraft"
                      :disabled="composerDisabled"
                      :placeholder="composerPlaceholder"
                      :sending="sending"
                      :editing="!!editingMessageId"
                      :error="sendError"
                      :streaming="!!activeStreamingMessageId"
                      :stopping="stoppingAi"
                      @send="doSend"
                      @stop="handleStopAi"
                      @cancel-edit="cancelEdit"
                      @typing="handleComposerTyping"
                    />
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 消息上下文菜单（编辑 / 撤回）：Teleport 到 body 避免被弹窗剪裁 -->
  <Teleport to="body">
    <div
      v-if="contextMenuMessageId"
      class="ik-knock__context-menu-mask"
      @click="hideContextMenu"
      @contextmenu.prevent="hideContextMenu"
    >
      <div
        class="ik-knock__context-menu"
        :style="contextMenuStyle"
        @click.stop
      >
        <button
          v-if="contextMenuCanCopy"
          type="button"
          class="ik-knock__context-menu-item"
          @click="onContextMenuAction('copy')"
        >
          复制
        </button>
        <button
          v-if="contextMenuCanModify"
          type="button"
          class="ik-knock__context-menu-item"
          @click="onContextMenuAction('edit')"
        >
          编辑
        </button>
        <button
          v-if="contextMenuCanModify"
          type="button"
          class="ik-knock__context-menu-item ik-knock__context-menu-item--danger"
          @click="onContextMenuAction('withdraw')"
        >
          撤回
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Overlay 外壳 —— 与委托弹窗 / 登录弹窗完全一致
   ═══════════════════════════════════════════════ */
.ik-overlay {
  position: fixed;
  inset: 0;
  /* 低于委托弹窗 (9000)，保证点击评论委托后委托弹窗叠加在上方 */
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
  height: 32px;
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


/* ── 侧栏 / 主栏 共享面板装饰 ────────────────── */
.ik-knock__sidebar,
.ik-knock__main {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.92) 0%,
    rgba(26, 26, 26, 0.82) 100%
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
  position: relative;
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

.ik-knock__tab-badge {
  position: absolute;
  top: 2px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ff3b30;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  border: 1px solid #000;
  pointer-events: none;
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

/* AI 会话列表顶部：返回角色、角色名、新建会话 */
.ik-knock__ai-session-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 2px solid #202020;
  background: #161616;
  flex-shrink: 0;
}

.ik-knock__ai-session-back {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
}

.ik-knock__ai-session-back:hover {
  background: rgba(255, 255, 255, 0.08);
}

.ik-knock__ai-session-back-icon {
  width: 20px;
  height: 20px;
}

.ik-knock__ai-session-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 800;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-knock__new-session {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #777;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.ik-knock__new-session:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.ik-knock__new-session:disabled {
  opacity: 0.45;
  cursor: default;
}

.ik-knock__new-session-icon {
  width: 18px;
  height: 18px;
}

/* 单个会话项的删除按钮 */
.ik-knock__item-actions {
  display: none;
  align-items: center;
  gap: 4px;
}

.ik-knock__list-item:hover .ik-knock__item-actions {
  display: inline-flex;
}

.ik-knock__delete-session {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #777;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.ik-knock__delete-session:hover:not(:disabled) {
  color: #ff4d4f;
  background: rgba(255, 77, 79, 0.12);
}

.ik-knock__delete-session:disabled {
  opacity: 0.45;
  cursor: default;
}

.ik-knock__delete-session-icon {
  width: 15px;
  height: 15px;
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

/* 移动端返回箭头：桌面端为双栏布局，无需返回，故默认隐藏 */
.ik-knock__back {
  display: none;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-left: -8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #fff;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.ik-knock__back-icon {
  width: 26px;
  height: 26px;
}

.ik-knock__main-title-wrap {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-width: 0;
}

/* 会话标题栏：对端可跳转个人主页时的可点击态 */
.ik-knock__main-title-wrap.is-clickable {
  cursor: pointer;
  border-radius: 6px;
  transition: opacity 140ms ease;
}

.ik-knock__main-title-wrap.is-clickable:hover {
  opacity: 0.8;
}

.ik-knock__main-title-wrap.is-clickable:focus-visible {
  outline: 2px solid #fbfe00;
  outline-offset: 2px;
}

/* 重置对话按钮（3.3.4）：靠右对齐 */
.ik-knock__reset {
  margin-left: auto;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #777;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}

.ik-knock__reset:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.ik-knock__reset:disabled {
  opacity: 0.45;
  cursor: default;
}

.ik-knock__reset-icon {
  width: 18px;
  height: 18px;
}

/* AI 会话管理按钮（新建 / 删除）：与 reset 同款 */
.ik-knock__session-action {
  margin-left: 4px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #777;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}

.ik-knock__session-action:first-of-type {
  margin-left: auto;
}

.ik-knock__session-action:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.ik-knock__session-action:disabled {
  opacity: 0.45;
  cursor: default;
}

.ik-knock__session-action-icon {
  width: 18px;
  height: 18px;
}

.ik-knock__search-toggle + .ik-knock__session-action {
  margin-left: 4px;
}

/* ── Phase 4 会话内搜索 ───────────────────── */
/* header 搜索开关：与 reset 同款按钮语言；靠右（reset 存在时紧挨其左） */
.ik-knock__search-toggle {
  margin-left: auto;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #777;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}

/* reset 按钮同时存在时由搜索按钮承担 margin-left:auto，reset 紧随其后 */
.ik-knock__search-toggle + .ik-knock__reset {
  margin-left: 0;
}

.ik-knock__search-toggle:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.ik-knock__search-toggle.is-active {
  color: #000;
  background: #fbfe00;
}

.ik-knock__search-toggle-icon {
  width: 18px;
  height: 18px;
}

/* 搜索条：header 下方整行；输入 + 命中计数 + 上下跳转 + 关闭 */
.ik-knock__search-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: #161616;
  border-bottom: 2px solid #202020;
}

.ik-knock__search-bar-icon {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  color: rgba(255, 255, 255, 0.4);
}

.ik-knock__search-input {
  flex: 1;
  min-width: 0;
  padding: 5px 10px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 140ms ease;
}

.ik-knock__search-input:focus {
  border-color: #fbfe00;
}

.ik-knock__search-input::placeholder {
  color: rgba(255, 255, 255, 0.32);
}

.ik-knock__search-count {
  flex-shrink: 0;
  min-width: 40px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
  font-variant-numeric: tabular-nums;
}

.ik-knock__search-nav {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #999;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.ik-knock__search-nav:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.ik-knock__search-nav:disabled {
  opacity: 0.35;
  cursor: default;
}

.ik-knock__search-nav-icon {
  width: 15px;
  height: 15px;
}


/* system 分界 / 消息气泡 / 引用卡 / 操作条样式随 Phase 4 拆分移至 DmMessageItem.vue */

.ik-knock__main-title {
  font-size: 17px;
  font-weight: 900;
  color: #fff;
}

/* ── 正在输入指示器（header 标题旁；气泡内加载点样式在 DmMessageItem） ── */
.ik-knock__typing-indicator {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 14px;
}

.ik-knock__typing-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin-left: 2px;
  letter-spacing: 0.2px;
}

.ik-knock__typing-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.45);
  animation: ik-typing-bounce 1.2s ease-in-out infinite;
}

.ik-knock__typing-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.ik-knock__typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes ik-typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30% { transform: translateY(-4px); opacity: 1; }
}

.ik-typing-enter-active,
.ik-typing-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.ik-typing-enter-from,
.ik-typing-leave-to {
  opacity: 0;
  transform: translateY(2px);
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
/* wrap：给「回到底部」悬浮按钮提供定位上下文（1.6） */
.ik-knock__messages-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ik-knock__back-to-bottom {
  position: absolute;
  right: 16px;
  bottom: 12px;
  z-index: 5;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 50%;
  background: #2b2b2e;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  transition: background 140ms ease, color 140ms ease, transform 140ms ease;
}

.ik-knock__back-to-bottom:hover {
  background: #fbfe00;
  color: #000;
  transform: translateY(-2px);
}

.ik-knock__back-to-bottom-icon {
  width: 18px;
  height: 18px;
}

.ik-b2b-enter-active,
.ik-b2b-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.ik-b2b-enter-from,
.ik-b2b-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.ik-knock__messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 消息间距适中，不太拥挤 */
  gap: 14px;
  overflow-y: auto;
  padding-right: 6px;
  /* 底部留呼吸空间，避免最后一条消息贴着 composer 输入框 */
  padding-bottom: 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  /* 滚到底后阻断滚动事件向父级冒泡，避免外层弹窗/页面跟随回弹抖动 */
  overscroll-behavior: contain;
  /* 关闭浏览器自动 scroll anchoring，避免拉到底时被悄悄回拉一小段，
     "永远到不了最底"——我们已在 watch 里手动 scrollTop=scrollHeight */
  overflow-anchor: none;
}

/* 切会话沉降态：消息已渲染但 scrollTop 还没校正到底前先隐藏，
   避免长消息流首帧 paint 在顶部造成"先看到最早消息一闪 → 跳底"抖动 */
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

/* Phase 4 渲染窗口化：顶部「加载更早的消息」提示条（滚顶也会自动扩窗） */
.ik-knock__load-earlier {
  align-self: center;
  flex-shrink: 0;
  margin: 2px 0 4px;
  padding: 4px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.ik-knock__load-earlier:hover {
  background: rgba(251, 254, 0, 0.12);
  color: #fbfe00;
}

/* 消息气泡 / 头像 / 时间分隔 / 引用卡 / 操作条 / is-mine 等
   消息级样式随 Phase 4 拆分移至 DmMessageItem.vue（scoped 类名不变） */

/* 入场/出场动画统一在 theme.css 的 .ik-overlay-* 全局规则里维护 */

/* ── Mobile：QQ / TG 风格全屏单栏（会话列表 ↔ 聊天，二选一） ──
   桌面端是左右双栏；手机端屏幕窄，双栏会挤成「列表 + 空聊天框」割裂体验。
   这里改成原生 IM 模式：默认全屏会话列表，点开某会话后整页切到聊天，
   聊天页顶部用返回箭头回到列表。 */
@media (max-width: 768px) {
  /* 全屏铺满，去掉浮层弹窗外观（圆角 / 边框留白） */
  .ik-dialog--knock {
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
  }

  .ik-dialog--knock .ik-dialog__outer {
    padding: 0;
    border-radius: 0;
    background: #000;
  }

  .ik-dialog--knock .ik-dialog__inner {
    padding: 0;
    border-radius: 0;
  }

  /* 顶部品牌栏（仅列表视图显示）：贴顶 + 顶部安全区 */
  .ik-dialog--knock .ik-dialog__header {
    border-radius: 0;
    padding: 12px 16px;
    padding-top: calc(12px + env(safe-area-inset-top));
  }

  .ik-knock__brand-icon {
    width: 34px;
    height: 34px;
  }

  .ik-knock__brand-text {
    font-size: 20px;
  }

  /* 单栏导航：会话列表常驻底层，聊天页绝对定位覆盖整屏，靠 transform 滑入/滑出 */
  .ik-dialog--knock .ik-dialog__inner {
    position: relative;
  }

  .ik-dialog__body.ik-knock__body {
    display: block;
    position: static;
    padding: 0;
    gap: 0;
    border-radius: 0;
  }

  /* 列表视图：会话列表在正常流中铺满 body（位于品牌栏下方） */
  .ik-knock__sidebar {
    position: relative;
    width: 100%;
    height: 100%;
    flex: none;
    padding: 12px 12px 0;
    gap: 12px;
    border-radius: 0;
    box-shadow: none;
    background: #121212;
  }

  /* 聊天页：绝对定位覆盖整个弹窗（含品牌栏），默认滑出到屏幕右侧外 */
  .ik-knock__main {
    position: absolute;
    inset: 0;
    z-index: 30;
    width: 100%;
    height: 100%;
    flex: none;
    display: flex;
    border-radius: 0;
    box-shadow: none;
    background: #121212;
    transform: translateX(100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: transform;
  }

  /* 选中会话：聊天页滑入到位 */
  .ik-dialog--knock.is-mobile-chat .ik-knock__main {
    transform: translateX(0);
  }

  /* tabs：加大触控高度 */
  .ik-knock__tab {
    height: 40px;
  }

  .ik-knock__tab-icon {
    width: 20px;
    height: 20px;
  }

  /* 会话列表项：放大头像与字号，贴近原生 IM 列表 */
  .ik-knock__list {
    gap: 8px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
  }

  .ik-knock__list-item {
    padding: 12px 16px;
    gap: 14px;
  }

  .ik-knock__avatar {
    width: 50px;
    height: 50px;
  }

  .ik-knock__avatar-icon {
    width: 44px;
    height: 44px;
  }

  .ik-knock__item-title {
    font-size: 16px;
  }

  .ik-knock__item-subtitle {
    font-size: 13px;
  }

  /* 聊天头部：返回箭头 + 对方昵称，贴顶 + 顶部安全区 */
  .ik-knock__back {
    display: inline-flex;
  }

  .ik-knock__main-icon {
    display: none;
  }

  .ik-knock__main-header {
    height: auto;
    min-height: 54px;
    padding: 10px 12px;
    padding-top: calc(10px + env(safe-area-inset-top));
    gap: 6px;
    background: linear-gradient(180deg, #161616 0%, #0c0c0c 100%);
    border-bottom: 2px solid #202020;
  }

  .ik-knock__main-title {
    font-size: 17px;
  }

  /* 消息区 + 输入框：底部安全区留白，避免被 Home 条遮挡
     （composer 的 safe-area 规则随拆分移至 DmComposer.vue） */
  .ik-knock__main-body {
    padding: 14px;
  }

  .ik-knock__empty-pill {
    padding: 12px 48px;
    min-width: 240px;
    font-size: 16px;
    letter-spacing: 4px;
  }
}

/* is-new 入场动画的 reduced-motion 豁免随拆分移至 DmMessageItem.vue */

/* ═══════════════════════════════════════════════
   DM 私聊：上下文菜单（消息气泡 / Composer 样式已拆分至
   DmMessageItem.vue / DmComposer.vue）
   ═══════════════════════════════════════════════ */

/* ── 上下文菜单（编辑/撤回） ───────────────── */
/* 全屏遮罩：捕获点击关闭菜单 */
.ik-knock__context-menu-mask {
  position: fixed;
  inset: 0;
  /* 高于弹窗主体；与委托弹窗 9000 同级或略高 */
  z-index: 9100;
}

.ik-knock__context-menu {
  position: fixed;
  min-width: 130px;
  padding: 4px;
  background: #1a1a1a;
  border: 2px solid #3a3a3a;
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ik-knock__context-menu-item {
  appearance: none;
  border: 0;
  background: transparent;
  color: #e0e0e0;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.ik-knock__context-menu-item:hover,
.ik-knock__context-menu-item:focus-visible {
  background: rgba(251, 254, 0, 0.18);
  color: #fbfe00;
  outline: none;
}

.ik-knock__context-menu-item--danger {
  color: #ff8080;
}

.ik-knock__context-menu-item--danger:hover,
.ik-knock__context-menu-item--danger:focus-visible {
  background: rgba(255, 80, 80, 0.18);
  color: #ff5050;
}

</style>
