/**
 * usePostModal – 路由级弹窗 composable
 *
 * 从首页点击委托时，通过 history.pushState 改变 URL（不走 Vue Router），
 * 委托内容以全屏弹窗渲染，首页保持 mounted。
 * URL 使用 /post/:id；直接访问 /post/:id 时走正常的页面路由（post/[id].vue）。
 *
 * 敲敲弹窗使用 query（ik_knock），与本 composable 分离。
 */
import type { Author } from "~/types/entities";
import { overlayHistoryState } from "~/utils/overlay-history";

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
  publishedAt?: string;
  firstPublishedAt?: string | null;
  category?: { name: string; slug: string } | null;
  cover?: string;
}

export function usePostModal() {
  const api = useApi();
  const isOpen = useState("pm:open", () => false);
  const postId = useState<string | null>("pm:id", () => null);
  const coverHint = useState<number | null>("pm:coverHint", () => null);
  const preview = useState<PostPreview | null>("pm:preview", () => null);
  const targetCommentId = useState<string | null>("pm:targetCommentId", () => null);
  const { acquire, release } = useBodyScrollLock();

  function open(
    id: string,
    opts?: {
      coverAspectRatio?: number;
      preview?: PostPreview;
      commentId?: string;
    },
  ) {
    if (!import.meta.client) return;
    const replacingOpenPost = isOpen.value;

    // 首次打开才保存标题、锁滚动；浮层内点相关委托是在已开的浮层里换内容，
    // 复用同一把滚动锁与原始标题。
    if (!replacingOpenPost) {
      _savedTitle = document.title;
      acquire(SCROLL_LOCK_TOKEN);
    }

    postId.value = id;
    coverHint.value = opts?.coverAspectRatio ?? null;
    preview.value = opts?.preview ?? null;
    targetCommentId.value = opts?.commentId ?? null;
    isOpen.value = true;
    _historyPushed = true;

    const url = opts?.commentId
      ? `/post/${id}?comment=${encodeURIComponent(opts.commentId)}`
      : `/post/${id}`;
    const state = overlayHistoryState({ __postModal: true, postId: id, commentId: opts?.commentId ?? null });
    // 相关委托逐条压入历史：每点一条新增一条 /post/:id 记录，
    // 这样返回键 / 关闭键可以逐条退回上一条委托，直到最初进入的页面。
    window.history.pushState(state, "", url);

    // 预热委托详情，减少 PostOverlay 挂载后的等待与布局抖动
    // 首屏评论由 PostOverlay 挂载时强制拉取最新，避免命中旧缓存
    void api.getPost(id).catch(() => {});
  }

  /**
   * 关闭弹窗并回退浏览器历史（用户点击关闭按钮 / ESC）
   */
  function close() {
    if (!isOpen.value) return;
    // 逐条返回：交给 history.back → popstate → handlePopState 决定是切到
    // 上一条委托还是彻底关闭；不在这里直接 teardown，否则会跳过中间的
    // 委托历史条目，一步退到最初进入的页面。
    if (_historyPushed) window.history.back();
    else teardown();
  }

  /**
   * 仅清理状态，不操作 history（由 popstate / 路由守卫调用）
   */
  function teardown() {
    if (!isOpen.value) return;
    isOpen.value = false;
    _historyPushed = false;
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
    targetCommentId.value = null;
  }

  /**
   * popstate 事件处理器 —— 在 app.vue 中注册
   */
  function handlePopState() {
    if (!isOpen.value) return;
    const state = window.history.state as { __postModal?: boolean; postId?: string; commentId?: string | null } | null;
    // 回退 / 前进到仍属于委托浮层的历史条目：保持浮层开启。
    // - postId 变了（相关委托逐条返回）：原地切换浮层内容；
    // - postId 没变（如从敲敲弹窗返回委托弹窗）：什么都不做。
    if (state?.__postModal) {
      if (typeof state.postId === "string" && state.postId !== postId.value) {
        postId.value = state.postId;
        coverHint.value = null;
        preview.value = null;
        targetCommentId.value = state.commentId ?? null;
        // 预热切回的委托详情，减少 PostOverlay 重载等待
        void api.getPost(state.postId).catch(() => {});
      }
      return;
    }
    // 回退到背景页（首页 / 标签页 / 独立文章页等）：彻底关闭浮层
    teardown();
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
    targetCommentId: readonly(targetCommentId),
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
