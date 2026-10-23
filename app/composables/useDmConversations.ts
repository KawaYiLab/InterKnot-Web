/**
 * useDmConversations —— 私聊数据层（REST + 实时事件合并）。
 *
 * 这是一个跨页面的共享 store（基于 Nuxt useState），多个组件调用同一个
 * composable 拿到的是同一份会话列表 / 消息缓存。
 *
 * 数据源是 ik-server 的统一收件箱（`/v1/inbox`）：私聊会话与通知分组按最后活动混排，
 * 与某人有私聊时，他发来的通知直接并进那个会话（会话时间线里消息与通知混排）。
 * 没有私聊的通知分组在前端是 pseudo 会话：
 *   - `pseudo:user:<用户 id>`：某个用户发来的通知；发消息时先开私聊（实质化成真会话）
 *   - `pseudo:system`：系统通知，不可回复
 *
 * 责任划分：
 *  - 传输层：`useDmStream`（跑在共享的 /v1/realtime 连接上）；本 composable 仅订阅事件。
 *  - 业务层（本文件）：拉收件箱（游标分页，见 refresh / loadMoreConversations）
 *                       / 懒加载时间线 / 发送 - 编辑 - 撤回 / 标已读
 *                       / 离开 / 接实时事件 patch 缓存（含去重）。
 *  - 发送 / 编辑 / 撤回走 HTTP，落地后还会从实时通道收到同一条事件——按 documentId 去重。
 */
import { computed, type ComputedRef, type Ref } from "vue";
import type { ApiClientError } from "~/types/api";
import type {
  AiWorkflowEvent,
  DmConversationSummary,
  DmMessage,
  DmMessageKind,
  DmNotificationKind,
  DmPeer,
} from "~/types/entities";
import type { DmStreamEvent } from "~/composables/useDmStream";

/** 单会话消息缓存：本地按 documentId 维护 */
interface ConversationMessageState {
  /** 按 createdAt asc 排序 */
  items: DmMessage[];
  loading: boolean;
  /** 是否还有更老的历史可拉（向上分页） */
  hasMore: boolean;
  /** 拉历史时传给后端的 cursor */
  nextCursor: string | null;
  /** 是否已经首屏加载过；进入会话时跳过重复请求 */
  hydrated: boolean;
  /** 加载期间收到 force=true 请求时标记，加载完成后自动触发一次 force-reload */
  pendingForceReload: boolean;
}

const emptyMessageState = (): ConversationMessageState => ({
  items: [],
  loading: false,
  hasMore: false,
  nextCursor: null,
  hydrated: false,
  pendingForceReload: false,
});

/** 会话列表每页条数 */
const CONVERSATION_PAGE_SIZE = 20;
/** 时间线每页条数（后端上限 50） */
const MESSAGE_PAGE_SIZE = 50;

// ── 后端 DTO（只列这里读到的字段） ─────────────────────

interface PeerDto {
  id?: string | null;
  name: string;
  level?: number | null;
  avatarUrl?: string | null;
}

interface InboxEntryDto {
  key: string;
  kind: "conversation" | "notifications";
  conversationId?: string | null;
  /** `direct` | `ai`（只有私聊会话有） */
  conversationKind?: string | null;
  /** AI 会话的标题 */
  title?: string | null;
  peer: PeerDto;
  activityAt: string;
  preview?: { at: string; fromMe: boolean; kind: string; text: string } | null;
  unreadCount: number;
  muted: boolean;
  pinned: boolean;
}

interface InboxPageDto {
  items: InboxEntryDto[];
  nextCursor?: string | null;
  totalUnread?: number | null;
}

interface ConversationDto {
  id: string;
  kind: string;
  title?: string | null;
  peer: PeerDto;
  muted: boolean;
  pinned: boolean;
  activityAt: string;
  lastReadAt?: string | null;
  lastMessage?: { id: string; createdAt: string; preview: string; senderId: string } | null;
  unreadCount: number;
}

interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  kind: string;
  content?: string | null;
  createdAt: string;
  editedAt?: string | null;
  withdrawnAt?: string | null;
  replyTo?: { id: string; senderId?: string | null; content?: string | null; withdrawn: boolean } | null;
  images?: { id: string; url: string; width?: number | null; height?: number | null }[];
  ai?: { state: string; modelKey?: string | null; workflow?: AiWorkflowEvent[] | null } | null;
}

interface NotificationDtoV1 {
  id: string;
  kind: string;
  bucket: string;
  summary: string;
  excerpt: string;
  isRead: boolean;
  createdAt: string;
  postId?: string | null;
  postTitle?: string | null;
  commentId?: string | null;
  sender?: PeerDto | null;
}

type InboxItemDto =
  | { type: "message"; message: MessageDto }
  | { type: "notification"; notification: NotificationDtoV1 };

interface UseDmConversations {
  conversations: ComputedRef<DmConversationSummary[]>;
  isLoading: ComputedRef<boolean>;
  error: ComputedRef<string | null>;
  /** 全部未读总和（用于头部红点等场景）——服务端权威值 + 本地增量修正 */
  totalUnread: ComputedRef<number>;

  /** 会话列表是否还有下一页 */
  hasMoreConversations: ComputedRef<boolean>;
  /** 正在追加下一页（与首屏 isLoading 分开，避免列表闪空） */
  isLoadingMoreConversations: ComputedRef<boolean>;
  /** 追加下一页会话；无更多 / 正在加载时是 no-op */
  loadMoreConversations: () => Promise<void>;

  /** 当前选中会话 id（documentId）；切换会话时设置 */
  activeConversationId: Ref<string | null>;
  /** typing：conversationId → 正在输入的 userId 数组 */
  typingByConversation: ComputedRef<Record<string, string[]>>;

  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  /** 取/建私聊会话，返回 summary 与 isNew */
  openDirectConversation: (
    targetUserId: string,
  ) => Promise<{ summary: DmConversationSummary; isNew: boolean }>;
  /** 为指定 AI 角色新建一个独立会话 */
  createAiSession: (
    characterSlug: string,
    title?: string,
  ) => Promise<DmConversationSummary>;
  /** 删除/离开当前会话 */
  deleteConversation: (id: string) => Promise<void>;

  /**
   * 取某会话的消息状态。返回 plain object 而非 ComputedRef——调用方在
   * setup 阶段自己用 `computed(() => messageStateOf(id))` 包装一次即可。
   */
  messageStateOf: (id: string) => ConversationMessageState;
  ensureMessages: (id: string, force?: boolean) => Promise<void>;
  loadMoreMessages: (id: string) => Promise<void>;

  sendMessage: (
    conversationId: string,
    payload: { content: string; kind?: DmMessageKind; replyTo?: string; imageIds?: string[] },
  ) => Promise<DmMessage>;
  editMessage: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => Promise<void>;
  withdrawMessage: (
    conversationId: string,
    messageId: string,
  ) => Promise<void>;

  /** 该消息是否正在流式接收中，用于跳过打字机、直接展示累计文本 */
  isStreamingMessage: (documentId: string) => boolean;

  /** AI 工作流实时事件：流式生成期间按 messageId 聚合的事件序列 */
  workflowEventsOf: (messageId: string) => AiWorkflowEvent[];

  markConversationAsRead: (id: string, opts?: { force?: boolean }) => Promise<void>;
  /** 一键已读：清零所有会话（真实私聊 + 通知分组）的未读 */
  markAllAsRead: () => Promise<void>;
  /** 设置 muted/pinned；title 与 aiModelKey 仅 AI 会话可用（aiModelKey 传 null 清除选择） */
  updateConversation: (
    id: string,
    patch: { muted?: boolean; pinned?: boolean; title?: string; aiModelKey?: string | null },
  ) => Promise<void>;
  leaveConversation: (id: string) => Promise<void>;

