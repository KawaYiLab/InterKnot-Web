/**
 * useKkCall —— 敲敲通话视图（角色卡 + 会话 + 消息 + SSE 流式发送）
 *
 * 后端契约：`server/src/api/kk-call/*`
 *   GET    /api/kk-call/sessions               左栏列表（真 session ∪ pseudo:char）
 *   GET    /api/kk-call/sessions/:id/messages  消息分页（pseudo:char 返回空数组）
 *   POST   /api/kk-call/sessions/:id/messages  发送消息，SSE 流式响应
 *
 * 关键状态用 `useState` 共享，确保多处使用拿到同一份缓存。
 *
 * 注意 active id 由外部（KnockKnockModal）持有，本 composable 不维护。
 */

import { computed, type ComputedRef } from "vue";
import { fetchSSE, type SseEvent } from "~/utils/sse";
import type {
  KkCallCharacter,
  KkCallMessage,
  KkCallSessionSummary,
  KkCallToolCall,
} from "~/types/entities";

const TOKEN_KEY = "access_token";

interface SessionListResponse {
  data: KkCallSessionSummary[];
}

interface MessagesResponse {
  /** 后端按 createdAt desc 返回；前端反转后存为 asc */
  data: KkCallMessage[];
  meta?: { hasMore?: boolean; nextCursor?: string | null };
}

/** 单会话消息缓存：与 useDmConversations 一致的形态便于复用 UI 逻辑 */
export interface KkCallMessageState {
  items: KkCallMessage[];
  loading: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  hydrated: boolean;
}

const emptyMessageState = (): KkCallMessageState => ({
  items: [],
  loading: false,
  hasMore: false,
  nextCursor: null,
  hydrated: false,
});

interface UseKkCall {
  sessions: ComputedRef<KkCallSessionSummary[]>;
  isLoading: ComputedRef<boolean>;
  error: ComputedRef<string | null>;

  refresh: () => Promise<void>;
  ensureMessages: (id: string, force?: boolean) => Promise<void>;
  loadMoreMessages: (id: string) => Promise<void>;
  messageStateOf: (id: string) => KkCallMessageState;

  /**
   * 发送消息并消费 SSE 流。
   *  - 若 `sessionId` 是 pseudo:char:X，后端首帧会发 session.materialized，
   *    本方法负责把本地 messages 桶 / sessions 列表里的 pseudo id 替换为真 id；
   *    返回值 `realId` 即真 session documentId（pseudo 也会换成它）。
   *  - sending / 流取消由 controller 内部 AbortController 管理；调用方组件
   *    卸载时应调返回的 `abort()`。
   */
  sendMessage: (
    sessionId: string,
    content: string,
  ) => {
    realId: Promise<string>; // resolved 拿到（最终）真 session documentId
    done: Promise<void>;
    abort: () => void;
  };
}

