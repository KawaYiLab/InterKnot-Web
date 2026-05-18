/**
 * useKnockKnockModal —— "敲敲" 消息通知弹窗（私聊 / 群聊入口）
 *
 * 模式：仿 useLoginDialog 的轻量单例（全局共享 visible），
 * 外壳动画复用项目帖子弹窗的 .ik-overlay / .ik-dialog 样式。
 */
const knockKnockVisible = ref(false);
/** 唯一 token：所有 useKnockKnockModal 实例共享，确保 open/close 配对 */
const SCROLL_LOCK_TOKEN = Symbol("knock-knock-modal");

export function useKnockKnockModal() {
  const { acquire, release } = useBodyScrollLock();

  const open = () => {
    knockKnockVisible.value = true;
    acquire(SCROLL_LOCK_TOKEN);
  };

  const close = () => {
    knockKnockVisible.value = false;
    release(SCROLL_LOCK_TOKEN);
  };

  return {
    visible: knockKnockVisible,
    open,
    close,
  };
}
