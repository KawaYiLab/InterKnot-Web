/**
 * useKnockKnockConversations —— 敲敲会话视图（懒加载 + SSE）
 *
 * 行为：
 *   - 进入弹窗时拉一次会话列表 `/api/knock/conversations`（聚合摘要，无消息正文）
 *   - 选中某会话时再调 `/api/knock/conversations/:id/messages` 拉取该会话的消息流
 *   - 标记已读用 `/api/knock/conversations/:id/mark-read` 一次批量更新
 *   - 同时建立 SSE 长连接 `/api/knock/stream` 接收实时事件，触发增量刷新
 *
 * 共享状态用 `useState`，保证同一页面多处使用时拿到同一份缓存（例如 AppHeader 的红点）。
 */
import { computed, type ComputedRef, type Ref } from "vue";
import type { ApiClientError } from "~/types/api";
import type {
  KnockConversation,
  KnockSseEvent,
  NotificationDto,
} from "~/types/entities";

interface ConversationListResponse {
  data: KnockConversation[];
  meta?: {
    total?: number;
    truncated?: boolean;
    scannedRows?: number;
    cap?: number;
  };
}

interface MessagesResponse {
  data: NotificationDto[];
  meta?: {
    nextCursor?: string | null;
    hasMore?: boolean;
  };
}

/** 单会话消息缓存：本地按会话 id 维护 */
interface ConversationMessageState {
  items: NotificationDto[];
  loading: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  /** 标记是否首次加载过，避免重复发起首屏请求 */
  hydrated: boolean;
}

const TOKEN_KEY = "access_token";

const emptyMessageState = (): ConversationMessageState => ({
  items: [],
  loading: false,
  hasMore: false,
  nextCursor: null,
  hydrated: false,
});

interface UseKnockKnockConversations {
  conversations: ComputedRef<KnockConversation[]>;
  isLoading: ComputedRef<boolean>;
  error: ComputedRef<string | null>;
  truncated: ComputedRef<boolean>;
  refresh: () => Promise<void>;

  /** 取某会话的消息状态（响应式） */
  messageStateOf: (id: string) => ComputedRef<ConversationMessageState>;
  /** 首次进入会话时调用，已加载过则跳过；强制刷新传 force=true */
  ensureMessages: (id: string, force?: boolean) => Promise<void>;
  /** 滚到顶部时拉历史 */
  loadMoreMessages: (id: string) => Promise<void>;

  /** 单会话批量标记已读（乐观更新 + 后端一次更新） */
  markConversationAsRead: (id: string) => Promise<void>;

  /** 当前用户正在查看的会话 id，SSE 实时推送时只刷它一个，避免 N 倍放大 */
  activeConversationId: Ref<string | null>;

  /** SSE：开启/关闭实时推送 */
  startStream: () => void;
  stopStream: () => void;

  /** 登出/切账号时调用：清缓存 + 停 SSE */
  reset: () => void;
}

// ──────────────────────────────────────────────────────
// 模块级单例：SSE 连接 + debounce 句柄。useState 不能存 EventSource。
// ──────────────────────────────────────────────────────
let sse: EventSource | null = null;
let sseStarted = false;
let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const REFRESH_DEBOUNCE_MS = 250;

/**
 * EventSource 在 401/服务器关闭等场景下会按 retry 间隔无限重连。
 * 我们在 onerror 累计连续失败次数；任何成功事件归零。超过阈值就主动 close()，
 * 避免「被封号用户的浏览器每 5 秒打一次后端」。
 */
const MAX_CONSECUTIVE_SSE_FAILURES = 3;
let sseFailureStreak = 0;

