/**
 * 帖子浮层使用 RouterHistory 更新地址，但不替换当前 NuxtPage。
 * 只有本次页面会话创建的历史项可以恢复浮层；直接访问 /post/:id 仍是独立页。
 */
import type { Author } from "~/types/entities";
import type { HistoryState } from "vue-router";
import { overlayHistoryState } from "~/utils/overlay-history";
import { isPostSnowflake, knownPostId, postPath } from "~/utils/post-path";
import { cancelPendingModalNavigation, restoreModalBackground } from "~/utils/post-modal-history";

let _historyPushed = false;
let _closing = false;
let _queuedOpen: (() => void) | null = null;
let _savedTitle = "";
let _openRequest = 0;
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
}
interface PostEntry {
  key: string;
  position: number;
  background: ModalBackground;
  id: string;
  options?: OpenOptions;
  title?: string;
}
const entries = new Map<string, PostEntry>();

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
  const entryKey = useState<string | null>("pm:entry", () => null);
  const cachedEntryKeys = useState<string[]>("pm:cachedEntries", () => []);
  const sessionKey = useState<string | null>("pm:session", () => null);
  const switching = useState("pm:switching", () => false);
  const postId = useState<string | null>("pm:id", () => null);
  const coverHint = useState<number | null>("pm:coverHint", () => null);
  const preview = useState<PostPreview | null>("pm:preview", () => null);
  const targetCommentId = useState<string | null>("pm:targetCommentId", () => null);
  const { acquire, release } = useBodyScrollLock();
  let resumeRouter: (() => void) | null = null;

  const locationUrl = () => window.location.pathname + window.location.search + window.location.hash;

  function show(entry: PostEntry) {
    const { id, background, options: opts } = entry;
    switching.value = isOpen.value;
    if (!isOpen.value) {
      _savedTitle = background.title;
      acquire(SCROLL_LOCK_TOKEN);
      _entered = false;
    }
    _activeKey = entry.key;
    entryKey.value = entry.key;
    sessionKey.value = background.key;
    _restoreFocus = null;
    _historyPushed = true;
    postId.value = id;
    coverHint.value = opts?.coverAspectRatio ?? null;
    preview.value = opts?.preview ?? null;
    targetCommentId.value = opts?.commentId ?? null;
    isOpen.value = true;
    document.title = entry.title || (opts?.preview?.title ? `${opts.preview.title} - ${DEFAULT_TITLE}` : `委托 - ${DEFAULT_TITLE}`);
    void api.getPost(id).then((post) => shortenUrl(post.id, post.postNo, entry.key)).catch(() => {});
  }

  /** 用帖子 id 打开的浮层，查到编号后把地址换成短的（不新增历史项）。 */
  function shortenUrl(id: string, postNo: number | undefined, key: string) {
    const state = window.history.state;
    if (postNo == null || _activeKey !== key || state?.postModalKey !== key || state.postId !== id) return;
    const url = postPath(id, postNo) + window.location.search + window.location.hash;
    if (url === locationUrl()) return;
    const next = { ...state };
    for (const k of ROUTER_STATE_KEYS) delete next[k];
    router.options.history.replace(url, next as HistoryState);
  }

  function open(ref: string, opts?: OpenOptions) {
    if (!import.meta.client || !ref) return;
    const request = ++_openRequest;
    const position = window.history.state?.position;
    const originEntry = window.history.state?.postModalKey;
    const route = router.currentRoute.value.fullPath;
    const id = knownPostId(ref);
    const stillWanted = () => request === _openRequest && window.history.state?.position === position &&
      window.history.state?.postModalKey === originEntry &&
      router.currentRoute.value.fullPath === route;
    // 短编号先解析成 id；较晚返回的请求不能覆盖新的点击或重新打开已关闭的弹窗。
    if (!isPostSnowflake(id)) {
      void api.getPost(id)
        .then((post) => { if (stillWanted()) openById(post.id || id, opts); })
        .catch(() => { if (stillWanted()) openById(id, opts); });
      return;
    }
    openById(id, opts);
  }

  function openById(id: string, opts?: OpenOptions) {
    if (_closing) {
      _queuedOpen = () => openById(id, opts);
      return;
    }
    const history = router.options.history;
    const active = _activeKey ? entries.get(_activeKey) : undefined;
    // 连点当前内容不会制造空的返回步骤；同帖的不同评论仍有各自的历史和阅读位置。
    if (isOpen.value && active?.id === id && active.options?.commentId === opts?.commentId) return;
    let background = isOpen.value ? active?.background : undefined;
    if (!background) {
      const activeElement = document.activeElement;
      background = {
        key: crypto.randomUUID(),
        url: locationUrl(),
        route: router.currentRoute.value.fullPath,
        position: window.history.state?.position,
        title: document.title,
        focus: _restoreFocus?.route === router.currentRoute.value.fullPath
          ? _restoreFocus.focus
          : activeElement instanceof HTMLElement ? activeElement : null,
      };
    }
    const key = crypto.randomUUID();
    const url = postPath(id) + (opts?.commentId ? `?comment=${encodeURIComponent(opts.commentId)}` : "");
    const state = overlayHistoryState({
      __postModal: true,
      postModalKey: key,
      postId: id,
      commentId: opts?.commentId ?? null,
    });
    for (const key of ROUTER_STATE_KEYS) delete state[key];
    history.push(url, state as HistoryState);
    const entry: PostEntry = { key, position: Number(history.state.position), background, id, options: opts };
    entries.set(key, entry);
    cachedEntryKeys.value = [...entries.keys()];
    show(entry);
  }

  function discardForwardEntries(firstDiscardedPosition: number) {
    for (const [key, entry] of entries) {
      if (entry.position >= firstDiscardedPosition) entries.delete(key);
    }
    cachedEntryKeys.value = [...entries.keys()];
  }

  function close() {
    ++_openRequest;
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
    ++_openRequest;
    _closing = false;
    if (!isOpen.value) return;
    _restoreFocus = restoreFocus && _activeKey ? entries.get(_activeKey)?.background ?? null : null;
    _activeKey = null;
    isOpen.value = false;
    switching.value = false;
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
    entryKey.value = null;
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
    cancelPendingModalNavigation(router);
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
    ++_openRequest;
    resumeRouter?.();
    const state = window.history.state;
    const active = _activeKey ? entries.get(_activeKey)?.background : undefined;
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
    const entry = state?.__postModal && typeof state.postModalKey === "string"
      ? entries.get(state.postModalKey)
      : undefined;
    if (entry && typeof state.postId === "string" &&
        router.currentRoute.value.fullPath === entry.background.route) {
      keepBackgroundRoute();
      _closing = false;
      show(entry);
      const reopen = _queuedOpen;
      _queuedOpen = null;
      if (reopen) setTimeout(reopen, 0);
      return;
    }
    _queuedOpen = null;
    teardown();
    if (entry) restoreModalBackground(router, entry.background.route, entry.background.position);
  }

  function setTitle(title: string) {
    if (!import.meta.client || !isOpen.value || !title) return;
    document.title = `${title} - ${DEFAULT_TITLE}`;
    const entry = _activeKey ? entries.get(_activeKey) : undefined;
    if (entry) entry.title = document.title;
  }

  return {
    isOpen: readonly(isOpen),
    entryKey: readonly(entryKey),
    cachedEntryKeys: readonly(cachedEntryKeys),
    sessionKey: readonly(sessionKey),
    switching: readonly(switching),
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
    discardForwardEntries,
  };
}
