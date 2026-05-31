/**
 * usePostModal – 路由级弹窗 composable
 *
 * 从首页点击帖子时，通过 history.pushState 改变 URL（不走 Vue Router），
 * 帖子内容以全屏弹窗渲染，首页保持 mounted。
 * 直接访问 /post/:id 时走正常的页面路由（post/[id].vue）。
 */
import type { Author } from "~/types/entities";

// 模块级单例，确保所有 usePostModal() 实例共享同一份标记
let _historyPushed = false;
let _savedTitle = "";

const DEFAULT_TITLE = "绳网";
/** 唯一 token：所有 usePostModal 实例共享，确保 open/close 配对 */
const SCROLL_LOCK_TOKEN = Symbol("post-modal");

export interface PostPreview {
  title?: string;
  author?: Author;
  createdAt?: string;
}

export function usePostModal() {
  const api = useApi();
  const isOpen = useState("pm:open", () => false);
  const postId = useState<string | null>("pm:id", () => null);
  const coverHint = useState<number | null>("pm:coverHint", () => null);
  const preview = useState<PostPreview | null>("pm:preview", () => null);
  const { acquire, release } = useBodyScrollLock();

  function open(
    id: string,
    opts?: {
      coverAspectRatio?: number;
      preview?: PostPreview;
    },
  ) {
    if (!import.meta.client) return;

    postId.value = id;
    coverHint.value = opts?.coverAspectRatio ?? null;
    preview.value = opts?.preview ?? null;
    isOpen.value = true;
    _historyPushed = true;

    _savedTitle = document.title;
    acquire(SCROLL_LOCK_TOKEN);
    window.history.pushState(
      { __postModal: true, postId: id },
      "",
      `/post/${id}`,
    );

    // 预热帖子详情与首屏评论，减少 PostOverlay 挂载后的等待与布局抖动
    void api.getPost(id);
    void api.getComments(id, "");
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
    // postId 保留到离场动画结束后再清理
    if (import.meta.client) {
      // 只 release 自己的锁；如果还有别的 overlay（如 KnockKnockModal）持有，
      // body.overflow 保持 hidden，避免下方页面意外可滚。
      release(SCROLL_LOCK_TOKEN);
      document.title = _savedTitle || DEFAULT_TITLE;
    }
  }

  /**
   * 离场动画结束后清理 postId（由 Transition @after-leave 调用）
   */
  function clearAfterLeave() {
    postId.value = null;
    preview.value = null;
  }

  /**
   * popstate 事件处理器 —— 在 app.vue 中注册
   */
  function handlePopState() {
    if (isOpen.value) {
      // 如果是回退到自身的 history 条目（如从敲敲弹窗返回帖子弹窗），不关闭
      if (window.history.state?.__postModal) return;
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
    postId: readonly(postId),
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