export function useKnockKnockConversations(): UseKnockKnockConversations {
  const conversations = useState<KnockConversation[]>(
    "knock:conversations",
    () => [],
  );
  const isLoading = useState<boolean>("knock:loading", () => false);
  const error = useState<string | null>("knock:error", () => null);
  const truncated = useState<boolean>("knock:truncated", () => false);

  // 单会话消息缓存。用 reactive 的 plain object，便于按 id 增删。
  const messagesById = useState<Record<string, ConversationMessageState>>(
    "knock:messages",
    () => ({}),
  );

  // 当前用户正在查看的会话 id。modal 切换右栏时写它；SSE 推送时只刷它一个。
  const activeConversationId = useState<string | null>(
    "knock:activeConversationId",
    () => null,
  );

  const { $api } = useNuxtApp();

  async function refresh(): Promise<void> {
    // 并发守卫：已经在拉就让后到的调用直接跳过。
    // 这避免「打开弹窗直接 refresh + SSE debounce 又 refresh」短时间内打两次的浪费，
    // 也避免后到响应覆盖先到响应导致 UI 抖动。
    if (isLoading.value) return;

    isLoading.value = true;
    error.value = null;
    try {
      const resp = await $api<ConversationListResponse>("/api/knock/conversations");
      conversations.value = resp?.data ?? [];
      truncated.value = !!resp?.meta?.truncated;
    } catch (err) {
      const e = err as ApiClientError;
      error.value = e?.message || "加载失败";
      conversations.value = [];
      truncated.value = false;
    } finally {
      isLoading.value = false;
    }
  }

  function ensureMessageBucket(id: string): ConversationMessageState {
    let bucket = messagesById.value[id];
    if (!bucket) {
      bucket = emptyMessageState();
      messagesById.value = { ...messagesById.value, [id]: bucket };
    }
    return bucket;
  }

  function patchMessageState(id: string, patch: Partial<ConversationMessageState>) {
    const prev = messagesById.value[id] ?? emptyMessageState();
    messagesById.value = {
      ...messagesById.value,
      [id]: { ...prev, ...patch },
    };
  }

  async function fetchMessagesPage(
    id: string,
    cursor: string | null,
  ): Promise<MessagesResponse> {
    const query: Record<string, string> = { limit: "50" };
    if (cursor) query.cursor = cursor;
    return $api<MessagesResponse>(
      `/api/knock/conversations/${encodeURIComponent(id)}/messages`,
      { query },
    );
  }

  async function ensureMessages(id: string, force = false): Promise<void> {
    const bucket = ensureMessageBucket(id);
    if (bucket.hydrated && !force) return;
    if (bucket.loading) return;

    patchMessageState(id, { loading: true });
    try {
      const resp = await fetchMessagesPage(id, null);
      const incoming = resp?.data ?? [];

      // hydrated + force=true：合并而不是替换，避免丢失用户已加载的历史（loadMoreMessages）。
      // 按 documentId 去重，incoming 覆盖现有同 id 项（拿到最新的 isRead 等状态），
      // 再按 createdAt 升序排序确保前端展示顺序稳定。
      const nextItems = bucket.hydrated && force
        ? mergeMessages(bucket.items, incoming)
        : incoming;

      patchMessageState(id, {
        items: nextItems,
        // 首屏 reload 时 nextCursor 是「最新 50 之外还有更老的」；
        // 合并模式下，如果原本 hasMore 是 true 就保留 true（用户还能继续往上滚）；
        // 否则用后端返回的（避免把已经滚到顶的状态错误地重置）
        hasMore: bucket.hydrated && force
          ? bucket.hasMore || !!resp?.meta?.hasMore
          : !!resp?.meta?.hasMore,
        nextCursor: bucket.hydrated && force
          ? bucket.nextCursor ?? resp?.meta?.nextCursor ?? null
          : resp?.meta?.nextCursor ?? null,
        hydrated: true,
        loading: false,
      });
    } catch (err) {
      patchMessageState(id, { loading: false });
      throw err;
    }
  }

  /** 按 documentId 去重合并；保留更老的历史 + 用 incoming 覆盖同 id 的最新状态 */
  function mergeMessages(
    existing: NotificationDto[],
    incoming: NotificationDto[],
  ): NotificationDto[] {
    if (incoming.length === 0) return existing;
    const map = new Map<string, NotificationDto>();
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
  }

  async function loadMoreMessages(id: string): Promise<void> {
    const bucket = ensureMessageBucket(id);
    if (!bucket.hasMore || !bucket.nextCursor || bucket.loading) return;

    patchMessageState(id, { loading: true });
    try {
      const resp = await fetchMessagesPage(id, bucket.nextCursor);
      const incoming = resp?.data ?? [];
      // 后端按 createdAt ASC 返回；历史更早的应当 prepend 到当前 items 之前
      patchMessageState(id, {
        items: [...incoming, ...bucket.items],
        hasMore: !!resp?.meta?.hasMore,
        nextCursor: resp?.meta?.nextCursor ?? null,
        loading: false,
      });
    } catch (err) {
      patchMessageState(id, { loading: false });
      throw err;
    }
  }

  async function markConversationAsRead(id: string): Promise<void> {
    const conv = conversations.value.find((c) => c.id === id);
    if (!conv || conv.unread <= 0) return;

    // 乐观：本地置 unread=0 + 标记当前已加载的 items 为已读
    conversations.value = conversations.value.map((c) =>
      c.id === id ? { ...c, unread: 0 } : c,
    );
    const bucket = messagesById.value[id];
    if (bucket?.items?.length) {
      patchMessageState(id, {
        items: bucket.items.map((it) => (it.isRead ? it : { ...it, isRead: true })),
      });
    }

    try {
      await $api(`/api/knock/conversations/${encodeURIComponent(id)}/mark-read`, {
        method: "POST",
      });
    } catch {
      // 静默失败：下次 SSE 或刷新时会自我修复
    }
  }

  // ── SSE 实时推送 ─────────────────────────────────────
  /** 通知变更后刷新列表（legacy knock API + DM 融合列表，后者供 Header 未读角标） */
  function scheduleRefresh() {
    if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = setTimeout(() => {
      refreshDebounceTimer = null;
      void refresh();
      void useDmConversations().refresh({ silent: true });
    }, REFRESH_DEBOUNCE_MS);
  }

  function handleSseEvent(event: KnockSseEvent) {
    if (event.type === "notification.created") {
      // 红点 / 列表（含 AppHeader totalUnread）
      scheduleRefresh();

      // 只刷当前用户正在看的那个会话，避免 N 倍放大：
      // - active 的：force-reload，新消息立刻可见
      // - 非 active 但已 hydrated 的：标 hydrated=false 让下次进入时再拉，省 IO
      const activeId = activeConversationId.value;
      const targetId = event.conversationId ?? activeId;

      // 后端如果给了明确的 conversationId 且不是当前激活的，仅 invalidate 缓存
      if (targetId && targetId !== activeId) {
        const bucket = messagesById.value[targetId];
        if (bucket?.hydrated) {
          patchMessageState(targetId, { hydrated: false });
        }
      }

      if (activeId && messagesById.value[activeId]?.hydrated) {
        void ensureMessages(activeId, true);
      }
      return;
    }

    if (
      event.type === "notification.read" ||
      event.type === "notification.read.bulk"
    ) {
      // 其他端点已读了，本端只需同步红点
      scheduleRefresh();
    }
  }

  function startStream() {
    if (!import.meta.client) return;
    if (sseStarted) return;
    sseStarted = true;

    const config = useRuntimeConfig();
    const baseURL = (config.public as { apiBaseUrl?: string })?.apiBaseUrl ?? "";
    const token = localStorage.getItem(TOKEN_KEY) || "";
    if (!token) {
      sseStarted = false;
      return;
    }

    const url = `${baseURL.replace(/\/$/, "")}/api/knock/stream?token=${encodeURIComponent(token)}`;
    try {
      sse = new EventSource(url);
    } catch {
      sseStarted = false;
      return;
    }

    const onAnyEvent = (ev: Event) => {
      // 任何成功事件都说明连接活着，归零失败计数
      sseFailureStreak = 0;
      try {
        handleSseEvent(JSON.parse((ev as MessageEvent).data) as KnockSseEvent);
      } catch {
        /* malformed payload — ignore */
      }
    };
    sse.addEventListener("notification.created", onAnyEvent);
    sse.addEventListener("notification.read", onAnyEvent);
    sse.addEventListener("notification.read.bulk", onAnyEvent);
    // 服务端的 hello / bye 心跳事件也算「连接活着」
    sse.addEventListener("hello", () => {
      sseFailureStreak = 0;
    });
    sse.addEventListener("bye", () => {
      // 服务端主动告别（如被 evict）—— 不再重连
      stopStream();
    });

    sse.onopen = () => {
      sseFailureStreak = 0;
    };
    sse.onerror = () => {
      sseFailureStreak += 1;
      // EventSource 默认会按 retry 间隔自动重连。但 401/403/账号封禁等场景下，
      // 重连永远不会成功；不能让客户端每 5s 死循环打后端。
      if (sseFailureStreak >= MAX_CONSECUTIVE_SSE_FAILURES) {
        stopStream();
      }
    };
  }

  function stopStream() {
    if (sse) {
      sse.close();
      sse = null;
    }
    sseStarted = false;
    sseFailureStreak = 0;
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer);
      refreshDebounceTimer = null;
    }
  }

  /**
   * 登出 / 切账号时调用：停 SSE + 清所有本地缓存。
   * 注：useState 是 SSR 范围内的，clearSession 之后 hydrate 时还会重建空状态。
   */
  function reset() {
    stopStream();
    conversations.value = [];
    isLoading.value = false;
    error.value = null;
    truncated.value = false;
    messagesById.value = {};
    activeConversationId.value = null;
  }

  return {
    conversations: computed(() => conversations.value),
    isLoading: computed(() => isLoading.value),
    error: computed(() => error.value),
    truncated: computed(() => truncated.value),
    refresh,
    messageStateOf: (id: string) =>
      computed(() => messagesById.value[id] ?? emptyMessageState()),
    ensureMessages,
    loadMoreMessages,
    markConversationAsRead,
    activeConversationId,
    startStream,
    stopStream,
    reset,
  };
}
