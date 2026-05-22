/**
 * useKnockKnockModal —— "敲敲" 消息通知弹窗（私聊 / 群聊入口）
 *
 * 模式：仿 useLoginDialog 的轻量单例（全局共享 visible），
 * 外壳动画复用项目帖子弹窗的 .ik-overlay / .ik-dialog 样式。
 *
 * open() 支持选参 { dmConversationId? }：当传入时弹窗会自动定位到该
 * DM 私聊会话（用于 UserHoverCard 的「私信」按钮跳转场景）。
 */
const knockKnockVisible = ref(false);
/** 弹窗一开就要定位到的目标 DM 会话；contacts tab 监听这个值后清空 */
const pendingDmConversationId = ref<string | null>(null);
/** 唯一 token：所有 useKnockKnockModal 实例共享，确保 open/close 配对 */
const SCROLL_LOCK_TOKEN = Symbol("knock-knock-modal");

interface OpenOptions {
  /** 打开后切到「私聊」tab 并定位到该会话 documentId */
  dmConversationId?: string;
}

export function useKnockKnockModal() {
  const { acquire, release } = useBodyScrollLock();

  const open = (options?: OpenOptions) => {
    if (options?.dmConversationId) {
      pendingDmConversationId.value = options.dmConversationId;
    }
    knockKnockVisible.value = true;
    acquire(SCROLL_LOCK_TOKEN);
  };

  const close = () => {
    knockKnockVisible.value = false;
    release(SCROLL_LOCK_TOKEN);
    // 关闭时把待跳转目标清掉，避免下次 open() 时残留
    pendingDmConversationId.value = null;
  };

  /** contacts tab 消费 pending 目标后调用一次清空，避免再次定位同一会话 */
  const consumePendingDmConversationId = (): string | null => {
    const next = pendingDmConversationId.value;
    pendingDmConversationId.value = null;
    return next;
  };

  return {
    visible: knockKnockVisible,
    pendingDmConversationId,
    open,
    close,
    consumePendingDmConversationId,
  };
}
