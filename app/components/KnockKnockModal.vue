<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import {
  PhoneIcon,
  UserIcon,
  UserGroupIcon,
  ChatBubbleLeftIcon,
  PaperAirplaneIcon,
} from "@heroicons/vue/24/solid";
import { DocumentTextIcon, ChevronLeftIcon, ArrowPathIcon } from "@heroicons/vue/24/outline";
import type { AiRoleCard, DmConversationSummary, DmMessage } from "~/types/entities";
import { formatTime } from "~/utils/time";
import { resolveErrorMessage } from "~/utils/api-error";
import { stripMentionsToPlain } from "~/utils/mention";
import { stripEmotesToPlain } from "~/utils/emote";

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
  openDirectConversation,
  isStreamingMessage,
  resetContext,
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

/** 当前会话是否为官方 AI 角色（决定是否显示「重置对话」按钮，3.3.4） */
const isActiveAiConversation = computed<boolean>(() => {
  const conv = activeConversation.value;
  if (!conv) return false;
  const uid = conv.peer?.userId;
  return conv.peer?.isAiAgent === true || (typeof uid === "number" && aiPeerUserIds.value.has(uid));
});

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

const resettingContext = ref(false);

/** 重置 AI 对话上下文（3.3.4）：清空记忆开新话题；服务端会广播 system 分界消息。 */
async function handleResetContext() {
  const id = activeConversationId.value;
  if (!id || resettingContext.value || !isActiveAiConversation.value) return;
  resettingContext.value = true;
  try {
    await resetContext(id);
    await ensureMessages(id, true);
  } catch {
    // 静默失败：用户可重试
  } finally {
    resettingContext.value = false;
  }
}

