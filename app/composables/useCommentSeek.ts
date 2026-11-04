import { computed, getCurrentScope, nextTick, onScopeDispose, ref, watch } from "vue";
import type { Ref } from "vue";
import type { Comment } from "~/types/entities";

type LoadGuard = () => boolean;

export interface UseCommentSeekOptions {
  targetCommentId: Ref<string | null>;
  comments: Ref<Comment[]>;
  /** 时间线开头的采纳 / 置顶：它们不在 comments 里，定位到它们时滚到顶部那一条。 */
  featured?: Ref<Comment[]>;
  commentsHasNext: Ref<boolean>;
  /** 异步加载提交结果前也检查 guard，避免旧定位替换新目标的时间线。 */
  loadComments: (isCurrent?: LoadGuard) => Promise<void>;
  loadAround: (commentId: string, isCurrent?: LoadGuard) => Promise<void>;
  commentsVisible?: Ref<boolean>;
  /** 浮层只查询自己的评论，不能命中背景独立页里的同一条评论。 */
  root?: Ref<HTMLElement | null>;
}

export interface SeekOptions {
  highlight?: boolean;
  behavior?: ScrollBehavior;
}

interface SeekIntent {
  targetId?: string;
  options?: SeekOptions;
}

/** 最新定位意图优先；切帖、关闭和卸载均可取消待完成的加载与 DOM 等待。 */
export function useCommentSeek({
  targetCommentId,
  comments,
  featured,
  commentsHasNext,
  loadComments,
  loadAround,
  commentsVisible,
  root,
}: UseCommentSeekOptions) {
  const targetFound = ref(false);
  const seeking = ref(false);
  const currentTargetId = ref<string | null>(null);
  const shouldHighlight = ref(true);
  let generation = 0;
  let cancelVisibilityWait: (() => void) | null = null;
  let activeIntent: SeekIntent | null = null;
  let pausedIntent: SeekIntent | null = null;

  const isLoaded = (id: string) =>
    comments.value.some((c) => c.id === id) || !!featured?.value.some((c) => c.id === id);
  const highlightedCommentId = computed(() =>
    targetFound.value && shouldHighlight.value ? currentTargetId.value : null,
  );

  const cancel = () => {
    generation++;
    cancelVisibilityWait?.();
    seeking.value = false;
    targetFound.value = false;
    currentTargetId.value = null;
    activeIntent = null;
    pausedIntent = null;
  };

  // 缓存帖子暂时离开时只保存未完成的定位，已完成的定位不能覆盖后续手动滚动。
  const pause = () => {
    const pending = seeking.value ? activeIntent : pausedIntent;
    cancel();
    pausedIntent = pending;
  };

  const scrollToTarget = async (targetId: string, behavior: ScrollBehavior, isCurrent: LoadGuard) => {
    if (commentsVisible && !commentsVisible.value) {
      await new Promise<void>((resolve) => {
        let stop: ReturnType<typeof watch> | undefined;
        const finish = () => {
          clearTimeout(timer);
          stop?.();
          if (cancelVisibilityWait === finish) cancelVisibilityWait = null;
          resolve();
        };
        const timer = setTimeout(finish, 3000);
        cancelVisibilityWait = finish;
        stop = watch(commentsVisible, (visible) => { if (visible) finish(); }, { flush: "sync" });
      });
    }
    if (!isCurrent() || (commentsVisible && !commentsVisible.value)) return;
    await nextTick();
    if (!isCurrent()) return;
    const safeId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(targetId)
      : targetId.replace(/["\\]/g, "\\$&");
    const container = root ? root.value : document;
    const el = container?.querySelector<HTMLElement>(`[data-comment-id="${safeId}"]`);
    el?.scrollIntoView?.({ behavior, block: "start" });
  };

  const seek = async (overrideTargetId?: string, options?: SeekOptions) => {
    cancel();
    const request = generation;
    const isCurrent = () => request === generation;
    const effectiveTargetId = overrideTargetId ?? targetCommentId.value;
    activeIntent = { targetId: effectiveTargetId ?? undefined, options };
    currentTargetId.value = effectiveTargetId;
    shouldHighlight.value = options?.highlight ?? true;
    seeking.value = true;
    try {
      if (!effectiveTargetId) {
        await loadComments(isCurrent);
        return false;
      }
      if (!comments.value.length && commentsHasNext.value) await loadComments(isCurrent);
      if (!isCurrent()) return false;
      if (!isLoaded(effectiveTargetId)) await loadAround(effectiveTargetId, isCurrent);
      if (!isCurrent() || !isLoaded(effectiveTargetId)) return false;
      targetFound.value = true;
      await scrollToTarget(effectiveTargetId, options?.behavior ?? "smooth", isCurrent);
      return isCurrent();
    } catch (error) {
      if (!isCurrent()) return false;
      throw error;
    } finally {
      if (isCurrent()) {
        seeking.value = false;
        activeIntent = null;
      }
    }
  };

  const resume = () => {
    const pending = pausedIntent;
    pausedIntent = null;
    return pending ? seek(pending.targetId, pending.options) : null;
  };

  watch(targetCommentId, cancel, { flush: "sync" });
  if (getCurrentScope()) onScopeDispose(cancel);

  return { seek, cancel, pause, resume, targetFound, seeking, highlightedCommentId };
}
