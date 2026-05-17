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
import { computed, type ComputedRef } from "vue";
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

  /** SSE：开启/关闭实时推送 */
  startStream: () => void;
  stopStream: () => void;
}

// ──────────────────────────────────────────────────────
// 模块级单例：SSE 连接 + debounce 句柄。useState 不能存 EventSource。
// ──────────────────────────────────────────────────────
let sse: EventSource | null = null;
let sseStarted = false;
let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const REFRESH_DEBOUNCE_MS = 250;

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

  const { $api } = useNuxtApp();

  async function refresh(): Promise<void> {
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
      patchMessageState(id, {
        items: resp?.data ?? [],
        hasMore: !!resp?.meta?.hasMore,
        nextCursor: resp?.meta?.nextCursor ?? null,
        hydrated: true,
        loading: false,
      });
    } catch (err) {
      patchMessageState(id, { loading: false });
      throw err;
    }
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
  function scheduleRefresh() {
    if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = setTimeout(() => {
      refreshDebounceTimer = null;
      void refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  function handleSseEvent(event: KnockSseEvent) {
    if (event.type === "notification.created") {
      // 红点 / 列表
      scheduleRefresh();

      // 当前打开（hydrated）的会话都 force-reload。
      // 不只靠 event.conversationId 匹配是为了兜底两类问题：
      //   1) 后端 lifecycle 偶尔拿不全 sender/Comment 导致 conversationId 缺失
      //   2) 多端 / 不同来源的 id 编码漂移
      // 已 hydrated 的会话数量通常是 1（用户当前打开的那个），开销可忽略。
      const hydratedIds = Object.entries(messagesById.value)
        .filter(([, state]) => state?.hydrated)
        .map(([id]) => id);
      for (const id of hydratedIds) {
        void ensureMessages(id, true);
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

    sse.addEventListener("notification.created", (ev) => {
      try {
        handleSseEvent(JSON.parse((ev as MessageEvent).data) as KnockSseEvent);
      } catch {
        /* malformed payload — ignore */
      }
    });
    sse.addEventListener("notification.read", (ev) => {
      try {
        handleSseEvent(JSON.parse((ev as MessageEvent).data) as KnockSseEvent);
      } catch {
        /* ignore */
      }
    });
    sse.addEventListener("notification.read.bulk", (ev) => {
      try {
        handleSseEvent(JSON.parse((ev as MessageEvent).data) as KnockSseEvent);
      } catch {
        /* ignore */
      }
    });
    sse.onerror = () => {
      // EventSource 本身会自动重连，这里不主动关闭
    };
  }

  function stopStream() {
    if (sse) {
      sse.close();
      sse = null;
    }
    sseStarted = false;
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer);
      refreshDebounceTimer = null;
    }
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
    startStream,
    stopStream,
  };
}
