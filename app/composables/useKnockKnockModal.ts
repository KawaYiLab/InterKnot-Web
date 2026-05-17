/**
 * useKnockKnockModal —— "敲敲" 消息通知弹窗（私聊 / 群聊入口）
 *
 * 模式：仿 useLoginDialog 的轻量单例（全局共享 visible），
 * 外壳动画复用项目帖子弹窗的 .ik-overlay / .ik-dialog 样式。
 */
const knockKnockVisible = ref(false);

export function useKnockKnockModal() {
  const open = () => {
    knockKnockVisible.value = true;
    if (import.meta.client) {
      document.body.style.overflow = "hidden";
    }
  };

  const close = () => {
    knockKnockVisible.value = false;
    if (import.meta.client) {
      document.body.style.overflow = "";
    }
  };

  return {
    visible: knockKnockVisible,
    open,
    close,
  };
}
