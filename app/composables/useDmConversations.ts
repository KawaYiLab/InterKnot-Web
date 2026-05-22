/**
 * useDmConversations —— DM 私聊数据层（REST + WS 双路径合并）。
 *
 * 这是一个跨页面的共享 store（基于 Nuxt useState），多个组件调用同一个
 * composable 拿到的是同一份会话列表 / 消息缓存。
 *
 * 责任划分：
 *  - 传输层：`useDmStream`（WS 连接 / 重连 / 收发）；本 composable 仅订阅事件。
 *  - 业务层（本文件）：拉 REST 列表 / 懒加载消息 / 发送 - 编辑 - 撤回 / 标已读
 *                       / 离开 / 接 WS 事件 patch 缓存（含去重）。
 *
 * 与 useKnockKnockConversations 的核心差异：
 *  1. 走 `/api/dm/*` 路径，与"敲敲通知聚合"完全独立。
 *  2. WS 而非 SSE，且事件 schema 不同（见 DmWsEvent）。
 *  3. 双向写：sendMessage / editMessage / withdrawMessage 走 HTTP，落地后
 *     还会从 WS 收到同一条事件——按 documentId 去重，避免重复渲染。
 */
import { computed, type ComputedRef, type Ref } from "vue";
import type { ApiClientError } from "~/types/api";
import type {
  DmConversationSummary,
  DmMessage,
  DmMessageKind,
  DmWsEvent,
} from "~/types/entities";

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
}

const emptyMessageState = (): ConversationMessageState => ({
  items: [],
  loading: false,
  hasMore: false,
  nextCursor: null,
  hydrated: false,
});

interface ConversationListResponse {
  data: DmConversationSummary[];
}

interface ConversationDirectResponse {
  data: DmConversationSummary;
  isNew: boolean;
}

interface MessagesResponse {
  /** 后端按 createdAt desc 返回；前端反转后存为 asc */
  data: DmMessage[];
  meta?: { hasMore?: boolean; nextCursor?: string | null };
}

interface SendMessageResponse {
  data: DmMessage;
}

interface UseDmConversations {
  conversations: ComputedRef<DmConversationSummary[]>;
  isLoading: ComputedRef<boolean>;
  error: ComputedRef<string | null>;
  /** 全部未读总和（用于头部红点等场景） */
  totalUnread: ComputedRef<number>;

  /** 当前选中会话 id（documentId）；切换会话时设置 */
  activeConversationId: Ref<string | null>;
  /** WS typing：来自对端 userId 集合 → 简化用 conversationId → userId 数组 */
  typingByConversation: ComputedRef<Record<string, number[]>>;

  refresh: () => Promise<void>;
  /** 取/建私聊会话，返回 summary 与 isNew */
  openDirectConversation: (
    targetUserId: number,
  ) => Promise<{ summary: DmConversationSummary; isNew: boolean }>;

  /**
   * 取某会话的消息状态。返回 plain object 而非 ComputedRef——调用方在
   * setup 阶段自己用 `computed(() => messageStateOf(id))` 包装一次即可。
   * 之前返回 `computed(...)` 工厂在响应式上下文每次访问都新建实例，
   * 触发 Vue effect 嵌套警告 + GC 压力。
   */
  messageStateOf: (id: string) => ConversationMessageState;
  ensureMessages: (id: string, force?: boolean) => Promise<void>;
  loadMoreMessages: (id: string) => Promise<void>;