export function useKkCall(): UseKkCall {
  const sessions = useState<KkCallSessionSummary[]>("kk-call:sessions", () => []);
  const isLoading = useState<boolean>("kk-call:loading", () => false);
  const error = useState<string | null>("kk-call:error", () => null);
  const messagesById = useState<Record<string, KkCallMessageState>>(
    "kk-call:messages",
    () => ({}),
  );

  const { $api } = useNuxtApp();

  /* ───────── 列表 / 消息 ───────── */

  async function refresh(): Promise<void> {
    if (isLoading.value) return;
    isLoading.value = true;
    error.value = null;
    try {
      const resp = await $api<SessionListResponse>("/api/kk-call/sessions");
      sessions.value = Array.isArray(resp?.data) ? resp.data : [];
    } catch (err: any) {
      error.value = err?.message || "加载失败";
    } finally {
      isLoading.value = false;
    }
  }

  function ensureBucket(id: string): KkCallMessageState {
    let bucket = messagesById.value[id];
    if (!bucket) {
      bucket = emptyMessageState();
      messagesById.value = { ...messagesById.value, [id]: bucket };
    }
    return bucket;
  }

  function patchBucket(id: string, patch: Partial<KkCallMessageState>) {
    const prev = messagesById.value[id] ?? emptyMessageState();
    messagesById.value = {
      ...messagesById.value,
      [id]: { ...prev, ...patch },
    };
  }

  /** 后端 desc → 前端 asc */
  const toAsc = (items: KkCallMessage[]): KkCallMessage[] => {
    const copy = items.slice();
    copy.reverse();
    return copy;
  };

  /** dedup by documentId，incoming 覆盖；按 createdAt asc 排序。
   *  合并时保留 existing 上的 SSE-only 字段（thinkingContent / toolCalls / refs），
   *  因为这些字段只在流式推送期间存在、不会持久化到数据库。 */
  const mergeMessages = (
    existing: KkCallMessage[],
    incoming: KkCallMessage[],
  ): KkCallMessage[] => {
    if (incoming.length === 0) return existing;
    const map = new Map<string, KkCallMessage>();
    for (const it of existing) {
      if (it?.documentId) map.set(it.documentId, it);
    }
    for (const it of incoming) {
      if (!it?.documentId) continue;
      const prev = map.get(it.documentId);
      if (prev) {
        // 保留 SSE-only 字段
        map.set(it.documentId, {
          ...it,
          thinkingContent: it.thinkingContent || prev.thinkingContent,
          thinkingDone: it.thinkingDone ?? prev.thinkingDone,
          toolCalls: it.toolCalls?.length ? it.toolCalls : prev.toolCalls,
          refs: it.refs?.length ? it.refs : prev.refs,
        });
      } else {
        map.set(it.documentId, it);
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return da - db;
    });
  };

  async function fetchMessagesPage(id: string, before: string | null): Promise<MessagesResponse> {
    const query: Record<string, string> = { limit: "50" };
    if (before) query.before = before;
    return $api<MessagesResponse>(
      `/api/kk-call/sessions/${encodeURIComponent(id)}/messages`,
      { query },
    );
  }

  async function ensureMessages(id: string, force = false): Promise<void> {
    const bucket = ensureBucket(id);
    if (bucket.hydrated && !force) return;
    if (bucket.loading) return;
    patchBucket(id, { loading: true });
    try {
      const resp = await fetchMessagesPage(id, null);
      const incoming = toAsc(resp?.data ?? []);
      patchBucket(id, {
        items: mergeMessages(bucket.items, incoming),
        hasMore: !!resp?.meta?.hasMore,
        nextCursor: resp?.meta?.nextCursor ?? null,
        hydrated: true,
        loading: false,
      });
    } catch (err) {
      patchBucket(id, { loading: false });
      throw err;
    }
  }

  async function loadMoreMessages(id: string): Promise<void> {
    const bucket = ensureBucket(id);
    if (!bucket.hasMore || !bucket.nextCursor || bucket.loading) return;
    patchBucket(id, { loading: true });
    try {
      const resp = await fetchMessagesPage(id, bucket.nextCursor);
      const olderAsc = toAsc(resp?.data ?? []);
      patchBucket(id, {
        items: [...olderAsc, ...bucket.items],
        hasMore: !!resp?.meta?.hasMore,
        nextCursor: resp?.meta?.nextCursor ?? null,
        loading: false,
      });
    } catch (err) {
      patchBucket(id, { loading: false });
      throw err;
    }
  }

  /* ───────── 发送（SSE 流） ───────── */

  const sendMessage = (sessionId: string, content: string) => {
    const config = useRuntimeConfig();
    const baseURL = (config.public as { apiBaseUrl?: string })?.apiBaseUrl ?? "";
    const token = import.meta.client ? localStorage.getItem(TOKEN_KEY) || "" : "";

    const url = `${baseURL.replace(/\/$/, "")}/api/kk-call/sessions/${encodeURIComponent(
      sessionId,
    )}/messages`;

    const abortController = new AbortController();
    let resolveRealId: (id: string) => void = () => {};
    let rejectRealId: (e: unknown) => void = () => {};
    const realIdPromise = new Promise<string>((resolve, reject) => {
      resolveRealId = resolve;
      rejectRealId = reject;
    });

    let currentBucketId = sessionId;
    let assistantMsgId: string | null = null;

    /** 把 pseudo 桶替换为真桶（保留已有 items）；同步更新 sessions 列表里的 id */
    const migratePseudoToReal = (realId: string, character: KkCallCharacter | null) => {
      if (currentBucketId === realId) return;
      const oldBucket = messagesById.value[currentBucketId];
      const newBucket = messagesById.value[realId];
      // 真桶若已存在则合并；否则直接搬过去并标 hydrated
      const merged: KkCallMessageState = newBucket
        ? {
            ...newBucket,
            items: mergeMessages(newBucket.items, oldBucket?.items ?? []),
            hydrated: newBucket.hydrated || !!oldBucket?.hydrated,
          }
        : {
            items: oldBucket?.items ?? [],
            loading: false,
            hasMore: false,
            nextCursor: null,
            hydrated: true,
          };
      const next = { ...messagesById.value, [realId]: merged };
      delete next[currentBucketId];
      messagesById.value = next;

      // sessions 列表：把 pseudo 项替换成真 session 摘要
      sessions.value = sessions.value.map((s) =>
        s.documentId === currentBucketId
          ? {
              ...s,
              documentId: realId,
              isPseudo: false,
              character: character || s.character,
            }
          : s,
      );

      currentBucketId = realId;
    };

    /** 把消息追加 / 合并到当前 bucket */
    const upsertMessage = (msg: KkCallMessage) => {
      const bucket = messagesById.value[currentBucketId];
      if (!bucket) {
        patchBucket(currentBucketId, {
          items: [msg],
          hydrated: true,
        });
        return;
      }
      patchBucket(currentBucketId, {
        items: mergeMessages(bucket.items, [msg]),
      });
    };

    /** 修改 assistant 占位的 content / pending / errorReason */
    const patchAssistant = (patch: Partial<KkCallMessage>) => {
      if (!assistantMsgId) return;
      const bucket = messagesById.value[currentBucketId];
      if (!bucket?.items?.length) return;
      patchBucket(currentBucketId, {
        items: bucket.items.map((m) =>
          m.documentId === assistantMsgId ? { ...m, ...patch } : m,
        ),
      });
    };

    const done = (async () => {
      try {
        const stream = fetchSSE<any>(url, {
          method: "POST",
          body: { content },
          token,
          signal: abortController.signal,
        });

        for await (const evt of stream as AsyncIterable<SseEvent<any>>) {
          handleEvent(evt);
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || abortController.signal.aborted) {
          // 用户主动取消：把 assistant 标 errorReason，但不抛
          patchAssistant({ pending: false, errorReason: "aborted" });
          return;
        }
        // 其它错误（HTTP 4xx/5xx）：标 assistant errorReason
        patchAssistant({
          pending: false,
          errorReason: err?.status ? `http_${err.status}` : "network_error",
        });
        throw err;
      } finally {
        // 兜底：流结束但 assistant 仍 pending（理论上 done/error 事件会清掉）
        patchAssistant({ pending: false });
        // 触发一次列表刷新拉权威预览（fire & forget）
        void refresh();
      }
    })();

    function handleEvent(evt: SseEvent<any>) {
      const data = evt.data;
      switch (evt.type) {
        case "session.materialized": {
          const realId = String(data?.sessionId || "");
          const character: KkCallCharacter | null = data?.character || null;
          if (realId) {
            migratePseudoToReal(realId, character);
            resolveRealId(realId);
          }
          break;
        }
        case "message.user.created": {
          if (data?.documentId) upsertMessage(data as KkCallMessage);
          // 真 sessionId 已就绪——若入参就是真 id，这里 resolve
          if (currentBucketId === sessionId && !sessionId.startsWith("pseudo:")) {
            resolveRealId(sessionId);
          }
          break;
        }
        case "message.assistant.started": {
          if (data?.documentId) {
            assistantMsgId = data.documentId;
            const placeholder: KkCallMessage = {
              documentId: data.documentId,
              role: "assistant",
              content: "",
              pending: true,
              errorReason: null,
              createdAt:
                typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
            };
            upsertMessage(placeholder);
          }
          break;
        }
        case "message.assistant.delta": {
          const delta = typeof data?.delta === "string" ? data.delta : "";
          if (!delta || !assistantMsgId) break;
          const bucket = messagesById.value[currentBucketId];
          if (!bucket?.items?.length) break;
          patchBucket(currentBucketId, {
            items: bucket.items.map((m) =>
              m.documentId === assistantMsgId
                ? { ...m, content: (m.content || "") + delta }
                : m,
            ),
          });
          break;
        }
        case "message.assistant.done": {
          const fullContent = typeof data?.content === "string" ? data.content : null;
          patchAssistant({
            pending: false,
            errorReason: null,
            ...(fullContent != null ? { content: fullContent } : {}),
          });
          break;
        }
        // ── PR4: 思考链 / 工具调用 / 引用 ──
        case "message.assistant.thinking_delta": {
          const td = typeof data?.delta === "string" ? data.delta : "";
          if (!td || !assistantMsgId) break;
          const bucket = messagesById.value[currentBucketId];
          if (!bucket?.items?.length) break;
          patchBucket(currentBucketId, {
            items: bucket.items.map((m) =>
              m.documentId === assistantMsgId
                ? { ...m, thinkingContent: (m.thinkingContent || "") + td, thinkingDone: false }
                : m,
            ),
          });
          break;
        }
        case "message.assistant.thinking_done": {
          patchAssistant({ thinkingDone: true });
          break;
        }
        case "message.assistant.tool_call": {
          if (!assistantMsgId) break;
          const tcName = typeof data?.name === "string" ? data.name : "tool";
          const tcArgs = typeof data?.arguments === "string" ? data.arguments : "";
          const tc: KkCallToolCall = { name: tcName, arguments: tcArgs };
          const bucket2 = messagesById.value[currentBucketId];
          if (!bucket2?.items?.length) break;
          patchBucket(currentBucketId, {
            items: bucket2.items.map((m) =>
              m.documentId === assistantMsgId
                ? { ...m, toolCalls: [...(m.toolCalls || []), tc] }
                : m,
            ),
          });
          break;
        }
        case "message.assistant.tool_result": {
          if (!assistantMsgId) break;
          const trName = typeof data?.name === "string" ? data.name : "tool";
          const trResult = typeof data?.result === "string" ? data.result : "";
          const bucket3 = messagesById.value[currentBucketId];
          if (!bucket3?.items?.length) break;
          // 匹配最后一个同名 tool_call 并填充 result
          patchBucket(currentBucketId, {
            items: bucket3.items.map((m) => {
              if (m.documentId !== assistantMsgId) return m;
              const calls: KkCallToolCall[] = [...(m.toolCalls || [])];
              for (let i = calls.length - 1; i >= 0; i--) {
                const c = calls[i];
                if (c && c.name === trName && !c.result) {
                  calls[i] = { name: c.name, arguments: c.arguments, result: trResult };
                  break;
                }
              }
              return { ...m, toolCalls: calls };
            }),
          });
          break;
        }
        case "message.assistant.ref": {
          if (!assistantMsgId) break;
          const refId = typeof data?.refId === "string" ? data.refId : "";
          if (!refId) break;
          const bucket4 = messagesById.value[currentBucketId];
          if (!bucket4?.items?.length) break;
          patchBucket(currentBucketId, {
            items: bucket4.items.map((m) =>
              m.documentId === assistantMsgId
                ? { ...m, refs: [...(m.refs || []), refId] }
                : m,
            ),
          });
          break;
        }
        case "message.assistant.removed": {
          // 后端删除了提前创建的空占位消息（工具调用后无后续内容的边界情况）
          const rmId = typeof data?.documentId === "string" ? data.documentId : "";
          if (!rmId) break;
          const bucketRm = messagesById.value[currentBucketId];
          if (!bucketRm?.items?.length) break;
          patchBucket(currentBucketId, {
            items: bucketRm.items.filter((m) => m.documentId !== rmId),
          });
          if (assistantMsgId === rmId) assistantMsgId = null;
          break;
        }
        case "error": {
          const code = typeof data?.code === "string" ? data.code : "stream_error";
          patchAssistant({ pending: false, errorReason: code });
          break;
        }
        default:
          // 未知事件，忽略
          break;
      }
    }

    // sessionId 是真 id 时，realId 立即 resolve（即使流未开始）
    if (!sessionId.startsWith("pseudo:")) {
      resolveRealId(sessionId);
    }
    // 若 done 抛异常,realId 也要 reject 避免悬挂
    done.catch((e) => rejectRealId(e));

    return {
      realId: realIdPromise,
      done,
      abort: () => {
        try {
          abortController.abort();
        } catch {
          /* noop */
        }
      },
    };
  };

  return {
    sessions: computed(() => sessions.value),
    isLoading: computed(() => isLoading.value),
    error: computed(() => error.value),
    refresh,
    ensureMessages,
    loadMoreMessages,
    messageStateOf: (id: string) => messagesById.value[id] ?? emptyMessageState(),
    sendMessage,
  };
}
