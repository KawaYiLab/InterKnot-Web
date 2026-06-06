/**
 * 评论场景「AI 正在回复…」状态（3.2.4）
 *
 * 后端在评论入队 / 回复落库时通过 knock SSE 推送 `agent.replying` /
 * `agent.reply.done`（见 ikserver sse-bus）。这里维护一个按文章 documentId
 * 聚合的响应式状态，供帖子详情页展示加载态。
 *
 * SSE 连接由 `useKnockKnockConversations` 统一维护，事件在那里分发到本 store。
 */
import type { KnockSseEvent } from "~/types/entities";

interface AgentReplyState {
  /** 正在回复的 AI 角色名（用于文案展示） */
  roleName?: string;
  /** 安全自动清除计时器：done 事件丢失 / 回复失败时兜底 */
  timer?: ReturnType<typeof setTimeout>;
}

/** 兜底：replying 后最多保留多久仍未收到 done 就自动清除 */
const AUTO_CLEAR_MS = 60_000;

export function useAgentReplyStatus() {
  // key: article documentId
  const stateByArticle = useState<Record<string, AgentReplyState>>(
    "agent-reply-status",
    () => ({}),
  );

  function clear(articleId: string) {
    const existing = stateByArticle.value[articleId];
    if (existing?.timer) clearTimeout(existing.timer);
    if (!existing) return;
    const next = { ...stateByArticle.value };
    delete next[articleId];
    stateByArticle.value = next;
  }

  /** 由 SSE 分发器调用 */
  function handleEvent(event: KnockSseEvent) {
    const articleId = event.articleId;
    if (!articleId) return;

    if (event.type === "agent.replying") {
      const prev = stateByArticle.value[articleId];
      if (prev?.timer) clearTimeout(prev.timer);
      const timer = import.meta.client
        ? setTimeout(() => clear(articleId), AUTO_CLEAR_MS)
        : undefined;
      stateByArticle.value = {
        ...stateByArticle.value,
        [articleId]: { roleName: event.roleName, timer },
      };
    } else if (event.type === "agent.reply.done") {
      clear(articleId);
    }
  }

  /** 帖子详情页：是否有 AI 正在为该文章回复 */
  function isReplying(articleId: string): boolean {
    return !!stateByArticle.value[articleId];
  }

  /** 帖子详情页：正在回复的角色名（可空） */
  function replyingRoleName(articleId: string): string | undefined {
    return stateByArticle.value[articleId]?.roleName;
  }

  return { handleEvent, isReplying, replyingRoleName, clear };
}