  sendMessage: (
    conversationId: string,
    payload: { content: string; kind?: DmMessageKind; replyTo?: string },
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

  markConversationAsRead: (id: string) => Promise<void>;
  /** 设置 muted/pinned；title 仅群聊可用 */
  updateConversation: (
    id: string,
    patch: { muted?: boolean; pinned?: boolean; title?: string },
  ) => Promise<void>;
  leaveConversation: (id: string) => Promise<void>;

  /** 发送 typing 状态（节流由调用方控制） */
  sendTyping: (conversationId: string) => void;

  /** 启停：通常由 KnockKnockModal 在打开/关闭时调用 */
  startStream: () => void;
  stopStream: () => void;

  /** 登出 / 切账号时清状态 */
  reset: () => void;
}

// ──────────────────────────────────────────────────────
// 模块级一次性资源：WS 订阅 unsubscribe + typing 超时句柄。
// useState 不能存 function，所以放在这里。
// ──────────────────────────────────────────────────────
let unsubscribeAll: Array<() => void> = [];
let subscribed = false;
let typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const TYPING_TTL_MS = 4_000;

export function useDmConversations(): UseDmConversations {
  const conversations = useState<DmConversationSummary[]>(
    "dm:conversations",
    () => [],
  );
  const isLoading = useState<boolean>("dm:loading", () => false);
  const error = useState<string | null>("dm:error", () => null);

  const messagesById = useState<Record<string, ConversationMessageState>>(
    "dm:messages",
    () => ({}),
  );

  const activeConversationId = useState<string | null>(
    "dm:activeConversationId",
    () => null,
  );

  // typing 状态：conversationId → 正在输入的 userId 数组
  const typing = useState<Record<string, number[]>>(
    "dm:typing",
    () => ({}),
  );

  const { $api } = useNuxtApp();
  const auth = useAuthStore();
  const stream = useDmStream();

  const selfUserId = computed<number | null>(() => {
    const id = auth.user?.id;
    if (typeof id === "number") return id;
    if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
    return null;
  });

  // ── 基础工具 ────────────────────────────────────────
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
    copy.sort((a, b) => {
      const ap = a.self?.pinned ? 1 : 0;
      const bp = b.self?.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
    conversations.value = copy;
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
    // Partial 解构后 TS 会宽化到 Partial<DmConversationSummary>；强制断言回去，
    // 因为 base copy[idx] 提供了全部 required 字段。
    copy[idx] = { ...copy[idx], ...patch } as DmConversationSummary;
    if (resort) {
      copy.sort((a, b) => {
        const ap = a.self?.pinned ? 1 : 0;
        const bp = b.self?.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bt - at;
      });
    }
    conversations.value = copy;
  };

  // ── REST 调用 ────────────────────────────────────────
  async function refresh(): Promise<void> {
    if (isLoading.value) return;
    isLoading.value = true;
    error.value = null;
    try {
      const resp = await $api<ConversationListResponse>("/api/dm/conversations");
      conversations.value = resp?.data ?? [];
    } catch (err) {
      const e = err as ApiClientError;
      error.value = e?.message || "加载失败";
      // 不清空 conversations：网络抖动 / 短暂 5xx 时保留旧列表，避免用户看到的
      // 私聊列表瞬间消失；error 已暴露给上层 UI 提示用户重试
    } finally {
      isLoading.value = false;
    }
  }

  async function openDirectConversation(
    targetUserId: number,
  ): Promise<{ summary: DmConversationSummary; isNew: boolean }> {
    const resp = await $api<ConversationDirectResponse>(
      "/api/dm/conversations/direct",
      { method: "POST", body: { targetUserId } },
    );
    if (!resp?.data?.documentId) {
      throw new Error("invalid direct response");
    }
    upsertConversation(resp.data);
    return { summary: resp.data, isNew: !!resp.isNew };
  }

  /** 从列表里移除指定会话（连同消息桶） */
  function removeConversation(id: string): void {
    conversations.value = conversations.value.filter((c) => c.documentId !== id);
    if (messagesById.value[id]) {
      const next = { ...messagesById.value };
      delete next[id];
      messagesById.value = next;
    }
  }

  /**
   * 把 pseudo:user:N 会话懒激活为真 DM 会话。
   *
   * 触发场景：用户在 pseudo 会话里点击「发送」时，需要先把通知聚合的会话项
   * 实质化为真实 DM 会话；然后才能往真 DM 写消息。
   *
   * 行为：
   *  - 调 /api/dm/conversations/direct 找/建真会话
   *  - 把 pseudo 桶里已加载的通知历史拷到真会话桶，避免发完消息再加载
   *    时通知历史短暂消失
   *  - 移除列表里的 pseudo 项（真会话已 upsert 进列表）
   *  - 若当前 active 是 pseudo id，自动切到真 documentId
   *
   * 返回真会话 summary；若入参不是 pseudo:user 形式则返回 null。
   */
  async function materializePseudoUserConversation(
    pseudoId: string,
  ): Promise<DmConversationSummary | null> {
    const m = /^pseudo:user:(\d+)$/.exec(pseudoId);
    if (!m || !m[1]) return null;
    const userId = Number.parseInt(m[1], 10);
    if (!Number.isInteger(userId) || userId <= 0) return null;

    const { summary } = await openDirectConversation(userId);

    // 把 pseudo 桶的消息（通知历史）迁移到真会话桶
    const pseudoBucket = messagesById.value[pseudoId];
    if (pseudoBucket?.hydrated) {
      const realBucket = messagesById.value[summary.documentId];
      if (!realBucket || !realBucket.hydrated) {
        patchMessageState(summary.documentId, {
          ...pseudoBucket,
        });
      } else {
        // 真桶已有数据；做一次合并去重
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
    // 移除 pseudo 列表项与桶
    removeConversation(pseudoId);

    return summary;
  }

  async function fetchMessagesPage(id: string, before: string | null): Promise<MessagesResponse> {
    const query: Record<string, string> = { limit: "50" };
    if (before) query.before = before;
    return $api<MessagesResponse>(
      `/api/dm/conversations/${encodeURIComponent(id)}/messages`,
      { query },
    );
  }

  /** 把后端 desc 数组反转为 asc */
  const toAsc = (items: DmMessage[]): DmMessage[] => {
    const copy = items.slice();
    copy.reverse();
    return copy;
  };

  async function ensureMessages(id: string, force = false): Promise<void> {
    const bucket = ensureMessageBucket(id);
    if (bucket.hydrated && !force) return;
    if (bucket.loading) return;

    patchMessageState(id, { loading: true });
    try {
      const resp = await fetchMessagesPage(id, null);
      const incoming = toAsc(resp?.data ?? []);

      const nextItems = bucket.hydrated && force
        ? mergeMessages(bucket.items, incoming)
        : incoming;

      patchMessageState(id, {
        items: nextItems,
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

  async function loadMoreMessages(id: string): Promise<void> {
    const bucket = ensureMessageBucket(id);
    if (!bucket.hasMore || !bucket.nextCursor || bucket.loading) return;
    patchMessageState(id, { loading: true });
    try {
      const resp = await fetchMessagesPage(id, bucket.nextCursor);
      const olderAsc = toAsc(resp?.data ?? []);
      patchMessageState(id, {
        items: [...olderAsc, ...bucket.items],
        hasMore: !!resp?.meta?.hasMore,
        nextCursor: resp?.meta?.nextCursor ?? null,
        loading: false,
      });
    } catch (err) {
      patchMessageState(id, { loading: false });
      throw err;
    }
  }

  async function sendMessage(
    conversationId: string,
    payload: { content: string; kind?: DmMessageKind; replyTo?: string },
  ): Promise<DmMessage> {
    // pseudo 会话拦截：
    //  - pseudo:user:N → lazy 实质化为真 DM 会话
    //  - pseudo:anonymous / pseudo:system → 不可私信（语义上没有真实 sender）
    let actualId = conversationId;
    if (conversationId.startsWith("pseudo:user:")) {
      const real = await materializePseudoUserConversation(conversationId);
      if (!real) throw new Error("invalid pseudo user conversation id");
      actualId = real.documentId;
    } else if (
      conversationId === "pseudo:system" ||
      conversationId.startsWith("pseudo:anonymous:")
    ) {
      throw new Error("此会话不可发送消息");
    }

    const resp = await $api<SendMessageResponse>(
      `/api/dm/conversations/${encodeURIComponent(actualId)}/messages`,
      { method: "POST", body: payload },
    );
    const created = resp?.data;
    if (!created?.documentId) throw new Error("send returned no message");

    // 立即写入本地缓存（WS message.created 到达时会按 documentId dedup）
    const bucket = ensureMessageBucket(actualId);
    if (bucket.hydrated) {
      patchMessageState(actualId, {
        items: mergeMessages(bucket.items, [created]),
      });
    }

    // 同步会话列表预览
    patchConversation(actualId, {
      lastMessage: {
        documentId: created.documentId,
        content: created.content ?? "",
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
    await $api(`/api/dm/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: { content },
    });
    // WS message.edited 也会到达，但为了即时反馈，本地也 patch 一次
    const bucket = messagesById.value[conversationId];
    if (bucket?.items?.length) {
      const editedAt = new Date().toISOString();
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
    await $api(`/api/dm/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
    });
    // 本地立即 patch，WS message.deleted 到达时 dedup（已 deletedAt 则跳过）
    const bucket = messagesById.value[conversationId];
    if (bucket?.items?.length) {
      const deletedAt = new Date().toISOString();
      patchMessageState(conversationId, {
        items: bucket.items.map((m) =>
          m.documentId === messageId ? { ...m, deletedAt, content: null } : m,
        ),
      });
    }
  }

  async function markConversationAsRead(id: string): Promise<void> {
    const conv = conversations.value.find((c) => c.documentId === id);
    // 没找到会话 / 已经全部已读 → 不发请求
    if (!conv || conv.unreadCount === 0) return;

    // 乐观：本地置 unread=0
    patchConversation(id, { unreadCount: 0 });

    try {
      await $api(`/api/dm/conversations/${encodeURIComponent(id)}/read`, {
        method: "PATCH",
      });
    } catch {
      // 静默失败：下次 refresh / WS 事件会自我修复
    }
  }

  async function updateConversation(
    id: string,
    patch: { muted?: boolean; pinned?: boolean; title?: string },
  ): Promise<void> {
    await $api(`/api/dm/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    });
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
        },
        typeof patch.pinned === "boolean",
      );
    }
  }

  async function leaveConversation(id: string): Promise<void> {
    await $api(`/api/dm/conversations/${encodeURIComponent(id)}/leave`, {
      method: "POST",
    });
    // 从列表移除
    conversations.value = conversations.value.filter((c) => c.documentId !== id);
    if (activeConversationId.value === id) activeConversationId.value = null;
    // 消息缓存也清掉
    if (messagesById.value[id]) {
      const next = { ...messagesById.value };
      delete next[id];
      messagesById.value = next;
    }
  }

  // ── WS 事件处理 ───────────────────────────────────────
  interface MessageCreatedData { message: DmMessage }
  interface MessageEditedData { content: string; editedAt: string }
  interface MessageDeletedData { deletedAt: string }
  interface ConversationReadData { lastReadAt: string }
  interface ConversationUpdatedData { title?: string }
  interface ConversationMemberRemovedData { userId: number }
  interface TypingData { userId: number }

  const onMessageCreated = (event: DmWsEvent<MessageCreatedData>) => {
    const cid = event.conversationId;
    const msg = event.data?.message;
    if (!cid || !msg?.documentId) return;

    const senderUserId = msg.sender?.userId;
    const isMine = selfUserId.value != null && senderUserId === selfUserId.value;

    // ── M3 通知融合边界 ──
    // 如果 recipient 列表里只有 pseudo:user:senderId（之前只有通知历史，从未
    // 真 DM 过），sender 第一次发 DM 时后端会 lazy 化为真 DM 会话并推送 ws
    // 事件——但本地列表 / 桶 / active 都还停留在 pseudo。这里做就地迁移：
    //  1) 把 pseudo 桶里的历史（通知）合并到真 DM 桶
    //  2) active 若指向 pseudo，切到真 DM docId
    //  3) 删 pseudo 列表项与桶；conversations 列表交给下面 refresh 兜底拉权威
    if (!isMine && typeof senderUserId === "number") {
      const pseudoId = `pseudo:user:${senderUserId}`;
      const pseudoIsActive = activeConversationId.value === pseudoId;
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
        if (pseudoIsActive) activeConversationId.value = cid;
        removeConversation(pseudoId);
      }
    }

    // 写入消息缓存（dedup by documentId）
    // 注意：上面 pseudo 迁移可能已经更新过 messagesById[cid]，所以这里重新读 bucket
    const bucket = messagesById.value[cid];
    if (bucket?.hydrated) {
      patchMessageState(cid, {
        items: mergeMessages(bucket.items, [msg]),
      });
    }

    // 更新会话列表预览 + 未读
    const conv = conversations.value.find((c) => c.documentId === cid);
    const isActive = activeConversationId.value === cid;

    if (conv) {
      const nextLast = {
        documentId: msg.documentId,
        content: msg.content ?? "",
        createdAt: msg.createdAt,
        kind: msg.kind,
        senderUserId: msg.sender?.userId ?? null,
      };
      const nextUnread = isMine || isActive ? conv.unreadCount : conv.unreadCount + 1;
      patchConversation(
        cid,
        {
          lastMessage: nextLast,
          lastMessageAt: msg.createdAt,
          unreadCount: nextUnread,
        },
        true,
      );
    } else {
      // 列表里还没这个会话——可能是：
      //  1) 对端新建会话给我发了第一条消息（!isMine）
      //  2) 多端登录：我在端 1 发完消息触发 pseudo 实质化，端 2 还没刷新列表
      //     (isMine=true 但端 2 conversations 里没有该真 DM 项)
      // 两种情况都需要 refresh 拿权威列表
      void refresh();
    }

    // 如果是当前激活会话且来自他人，顺手把已读推进到现在（多端同步）
    if (isActive && !isMine) {
      void markConversationAsRead(cid);
    }
  };

  const onMessageEdited = (event: DmWsEvent<MessageEditedData>) => {
    const cid = event.conversationId;
    const mid = event.messageId;
    const data = event.data;
    if (!cid || !mid || !data) return;
    const bucket = messagesById.value[cid];
    if (!bucket?.items?.length) return;
    patchMessageState(cid, {
      items: bucket.items.map((m) =>
        m.documentId === mid ? { ...m, content: data.content, editedAt: data.editedAt } : m,
      ),
    });
  };

  const onMessageDeleted = (event: DmWsEvent<MessageDeletedData>) => {
    const cid = event.conversationId;
    const mid = event.messageId;
    if (!cid || !mid) return;
    const bucket = messagesById.value[cid];
    if (!bucket?.items?.length) return;
    patchMessageState(cid, {
      items: bucket.items.map((m) =>
        m.documentId === mid ? { ...m, content: null, deletedAt: event.data?.deletedAt ?? new Date().toISOString() } : m,
      ),
    });
    // lastMessage 预览若是这条消息，也要更新
    const conv = conversations.value.find((c) => c.documentId === cid);
    if (conv?.lastMessage?.documentId === mid) {
      patchConversation(cid, {
        lastMessage: { ...conv.lastMessage, content: "" },
      });
    }
  };

  const onConversationRead = (event: DmWsEvent<ConversationReadData>) => {
    const cid = event.conversationId;
    const data = event.data;
    if (!cid || !data) return;
    const conv = conversations.value.find((c) => c.documentId === cid);
    if (!conv) return;
    patchConversation(cid, {
      unreadCount: 0,
      self: { ...conv.self, lastReadAt: data.lastReadAt },
    });
  };

  const onConversationUpdated = (event: DmWsEvent<ConversationUpdatedData>) => {
    const cid = event.conversationId;
    const data = event.data;
    if (!cid || !data) return;
    patchConversation(cid, {
      ...(typeof data.title === "string" ? { title: data.title } : {}),
    });
  };

  const onConversationMemberRemoved = (event: DmWsEvent<ConversationMemberRemovedData>) => {
    const cid = event.conversationId;
    if (!cid) return;
    // 私聊场景：对端离开 → 这个会话仍然存在，但前端可显示提示；
    //          自己离开 → 后端不会推自己，所以这里收到的都是对端动作。
    // 简化处理：刷新一次列表（拿权威 memberCount 等）
    void refresh();
  };

  const onTyping = (event: DmWsEvent<TypingData>) => {
    const cid = event.conversationId;
    const uid = event.data?.userId;
    if (!cid || typeof uid !== "number") return;
    // 加入 typing 集合
    const current = typing.value[cid] ?? [];
    if (!current.includes(uid)) {
      typing.value = { ...typing.value, [cid]: [...current, uid] };
    }
    // 4s 后自动移除（与服务端的 typing 心跳节奏匹配）
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

  const startStream = () => {
    if (subscribed) {
      // 已订阅；只保证 stream 在运行
      stream.start();
      return;
    }
    subscribed = true;
    stream.start();

    unsubscribeAll.push(stream.on<MessageCreatedData>("message.created", onMessageCreated));
    unsubscribeAll.push(stream.on<MessageEditedData>("message.edited", onMessageEdited));
    unsubscribeAll.push(stream.on<MessageDeletedData>("message.deleted", onMessageDeleted));
    unsubscribeAll.push(stream.on<ConversationReadData>("conversation.read", onConversationRead));
    unsubscribeAll.push(stream.on<ConversationUpdatedData>("conversation.updated", onConversationUpdated));
    unsubscribeAll.push(stream.on<ConversationMemberRemovedData>("conversation.member.removed", onConversationMemberRemoved));
    unsubscribeAll.push(stream.on<TypingData>("typing", onTyping));
  };

  const stopStream = () => {
    for (const off of unsubscribeAll) {
      try { off(); } catch { /* noop */ }
    }
    unsubscribeAll = [];
    subscribed = false;
    stream.stop();
    // 清 typing 超时 + 视觉状态：否则关弹窗后 typing 残留
    // 下次打开会显示"对方正在输入..."
    for (const t of typingTimers.values()) clearTimeout(t);
    typingTimers.clear();
    typing.value = {};
  };

  const reset = () => {
    stopStream();
    conversations.value = [];
    isLoading.value = false;
    error.value = null;
    messagesById.value = {};
    activeConversationId.value = null;
    typing.value = {};
  };

  const totalUnread = computed(() =>
    conversations.value.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
  );

  return {
    conversations: computed(() => conversations.value),
    isLoading: computed(() => isLoading.value),
    error: computed(() => error.value),
    totalUnread,
    activeConversationId,
    typingByConversation: computed(() => typing.value),

    refresh,
    openDirectConversation,
    messageStateOf: (id: string) =>
      messagesById.value[id] ?? emptyMessageState(),
    ensureMessages,
    loadMoreMessages,
    sendMessage,
    editMessage,
    withdrawMessage,
    markConversationAsRead,
    updateConversation,
    leaveConversation,
    sendTyping: stream.sendTyping,
    startStream,
    stopStream,
    reset,
  };
}