  /** 重置 AI 对话上下文：写入 system 分界消息，等效清空记忆开新话题 */
  resetContext: (id: string) => Promise<void>;

  /** 停止 AI 流式生成：messageId 为流式占位消息 documentId */
  stopAiStream: (messageId: string) => Promise<void>;

  /** 重新生成 AI 回复：messageId 为会话最后一条 AI 回复 documentId */
  regenerateAiReply: (messageId: string, aiModelKey?: string | null) => Promise<void>;

  /** 发送 typing 状态（节流由调用方控制） */
  sendTyping: (conversationId: string) => void;

  /** 手动清除指定会话的 typing 状态（可选指定 userId，默认清空整个会话） */
  clearTyping: (conversationId: string, userId?: string | null) => void;

  /** 启停实时事件订阅 */
  startStream: () => void;
  stopStream: () => void;

  /** 登出 / 切账号时清状态 */
  reset: () => void;
}

// ──────────────────────────────────────────────────────
// 模块级一次性资源：事件订阅 unsubscribe + typing 超时句柄。
// useState 不能存 function，所以放在这里。
// ──────────────────────────────────────────────────────
let unsubscribeAll: Array<() => void> = [];
let subscribed = false;
let typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const TYPING_TTL_MS = 3_000;
let finalizedAtByConv = new Map<string, number>();
const TYPING_IGNORE_AFTER_FINALIZE_MS = 1_500;
let notificationRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const NOTIFICATION_REFRESH_DEBOUNCE_MS = 250;

interface ConversationRefresh {
  generation: number;
  showLoading: boolean;
  promise: Promise<void>;
}

// 共享请求独立于 UI loading：静默刷新也必须去重，同一个账号的所有调用方
// 都等待同一份结果。按 auth store 隔离，避免 SSR 请求间串用 Promise。
const conversationRefreshes = new WeakMap<object, ConversationRefresh>();

const DM_KEY_PREFIX = "dm-";

/** 收件箱键 → 前端会话 id（真会话用会话 id，通知分组用 pseudo id）。 */
function conversationIdForKey(key: string, conversationId?: string | null): string {
  if (conversationId) return conversationId;
  if (key.startsWith(DM_KEY_PREFIX)) return key.slice(DM_KEY_PREFIX.length);
  if (key.startsWith("user-")) return `pseudo:user:${key.slice(5)}`;
  return "pseudo:system";
}

/** 前端会话 id → 收件箱键。 */
function inboxKeyOf(id: string): string {
  if (id === "pseudo:system") return "system";
  if (id.startsWith("pseudo:user:")) return `user-${id.slice("pseudo:user:".length)}`;
  return `${DM_KEY_PREFIX}${id}`;
}

const NOTIFICATION_KINDS = new Set<DmNotificationKind>([
  "like", "favorite", "comment", "reply", "mention", "system", "denny", "accepted",
]);

const AI_DONE_STATES = new Set(["done", "stopped", "failed"]);

