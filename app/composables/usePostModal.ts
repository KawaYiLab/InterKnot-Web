/**
 * 帖子浮层使用 RouterHistory 更新地址，但不替换当前 NuxtPage。
 * 只有本次页面会话创建的历史项可以恢复浮层；直接访问 /post/:id 仍是独立页。
 */
import type { Author } from "~/types/entities";
import type { HistoryState } from "vue-router";
import { overlayHistoryState } from "~/utils/overlay-history";

let _historyPushed = false;
let _closing = false;
let _queuedOpen: (() => void) | null = null;
let _savedTitle = "";
let _activeKey: string | null = null;
let _restoreFocus: ModalBackground | null = null;

// 不写入 history.state：DOM 引用不能序列化，也不能在刷新后恢复成浮层。
interface ModalBackground {
  key: string;
  url: string;
  route: string;
  position: unknown;
  title: string;
  focus: HTMLElement | null;
  options?: OpenOptions;
}
const backgrounds = new Map<string, ModalBackground>();

let _entered = true;
let _enteredWaiters: Array<() => void> = [];
const ENTER_FALLBACK_MS = 400;
const DEFAULT_TITLE = "绳网";
const SCROLL_LOCK_TOKEN = Symbol("post-modal");
const ROUTER_STATE_KEYS = ["back", "current", "forward", "position", "replaced", "scroll"];

function flushEnteredWaiters() {
  _entered = true;
  const waiters = _enteredWaiters;
  _enteredWaiters = [];
  for (const resolve of waiters) resolve();
}

export interface PostPreview {
  title?: string;
  author?: Author;
  createdAt?: string;
  publishedAt?: string;
  firstPublishedAt?: string | null;
  category?: { name: string; slug: string } | null;
  cover?: string;
}

interface OpenOptions {
  coverAspectRatio?: number;
  preview?: PostPreview;
  commentId?: string;
}

