/**
 * useDiscussionModal – 路由级弹窗 composable
 *
 * 从首页点击帖子时，通过 history.pushState 改变 URL（不走 Vue Router），
 * 帖子内容以全屏弹窗渲染，首页保持 mounted。
 * 直接访问 /discussion/:id 时走正常的页面路由（discussion/[id].vue）。
 */
import type { Author } from "~/types/entities";

// 模块级单例，确保所有 useDiscussionModal() 实例共享同一份标记
let _historyPushed = false;
let _savedTitle = "";

const DEFAULT_TITLE = "绳网";

export interface DiscussionPreview {
  title?: string;
  author?: Author;
  createdAt?: string;
}

export function useDiscussionModal() {
  const isOpen = useState("dm:open", () => false);
  const discussionId = useState<string | null>("dm:id", () => null);
  const coverHint = useState<number | null>("dm:coverHint", () => null);
  const preview = useState<DiscussionPreview | null>("dm:preview", () => null);
  function open(
    id: string,
    opts?: {
      coverAspectRatio?: number;
      preview?: DiscussionPreview;
    },
  ) {
    if (!import.meta.client) return;

    discussionId.value = id;
    coverHint.value = opts?.coverAspectRatio ?? null;
    preview.value = opts?.preview ?? null;
    isOpen.value = true;
    _historyPushed = true;

    _savedTitle = document.title;
    document.body.style.overflow = "hidden";
    window.history.pushState(
      { __discussionModal: true, discussionId: id },
      "",
      `/discussion/${id}`,
    );
  }

  /**
   * 关闭弹窗并回退浏览器历史（用户点击关闭按钮 / ESC）
   */
  function close() {
    if (!isOpen.value) return;
    teardown();
    if (_historyPushed) {
      _historyPushed = false;
      window.history.back();
    }
  }

  /**
   * 仅清理状态，不操作 history（由 popstate / 路由守卫调用）
   */
  function teardown() {
    isOpen.value = false;
    // discussionId 保留到离场动画结束后再清理
    if (import.meta.client) {
      document.body.style.overflow = "";
      document.title = _savedTitle || DEFAULT_TITLE;
    }
  }

  /**
   * 离场动画结束后清理 discussionId（由 Transition @after-leave 调用）
   */
  function clearAfterLeave() {
    discussionId.value = null;
    preview.value = null;
  }

  /**
   * popstate 事件处理器 —— 在 app.vue 中注册
   */
  function handlePopState() {
    if (isOpen.value) {
      _historyPushed = false;
      teardown();
    }
  }

  function setTitle(title: string) {
    if (import.meta.client && isOpen.value && title) {
      document.title = `${title} - ${DEFAULT_TITLE}`;
    }
  }

  return {
    isOpen: readonly(isOpen),
    discussionId: readonly(discussionId),
    coverHint: readonly(coverHint),
    preview: readonly(preview),
    open,
    close,
    setTitle,
    /** @internal 供 app 级别 popstate listener 使用 */
    handlePopState,
    /** @internal 供路由守卫关闭弹窗（不回退 history） */
    teardown,
    /** @internal 离场动画结束后清理（由 Transition @after-leave 调用） */
    clearAfterLeave,
  };
}