/** 通话 Tab：按 AI boundUserId 索引未读，避免模板里重复 find */
const aiUnreadByUserId = computed(() => {
  const map = new Map<number, number>();
  for (const c of allConversations.value) {
    const uid = c.peer?.userId;
    if (typeof uid === "number") map.set(uid, c.unreadCount ?? 0);
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

const openAiCharacterChat = async (card: AiRoleCard) => {
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
  const { summary } = await openDirectConversation(uid);
  activeConversationId.value = summary.documentId;
  updateUrl("calls", summary.documentId);
  // 消息加载由 watch(activeConversationId) 统一触发，避免重复请求
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

/** 节流发送 typing 状态：2s 内最多触发一次 */
let typingThrottleLast = 0;
let typingThrottleTimer: ReturnType<typeof setTimeout> | null = null;
const onComposerInput = () => {
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
 */
type BubbleRender = string | { mode: "rich"; content: string };

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

// ── AI 回复内链接渲染（markdown 链接 + 裸 /post/xxx 路径均可点击）──
type BubbleSegment =
  | { type: "text"; content: string }
  | { type: "link"; text: string; href: string };

// 匹配 markdown 链接 [text](url) 或裸路径 /post/documentId
const BUBBLE_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)|\/post\/([a-zA-Z0-9_-]+)/g;

const hasBubbleLinks = (text: string): boolean =>
  /\[([^\]]+)\]\(([^)]+)\)|\/post\/[a-zA-Z0-9_-]+/.test(text);

const parseBubbleSegments = (text: string): BubbleSegment[] => {
  const regex = new RegExp(BUBBLE_LINK_RE.source, 'g');
  const segments: BubbleSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    if (match[1] && match[2]) {
      // markdown link: [text](url)
      segments.push({ type: "link", text: match[1], href: match[2] });
    } else if (match[3]) {
      // bare /post/id path → 显示为"查看帖子"标签
      segments.push({ type: "link", text: "查看帖子", href: `/post/${match[3]}` });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments;
};

const handleBubbleLink = (href: string, e: Event) => {
  e.preventDefault();
  const postMatch = href.match(/^\/post\/([a-zA-Z0-9_-]+)/);
  if (postMatch) {
    postModal.open(postMatch[1]!);
  }
};

/** like-on-comment：通知关联帖子+评论时，quote 卡引用「评论原文」而不是帖子标题 */
const isLikeOnComment = (msg: DmMessage): boolean =>
  msg.notificationKind === "like" && !!msg.comment;

/** quote 卡左侧 label */
const quoteLabel = (msg: DmMessage): string => {
  if (isLikeOnComment(msg)) return "评论";
  if (msg.notificationKind === "like" || msg.notificationKind === "favorite" || msg.notificationKind === "denny") return "委托";
  if (msg.notificationKind === "system") return "委托";
  return "评论委托"; // comment / reply / mention：引用所在委托
};

/** quote 卡右侧主标题：like-on-comment 引用评论原文，其余引用帖子标题 */
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
  // comment/reply/mention：主气泡已是评论正文，再放 quote 帖子卡
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
 */
interface EnrichedMessage {
  msg: DmMessage;
  isMine: boolean;
  isNew: boolean;
  showTime: boolean;
  rendered: BubbleRender;
  quote: {
    label: string;
    title: string;
    article: NonNullable<DmMessage["article"]>;
  } | null;
  /** 头像是否可点击跳转个人主页 */
  avatarClickable: boolean;
  /** 个人主页 URL（avatarClickable 为 false 时为 null） */
  profileUrl: string | null;
}

const enrichedMessages = computed<EnrichedMessage[]>(() => {
  const list = activeMessages.value;
  const known = knownMessageIds.value;
  void aiRevealTick.value;
  return list.map((msg, idx) => {
    const avatarClickable = canClickAvatar(msg);
    return {
      msg,
      isMine: isMine(msg),
      isNew: !known.has(msg.documentId),
      showTime: shouldShowTime(idx),
      rendered: bubbleTextForDisplay(msg),
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

/** 5 分钟内自己发的、未撤回的文本消息可以编辑/撤回 */
const EDIT_WINDOW_MS = 5 * 60 * 1000;
const canModifyMessage = (msg: DmMessage): boolean => {
  if (!isMine(msg)) return false;
  if (msg.deletedAt) return false;
  if (msg.kind !== "text") return false;
  const ageMs = Date.now() - new Date(msg.createdAt).getTime();
  return ageMs < EDIT_WINDOW_MS;
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
  if (!id) return;
  // 新会话默认看最新消息
  wasNearBottom.value = true;
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

// （bubbleBody 已被 bubbleText 取代——见上方，支持富文本 mention 渲染）

// ── 输入 / 发送 / 编辑 / 撤回 ───────────────────────────
const draft = ref("");
const sending = ref(false);
const sendError = ref<string | null>(null);
const composerRef = ref<HTMLTextAreaElement | null>(null);

/** 当前正在编辑的消息 documentId（null 表示无）；编辑时输入框临时改为修改模式 */
const editingMessageId = ref<string | null>(null);
const editingDraft = ref("");

/** 当前消息上下文菜单：右键/长按 触发 */
const contextMenuMessageId = ref<string | null>(null);
const contextMenuStyle = ref<Record<string, string>>({});
const showContextMenu = (e: MouseEvent, msg: DmMessage) => {
  if (!canModifyMessage(msg)) return;
  e.preventDefault();
  contextMenuMessageId.value = msg.documentId;
  // 菜单贴近鼠标位置；屏幕边缘 clamp
  const x = Math.min(e.clientX, window.innerWidth - 160);
  const y = Math.min(e.clientY, window.innerHeight - 100);
  contextMenuStyle.value = {
    left: `${x}px`,
    top: `${y}px`,
  };
};
const hideContextMenu = () => {
  contextMenuMessageId.value = null;
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

/** 上下文菜单的两种操作的统一入口：根据当前 contextMenuMessageId 查到消息再分发 */
const onContextMenuAction = (action: "edit" | "withdraw") => {
  const id = contextMenuMessageId.value;
  if (!id) return;
  const msg = activeMessages.value.find((m) => m.documentId === id);
  if (!msg) {
    hideContextMenu();
    return;
  }
  if (action === "edit") beginEdit(msg);
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

/** Enter 发送，Shift+Enter 换行（与主流 IM 一致） */
const onComposerKeyDown = (e: KeyboardEvent) => {
  if (e.key !== "Enter") return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return; // 组合键允许换行
  e.preventDefault();
  void doSend();
};

/** ESC 优先关闭：上下文菜单 → 编辑模式 → 弹窗本体 */
const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== "Escape" || !visible.value) return;
  // 如果有更上层的弹窗（如帖子详情 overlay）处于打开状态，不关闭敲敲
  // 敲敲自身也是 .ik-overlay，所以检查数量 > 1
  if (document.querySelectorAll(".ik-overlay").length > 1) return;
  if (contextMenuMessageId.value) {
    hideContextMenu();
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

const handleTabClick = async (tab: KnockTab) => {
  activeTab.value = tab;
  if (tab === "calls") {
    await openCallsTab();
    return;
  }
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
        <!-- 斜线纹理背景（与帖子弹窗一致） -->
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
                      @click="openAiCharacterChat(card)"
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
                        {{ activeConversation?.peer?.name || activeConversation?.title || "NoData" }}
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
                    <!-- 重置 AI 对话上下文（3.3.4）：仅 AI 会话显示 -->
                    <button
                      v-if="isActiveAiConversation"
                      type="button"
                      class="ik-knock__reset"
                      :disabled="resettingContext"
                      aria-label="重置对话"
                      title="清空记忆，开始新话题"
                      @click="handleResetContext"
                    >
                      <ArrowPathIcon class="ik-knock__reset-icon" aria-hidden="true" />
                    </button>
                  </header>
                  <div class="ik-knock__main-body">
                    <!-- 会话消息流 -->
                    <div
                      v-if="activeConversation && activeMessages.length"
                      ref="messagesRef"
                      class="ik-knock__messages"
                      :class="{ 'is-settling': messagesSettling }"
                      @scroll.passive="onMessagesScroll"
                    >
                      <template
                        v-for="entry in enrichedMessages"
                        :key="entry.msg.documentId"
                      >
                        <!-- 时间分隔行：首条或与上条间隔 > 5min 时显示 -->
                        <div
                          v-if="entry.showTime"
                          class="ik-knock__time-divider"
                          :class="{ 'is-new': entry.isNew }"
                        >
                          {{ formatTime(entry.msg.createdAt) }}
                        </div>
                        <!-- system 分界（如「对话已重置」3.3.4）：居中提示，不渲染气泡 -->
                        <div
                          v-if="entry.msg.kind === 'system'"
                          class="ik-knock__sys-divider"
                        >
                          <span>{{ entry.msg.content }}</span>
                        </div>
                        <div
                          v-else
                          class="ik-knock__msg"
                          :class="{
                            'is-new': entry.isNew,
                            'is-mine': entry.isMine,
                          }"
                          @contextmenu="showContextMenu($event, entry.msg)"
                        >
                          <div
                            class="ik-knock__msg-avatar"
                            :class="{ 'is-clickable': entry.avatarClickable }"
                            :role="entry.avatarClickable ? 'button' : undefined"
                            :tabindex="entry.avatarClickable ? 0 : undefined"
                            :aria-hidden="entry.avatarClickable ? undefined : 'true'"
                            :aria-label="entry.avatarClickable ? `查看${entry.msg.sender?.name || '用户'}的主页` : undefined"
                            @click="goToProfile(entry.profileUrl)"
                            @keydown.enter="goToProfile(entry.profileUrl)"
                          >
                            <img
                              v-if="entry.msg.sender?.avatar"
                              :src="entry.msg.sender.avatar"
                              :alt="entry.msg.sender?.name || ''"
                              class="ik-knock__msg-avatar-img"
                              draggable="false"
                            />
                            <img v-else src="/images/default-avatar.webp" alt="" class="ik-knock__msg-avatar-img" draggable="false" />
                          </div>
                          <div class="ik-knock__msg-body">
                            <div
                              class="ik-knock__msg-bubble"
                              :class="{ 'is-deleted': !!entry.msg.deletedAt }"
                            >
                              <template v-if="typeof entry.rendered === 'object'">
                                <CommentBody :content="entry.rendered.content" />
                              </template>
                              <span
                                v-else-if="isPendingStreamBubble(entry.msg)"
                                class="ik-knock__msg-typing"
                                aria-label="正在输入"
                              >
                                <span class="ik-knock__typing-dot" />
                                <span class="ik-knock__typing-dot" />
                                <span class="ik-knock__typing-dot" />
                              </span>
                              <template v-else-if="typeof entry.rendered === 'string' && hasBubbleLinks(entry.rendered)">
                                <template v-for="(seg, si) in parseBubbleSegments(entry.rendered)" :key="si">
                                  <span v-if="seg.type === 'text'">{{ seg.content }}</span>
                                  <a
                                    v-else
                                    :href="seg.href"
                                    class="ik-knock__msg-link"
                                    @click="handleBubbleLink(seg.href, $event)"
                                  >{{ seg.text }}</a>
                                </template>
                              </template>
                              <template v-else>{{ entry.rendered }}</template>
                              <span v-if="entry.msg.editedAt && !entry.msg.deletedAt" class="ik-knock__msg-edited">(已编辑)</span>
                            </div>
                            <!-- 通知 quote 卡：点击跳到关联帖子（postModal） -->
                            <button
                              v-if="entry.quote"
                              type="button"
                              class="ik-knock__msg-quote"
                              @click="goPost(entry.msg)"
                            >
                              <DocumentTextIcon
                                class="ik-knock__msg-quote-icon"
                                aria-hidden="true"
                              />
                              <span class="ik-knock__msg-quote-text">
                                <span class="ik-knock__msg-quote-label">{{ entry.quote.label }}</span>
                                <span class="ik-knock__msg-quote-title">
                                  {{ entry.quote.title }}
                                </span>
                              </span>
                            </button>
                          </div>
                        </div>
                      </template>
                    </div>
                    <!-- 占位：仅在非加载态时显示，避免切换会话时闪烁 -->
                    <div v-else-if="!activeMessageLoading" class="ik-knock__empty-pill">
                      EMPTY
                    </div>

                    <!-- 输入框：仅在有选中会话且非匿名/系统会话时显示 -->
                    <div v-if="activeConversation && !composerDisabled" class="ik-knock__composer">
                      <div
                        v-if="editingMessageId"
                        class="ik-knock__composer-edit-banner"
                      >
                        <span>正在编辑消息</span>
                        <button
                          type="button"
                          class="ik-knock__composer-edit-cancel"
                          @click="cancelEdit"
                        >
                          取消
                        </button>
                      </div>
                      <div
                        v-if="sendError"
                        class="ik-knock__composer-error"
                        role="alert"
                      >
                        {{ sendError }}
                      </div>
                      <div
                        class="ik-knock__composer-row"
                        :class="{ 'is-disabled': composerDisabled }"
                      >
                        <textarea
                          v-if="editingMessageId"
                          ref="composerRef"
                          v-model="editingDraft"
                          class="ik-knock__composer-input"
                          placeholder="编辑消息…"
                          rows="1"
                          maxlength="4000"
                          :disabled="composerDisabled"
                          @keydown="onComposerKeyDown"
                        />
                        <textarea
                          v-else
                          ref="composerRef"
                          v-model="draft"
                          class="ik-knock__composer-input"
                          :placeholder="composerPlaceholder"
                          rows="1"
                          maxlength="4000"
                          :disabled="composerDisabled"
                          @keydown="onComposerKeyDown"
                          @input="onComposerInput"
                        />
                        <button
                          type="button"
                          class="ik-knock__composer-send"
                          :disabled="composerDisabled || sending || (editingMessageId ? !editingDraft.trim() : !draft.trim())"
                          :aria-label="editingMessageId ? '保存编辑' : '发送'"
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
          type="button"
          class="ik-knock__context-menu-item"
          @click="onContextMenuAction('edit')"
        >
          编辑
        </button>
        <button
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

/* system 分界提示（如「对话已重置」3.3.4） */
.ik-knock__sys-divider {
  display: flex;
  justify-content: center;
  margin: 10px 0;
}

.ik-knock__sys-divider span {
  font-size: 12px;
  color: #888;
  background: rgba(255, 255, 255, 0.05);
  padding: 3px 12px;
  border-radius: 10px;
}

.ik-knock__main-title {
  font-size: 17px;
  font-weight: 900;
  color: #fff;
}

/* ── 正在输入指示器 ─────────────────────── */
.ik-knock__typing-indicator {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 14px;
}

/* 流式占位气泡内的加载点（首个 delta 未到达前） */
.ik-knock__msg-typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 1.2em;
  vertical-align: middle;
}

/* 气泡内的加载点需要用深色（默认白色点在白底气泡上不可见） */
.ik-knock__msg-typing .ik-knock__typing-dot {
  background: rgba(0, 0, 0, 0.35);
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

/* 消息头像可点击跳转个人主页 */
.ik-knock__msg-avatar.is-clickable {
  cursor: pointer;
  transition: opacity 140ms ease;
}

.ik-knock__msg-avatar.is-clickable:hover {
  opacity: 0.8;
}

.ik-knock__msg-avatar.is-clickable:focus-visible {
  outline: 2px solid #fbfe00;
  outline-offset: 2px;
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

/*
 * 白底气泡里的 @mention 芯片需要单独配色：
 * 默认 MentionChip 是「黄绿字 + 透明底」，在白底上几乎不可读。
 * 这里用 :deep 穿透 scoped 边界，把它改成「黄底黑字小标签」——
 * 与 KnockKnock 选中态的 #fbfe00 主色一致，整体语言统一。
 */
.ik-knock__msg-bubble :deep(.ik-mention) {
  background-color: #fbfe00;
  color: #000;
  padding: 0 6px;
  border-radius: 4px;
  font-weight: 700;
}

.ik-knock__msg-bubble :deep(.ik-mention:hover),
.ik-knock__msg-bubble :deep(.ik-mention:focus-visible) {
  background-color: #e8eb00;
  color: #000;
}

/* ── 消息入场动画（仅增量到达的新消息，仅动画 transform + opacity 不触发重排） ── */
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

/* ── AI 回复内 markdown 链接样式（白底气泡上需要深色链接） ── */
.ik-knock__msg-link {
  color: #2c58e2;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  transition: color 120ms ease;
}

.ik-knock__msg-link:hover {
  color: #1a3fad;
}

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

  /* 消息区 + 输入框：底部安全区留白，避免被 Home 条遮挡 */
  .ik-knock__main-body {
    padding: 14px;
  }

  .ik-knock__composer {
    padding-bottom: env(safe-area-inset-bottom);
  }

  .ik-knock__empty-pill {
    padding: 12px 48px;
    min-width: 240px;
    font-size: 16px;
    letter-spacing: 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  /* .ik-overlay-* 动画在 theme.css 全局接管，这里只管本组件专有的 is-new 动画 */
  .ik-knock__msg.is-new,
  .ik-knock__time-divider.is-new {
    animation: none;
  }
}

/* ═══════════════════════════════════════════════
   DM 私聊：自己的消息（右侧） + 编辑/撤回态 + Composer + 上下文菜单
   ═══════════════════════════════════════════════ */

/* 自己发的消息：头像 + 气泡整体右对齐；nipple 改右上 */
.ik-knock__msg.is-mine {
  flex-direction: row-reverse;
}

.ik-knock__msg.is-mine .ik-knock__msg-body {
  align-items: flex-end;
}

.ik-knock__msg.is-mine .ik-knock__msg-bubble {
  align-self: flex-end;
  /* 参考 zenless-tools chat-generator：Right 侧 accent-dark (#2c58e2) + 白字
     是 ZZZ 游戏内蓝色对话框的视觉语言；之前的黄底是项目自创版本，统一回原版 */
  background: #2c58e2;
  color: #fff;
}

/* 右侧 nipple：使用专门的右箭头 webp（zenless-tools chat_message_arrow_right.webp），
   注意右侧偏移 -0.34375em 与左侧 -0.4375em 不同——原始资源箭头形状不对称 */
.ik-knock__msg.is-mine .ik-knock__msg-bubble::before {
  left: auto;
  right: -0.34375em;
  background-image: url("/images/chat_message_arrow_right.webp");
  transform: none;
}

/* 撤回的消息：灰色斜体小占位 */
.ik-knock__msg-bubble.is-deleted {
  background: rgba(255, 255, 255, 0.06) !important;
  color: rgba(255, 255, 255, 0.45) !important;
  font-style: italic;
  font-weight: 500;
}

.ik-knock__msg-bubble.is-deleted::before {
  display: none;
}

/* "(已编辑)" 小标 */
.ik-knock__msg-edited {
  margin-left: 6px;
  color: rgba(0, 0, 0, 0.4);
  font-size: 11px;
  font-weight: 600;
}

/* 自己气泡是蓝底白字 → "(已编辑)" 用半透明白保持层级 */
.ik-knock__msg.is-mine .ik-knock__msg-edited {
  color: rgba(255, 255, 255, 0.7);
}

/* 对端气泡是白底，"(已编辑)"用浅灰 */
.ik-knock__msg:not(.is-mine) .ik-knock__msg-edited {
  color: rgba(0, 0, 0, 0.35);
}

/* ── Composer ──────────────────────────────── */
.ik-knock__composer {
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 10px;
  border-top: 2px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-knock__composer-edit-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(251, 254, 0, 0.12);
  color: #fbfe00;
  font-size: 12px;
  font-weight: 700;
}

.ik-knock__composer-edit-cancel {
  border: 0;
  background: transparent;
  color: #fbfe00;
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
  padding: 0;
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
  border-color: #fbfe00;
}

/* pseudo:anonymous / pseudo:system 会话：输入框整体禁用态 */
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

/* ── 上下文菜单（编辑/撤回） ───────────────── */
/* 全屏遮罩：捕获点击关闭菜单 */
.ik-knock__context-menu-mask {
  position: fixed;
  inset: 0;
  /* 高于弹窗主体；与帖子弹窗 9000 同级或略高 */
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