export function usePostModal() {
  const api = useApi();
  const router = useRouter();
  const isOpen = useState("pm:open", () => false);
  const postId = useState<string | null>("pm:id", () => null);
  const coverHint = useState<number | null>("pm:coverHint", () => null);
  const preview = useState<PostPreview | null>("pm:preview", () => null);
  const targetCommentId = useState<string | null>("pm:targetCommentId", () => null);
  const { acquire, release } = useBodyScrollLock();
  let resumeRouter: (() => void) | null = null;

  const locationUrl = () => window.location.pathname + window.location.search + window.location.hash;

  function show(id: string, background: ModalBackground, opts?: OpenOptions) {
    if (!isOpen.value) {
      _savedTitle = background.title;
      acquire(SCROLL_LOCK_TOKEN);
      _entered = false;
    }
    _activeKey = background.key;
    _restoreFocus = null;
    _historyPushed = true;
    postId.value = id;
    coverHint.value = opts?.coverAspectRatio ?? null;
    preview.value = opts?.preview ?? null;
    targetCommentId.value = opts?.commentId ?? null;
    isOpen.value = true;
    void api.getPost(id).catch(() => {});
  }

  function open(id: string, opts?: OpenOptions) {
    if (!import.meta.client || !id) return;
    // back 是异步的。先等它落到背景项，再处理最新的打开意图，不能替换正在退出的项。
    if (_closing) {
      _queuedOpen = () => open(id, opts);
      return;
    }
    const history = router.options.history;
    let background = _activeKey ? backgrounds.get(_activeKey) : undefined;
    const replacing = isOpen.value && !!background;
    if (!replacing) {
      const url = locationUrl();
      // 敲敲等旧入口仍可能直接 pushState；先同步 RouterHistory 的当前位置。
      if (history.location !== url) {
        history.replace(url, { ...window.history.state, current: url });
      }
      const activeElement = document.activeElement;
      background = {
        key: crypto.randomUUID(),
        url,
        route: router.currentRoute.value.fullPath,
        position: window.history.state?.position,
        title: document.title,
        focus: _restoreFocus?.route === router.currentRoute.value.fullPath
          ? _restoreFocus.focus
          : activeElement instanceof HTMLElement ? activeElement : null,
      };
      backgrounds.set(background.key, background);
    }
    background!.options = opts;
    const url = `/post/${encodeURIComponent(id)}` + (opts?.commentId ? `?comment=${encodeURIComponent(opts.commentId)}` : "");
    const state = overlayHistoryState({
      __postModal: true,
      postModalKey: background!.key,
      postId: id,
      commentId: opts?.commentId ?? null,
    });
    // RouterHistory 自己维护 current / position / scroll，不能复制背景项的这些值。
    for (const key of ROUTER_STATE_KEYS) delete state[key];
    if (replacing) history.replace(url, state as HistoryState);
    else history.push(url, state as HistoryState);
    show(id, background!, opts);
  }

  function close() {
    if (!isOpen.value || _closing) return;
    _closing = true;
    if (_historyPushed && window.history.state?.postModalKey === _activeKey) {
      window.history.back();
    } else {
      teardown(true);
    }
  }

  /** 路由导航只清理浮层；返回背景时才恢复触发点焦点。 */
  function teardown(restoreFocus = false) {
    _closing = false;
    if (!isOpen.value) return;
    _restoreFocus = restoreFocus && _activeKey ? backgrounds.get(_activeKey) ?? null : null;
    _activeKey = null;
    isOpen.value = false;
    _historyPushed = false;
    flushEnteredWaiters();
    if (import.meta.client) {
      release(SCROLL_LOCK_TOKEN);
      document.title = _savedTitle || DEFAULT_TITLE;
    }
  }

  function markEntered() {
    flushEnteredWaiters();
  }

  function whenEntered(): Promise<void> {
    if (_entered || !import.meta.client) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(flushEnteredWaiters, ENTER_FALLBACK_MS);
      _enteredWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  function clearAfterLeave() {
    // Vue 会在新节点入场时结算旧 leave，旧回调不能清掉刚打开的帖子。
    if (isOpen.value) return;
    postId.value = null;
    coverHint.value = null;
    preview.value = null;
    targetCommentId.value = null;
    const background = _restoreFocus;
    _restoreFocus = null;
    if (background && router.currentRoute.value.fullPath === background.route) {
      const target = background.focus?.isConnected ? background.focus : document.querySelector<HTMLElement>("main");
      target?.focus({ preventScroll: true });
    }
  }

  function keepBackgroundRoute() {
    // 前置 listener 暂停路由导航一轮，但让 RouterHistory 的 popstate listener 照常
    // 同步 location / position。stopImmediatePropagation 会把这两份状态再次拆散。
    if (resumeRouter) return;
    const listening = router.listening;
    router.listening = false;
    const resume = () => {
      if (resumeRouter !== resume) return;
      router.listening = listening;
      resumeRouter = null;
    };
    resumeRouter = resume;
    // 原生事件的 listener 之间也可能清空微任务，必须等整个 popstate 派发完。
    setTimeout(resume, 0);
  }

  /** 由前置插件先于 RouterHistory 派发。 */
  function handlePopState() {
    resumeRouter?.();
    const state = window.history.state;
    const active = _activeKey ? backgrounds.get(_activeKey) : undefined;
    // 先认当前浮层的背景项：它本身也可能是以前访问过的独立帖子历史项。
    if (active && locationUrl() === active.url && state?.position === active.position &&
        router.currentRoute.value.fullPath === active.route) {
      keepBackgroundRoute();
      const reopen = _queuedOpen;
      _queuedOpen = null;
      teardown(true);
      if (reopen) setTimeout(reopen, 0);
      return;
    }
    const background = state?.__postModal && typeof state.postModalKey === "string"
      ? backgrounds.get(state.postModalKey)
      : undefined;
    if (background && typeof state.postId === "string" &&
        router.currentRoute.value.fullPath === background.route) {
      keepBackgroundRoute();
      _closing = false;
      show(state.postId, background, { ...background.options, commentId: state.commentId ?? undefined });
      return;
    }
    _queuedOpen = null;
    teardown();
  }

  function setTitle(title: string) {
    if (import.meta.client && isOpen.value && title) document.title = `${title} - ${DEFAULT_TITLE}`;
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
    whenEntered,
    markEntered,
    handlePopState,
    teardown,
    clearAfterLeave,
  };
}
