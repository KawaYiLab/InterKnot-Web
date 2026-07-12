/**
 * 委托预取
 *
 * - 鼠标停留一小段时间后再拉取，避免快速划过
 * - 页面滚动中 / 刚停滚的冷却期内不预取，并取消已排队的定时器
 * - 仅 (hover: hover) + fine pointer 设备启用（触屏不绑 hover）
 *
 * 请求走 TanStack Query cachedRead，与 open() 预取自动去重。
 */
const HOVER_INTENT_MS = 280;
/** 最后一次 scroll 后需静候多久，才视为「有意 hover」 */
const SCROLL_QUIET_MS = 400;

let lastScrollAt = 0;
let scrollGuardAttached = false;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

function attachScrollGuard() {
  if (!import.meta.client || scrollGuardAttached) return;
  scrollGuardAttached = true;
  window.addEventListener(
    "scroll",
    () => {
      lastScrollAt = Date.now();
      for (const timer of pendingTimers) {
        clearTimeout(timer);
      }
      pendingTimers.clear();
    },
    { passive: true, capture: true },
  );
}

function isScrollQuiet() {
  return Date.now() - lastScrollAt >= SCROLL_QUIET_MS;
}

function canHoverIntent() {
  if (!import.meta.client) return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function usePostPrefetch() {
  const api = useApi();
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  const prefetchPost = (id: string) => {
    if (!import.meta.client || !id) return;
    void api.getPost(id).catch(() => {});
    void api.getComments(id, "").catch(() => {});
  };

  const cancelPrefetch = () => {
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer);
      pendingTimers.delete(hoverTimer);
      hoverTimer = null;
    }
  };

  const schedulePrefetch = (id: string) => {
    if (!import.meta.client || !id || !canHoverIntent()) return;
    attachScrollGuard();
    if (!isScrollQuiet()) return;

    cancelPrefetch();
    hoverTimer = setTimeout(() => {
      pendingTimers.delete(hoverTimer!);
      hoverTimer = null;
      if (!isScrollQuiet()) return;
      prefetchPost(id);
    }, HOVER_INTENT_MS);
    pendingTimers.add(hoverTimer);
  };

  onBeforeUnmount(() => {
    cancelPrefetch();
  });

  return { schedulePrefetch, cancelPrefetch };
}
