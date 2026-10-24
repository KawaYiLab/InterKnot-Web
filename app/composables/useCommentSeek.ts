import { computed, nextTick, ref, watch } from "vue";
import type { Ref } from "vue";
import type { Comment } from "~/types/entities";

export interface UseCommentSeekOptions {
  targetCommentId: Ref<string | null>;
  comments: Ref<Comment[]>;
  commentsHasNext: Ref<boolean>;
  loadComments: () => Promise<void>;
  /**
   * 从某条评论所在的楼层重新加载时间线（GET comments?anchor=）。目标不在已加载的楼层里时
   * 直接跳过去，不用一页页往后翻。
   */
  loadAround: (commentId: string) => Promise<void>;
  /** 评论 DOM 是否已渲染（如 PostOverlay 的 commentsVisible），未渲染则先等待 */
  commentsVisible?: Ref<boolean>;
}

export interface SeekOptions {
  /** 是否对目标评论添加高亮特效，默认 true */
  highlight?: boolean;
  /** 滚动行为：'smooth' | 'auto'，默认 'smooth' */
  behavior?: ScrollBehavior;
}

/**
 * 评论区目标定位 composable：目标已加载就直接滚过去，否则从目标所在楼层重新加载，找到后滚动并高亮。
 * 用于 PostOverlay 与 post/[id].vue 共享同一套「定位目标评论」逻辑。
 */
export function useCommentSeek({
  targetCommentId,
  comments,
  commentsHasNext,
  loadComments,
  loadAround,
  commentsVisible,
}: UseCommentSeekOptions) {
  const targetFound = ref(false);
  const seeking = ref(false);
  const currentTargetId = ref<string | null>(null);
  const shouldHighlight = ref(true);

  const isLoaded = (id: string) => comments.value.some((c) => c.id === id);

  const highlightedCommentId = computed(() =>
    targetFound.value && shouldHighlight.value ? (currentTargetId.value ?? targetCommentId.value) : null,
  );

  const scrollToTarget = async (targetId: string, behavior: ScrollBehavior = "smooth") => {
    if (!targetId || !targetFound.value) return;

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
    const safeId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(targetId)
      : targetId.replace(/["\\]/g, "\\$&");
    const el = document.querySelector(
      `[data-comment-id="${safeId}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView?.({ behavior, block: "start" });
  };

  const seek = async (overrideTargetId?: string, options?: SeekOptions) => {
    const effectiveTargetId = overrideTargetId ?? targetCommentId.value;
    currentTargetId.value = effectiveTargetId;
    shouldHighlight.value = options?.highlight ?? true;
    const scrollBehavior = options?.behavior ?? "smooth";
    if (!effectiveTargetId) {
      targetFound.value = false;
      await loadComments();
      return false;
    }
    if (seeking.value) return false;
    seeking.value = true;
    targetFound.value = false;
    try {
      // 首屏还没拉时先拉第一页：目标多半就在里面，省一次跳转。
      if (!comments.value.length && commentsHasNext.value) await loadComments();
      if (!isLoaded(effectiveTargetId)) await loadAround(effectiveTargetId);
      if (!isLoaded(effectiveTargetId)) return false;
      targetFound.value = true;
      await scrollToTarget(effectiveTargetId, scrollBehavior);
      return true;
    } finally {
      seeking.value = false;
    }
  };

  // 目标评论切换时清除高亮状态，避免旧 target 残留
  watch(
    targetCommentId,
    (newVal) => {
      currentTargetId.value = newVal;
      shouldHighlight.value = true;
      targetFound.value = false;
    },
    { immediate: true },
  );

  return { seek, targetFound, seeking, highlightedCommentId };
}
