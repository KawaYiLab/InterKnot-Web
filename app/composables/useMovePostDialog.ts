import type { Category } from "~/types/entities";

interface MovePostDialogState {
  visible: boolean;
  postId: string;
  /** 委托当前所在分区的 slug。 */
  currentSlug: string;
  resolve: ((moved: Category | null) => void) | null;
}

const state = reactive<MovePostDialogState>({
  visible: false,
  postId: "",
  currentSlug: "",
  resolve: null,
});

/** 管理员、版主移动委托分区（如移进里区）的弹窗。移动成功时返回新分区，取消时为 null。 */
export function useMovePostDialog() {
  const open = (options: { postId: string; currentSlug?: string }): Promise<Category | null> => {
    state.resolve?.(null);
    return new Promise((resolve) => {
      state.postId = options.postId;
      state.currentSlug = options.currentSlug ?? "";
      state.resolve = resolve;
      state.visible = true;
    });
  };

  const close = (moved: Category | null) => {
    state.visible = false;
    state.resolve?.(moved);
    state.resolve = null;
  };

  return {
    state: readonly(state),
    open,
    close,
  };
}
