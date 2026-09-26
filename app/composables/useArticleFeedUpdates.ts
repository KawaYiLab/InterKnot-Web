import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import type { Post } from "~/types/entities";
import type { Pagination } from "~/types/api";

const HIGHLIGHT_MS = 3000;

export function useArticleFeedUpdates(options: {
  posts: Ref<Post[]>;
  enabled: Ref<boolean>;
  scope: Ref<string>;
  canApply: () => boolean;
  load: (ids: string[]) => Promise<Post[]>;
  onApplied: () => void;
  onError: (error: unknown) => void;
}) {
  // 每次事件都有版本号；同一帖子在请求期间再次更新时，不能随旧批次一起清掉。
  const pending = shallowRef(new Map<string, number>());
  const pendingIds = computed(() => [...pending.value.keys()]);
  const applying = ref(false);
  const highlightedIds = shallowRef(new Set<string>());
  const announcement = ref("");
  const reconciledBump = ref<number | null>(null);
  let eventVersion = 0;
  let generation = 0;
  let disposed = false;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;

  const clearHighlight = () => {
    clearTimeout(highlightTimer);
    highlightTimer = undefined;
    highlightedIds.value = new Set();
    announcement.value = "";
  };

  const reset = () => {
    generation++;
    applying.value = false;
    pending.value = new Map();
    reconciledBump.value = null;
    clearHighlight();
  };

  const enqueue = (id: string) => {
    if (disposed || !options.enabled.value || !id) return;
    const next = new Map(pending.value);
    next.set(id, ++eventVersion);
    pending.value = next;
  };

  const detect = (posts: Post[]) => {
    const known = new Map(options.posts.value.map((post) => [post.id, post]));
    for (const post of posts) {
      // 自己顶起 / 发布的帖不计入「新活动」：服务端按 viewer 下发 bumpedBySelf，
      // 覆盖轮询对账这条路（SSE 即时路径已在广播层按 user 排除）。
      if (post.bumpedBySelf) continue;
      const previous = known.get(post.id);
      // updatedAt 会受点赞等操作影响；只有 bumpedAt 才表示信息流中的新活动。
      if (!previous || (
        post.bumpedAt && previous.bumpedAt &&
        Date.parse(post.bumpedAt) > Date.parse(previous.bumpedAt)
      )) enqueue(post.id);
    }
  };

  const newestBump = (posts: Post[]) => posts.reduce<number | null>((latest, post) => {
    const time = Date.parse(post.bumpedAt || "");
    return !post.isPinned && Number.isFinite(time) ? Math.max(latest ?? time, time) : latest;
  }, null);
  const seedPollingBaseline = (posts: Post[]) => {
    reconciledBump.value = newestBump(posts);
  };

  const reconcile = async (
    loadPage: (cursor: string) => Promise<Pagination<Post>>,
    isCurrent: () => boolean,
  ) => {
    const currentGeneration = generation;
    const boundary = reconciledBump.value;
    const posts: Post[] = [];
    const cursors = new Set<string>();
    let cursor = "";
    while (true) {
      const page = await loadPage(cursor);
      if (disposed || currentGeneration !== generation || !isCurrent()) return;
      posts.push(...page.nodes);
      // 公告不参与时间边界。SSE 插入过的较新卡片也不能推进这里的对账边界。
      const reachedBaseline = boundary !== null && page.nodes.some((post) =>
        !post.isPinned && Date.parse(post.bumpedAt || "") < boundary,
      );
      if (boundary === null || reachedBaseline || !page.hasNextPage || !page.endCursor) break;
      if (cursors.has(page.endCursor)) return;
      cursors.add(page.endCursor);
      cursor = page.endCursor;
    }

    // 最后一页可能包含之前没翻到的旧帖，它们不是本次的新活动。
    detect(boundary === null ? posts : posts.filter((post) =>
      post.isPinned || !post.bumpedAt || Date.parse(post.bumpedAt) >= boundary,
    ));
    const latest = newestBump(posts);
    if (latest !== null) reconciledBump.value = Math.max(boundary ?? latest, latest);
  };

  const snapshot = () => new Map(pending.value);
  const acknowledge = (batch: Map<string, number>) => {
    const next = new Map(pending.value);
    for (const [id, version] of batch) {
      if (next.get(id) === version) next.delete(id);
    }
    pending.value = next;
  };

  const apply = async () => {
    if (disposed || applying.value || !options.enabled.value || !options.canApply() || !pending.value.size) return;
    const batch = snapshot();
    const currentGeneration = generation;
    applying.value = true;
    try {
      const posts = await options.load([...batch.keys()]);
      if (disposed || currentGeneration !== generation) return;

      const previous = new Map(options.posts.value.map((post) => [post.id, post]));
      const updates = new Map<string, Post>();
      for (const post of posts) {
        if (!post.id || !batch.has(post.id) || post.isHidden) continue;
        updates.set(post.id, previous.get(post.id)?.isRead && !post.isRead
          ? { ...post, isRead: true }
          : post);
      }

      // 本批次排在公告之前；旧列表只移走本批次，保留已翻到的页面与相对顺序。
      // 已删除/不可见的请求项不再插回，避免留着失效卡片。
      options.posts.value = [
        ...updates.values(),
        ...options.posts.value.filter((post) => !batch.has(post.id)),
      ];
      acknowledge(batch);
      clearHighlight();
      highlightedIds.value = new Set(updates.keys());
      announcement.value = updates.size
        ? ""
        : "这批帖子已不可见，列表已同步";
      highlightTimer = setTimeout(clearHighlight, HIGHLIGHT_MS);
      options.onApplied();
    } catch (error) {
      if (!disposed && currentGeneration === generation) options.onError(error);
    } finally {
      if (currentGeneration === generation) applying.value = false;
    }
  };

  watch([options.scope, options.enabled], reset, { flush: "sync" });
  onScopeDispose(() => {
    disposed = true;
    reset();
  });

  return {
    pendingIds, applying, highlightedIds, announcement, reconciledBump,
    enqueue, detect, snapshot, acknowledge, apply, clearHighlight, seedPollingBaseline, reconcile,
  };
}
