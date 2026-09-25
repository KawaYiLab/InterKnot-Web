import { watch, onScopeDispose, type Ref } from "vue";

/**
 * 列表级实时广播（SSE）客户端：订阅 `/api/articles/stream`，收到「新帖」事件时
 * 回调 topicId。用于首页/频道列表顶部「有 N 条新内容」按钮的**即时**路径，
 * 与既有的慢轮询对账互补（轮询兜底 bump 与漏推）。
 *
 * - 仅客户端运行；SSR 时是 no-op。
 * - EventSource 自带断线重连；这里只在「是否启用」或「分类」变化时开/关或换频道。
 * - 频道由 category slug 决定：空串 = 全站最新（latest 频道），否则订阅该分类频道。
 *   服务端已按频道过滤，客户端拿到的即是与当前视图相关的事件。
 */
/**
 * 对齐 Discourse：`new_topic` = 新帖，`topic_bumped` = 旧帖被新回复顶起。
 * 「最新」视图两者都算「新的或更新的」，客户端一视同仁地计数。
 */
export interface ArticleFeedTopicEvent {
  type: "new_topic" | "topic_bumped";
  topicId: string;
  categorySlug?: string | null;
  tagSlugs?: string[];
  at: string;
}

export function useArticleFeedStream(opts: {
  /** 是否应保持连接（推荐流 + 最新排序 + 无搜索时为 true）。 */
  enabled: Ref<boolean>;
  /** 当前分类 slug；空串 = 全部频道。 */
  category: Ref<string>;
  /**
   * 当前登录用户的 users-permissions user id（未登录为 null）。随连接明文上报给服务端，
   * 仅用于让服务端不把「自己触发的发帖 / 顶帖」事件推回给自己。伪造无收益：流里只有公开 topicId。
   */
  currentUserId: Ref<number | null>;
  /** 收到一条 topic 广播（新帖或顶帖）时调用。 */
  onTopicEvent: (topicId: string) => void;
}): { stop: () => void } {
  if (!import.meta.client) return { stop: () => {} };

  const config = useRuntimeConfig();
  const baseURL = (
    (config.public as { apiBaseUrl?: string })?.apiBaseUrl ?? ""
  ).replace(/\/$/, "");

  let es: EventSource | null = null;

  const close = () => {
    if (es) {
      try {
        es.close();
      } catch {
        /* noop */
      }
      es = null;
    }
  };

  const open = () => {
    close();
    const category = opts.category.value;
    const uid = opts.currentUserId.value;
    const search = new URLSearchParams();
    if (category) search.set("category", category);
    // 明文自报自己的 user id：仅用于让服务端不把「我自己顶起 / 发布的帖」推回给我自己
    //（EventSource 无法带 Authorization 头）。可伪造但无收益：流里只有公开 topicId。
    if (uid) search.set("uid", String(uid));
    const qs = search.toString();
    const params = qs ? `?${qs}` : "";
    let source: EventSource;
    try {
      source = new EventSource(`${baseURL}/api/articles/stream${params}`);
    } catch {
      return;
    }
    es = source;
    const onTopic = (ev: Event) => {
      if (es !== source || !opts.enabled.value || opts.category.value !== category) return;
      try {
        const data = JSON.parse(
          (ev as MessageEvent).data,
        ) as ArticleFeedTopicEvent;
        if (typeof data?.topicId === "string" && data.topicId) opts.onTopicEvent(data.topicId);
      } catch {
        /* malformed payload — ignore */
      }
    };
    source.addEventListener("new_topic", onTopic);
    source.addEventListener("topic_bumped", onTopic);
    // 不手动处理 onerror：EventSource 会按服务端下发的 retry 自行重连。
  };

  const sync = () => {
    if (opts.enabled.value) open();
    else close();
  };

  // enabled / category / 当前用户 变化：重新评估连接（换频道或登录态变化 = 关旧开新）。
  watch([opts.enabled, opts.category, opts.currentUserId], sync, { immediate: true });
  onScopeDispose(close);

  return { stop: close };
}
