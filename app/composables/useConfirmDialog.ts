interface ConfirmDialogState {
  visible: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  resolve: ((value: boolean) => void) | null;
}

const state = reactive<ConfirmDialogState>({
  visible: false,
  title: "",
  message: "",
  confirmText: "确定",
  cancelText: "取消",
  danger: false,
  resolve: null,
});

export function useConfirmDialog() {
  const open = (options: {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }): Promise<boolean> => {
    return new Promise((resolve) => {
      state.title = options.title || "提示";
      state.message = options.message;
      state.confirmText = options.confirmText || "确定";
      state.cancelText = options.cancelText || "取消";
      state.danger = options.danger ?? false;
      state.resolve = resolve;
      state.visible = true;
    });
  };

  const confirm = () => {
    state.visible = false;
    state.resolve?.(true);
    state.resolve = null;
  };

  const cancel = () => {
    state.visible = false;
    state.resolve?.(false);
    state.resolve = null;
  };

  return {
    state: readonly(state),
    open,
    confirm,
    cancel,
  };
}
