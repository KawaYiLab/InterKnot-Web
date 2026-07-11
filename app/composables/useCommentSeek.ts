import { computed, nextTick, ref, watch } from "vue";
import type { Ref } from "vue";
import type { Comment } from "~/types/entities";

export interface UseCommentSeekOptions {
  targetCommentId: Ref<string | null>;
  comments: Ref<Comment[]>;
  commentsHasNext: Ref<boolean>;
  loadComments: () => Promise<void>;
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
}: UseCommentSeekOptions) {
  const targetFound = ref(false);
  const seeking = ref(false);
  // 标记已检查过的顶层评论数量，避免每次 findComment 都全量扫描
  const checkedTopLevelCount = ref(0);

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

  const scrollToTarget = async () => {
    if (!targetCommentId.value || !targetFound.value) return;
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
    try {
      let prevLength = comments.value.length;
      while (true) {
        if (findComment(targetCommentId.value, comments.value)) {
          targetFound.value = true;
          await scrollToTarget();
          return;
        }
        if (!commentsHasNext.value) break;
        await loadComments();
        // 防止 loadComments 出错或返回空页导致死循环
        if (comments.value.length === prevLength) break;
        prevLength = comments.value.length;
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
    },
    { immediate: true },
  );

  return { seek, targetFound, seeking, highlightedCommentId };
}