export function useDmConversations(): UseDmConversations {
  const conversations = useState<DmConversationSummary[]>(
    "dm:conversations",
    () => [],
  );
  const isLoading = useState<boolean>("dm:loading", () => false);
  const error = useState<string | null>("dm:error", () => null);

  // ── 会话列表分页（游标）────────────────────────────
  const convNextCursor = useState<string | null>("dm:convNextCursor", () => null);
  const convHasMore = useState<boolean>("dm:convHasMore", () => false);
  const convLoadingMore = useState<boolean>("dm:convLoadingMore", () => false);
  /**
   * 已加载的页数。用来判断 refresh() 该「整体替换」还是「只覆盖第一页」——
   * 静默 refresh 很频繁（新通知 / 切回前台 / 打开弹窗），如果每次都替换成第一页，
   * 用户滚了几页的列表会被反复截回 20 条，哨兵又立刻进入视口重新翻页。
   */
  const convPagesLoaded = useState<number>("dm:convPagesLoaded", () => 0);
  /**
   * 未读总数。分页后不能再对 conversations 求和——列表只有已加载的那几页。
   * 第一页响应的 totalUnread 是权威值，之后由实时事件 / 本地已读操作增量修正。
   */
  const unreadTotal = useState<number | null>("dm:unreadTotal", () => null);

  const messagesById = useState<Record<string, ConversationMessageState>>(
    "dm:messages",
    () => ({}),
  );

  const activeConversationId = useState<string | null>(
    "dm:activeConversationId",
    () => null,
  );

  // typing 状态：conversationId → 正在输入的 userId 数组
  const typing = useState<Record<string, string[]>>(
    "dm:typing",
    () => ({}),
  );

  // 流式回复：正在增量接收中的消息 documentId 集合。
  // 这些消息走「直接展示累计文本」而非打字机动画。
  const streamingMessageIds = useState<Set<string>>(
    "dm:streamingMessageIds",
    () => new Set(),
  );

  // AI 工作流：流式生成期间的实时事件聚合，messageId → 事件序列。
  // 定稿时事件已随消息 workflow 字段下发，实时缓存即清除。
  const workflowByMessageId = useState<Record<string, AiWorkflowEvent[]>>(
    "dm:workflowEvents",
    () => ({}),
  );

  const { $api } = useNuxtApp();
  const auth = useAuthStore();
  const stream = useDmStream();
  const { characters: aiCharacters } = useAiCharacters();

  const selfUserId = computed<string | null>(() => {
    const id = auth.user?.id;
    return id != null && id !== "" ? String(id) : null;
  });

  /** AI 角色绑定的账号 id（判断对方是不是 AI） */
  const aiUserIds = computed(() =>
    new Set(aiCharacters.value.map((c) => c.boundUser?.id).filter((id): id is string => !!id)),
  );

  // ── 形状翻译 ────────────────────────────────────────

  const toPeer = (peer: PeerDto | null | undefined, isAi = false): DmPeer => {
    const userId = peer?.id ?? null;
    return {
      userId,
      authorDocumentId: userId,
      name: peer?.name || "",
      avatar: peer?.avatarUrl ?? null,
      level: peer?.level ?? null,
      isAiAgent: isAi || (!!userId && aiUserIds.value.has(userId)),
    };
  };

  const summaryFromEntry = (entry: InboxEntryDto): DmConversationSummary => {
    const documentId = conversationIdForKey(entry.key, entry.conversationId);
    const isConversation = entry.kind === "conversation";
    const isAi = entry.conversationKind === "ai";
    const pseudoKind = isConversation ? null : entry.key === "system" ? "system" : "user";
    const preview = entry.preview;
    const peer = toPeer(entry.peer, isAi);
    const existing = conversations.value.find((c) => c.documentId === documentId);
    return {
      documentId,
      kind: "direct",
      title: entry.title ?? existing?.title ?? null,
      avatar: peer.avatar,
      peer,
      memberCount: isConversation ? 2 : 1,
      lastMessageAt: entry.activityAt,
      lastMessage: preview
        ? {
            documentId: `${entry.key}:${preview.at}`,
            content: preview.text,
            createdAt: preview.at,
            kind: preview.kind === "notification" ? "notification" : "text",
            senderUserId: preview.fromMe ? selfUserId.value : peer.userId,
          }
        : null,
      unreadCount: entry.unreadCount,
      self: {
        role: "member",
        muted: entry.muted,
        pinned: entry.pinned,
        lastReadAt: existing?.self.lastReadAt ?? null,
      },
      pseudoKind,
      aiModelKey: existing?.aiModelKey,
      inboxKey: entry.key,
    };
  };

  const summaryFromConversation = (cv: ConversationDto): DmConversationSummary => {
    const peer = toPeer(cv.peer, cv.kind === "ai");
    const existing = conversations.value.find((c) => c.documentId === cv.id);
    return {
      documentId: cv.id,
      kind: "direct",
      title: cv.title ?? null,
      avatar: peer.avatar,
      peer,
      memberCount: 2,
      lastMessageAt: cv.activityAt,
      lastMessage: cv.lastMessage
        ? {
            documentId: cv.lastMessage.id,
            content: cv.lastMessage.preview,
            createdAt: cv.lastMessage.createdAt,
            kind: "text",
            senderUserId: cv.lastMessage.senderId,
          }
        : existing?.lastMessage ?? null,
      unreadCount: existing?.unreadCount ?? cv.unreadCount,
      self: {
        role: "member",
        muted: cv.muted,
        pinned: cv.pinned,
        lastReadAt: cv.lastReadAt ?? null,
      },
      pseudoKind: null,
      aiModelKey: existing?.aiModelKey,
      inboxKey: `${DM_KEY_PREFIX}${cv.id}`,
    };
  };

  /** 消息的发送者：要么是自己，要么是会话对方（私聊只有两个人）。 */
  const senderOf = (senderId: string, conversationId: string) => {
    if (senderId && senderId === selfUserId.value) {
      const me = auth.user;
      return {
        userId: senderId,
        authorDocumentId: senderId,
        name: me?.name || me?.username || "",
        avatar: me?.avatar || null,
        level: me?.level ?? null,
        isAiAgent: false,
      };
    }
    const peer = conversations.value.find((c) => c.documentId === conversationId)?.peer;
    return {
      userId: senderId || null,
      authorDocumentId: senderId || null,
      name: peer?.name || "",
      avatar: peer?.avatar ?? null,
      level: peer?.level ?? null,
      isAiAgent: peer?.isAiAgent === true || (!!senderId && aiUserIds.value.has(senderId)),
    };
  };

  const toDmMessage = (m: MessageDto): DmMessage => ({
    documentId: m.id,
    kind: (m.kind === "system" ? "system" : m.kind === "image" ? "image" : "text") as DmMessageKind,
    content: m.withdrawnAt ? null : (m.content ?? ""),
    createdAt: m.createdAt,
    editedAt: m.editedAt ?? null,
    deletedAt: m.withdrawnAt ?? null,
    sender: senderOf(m.senderId, m.conversationId),
    replyTo: m.replyTo
      ? {
          documentId: m.replyTo.id,
          content: m.replyTo.withdrawn ? null : (m.replyTo.content ?? null),
          senderUserId: m.replyTo.senderId ?? null,
        }
      : null,
    images: m.withdrawnAt
      ? []
      : (m.images ?? []).map((i) => ({
          documentId: i.id,
          url: i.url,
          width: i.width ?? undefined,
          height: i.height ?? undefined,
        })),
    workflow: m.ai?.workflow ?? null,
    aiModelKey: m.ai?.modelKey ?? null,
  });

  const notificationToDmMessage = (n: NotificationDtoV1): DmMessage => {
    const kind = (NOTIFICATION_KINDS.has(n.kind as DmNotificationKind) ? n.kind : "system") as DmNotificationKind;
    const senderId = n.sender?.id ?? null;
    return {
      documentId: `notif:${n.id}`,
      kind: "notification",
      content: n.summary,
      createdAt: n.createdAt,
      editedAt: null,
      deletedAt: null,
      sender: n.sender
        ? {
            userId: senderId,
            authorDocumentId: senderId,
            name: n.sender.name,
            avatar: n.sender.avatarUrl ?? null,
            level: n.sender.level ?? null,
          }
        : null,
      replyTo: null,
      notificationKind: kind,
      notificationDocumentId: n.id,
      notificationRead: n.isRead,
      article: n.postId ? { documentId: n.postId, title: n.postTitle || "" } : null,
      comment: n.commentId
        ? { documentId: n.commentId, content: n.excerpt, isAnonymous: false }
        : null,
    };
  };

  const toTimelineItem = (item: InboxItemDto): DmMessage =>
    item.type === "message" ? toDmMessage(item.message) : notificationToDmMessage(item.notification);

  // ── 基础工具 ────────────────────────────────────────
  /**
   * 立即清除指定会话（及对应用户）的 typing 状态并取消定时器。
   * 当流式完成或新消息到达时主动调用，
   * 杜绝依靠超时定时器自然过期导致的“消息已发完但仍然显示输入中”。
   */
  const clearConversationTyping = (cid: string, uid?: string | null) => {
    if (!cid) return;
    if (typeof uid === "string" && uid) {
      const key = `${cid}:${uid}`;
      const timer = typingTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        typingTimers.delete(key);
      }
      const list = typing.value[cid];
      if (list && list.includes(uid)) {
        const next = list.filter((id) => id !== uid);
        if (next.length === 0) {
          const copy = { ...typing.value };
          delete copy[cid];
          typing.value = copy;
        } else {
          typing.value = { ...typing.value, [cid]: next };
        }
      }
    } else {
      for (const [key, timer] of typingTimers.entries()) {
        if (key.startsWith(`${cid}:`)) {
          clearTimeout(timer);
          typingTimers.delete(key);
        }
      }
      if (typing.value[cid]) {
        const copy = { ...typing.value };
        delete copy[cid];
        typing.value = copy;
      }
    }
  };

  const ensureMessageBucket = (id: string): ConversationMessageState => {
    let bucket = messagesById.value[id];
    if (!bucket) {
      bucket = emptyMessageState();
      messagesById.value = { ...messagesById.value, [id]: bucket };
    }
    return bucket;
  };

  const patchMessageState = (id: string, patch: Partial<ConversationMessageState>) => {
    const prev = messagesById.value[id] ?? emptyMessageState();
    messagesById.value = {
      ...messagesById.value,
      [id]: { ...prev, ...patch },
    };
  };

  /** 按 createdAt asc 合并消息（dedup by documentId，incoming 覆盖同 id） */
  const mergeMessages = (existing: DmMessage[], incoming: DmMessage[]): DmMessage[] => {
    if (incoming.length === 0) return existing;
    const map = new Map<string, DmMessage>();
    for (const it of existing) {
      if (it?.documentId) map.set(it.documentId, it);
    }
    for (const it of incoming) {
      if (it?.documentId) map.set(it.documentId, it);
    }
    return Array.from(map.values()).sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return da - db;
    });
  };

  /** 列表排序：pinned desc, lastMessageAt desc（与后端收件箱同口径）；不改动入参 */
  const sortConversations = (list: DmConversationSummary[]): DmConversationSummary[] =>
    [...list].sort((a, b) => {
      const ap = a.self?.pinned ? 1 : 0;
      const bp = b.self?.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });

  /** 未读总数增量修正；服务端没给权威值时不做任何事 */
  const bumpUnreadTotal = (delta: number): void => {
    if (unreadTotal.value == null || delta === 0) return;
    unreadTotal.value = Math.max(0, unreadTotal.value + delta);
  };

  /** 把单个 conversation summary 写回列表，按 (pinned desc, lastMessageAt desc) 重排 */
  const upsertConversation = (next: DmConversationSummary): void => {
    const list = conversations.value;
    const idx = list.findIndex((c) => c.documentId === next.documentId);
    let copy: DmConversationSummary[];
    if (idx >= 0) {
      copy = list.slice();
      copy[idx] = next;
    } else {
      copy = [next, ...list];
    }
    conversations.value = sortConversations(copy);
  };

  const patchConversation = (
    id: string,
    patch: Partial<DmConversationSummary>,
    resort = false,
  ) => {
    const list = conversations.value;
    const idx = list.findIndex((c) => c.documentId === id);
    if (idx < 0) return;
    const copy = list.slice();
    copy[idx] = { ...copy[idx], ...patch } as DmConversationSummary;
    conversations.value = resort ? sortConversations(copy) : copy;
  };

  // ── REST 调用 ────────────────────────────────────────
  /**
   * 拉收件箱**第一页**。
   *
   * 已经翻过页时**不**把列表截回第一页：静默 refresh 由新通知 / 切回前台 / 打开
   * 弹窗触发，很频繁；截断会让用户滚到的位置反复丢失。此时只用第一页的权威数据覆盖
   * 同 documentId 的项，尾部已加载的页保留。totalUnread 每次都校正回来。
   */
  function refresh(opts?: { silent?: boolean }): Promise<void> {
    if (!auth.isLogin) return Promise.resolve();
    const silent = opts?.silent === true;
    const generation = auth.generation;
    const existing = conversationRefreshes.get(auth);
    if (existing?.generation === generation) {
      if (!silent) {
        existing.showLoading = true;
        isLoading.value = true;
        error.value = null;
      }
      return existing.promise;
    }

    const request: ConversationRefresh = {
      generation,
      showLoading: !silent,
      promise: Promise.resolve(),
    };
    const isCurrent = () =>
      auth.isLogin && auth.generation === generation && conversationRefreshes.get(auth) === request;
    if (!silent) {
      isLoading.value = true;
      error.value = null;
    }
    conversationRefreshes.set(auth, request);
    request.promise = (async () => {
      try {
        const resp = await $api<InboxPageDto>("/v1/inbox", {
          query: { limit: CONVERSATION_PAGE_SIZE },
        });
        if (!isCurrent()) return;
        const incoming = (resp?.items ?? []).map(summaryFromEntry);
        if (convPagesLoaded.value > 1) {
          const byId = new Map(conversations.value.map((c) => [c.documentId, c]));
          for (const c of incoming) byId.set(c.documentId, c);
          conversations.value = sortConversations([...byId.values()]);
          // cursor / hasMore 不动：后续页仍接在已加载列表之后
        } else {
          conversations.value = incoming;
          convPagesLoaded.value = 1;
          convNextCursor.value = resp?.nextCursor ?? null;
          convHasMore.value = !!resp?.nextCursor;
        }
        unreadTotal.value = typeof resp?.totalUnread === "number" ? resp.totalUnread : null;
      } catch (err) {
        if (!isCurrent()) return;
        if (request.showLoading) {
          const e = err as ApiClientError;
          error.value = e?.message || "加载失败";
        }
        // 不清空 conversations：网络抖动 / 短暂 5xx 时保留旧列表；error 已暴露给上层 UI。
      } finally {
        if (isCurrent()) {
          isLoading.value = false;
          conversationRefreshes.delete(auth);
        }
      }
    })();
    return request.promise;
  }

  /**
   * 追加下一页会话。
   *
   * 合并策略：按 documentId 去重，且**已有项不被新数据覆盖**——列表里的项可能
   * 已被实时事件 patch 过，而分页响应是服务端在更早时刻的快照。
   */
  async function loadMoreConversations(): Promise<void> {
    if (!auth.isLogin || !convHasMore.value || convLoadingMore.value) return;
    const generation = auth.generation;
    const cursor = convNextCursor.value;
    if (!cursor) {
      convHasMore.value = false;
      return;
    }
    convLoadingMore.value = true;
    try {
      const resp = await $api<InboxPageDto>("/v1/inbox", {
        query: { limit: CONVERSATION_PAGE_SIZE, cursor },
      });
      if (auth.generation !== generation || !auth.isLogin) return;
      const known = new Set(conversations.value.map((c) => c.documentId));
      const fresh = (resp?.items ?? []).map(summaryFromEntry).filter((c) => !known.has(c.documentId));
      if (fresh.length > 0) {
        conversations.value = sortConversations([...conversations.value, ...fresh]);
      }
      convNextCursor.value = resp?.nextCursor ?? null;
      convHasMore.value = !!resp?.nextCursor;
      convPagesLoaded.value += 1;
    } catch {
      // 静默失败：保留已加载的页，哨兵下次进入视口时会重试
    } finally {
      if (auth.generation === generation) convLoadingMore.value = false;
    }
  }

  async function openDirectConversation(
    targetUserId: string,
  ): Promise<{ summary: DmConversationSummary; isNew: boolean }> {
    const isNew = !conversations.value.some(
      (c) => !c.pseudoKind && c.peer?.userId === targetUserId && c.peer?.isAiAgent !== true,
    );
    const cv = await $api<ConversationDto>("/v1/dm/direct", {
      method: "POST",
      body: { userId: targetUserId },
    });
    if (!cv?.id) throw new Error("invalid direct response");
    const summary = summaryFromConversation(cv);
    upsertConversation(summary);
    return { summary, isNew };
  }

  async function createAiSession(
    characterSlug: string,
    title?: string,
  ): Promise<DmConversationSummary> {
    const cv = await $api<ConversationDto>("/v1/ai/sessions", {
      method: "POST",
      body: { character: characterSlug, ...(title ? { title } : {}) },
    });
    if (!cv?.id) throw new Error("invalid ai session response");
    const summary = summaryFromConversation(cv);
    upsertConversation(summary);
    return summary;
  }

  async function deleteConversation(id: string): Promise<void> {
    await $api(`/v1/dm/conversations/${encodeURIComponent(id)}/leave`, { method: "POST" });
    removeConversation(id, { dropUnread: true });
  }

  /**
   * 从列表里移除指定会话（连同消息桶）。
   *
   * dropUnread：会话真的从服务端视图消失了（离开 / 删除）时传 true，把它的未读
   * 从红点总数里扣掉。pseudo 项实质化为真会话这种「换身份」的场景不能扣——未读
   * 还在，只是挂到了新的 documentId 上。
   */
  function removeConversation(id: string, opts?: { dropUnread?: boolean }): void {
    if (opts?.dropUnread) {
      const conv = conversations.value.find((c) => c.documentId === id);
      if (conv?.unreadCount) bumpUnreadTotal(-conv.unreadCount);
    }
    conversations.value = conversations.value.filter((c) => c.documentId !== id);
    if (messagesById.value[id]) {
      const next = { ...messagesById.value };
      delete next[id];
      messagesById.value = next;
    }
  }

  /**
   * 把 pseudo:user:N 会话懒激活为真私聊会话。
   *
   * 触发场景：用户在 pseudo 会话里点击「发送」时，需要先开私聊，然后才能写消息。
   * 开了私聊之后，对方的通知会并进这个会话（服务端合并），所以 pseudo 项直接移除，
   * 已加载的通知历史拷到真会话桶，避免发完消息再加载时通知历史短暂消失。
   *
   * 返回真会话 summary；若入参不是 pseudo:user 形式则返回 null。
   */
  async function materializePseudoUserConversation(
    pseudoId: string,
  ): Promise<DmConversationSummary | null> {
    const m = /^pseudo:user:(\d+)$/.exec(pseudoId);
    if (!m || !m[1]) return null;
    const pseudo = conversations.value.find((c) => c.documentId === pseudoId);

    const { summary } = await openDirectConversation(m[1]);
    // 通知分组的未读并进了会话
    if (pseudo?.unreadCount) {
      patchConversation(summary.documentId, { unreadCount: summary.unreadCount + pseudo.unreadCount });
    }

    const pseudoBucket = messagesById.value[pseudoId];
    if (pseudoBucket?.hydrated) {
      const realBucket = messagesById.value[summary.documentId];
      if (!realBucket || !realBucket.hydrated) {
        patchMessageState(summary.documentId, { ...pseudoBucket });
      } else {
        patchMessageState(summary.documentId, {
          items: mergeMessages(realBucket.items, pseudoBucket.items),
          hydrated: true,
          loading: realBucket.loading,
          hasMore: realBucket.hasMore || pseudoBucket.hasMore,
          nextCursor: realBucket.nextCursor ?? pseudoBucket.nextCursor,
        });
      }
    }

    // 切换 active 到真会话（在删 pseudo 前切，避免 watch 看到 null）
    if (activeConversationId.value === pseudoId) {
      activeConversationId.value = summary.documentId;
    }
    removeConversation(pseudoId);

    return summary;
  }

  async function fetchTimelinePage(id: string, cursor: string | null) {
    const query: Record<string, string> = { limit: String(MESSAGE_PAGE_SIZE) };
    if (cursor) query.cursor = cursor;
    const resp = await $api<{ items: InboxItemDto[]; nextCursor?: string | null }>(
      `/v1/inbox/${encodeURIComponent(inboxKeyOf(id))}/items`,
      { query },
    );
    // 后端新的在前；前端存为旧的在前
    const items = (resp?.items ?? []).map(toTimelineItem).reverse();
    return { items, nextCursor: resp?.nextCursor ?? null };
  }

  /** AI 会话的模型选择与标题只在会话设置里有，进会话时补一次。 */
  async function hydrateAiSession(id: string): Promise<void> {
    const conv = conversations.value.find((c) => c.documentId === id);
    if (!conv || conv.pseudoKind || !conv.peer?.isAiAgent || conv.aiModelKey !== undefined) return;
    try {
      const session = await $api<{ title?: string | null; modelKey?: string | null }>(
        `/v1/ai/sessions/${encodeURIComponent(id)}`,
      );
      patchConversation(id, {
        aiModelKey: session.modelKey ?? null,
        ...(session.title ? { title: session.title } : {}),
      });
    } catch {
      // 不是 AI 会话或角色已下线：沿用默认
    }
  }

  async function ensureMessages(id: string, force = false): Promise<void> {
    const bucket = ensureMessageBucket(id);
    if (bucket.hydrated && !force) return;
    if (bucket.loading) {
      // 正在加载中时收到 force=true（如实时推送触发的 force-reload）：
      // 标记 pendingForceReload，当前加载完成后自动触发一次 force-reload。
      if (force) patchMessageState(id, { pendingForceReload: true });
      return;
    }

    patchMessageState(id, { loading: true, pendingForceReload: false });
    void hydrateAiSession(id);
    try {
      const page = await fetchTimelinePage(id, null);

      // await 后重新读取最新 bucket：loading 期间实时事件可能已写入新消息。
      // 始终用 mergeMessages 合并（按 documentId 去重，incoming 覆盖同 id 拿到服务端权威版本）。
      const freshBucket = messagesById.value[id] ?? emptyMessageState();
      patchMessageState(id, {
        items: mergeMessages(freshBucket.items, page.items),
        hasMore: freshBucket.hydrated ? freshBucket.hasMore : !!page.nextCursor,
        nextCursor: freshBucket.hydrated ? freshBucket.nextCursor : page.nextCursor,
        hydrated: true,
        loading: false,
        pendingForceReload: false,
      });
    } catch (err) {
      patchMessageState(id, { loading: false });
      throw err;
    }

    // 加载期间有 force 请求被延迟了，现在自动触发一次 force-reload
    if (messagesById.value[id]?.pendingForceReload) {
      patchMessageState(id, { pendingForceReload: false });
      void ensureMessages(id, true);
    }
  }

  async function loadMoreMessages(id: string): Promise<void> {
    const bucket = ensureMessageBucket(id);
    if (!bucket.hasMore || !bucket.nextCursor || bucket.loading) return;
    patchMessageState(id, { loading: true });
    try {
      const page = await fetchTimelinePage(id, bucket.nextCursor);
      const freshBucket = messagesById.value[id] ?? emptyMessageState();
      patchMessageState(id, {
        items: mergeMessages(freshBucket.items, page.items),
        hasMore: !!page.nextCursor,
        nextCursor: page.nextCursor,
        loading: false,
      });
    } catch (err) {
      patchMessageState(id, { loading: false });
      throw err;
    }
  }

  async function sendMessage(
    conversationId: string,
    payload: { content: string; kind?: DmMessageKind; replyTo?: string; imageIds?: string[] },
  ): Promise<DmMessage> {
    // pseudo 会话拦截：
    //  - pseudo:user:N → lazy 实质化为真私聊会话
    //  - pseudo:system → 不可私信
    let actualId = conversationId;
    if (conversationId.startsWith("pseudo:user:")) {
      const real = await materializePseudoUserConversation(conversationId);
      if (!real) throw new Error("invalid pseudo user conversation id");
      actualId = real.documentId;
    } else if (conversationId.startsWith("pseudo:")) {
      throw new Error("此会话不可发送消息");
    }

    const raw = await $api<MessageDto>(
      `/v1/dm/conversations/${encodeURIComponent(actualId)}/messages`,
      {
        method: "POST",
        body: {
          content: payload.content,
          // 服务端按 clientId 去重：网络重试不会发出两条
          clientId: crypto.randomUUID(),
          ...(payload.replyTo ? { replyToId: payload.replyTo } : {}),
          ...(payload.imageIds?.length ? { imageIds: payload.imageIds } : {}),
        },
      },
    );
    if (!raw?.id) throw new Error("send returned no message");
    const created = toDmMessage(raw);

    // 用户发出了新消息，解除上一轮对话定稿的 typing 忽略，并清理本人在此会话的 typing
    finalizedAtByConv.delete(actualId);
    if (selfUserId.value) clearConversationTyping(actualId, selfUserId.value);

    // 立即写入本地缓存（实时事件到达时会按 documentId dedup）。即使 bucket 尚未 hydrated
    // 也写入：ensureMessages 完成时会用 mergeMessages 合并，不会丢失此消息。
    const bucket = messagesById.value[actualId] ?? emptyMessageState();
    patchMessageState(actualId, {
      items: mergeMessages(bucket.items, [created]),
    });

    // 同步会话列表预览
    patchConversation(actualId, {
      lastMessage: {
        documentId: created.documentId,
        content: created.content || (created.images?.length ? "[图片]" : ""),
        createdAt: created.createdAt,
        kind: created.kind,
        senderUserId: created.sender?.userId ?? null,
      },
      lastMessageAt: created.createdAt,
    }, true);

    return created;
  }

  async function editMessage(
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    const raw = await $api<MessageDto>(`/v1/dm/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: { content },
    });
    // 实时 message.edited 也会到达，但为了即时反馈，本地也 patch 一次
    const bucket = messagesById.value[conversationId];
    if (bucket?.items?.length) {
      const editedAt = raw?.editedAt ?? new Date().toISOString();
      patchMessageState(conversationId, {
        items: bucket.items.map((m) =>
          m.documentId === messageId ? { ...m, content, editedAt } : m,
        ),
      });
    }
  }

  async function withdrawMessage(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    const raw = await $api<MessageDto>(`/v1/dm/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
    });
    // 本地立即 patch，实时 message.deleted 到达时 dedup
    const bucket = messagesById.value[conversationId];
    if (bucket?.items?.length) {
      const deletedAt = raw?.withdrawnAt ?? new Date().toISOString();
      patchMessageState(conversationId, {
        items: bucket.items.map((m) =>
          m.documentId === messageId ? { ...m, deletedAt, content: null, images: [] } : m,
        ),
      });
    }
  }

  async function markConversationAsRead(
    id: string,
    opts?: { force?: boolean },
  ): Promise<void> {
    const conv = conversations.value.find((c) => c.documentId === id);
    if (!conv) return;
    // 本地已是 0 且非强制：跳过（避免无意义请求）
    // 强制：用户正在看该会话时仍须推进服务端已读水位（例如新消息到达时本地未读未 +1）
    if (!opts?.force && conv.unreadCount === 0) return;

    if (conv.unreadCount !== 0) {
      bumpUnreadTotal(-conv.unreadCount);
      patchConversation(id, { unreadCount: 0 });
    }

    try {
      await $api(`/v1/inbox/${encodeURIComponent(conv.inboxKey ?? inboxKeyOf(id))}/read`, {
        method: "POST",
      });
    } catch {
      // 静默失败：下次 refresh / 实时事件会自我修复
    }
  }

  /**
   * 一键已读：把所有会话（真实私聊 + 通知分组）的未读清零。
   * 乐观本地清零 → 调 /v1/inbox/read-all；失败静默 refresh 自我修复。
   */
  async function markAllAsRead(): Promise<void> {
    if (totalUnread.value === 0) return;
    conversations.value = conversations.value.map((c) =>
      c.unreadCount ? { ...c, unreadCount: 0 } : c,
    );
    if (unreadTotal.value != null) unreadTotal.value = 0;
    try {
      await $api("/v1/inbox/read-all", { method: "POST" });
    } catch {
      void refresh({ silent: true });
    }
  }

  async function updateConversation(
    id: string,
    patch: { muted?: boolean; pinned?: boolean; title?: string; aiModelKey?: string | null },
  ): Promise<void> {
    const settings: Record<string, boolean> = {};
    if (typeof patch.muted === "boolean") settings.muted = patch.muted;
    if (typeof patch.pinned === "boolean") settings.pinned = patch.pinned;
    if (Object.keys(settings).length) {
      await $api(`/v1/dm/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: settings,
      });
    }
    if (patch.title !== undefined || patch.aiModelKey !== undefined) {
      await $api(`/v1/ai/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.aiModelKey !== undefined ? { modelKey: patch.aiModelKey } : {}),
        },
      });
    }
    // 乐观：把变更应用到本地 + 需要 resort（pinned 变化）
    const conv = conversations.value.find((c) => c.documentId === id);
    if (conv) {
      const nextSelf = { ...conv.self };
      if (typeof patch.muted === "boolean") nextSelf.muted = patch.muted;
      if (typeof patch.pinned === "boolean") nextSelf.pinned = patch.pinned;
      patchConversation(
        id,
        {
          self: nextSelf,
          ...(typeof patch.title === "string" ? { title: patch.title } : {}),
          // aiModelKey 允许显式置 null（清除会话级选择，回落角色卡默认）
          ...(patch.aiModelKey !== undefined ? { aiModelKey: patch.aiModelKey } : {}),
        },
        typeof patch.pinned === "boolean",
      );
    }
  }

  async function leaveConversation(id: string): Promise<void> {
    await $api(`/v1/dm/conversations/${encodeURIComponent(id)}/leave`, { method: "POST" });
    removeConversation(id, { dropUnread: true });
    if (activeConversationId.value === id) activeConversationId.value = null;
  }

  /**
   * 重置 AI 对话上下文：写入一条 system 分界消息，后续 AI 回复只读分界之后。
   * 服务端也会推 message.created，本地先插入（按 documentId 去重）。
   */
  async function resetContext(id: string): Promise<void> {
    const raw = await $api<MessageDto>(`/v1/ai/sessions/${encodeURIComponent(id)}/reset`, {
      method: "POST",
    });
    if (raw?.id) {
      const bucket = messagesById.value[id] ?? emptyMessageState();
      patchMessageState(id, { items: mergeMessages(bucket.items, [toDmMessage(raw)]) });
    }
  }

  /**
   * 停止 AI 流式生成：已生成的文本定稿（照常以 message.edited 收尾）。
   */
  async function stopAiStream(messageId: string): Promise<void> {
    if (activeConversationId.value) {
      finalizedAtByConv.set(activeConversationId.value, Date.now());
      clearConversationTyping(activeConversationId.value);
    }
    await $api(`/v1/ai/messages/${encodeURIComponent(messageId)}/stop`, { method: "POST" });
  }

  /**
   * 重新生成 AI 回复：旧回复以 message.deleted 移除，新占位消息随 message.created 到达。
   *
   * aiModelKey：换一个模型重生成，只对这一次生效，不改会话级选择。
   */
  async function regenerateAiReply(messageId: string, aiModelKey?: string | null): Promise<void> {
    if (activeConversationId.value) {
      finalizedAtByConv.delete(activeConversationId.value);
      clearConversationTyping(activeConversationId.value);
    }
    await $api(`/v1/ai/messages/${encodeURIComponent(messageId)}/regenerate`, {
      method: "POST",
      body: aiModelKey ? { modelKey: aiModelKey } : {},
    });
  }

  // ── 实时事件处理 ───────────────────────────────────────
  interface RawMessageData { rawMessage?: MessageDto | null }

  const onMessageCreated = (event: DmStreamEvent<RawMessageData>) => {
    const cid = event.conversationId;
    const raw = event.data?.rawMessage;
    if (!cid || !raw?.id) return;
    const msg = toDmMessage(raw);
    const streaming = raw.ai?.state === "streaming";

    const senderUserId = msg.sender?.userId ?? null;
    const isMine = selfUserId.value != null && senderUserId === selfUserId.value;

    // 普通新消息（非流式）到达时，立即清除该发送者的 typing 状态；非本人发送时记录定稿时间防残余 typing
    if (!streaming) {
      clearConversationTyping(cid, senderUserId);
      if (!isMine) finalizedAtByConv.set(cid, Date.now());
    }

    // 对方第一次给我发私信：列表里还只有他的通知分组（pseudo:user:<id>）。服务端已经
    // 把他的通知并进新会话，这里就地迁移：历史合并进真会话桶、active 切过去、删 pseudo 项。
    if (!isMine && senderUserId) {
      const pseudoId = `pseudo:user:${senderUserId}`;
      const pseudoExists = conversations.value.some((c) => c.documentId === pseudoId);
      const realExists = conversations.value.some((c) => c.documentId === cid);
      if (pseudoExists && !realExists) {
        const pseudoBucket = messagesById.value[pseudoId];
        if (pseudoBucket?.items?.length) {
          const realBucket = messagesById.value[cid];
          patchMessageState(cid, {
            items: mergeMessages(realBucket?.items ?? [], pseudoBucket.items),
            hydrated: realBucket?.hydrated || pseudoBucket.hydrated,
            hasMore: realBucket?.hasMore ?? pseudoBucket.hasMore,
            nextCursor: realBucket?.nextCursor ?? pseudoBucket.nextCursor,
            loading: false,
          });
        }
        if (activeConversationId.value === pseudoId) activeConversationId.value = cid;
        removeConversation(pseudoId);
      }
    }

    // 流式占位消息：首个 delta 之前就标记为流式
    if (streaming) {
      const next = new Set(streamingMessageIds.value);
      next.add(msg.documentId);
      streamingMessageIds.value = next;
    }

    // 写入消息缓存（dedup by documentId）。即使 bucket 尚未 hydrated 也写入，
    // 避免"侧边栏显示新消息但聊天栏不显示"的竞态；ensureMessages 完成时会合并。
    const bucket = messagesById.value[cid] ?? emptyMessageState();
    patchMessageState(cid, {
      items: mergeMessages(bucket.items, [msg]),
    });

    // 更新会话列表预览 + 未读
    const conv = conversations.value.find((c) => c.documentId === cid);
    const isActive = activeConversationId.value === cid;

    if (conv) {
      const nextUnread = isMine || isActive || streaming ? conv.unreadCount : conv.unreadCount + 1;
      if (nextUnread !== conv.unreadCount) bumpUnreadTotal(1);
      patchConversation(
        cid,
        {
          lastMessage: {
            documentId: msg.documentId,
            content: msg.content ?? "",
            createdAt: msg.createdAt,
            kind: msg.kind,
            senderUserId,
          },
          lastMessageAt: msg.createdAt,
          unreadCount: nextUnread,
        },
        true,
      );
    } else {
      // 列表里还没这个会话：对方新开了会话，或我在另一个端开的。拉权威列表。
      void refresh({ silent: true });
    }

    // 当前激活会话收到他人消息：本地未读可能已是 0，仍须推进服务端已读水位
    if (isActive && !isMine) {
      void markConversationAsRead(cid, { force: true });
    }
  };

  const onMessageEdited = (event: DmStreamEvent<RawMessageData>) => {
    const cid = event.conversationId;
    const raw = event.data?.rawMessage;
    if (!cid || !raw?.id) return;
    const mid = raw.id;
    const msg = toDmMessage(raw);
    // AI 回复以 edited 定稿（done / stopped / failed），不是用户编辑：不写 editedAt。
    const isStreamingFinalize = !!raw.ai && AI_DONE_STATES.has(raw.ai.state);
    if (streamingMessageIds.value.has(mid)) {
      const next = new Set(streamingMessageIds.value);
      next.delete(mid);
      streamingMessageIds.value = next;
    }
    if (isStreamingFinalize) {
      finalizedAtByConv.set(cid, Date.now());
      clearConversationTyping(cid);
    }
    const bucket = messagesById.value[cid];
    if (!bucket?.items?.length) return;
    // 定稿时消息自带完整时间线（权威版本）；缺失时退回实时缓存，保证时间线不消失。
    const finalWorkflow = isStreamingFinalize
      ? (msg.workflow?.length ? msg.workflow : workflowByMessageId.value[mid])
      : undefined;
    patchMessageState(cid, {
      items: bucket.items.map((m) =>
        m.documentId === mid
          ? {
              ...m,
              content: msg.content,
              aiModelKey: msg.aiModelKey ?? m.aiModelKey,
              ...(isStreamingFinalize ? {} : { editedAt: msg.editedAt }),
              ...(finalWorkflow?.length ? { workflow: finalWorkflow } : {}),
            }
          : m,
      ),
    });
    if (isStreamingFinalize && workflowByMessageId.value[mid]) {
      const next = { ...workflowByMessageId.value };
      delete next[mid];
      workflowByMessageId.value = next;
    }
  };

  // AI 工作流事件：按 messageId 聚合（seq 去重），驱动时间线实时推进。
  const onMessageWorkflow = (event: DmStreamEvent<{ event: AiWorkflowEvent }>) => {
    const mid = event.messageId;
    const ev = event.data?.event;
    if (!mid || !ev || typeof ev.seq !== "number" || typeof ev.type !== "string") return;
    const list = workflowByMessageId.value[mid] ?? [];
    if (list.some((it) => it.seq === ev.seq)) return;
    workflowByMessageId.value = {
      ...workflowByMessageId.value,
      [mid]: [...list, ev].sort((a, b) => a.seq - b.seq),
    };
  };

  // 流式回复增量：服务端推的是累计全文，直接覆盖。
  const onMessageDelta = (event: DmStreamEvent<{ content: string }>) => {
    const cid = event.conversationId;
    const mid = event.messageId;
    const content = event.data?.content;
    if (!cid || !mid || typeof content !== "string") return;
    if (!streamingMessageIds.value.has(mid)) {
      const next = new Set(streamingMessageIds.value);
      next.add(mid);
      streamingMessageIds.value = next;
    }
    const bucket = messagesById.value[cid];
    if (!bucket?.items?.length) return;
    patchMessageState(cid, {
      items: bucket.items.map((m) =>
        m.documentId === mid ? { ...m, content } : m,
      ),
    });
  };

  const onMessageDeleted = (event: DmStreamEvent<{ deletedAt?: string }>) => {
    const cid = event.conversationId;
    const mid = event.messageId;
    if (!cid || !mid) return;
    if (streamingMessageIds.value.has(mid)) {
      const next = new Set(streamingMessageIds.value);
      next.delete(mid);
      streamingMessageIds.value = next;
    }
    const bucket = messagesById.value[cid];
    if (bucket?.items?.length) {
      patchMessageState(cid, {
        items: bucket.items.map((m) =>
          m.documentId === mid ? { ...m, content: null, deletedAt: event.data?.deletedAt ?? new Date().toISOString() } : m,
        ),
      });
    }
    // lastMessage 预览若是这条消息，也要更新
    const conv = conversations.value.find((c) => c.documentId === cid);
    if (conv?.lastMessage?.documentId === mid) {
      patchConversation(cid, {
        lastMessage: { ...conv.lastMessage, content: "" },
      });
    }
  };

  /** 本人在别的端读了某个收件箱条目：本端同步清零。 */
  const onInboxRead = (event: DmStreamEvent<{ key?: string; lastReadAt?: string | null }>) => {
    const key = event.data?.key;
    if (!key) return;
    const cid = conversationIdForKey(key);
    const conv = conversations.value.find((c) => c.documentId === cid || c.inboxKey === key);
    if (!conv) return;
    if (conv.unreadCount) bumpUnreadTotal(-conv.unreadCount);
    patchConversation(conv.documentId, {
      unreadCount: 0,
      self: { ...conv.self, lastReadAt: event.data?.lastReadAt ?? conv.self.lastReadAt },
    });
  };

  const onConversationReadAll = () => {
    // 服务端一键已读的多端同步：本地所有会话未读清零（服务端清的是全部，不只是已加载的页）。
    conversations.value = conversations.value.map((c) =>
      c.unreadCount ? { ...c, unreadCount: 0 } : c,
    );
    if (unreadTotal.value != null) unreadTotal.value = 0;
  };

  const onConversationUpdated = (
    event: DmStreamEvent<{ muted?: boolean; pinned?: boolean; title?: string | null; aiModelKey?: string | null }>,
  ) => {
    const cid = event.conversationId;
    const data = event.data;
    if (!cid || !data) return;
    const conv = conversations.value.find((c) => c.documentId === cid);
    if (!conv) return;
    const self = { ...conv.self };
    if (typeof data.muted === "boolean") self.muted = data.muted;
    if (typeof data.pinned === "boolean") self.pinned = data.pinned;
    patchConversation(cid, {
      self,
      ...("title" in data ? { title: data.title ?? null } : {}),
      // 模型切换可能来自本人的另一个端；null 表示回落到角色卡默认
      ...("aiModelKey" in data ? { aiModelKey: data.aiModelKey ?? null } : {}),
    }, typeof data.pinned === "boolean");
  };

  /** 本人在别的端移除了会话。 */
  const onConversationLeft = (event: DmStreamEvent) => {
    const cid = event.conversationId;
    if (!cid) return;
    removeConversation(cid, { dropUnread: true });
    if (activeConversationId.value === cid) activeConversationId.value = null;
  };

  const onTyping = (event: DmStreamEvent<{ userId?: string }>) => {
    const cid = event.conversationId;
    const uid = event.data?.userId;
    if (!cid || typeof uid !== "string" || !uid) return;

    // 会话不久前刚定稿（如 AI 刚输出完毕）且用户尚未发起新发送：忽略网络延迟到达的残余 typing
    const finalizeAt = finalizedAtByConv.get(cid);
    if (finalizeAt && Date.now() - finalizeAt < TYPING_IGNORE_AFTER_FINALIZE_MS) {
      return;
    }

    const current = typing.value[cid] ?? [];
    if (!current.includes(uid)) {
      typing.value = { ...typing.value, [cid]: [...current, uid] };
    }
    // 3s 后自动移除（与服务端 typing 心跳节奏匹配）
    const key = `${cid}:${uid}`;
    const oldTimer = typingTimers.get(key);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(() => {
      typingTimers.delete(key);
      const list = typing.value[cid] ?? [];
      const next = list.filter((id) => id !== uid);
      if (next.length === 0) {
        const copy = { ...typing.value };
        delete copy[cid];
        typing.value = copy;
      } else {
        typing.value = { ...typing.value, [cid]: next };
      }
    }, TYPING_TTL_MS);
    typingTimers.set(key, timer);
  };

  /**
   * 通知有变化（新通知 / 撤回 / 别的端已读）或实时连接刚（重新）连上：
   * 静默刷新收件箱（含红点权威值），并强制重拉当前正在看的会话；其他已加载的会话标记过期。
   */
  const resyncFromServer = (conversationId?: string) => {
    if (!auth.isLogin) return;
    if (notificationRefreshTimer) clearTimeout(notificationRefreshTimer);
    notificationRefreshTimer = setTimeout(() => {
      notificationRefreshTimer = null;
      void refresh({ silent: true });
    }, NOTIFICATION_REFRESH_DEBOUNCE_MS);

    const activeId = activeConversationId.value;
    if (conversationId && conversationId !== activeId && messagesById.value[conversationId]?.hydrated) {
      patchMessageState(conversationId, { hydrated: false });
    }
    if (activeId && messagesById.value[activeId]?.hydrated) {
      void ensureMessages(activeId, true).catch(() => undefined);
    }
  };

  const onNotificationChanged = (event: DmStreamEvent<{ bucket?: string; conversationId?: string }>) => {
    const target = event.conversationId
      ?? (event.data?.bucket ? conversationIdForKey(event.data.bucket) : undefined);
    resyncFromServer(target);
  };

  const startStream = () => {
    if (subscribed) {
      stream.start();
      return;
    }
    subscribed = true;
    stream.start();

    unsubscribeAll.push(stream.on<RawMessageData>("message.created", onMessageCreated));
    unsubscribeAll.push(stream.on<RawMessageData>("message.edited", onMessageEdited));
    unsubscribeAll.push(stream.on<{ content: string }>("message.delta", onMessageDelta));
    unsubscribeAll.push(stream.on<{ event: AiWorkflowEvent }>("message.workflow", onMessageWorkflow));
    unsubscribeAll.push(stream.on<{ deletedAt?: string }>("message.deleted", onMessageDeleted));
    unsubscribeAll.push(stream.on("inbox.read", onInboxRead));
    unsubscribeAll.push(stream.on("conversation.read.all", onConversationReadAll));
    unsubscribeAll.push(stream.on("conversation.updated", onConversationUpdated));
    unsubscribeAll.push(stream.on("conversation.left", onConversationLeft));
    unsubscribeAll.push(stream.on("typing", onTyping));
    unsubscribeAll.push(stream.on("notification.changed", onNotificationChanged));
    unsubscribeAll.push(stream.on("resync", () => resyncFromServer()));
  };

  const stopStream = () => {
    for (const off of unsubscribeAll) {
      try { off(); } catch { /* noop */ }
    }
    unsubscribeAll = [];
    subscribed = false;
    stream.stop();
    // 清 typing 超时 + 视觉状态：否则下次打开会显示"对方正在输入..."
    for (const t of typingTimers.values()) clearTimeout(t);
    typingTimers.clear();
    finalizedAtByConv.clear();
    typing.value = {};
    if (notificationRefreshTimer) {
      clearTimeout(notificationRefreshTimer);
      notificationRefreshTimer = null;
    }

    // 不再接收事件后缓存可能过期：所有 bucket 标为未 hydrated，下次进入会话时重新拉取。
    // 保留 items 避免白屏，HTTP 返回后通过 mergeMessages 合并为最新数据。
    const stale = messagesById.value;
    const invalidated: Record<string, ConversationMessageState> = {};
    for (const [id, bucket] of Object.entries(stale)) {
      invalidated[id] = { ...bucket, hydrated: false, pendingForceReload: false };
    }
    messagesById.value = invalidated;
  };

  const reset = () => {
    conversationRefreshes.delete(auth);
    stopStream();
    conversations.value = [];
    isLoading.value = false;
    error.value = null;
    messagesById.value = {};
    activeConversationId.value = null;
    typing.value = {};
    streamingMessageIds.value = new Set();
    workflowByMessageId.value = {};
    convNextCursor.value = null;
    convHasMore.value = false;
    convLoadingMore.value = false;
    convPagesLoaded.value = 0;
    unreadTotal.value = null;
    typingTimers = new Map();
    finalizedAtByConv = new Map();
  };

  const isStreamingMessage = (documentId: string): boolean =>
    streamingMessageIds.value.has(documentId);

  const workflowEventsOf = (messageId: string): AiWorkflowEvent[] =>
    workflowByMessageId.value[messageId] ?? [];

  /**
   * 红点用的未读总数：优先用服务端在第一页给出的权威值（之后由实时事件 / 本地已读操作
   * 增量修正）；没有时退回对已加载列表求和。
   */
  const totalUnread = computed(() =>
    unreadTotal.value != null
      ? unreadTotal.value
      : conversations.value.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
  );

  return {
    conversations: computed(() => conversations.value),
    isLoading: computed(() => isLoading.value),
    error: computed(() => error.value),
    totalUnread,
    hasMoreConversations: computed(() => convHasMore.value),
    isLoadingMoreConversations: computed(() => convLoadingMore.value),
    loadMoreConversations,
    activeConversationId,
    typingByConversation: computed(() => typing.value),
    isStreamingMessage,
    workflowEventsOf,

    refresh,
    openDirectConversation,
    createAiSession,
    deleteConversation,
    messageStateOf: (id: string) =>
      messagesById.value[id] ?? emptyMessageState(),
    ensureMessages,
    loadMoreMessages,
    sendMessage,
    editMessage,
    withdrawMessage,
    markConversationAsRead,
    markAllAsRead,
    updateConversation,
    leaveConversation,
    resetContext,
    stopAiStream,
    regenerateAiReply,
    sendTyping: stream.sendTyping,
    clearTyping: clearConversationTyping,
    startStream,
    stopStream,
    reset,
  };
}
