const loginDialogVisible = ref(false);

export function useLoginDialog() {
  const open = () => {
    loginDialogVisible.value = true;
  };

  const close = () => {
    loginDialogVisible.value = false;
  };

  return {
    visible: loginDialogVisible,
    open,
    close,
  };
}
