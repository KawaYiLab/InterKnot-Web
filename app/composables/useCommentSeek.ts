import { computed, nextTick, ref, watch } from "vue";
import type { Ref } from "vue";
import type { Comment } from "~/types/entities";

export interface UseCommentSeekOptions {
  targetCommentId: Ref<string | null>;
  comments: Ref<Comment[]>;
  commentsHasNext: Ref<boolean>;
  loadComments: () => Promise<void>;
  /** 评论 DOM 是否已渲染（如 PostOverlay 的 commentsVisible），未渲染则先等待 */
  commentsVisible?: Ref<boolean>;
  /**
   * 展开某条顶层评论的下一页回复，返回新增条数（0 = 到底）。
   * 评论列表只内联前 3 条回复，目标回复可能还没加载，得靠它按需展开；
   * 不传则退化为「只在已加载的回复里找」（老行为）。
   */
  loadMoreReplies?: (comment: Comment) => Promise<number>;
  /** 一次 seek 里最多展开多少页回复，防止在回复几百条的帖子里无限翻 */
  maxReplyExpands?: number;
}

/**
 * 评论区目标定位 composable：按评论 id 逐页加载，找到后滚动并高亮。
 * 用于 PostOverlay 与 post/[id].vue 共享同一套「定位目标评论」逻辑。
 */
export function useCommentSeek({
  targetCommentId,
  comments,
  commentsHasNext,
  loadComments,
  commentsVisible,
  loadMoreReplies,
  maxReplyExpands = 8,
}: UseCommentSeekOptions) {
  const targetFound = ref(false);
  const seeking = ref(false);
  // 标记已检查过的顶层评论数量，避免每次 findComment 都全量扫描
  const checkedTopLevelCount = ref(0);
  // 本次 seek 已展开的回复页数，以及各条顶层评论各自展开了几页 / 哪些已经翻到底
  let replyExpands = 0;
  const expandedPages = new Map<string, number>();
  const exhaustedParents = new Set<string>();

  const findComment = (id: string, list: Comment[]): boolean => {
    if (list.length < checkedTopLevelCount.value) {
      // 评论列表被重置，需要重新扫描
      checkedTopLevelCount.value = 0;
    }
    for (let i = checkedTopLevelCount.value; i < list.length; i++) {
      const c = list[i]!;
      if (c.id === id) return true;
      if (c.replies?.some((r) => r.id === id)) return true;
    }
    checkedTopLevelCount.value = list.length;
    return false;
  };

  const highlightedCommentId = computed(() =>
    targetFound.value ? targetCommentId.value : null,
  );

  /**
   * 挑一条最值得展开回复的顶层评论：已展开页数最少的优先（回复很多的那条不该独吞预算），
   * 同等页数时按列表顺序 —— 评论列表是 desc，从通知点进来的目标多半靠前。
   */
  const pickExpandCandidate = (): Comment | undefined => {
    let best: Comment | undefined;
    let bestPages = Number.POSITIVE_INFINITY;
    for (const comment of comments.value) {
      if (comment.repliesHasMore !== true || exhaustedParents.has(comment.id)) continue;
      const pages = expandedPages.get(comment.id) ?? 0;
      if (pages < bestPages) {
        best = comment;
        bestPages = pages;
        if (pages === 0) break;
      }
    }
    return best;
  };

  /**
   * 展开一页回复。返回 true 表示花掉了一次展开机会（值得回到 findComment 复查），
   * false 表示没有可展开的评论或预算已用尽 —— 外层循环靠预算封顶，不会无限展开。
   * 一次只翻一页：目标往往就在第一页里，没必要把整棵回复树拉完。
   */
  const expandOneRepliesPage = async (): Promise<boolean> => {
    if (!loadMoreReplies || replyExpands >= maxReplyExpands) return false;
    const comment = pickExpandCandidate();
    if (!comment) return false;
    replyExpands += 1;
    expandedPages.set(comment.id, (expandedPages.get(comment.id) ?? 0) + 1);
    let added = 0;
    try {
      added = await loadMoreReplies(comment);
    } catch {
      // 展开失败不该让整个定位流程报错；标记为到底，避免对同一条反复重试
    }
    if (!added) {
      exhaustedParents.add(comment.id);
      return true;
    }
    // 新回复 append 在已扫过的评论里，增量扫描会漏掉，这里强制下一轮全量重扫
    checkedTopLevelCount.value = 0;
    return true;
  };

  const scrollToTarget = async () => {
    if (!targetCommentId.value || !targetFound.value) return;

    // 如果调用方延迟渲染评论 DOM（如 PostOverlay 的入场动画），
    // 先等待评论可见再滚动，避免目标元素尚未挂载导致滚动失效。
    if (commentsVisible && !commentsVisible.value) {
      await new Promise<void>((resolve) => {
        let stop: ReturnType<typeof watch> | undefined;
        const timer = setTimeout(() => {
          stop?.();
          resolve();
        }, 3000);
        stop = watch(
          commentsVisible,
          (visible) => {
            if (visible) {
              clearTimeout(timer);
              stop?.();
              resolve();
            }
          },
          { immediate: false },
        );
      });
      if (!commentsVisible.value) return;
    }

    await nextTick();
    const id = targetCommentId.value;
    const el = document.querySelector(
      `[data-comment-id="${CSS.escape(id)}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const seek = async () => {
    if (!targetCommentId.value) {
      targetFound.value = false;
      checkedTopLevelCount.value = 0;
      await loadComments();
      return;
    }
    if (seeking.value) return;
    seeking.value = true;
    targetFound.value = false;
    checkedTopLevelCount.value = 0;
    replyExpands = 0;
    expandedPages.clear();
    exhaustedParents.clear();
    try {
      let prevLength = comments.value.length;
      // 顶层评论还能不能继续翻（翻不动了就只剩展开回复这条路）
      let canLoadMore = true;
      while (true) {
        if (findComment(targetCommentId.value, comments.value)) {
          targetFound.value = true;
          await scrollToTarget();
          return;
        }
        // 先把顶层评论翻完，再考虑展开回复。顺序反过来会出事：maxReplyExpands 是整次 seek 的
        // 全局预算，而第一页评论里只要有几条 repliesHasMore，展开优先就会把预算全烧在它们
        // 身上 —— 目标是靠后那页的顶层评论时，得先白等这些串行请求（还会把无关评论的楼中楼
        // 自己展开）；目标是靠后那页某条评论下未内联的回复时，预算已归零，那条回复永远展不开，
        // seek 静默失败。顶层目标只靠翻页就能命中，翻完再展开还能拿到完整列表挑候选。
        if (canLoadMore && commentsHasNext.value) {
          await loadComments();
          // loadComments 出错或返回空页时别再试，转去展开回复（目标可能是已加载评论的回复）
          if (comments.value.length === prevLength) {
            canLoadMore = false;
            continue;
          }
          prevLength = comments.value.length;
          continue;
        }
        if (await expandOneRepliesPage()) continue;
        break;
      }
    } finally {
      seeking.value = false;
    }
  };

  // 目标评论切换时清除高亮状态，避免旧 target 残留
  watch(
    targetCommentId,
    () => {
      targetFound.value = false;
      checkedTopLevelCount.value = 0;
      replyExpands = 0;
      expandedPages.clear();
      exhaustedParents.clear();
    },
    { immediate: true },
  );

  return { seek, targetFound, seeking, highlightedCommentId };
}
