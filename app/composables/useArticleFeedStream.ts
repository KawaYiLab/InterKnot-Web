import { watch, onScopeDispose, type Ref } from "vue";

/**
 * 列表级实时广播：监听实时通道（/v1/realtime）的 `post.published`（首次发布）与
 * `post.bumped`（旧帖被新回复顶起），回调 postId。用于首页/频道列表顶部「有 N 条新内容」按钮的
 * **即时**路径，与既有的慢轮询对账互补（轮询兜底漏推）。
 *
 * - 仅客户端运行；SSR 时是 no-op。连接由 plugins/realtime.client.ts 维持。
 * - 新帖事件带 categoryId，按当前频道过滤；「全部」下不算里区的新帖。顶帖事件不带分区，交给 load 时的列表接口过滤。
 * - 自己发的帖、自己顶起的帖：服务端广播时不推给操作者本人；轮询对账路径由列表卡片的 bumpedBySelf 排除
 *   （见 useArticleFeedUpdates）。
 */
export function useArticleFeedStream(opts: {
  /** 是否接收（首页最新 / 热门 / 未看无搜索时为 true）。 */
  enabled: Ref<boolean>;
  /** 当前分类 slug；空串 = 全部频道。 */
  category: Ref<string>;
  /** 收到一条帖子广播（新帖或顶帖）时调用。 */
  onTopicEvent: (topicId: string) => void;
}): { stop: () => void } {
  if (!import.meta.client) return { stop: () => {} };

  const realtime = useRealtime();
  const api = useApi();
  // 分区 slug → id：新帖事件只带 categoryId。
  let categoryIds = new Map<string, string>();
  const loadCategories = () => {
    api.getCategories()
      .then((list) => {
        categoryIds = new Map(list.map((c) => [c.slug, c.documentId || ""]));
      })
      .catch(() => undefined);
  };
  // 「全部」也要知道里区的 id，用来跳过里区的新帖。
  watch(opts.category, (slug) => {
    if (!categoryIds.has(slug || INNER_CATEGORY_SLUG)) loadCategories();
  }, { immediate: true });

  const offs = [
    realtime.on<{ postId?: string; categoryId?: string | null; firstPublish?: boolean }>("post.published", (ev) => {
      const { postId, categoryId, firstPublish } = ev.d || {};
      // 编辑后重新发布不算新内容（不顶帖）。
      if (!opts.enabled.value || !postId || firstPublish === false) return;
      const slug = opts.category.value;
      if (slug) {
        const wanted = categoryIds.get(slug);
        if (wanted && categoryId && wanted !== categoryId) return;
      } else {
        const inner = categoryIds.get(INNER_CATEGORY_SLUG);
        if (inner && categoryId === inner) return;
      }
      opts.onTopicEvent(postId);
    }),
    realtime.on<{ postId?: string }>("post.bumped", (ev) => {
      const postId = ev.d?.postId;
      if (opts.enabled.value && postId) opts.onTopicEvent(postId);
    }),
  ];

  const stop = () => {
    for (const off of offs.splice(0)) off();
  };
  onScopeDispose(stop);

  return { stop };
}
