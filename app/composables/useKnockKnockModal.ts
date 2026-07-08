/**
 * useKnockKnockModal —— "敲敲" 消息通知弹窗（私聊 / 群聊入口）
 *
 * 模式：仿 usePostModal 的路由级弹窗单例，
 * 外壳动画复用帖子弹窗的 .ik-overlay / .ik-dialog 样式。
 *
 * open() 通过 history.pushState 在当前页 path 上追加 ik_knock query（不走 Vue Router），
 * tab 切换 / 选中会话时通过 history.replaceState 更新 URL，
 * close() 通过 history.back() 回退。
 *
 * open() 支持选参 { dmConversationId? }：当传入时弹窗会自动定位到该
 * DM 私聊会话（用于 UserHoverCard 的「私信」按钮跳转场景）。
 */
import { knockHistoryUrl, overlayHistoryState } from "~/utils/overlay-history";
const knockKnockVisible = ref(false);
/** 弹窗一开就要定位到的目标 DM 会话；contacts tab 监听这个值后清空 */
const pendingDmConversationId = ref<string | null>(null);
const pendingKnockTab = ref<string | null>(null);
/** 唯一 token：所有 useKnockKnockModal 实例共享，确保 open/close 配对 */
const SCROLL_LOCK_TOKEN = Symbol("knock-knock-modal");

// 模块级单例，确保所有 useKnockKnockModal() 实例共享同一份标记
let _historyPushed = false;
let _savedTitle = "";
const DEFAULT_TITLE = "绳网";

interface OpenOptions {
  /** 打开后切到「私聊」tab 并定位到该会话 documentId */
  dmConversationId?: string;
  /** 打开后切到「通话」Tab（AI 角色） */
  tab?: "calls" | "contacts" | "groups";
}

export function useKnockKnockModal() {
  const { acquire, release } = useBodyScrollLock();

  const open = (options?: OpenOptions) => {
    if (!import.meta.client) return;
    if (options?.dmConversationId) {
      pendingDmConversationId.value = options.dmConversationId;
    }
    if (options?.tab) {
      pendingKnockTab.value = options.tab;
    }
    knockKnockVisible.value = true;
    _historyPushed = true;
    _savedTitle = document.title;
    acquire(SCROLL_LOCK_TOKEN);
    window.history.pushState(
      overlayHistoryState({ __knockKnockModal: true }),
      "",
      knockHistoryUrl("contacts"),
    );
    document.title = `敲敲 - ${DEFAULT_TITLE}`;
  };

  /**
   * 关闭弹窗并回退浏览器历史（用户点击关闭按钮 / ESC）
   */
  const close = () => {
    if (!knockKnockVisible.value) return;
    const shouldBack = _historyPushed;
    teardown();
    if (shouldBack) {
      _historyPushed = false;
      window.history.back();
    }
  };

  /**
   * 仅清理状态，不操作 history（由 popstate / 路由守卫调用）
   */
  function teardown() {
    knockKnockVisible.value = false;
    release(SCROLL_LOCK_TOKEN);
    pendingDmConversationId.value = null;
    pendingKnockTab.value = null;
    if (import.meta.client) {
      document.title = _savedTitle || DEFAULT_TITLE;
    }
  }

  /**
   * popstate 事件处理器 —— 在 app.vue 中注册
   */
  function handlePopState() {
    if (knockKnockVisible.value) {
      // 如果是回退到自身的 history 条目（如从帖子弹窗返回敲敲），不关闭
      if (window.history.state?.__knockKnockModal) return;
      _historyPushed = false;
      teardown();
    }
  }

  /**
   * 更新 URL（replaceState），反映当前 tab / 会话状态。
   * 不新增 history 条目，仅替换当前条目的 URL。
   */
  function updateUrl(tab: string, conversationId?: string | null) {
    if (!import.meta.client || !knockKnockVisible.value) return;
    window.history.replaceState(
      overlayHistoryState({ __knockKnockModal: true }),
      "",
      knockHistoryUrl(tab, conversationId),
    );
  }

  /** contacts tab 消费 pending 目标后调用一次清空，避免再次定位同一会话 */
  const consumePendingDmConversationId = (): string | null => {
    const next = pendingDmConversationId.value;
    pendingDmConversationId.value = null;
    return next;
  };

  const consumePendingKnockTab = (): string | null => {
    const next = pendingKnockTab.value;
    pendingKnockTab.value = null;
    return next;
  };

  /** 路由跳转离开敲敲时调用，避免 close() 误触发 history.back() */
  function clearHistoryPushed() {
    _historyPushed = false;
  }

  return {
    visible: knockKnockVisible,
    pendingDmConversationId,
    open,
    close,
    /** @internal 供 app 级别 popstate listener 使用 */
    handlePopState,
    /** @internal 供路由守卫关闭弹窗（不回退 history） */
    teardown,
    /** 更新 URL 以反映当前 tab / 会话状态 */
    updateUrl,
    consumePendingDmConversationId,
    consumePendingKnockTab,
    clearHistoryPushed,
  };
}
