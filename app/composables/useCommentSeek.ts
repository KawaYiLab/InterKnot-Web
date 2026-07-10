import { computed, nextTick, ref } from "vue";
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

  const findComment = (id: string, list: Comment[]): boolean => {
    for (const c of list) {
      if (c.id === id) return true;
      if (c.replies?.some((r) => r.id === id)) return true;
    }
    return false;
  };

  const highlightedCommentId = computed(() =>
    targetFound.value ? targetCommentId.value : null,
  );

  const scrollToTarget = async () => {
    if (!targetCommentId.value || !targetFound.value) return;
    await nextTick();
    const el = document.querySelector(
      `[data-comment-id="${targetCommentId.value}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const seek = async () => {
    if (!targetCommentId.value) {
      await loadComments();
      return;
    }
    if (seeking.value) return;
    seeking.value = true;
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

  return { seek, targetFound, seeking, highlightedCommentId };
}
