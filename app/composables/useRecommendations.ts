import { effectScope, onScopeDispose, readonly, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import type { Post, RecommendationContext, RecommendationEvent } from "~/types/entities";

type RecommendedPost = Pick<Post, "id" | "title" | "recommendation" | "isPinned">;
type Transport = {
  sendRecommendationEvents: (events: RecommendationEvent[], signal?: AbortSignal) => Promise<void>;
  getRecommendationContext: (articleId: string, signal?: AbortSignal) => Promise<RecommendationContext | undefined>;
  setRecommendationDislike: (articleId: string, disliked: boolean, signal?: AbortSignal) => Promise<void>;
};
const CONTEXT_TTL = 15 * 60_000;
const expired = (context: RecommendationContext) => context.expiresAt !== undefined && context.expiresAt <= Date.now();

/** One browser identity owns its queue. No tokens, history, or IDs go into localStorage. */
export function createRecommendationManager(api: Transport, loggedIn: () => boolean, openLogin: () => void) {
  const revision = ref(0);
  const identityRevision = ref(0);
  const pending = ref(false);
  const dismissed = new Set<string>();
  const contexts = new Map<string, { value: RecommendationContext; at: number }>();
  const seen = new Set<string>();
  let queue: Array<{ event: RecommendationEvent; attempts: number; expiresAt?: number }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller = new AbortController();
  let sending = false;
  let disposed = false;

  const schedule = (delay = 5000) => {
    if (disposed || timer || sending || !queue.length) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
  };
  const flush = async () => {
    if (disposed || sending || !queue.length) return;
    clearTimeout(timer); timer = undefined;
    if (!loggedIn()) { queue = []; return; }
    queue = queue.filter((entry) => entry.expiresAt === undefined || entry.expiresAt > Date.now());
    if (!queue.length) return;
    const generation = identityRevision.value;
    const batch = queue.splice(0, 20);
    sending = true;
    let retryDelay = 5000;
    try {
      await api.sendRecommendationEvents(batch.map((entry) => entry.event), controller.signal);
    } catch (failure) {
      if (generation !== identityRevision.value || disposed) return;
      const status = Number((failure as { statusCode?: number; status?: number })?.statusCode
        ?? (failure as { status?: number })?.status);
      // Bad/expired receipts cannot be repaired by retrying. Network/5xx get at
      // most two retries; the server deduplicates the unchanged receipt/type.
      if (!status || status >= 500 || status === 429) {
        const retry = batch.filter((entry) => entry.attempts < 2)
          .map((entry) => ({ ...entry, attempts: entry.attempts + 1 }));
        queue = [...retry, ...queue].slice(0, 200);
        retryDelay = retry[0]?.attempts === 2 ? 10_000 : 5000;
      }
    } finally {
      if (generation === identityRevision.value && !disposed) { sending = false; schedule(retryDelay); }
    }
  };
  const record = (type: RecommendationEvent["type"], context?: RecommendationContext, durationMs?: number) => {
    if (disposed || !loggedIn() || !context?.token || expired(context)) return;
    const key = `${type}:${context.token}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 2000) seen.delete(seen.values().next().value!);
    queue.push({ event: { type, token: context.token, ...(durationMs === undefined ? {} : { durationMs }) }, attempts: 0, expiresAt: context.expiresAt });
    if (queue.length > 200) queue.shift();
    schedule();
  };
  const remember = (id: string, context: RecommendationContext) => {
    contexts.delete(id); contexts.set(id, { value: context, at: Date.now() });
    if (contexts.size > 100) contexts.delete(contexts.keys().next().value!);
  };
  const trackClick = (post: RecommendedPost) => {
    if (disposed || !loggedIn() || !post.recommendation || expired(post.recommendation)) return;
    remember(post.id, post.recommendation);
    // An intentional click proves exposure even before the one-second threshold.
    record("impression", post.recommendation);
  };
  const getContext = async (id: string) => {
    if (disposed || !loggedIn()) return undefined;
    const cached = contexts.get(id);
    if (cached && Date.now() - cached.at < CONTEXT_TTL && !expired(cached.value)) return cached.value;
    const generation = identityRevision.value;
    try {
      const context = await api.getRecommendationContext(id, controller.signal);
      if (disposed || generation !== identityRevision.value) return;
      if (context && !expired(context)) { remember(id, context); return context; }
      return undefined;
    } catch { return undefined; }
  };
  const isDismissed = (id: string) => { void revision.value; return dismissed.has(id); };
  const dismiss = async (post: RecommendedPost) => {
    // 不再要求推荐流的临时 token：详情浮层加载的委托没有 recommendation，
    // 但 setRecommendationDislike 只按委托 id 生效，因此按 id 也能拉黑。
    if (pending.value || post.isPinned || isDismissed(post.id)) return;
    if (!loggedIn()) { openLogin(); return; }
    const generation = identityRevision.value;
    pending.value = true;
    dismissed.add(post.id); revision.value++;
    try {
      await api.setRecommendationDislike(post.id, true, controller.signal);
    } catch {
      // 失败则回滚乐观移除，让这篇重新回到推荐流（提示由调用方的通用 message 负责）。
      if (generation !== identityRevision.value || disposed) return;
      dismissed.delete(post.id); revision.value++;
    } finally {
      if (generation === identityRevision.value && !disposed) pending.value = false;
    }
  };
  const reset = () => {
    controller.abort(); controller = new AbortController();
    clearTimeout(timer); timer = undefined; queue = []; sending = false;
    contexts.clear(); seen.clear(); dismissed.clear(); revision.value++;
    pending.value = false;
    identityRevision.value++;
  };
  return {
    revision: readonly(revision), identityRevision: readonly(identityRevision), pending: readonly(pending),
    isDismissed, dismiss, trackClick, record, getContext, flush, reset,
    dispose: () => { disposed = true; reset(); },
  };
}

type Manager = ReturnType<typeof createRecommendationManager>;
const managers = new WeakMap<object, Manager>();
export function useRecommendations(): Manager {
  const auth = useAuthStore();
  let manager = managers.get(auth);
  if (!manager) {
    const login = useLoginDialog();
    manager = createRecommendationManager(useApi(), () => auth.isLogin, () => login.open());
    managers.set(auth, manager);
    const current = manager;
    const scope = effectScope(true);
    scope.run(() => watch(() => auth.generation, current.reset, { flush: "sync" }));
    const dispose = current.dispose;
    current.dispose = () => { scope.stop(); dispose(); managers.delete(auth); };
  }
  return manager;
}

const viewportListeners = new Set<() => void>();
let frame = 0;
const notifyViewport = () => { for (const listener of viewportListeners) listener(); };
const onViewportScroll = () => {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; notifyViewport(); });
};
function subscribeViewport(listener: () => void) {
  if (!viewportListeners.size) {
    window.addEventListener("scroll", onViewportScroll, { passive: true, capture: true });
    window.addEventListener("resize", onViewportScroll, { passive: true });
    window.addEventListener("focus", notifyViewport); window.addEventListener("blur", notifyViewport);
    document.addEventListener("visibilitychange", notifyViewport);
  }
  viewportListeners.add(listener);
  return () => {
    viewportListeners.delete(listener);
    if (!viewportListeners.size) {
      cancelAnimationFrame(frame); frame = 0;
      window.removeEventListener("scroll", onViewportScroll, true); window.removeEventListener("resize", onViewportScroll);
      window.removeEventListener("focus", notifyViewport); window.removeEventListener("blur", notifyViewport);
      document.removeEventListener("visibilitychange", notifyViewport);
    }
  };
}
const foreground = () => document.visibilityState === "visible" && document.hasFocus();

/** Clip against scroll containers as well as the viewport; an overlay covering
 * the center is not a viewed card. Tall cards use the area that can fit onscreen. */
function visibleGeometry(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  let viewportLeft = 0, viewportTop = 0, viewportRight = window.innerWidth, viewportBottom = window.innerHeight;
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent);
    const box = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { viewportLeft = Math.max(viewportLeft, box.left); viewportRight = Math.min(viewportRight, box.right); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { viewportTop = Math.max(viewportTop, box.top); viewportBottom = Math.min(viewportBottom, box.bottom); }
    parent = parent.parentElement;
  }
  const left = Math.max(viewportLeft, rect.left), top = Math.max(viewportTop, rect.top);
  const right = Math.min(viewportRight, rect.right), bottom = Math.min(viewportBottom, rect.bottom);
  const width = Math.max(0, right - left), height = Math.max(0, bottom - top);
  if (!element.isConnected || width <= 0 || height <= 0) return { ratio: 0, height: 0 };
  const hit = document.elementFromPoint?.((left + right) / 2, (top + bottom) / 2);
  if (hit && !element.contains(hit)) return { ratio: 0, height: 0 };
  const area = Math.min(rect.width, Math.max(0, viewportRight - viewportLeft))
    * Math.min(rect.height, Math.max(0, viewportBottom - viewportTop));
  return { ratio: area > 0 ? width * height / area : 0, height };
}

export function useRecommendationImpression(
  element: MaybeRefOrGetter<HTMLElement | null | undefined>,
  post: MaybeRefOrGetter<RecommendedPost | undefined>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const recommendations = useRecommendations();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: IntersectionObserver | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const visible = () => {
    const node = toValue(element);
    return !!node && toValue(enabled) && foreground() && visibleGeometry(node).ratio >= 0.5;
  };
  const update = () => {
    const value = toValue(post);
    if (!value?.recommendation || expired(value.recommendation) || !visible()) { clear(); return; }
    if (!timer) timer = setTimeout(() => {
      timer = undefined;
      if (visible()) recommendations.record("impression", value.recommendation);
    }, 1000);
  };
  const unsubscribe = import.meta.client ? subscribeViewport(update) : () => {};
  watch([() => toValue(element), () => toValue(post)?.recommendation?.token, () => toValue(enabled), recommendations.identityRevision], () => {
    clear(); observer?.disconnect();
    const node = toValue(element);
    if (!import.meta.client || !node || !toValue(post)?.recommendation || !toValue(enabled)) return;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(update, { threshold: [0, 0.25, 0.5, 0.75, 1] });
      observer.observe(node);
    }
    update();
  }, { immediate: true, flush: "post" });
  onScopeDispose(() => { clear(); observer?.disconnect(); unsubscribe(); });
}

export function useRecommendationReading(
  documentId: MaybeRefOrGetter<string | undefined>,
  active: MaybeRefOrGetter<boolean>,
  bodyElement?: MaybeRefOrGetter<HTMLElement | null | undefined>,
) {
  const recommendations = useRecommendations();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started: number | null = null;
  let elapsed = 0;
  let generation = 0;
  let context: RecommendationContext | undefined;
  let contextAttempted = false;
  let finished = false;
  let observer: IntersectionObserver | undefined;
  const stop = (countInterval = true) => {
    if (started !== null && countInterval) elapsed += Math.max(0, performance.now() - started);
    started = null; clearTimeout(timer); timer = undefined;
  };
  const eligible = () => {
    if (!toValue(documentId) || !toValue(active) || !foreground()) return false;
    if (bodyElement === undefined) return true;
    const node = toValue(bodyElement);
    return !!node && visibleGeometry(node).height >= 32;
  };
  const update = () => {
    if (finished || !eligible()) { stop(); return; }
    if (!context) {
      if (!contextAttempted) {
        contextAttempted = true;
        const current = generation;
        void recommendations.getContext(toValue(documentId)!).then((value) => {
          if (current !== generation) return;
          context = value;
          if (value) update();
        });
      }
      return;
    }
    if (started !== null) {
      elapsed += Math.max(0, performance.now() - started);
      started = performance.now();
      return;
    }
    started = performance.now();
    timer = setTimeout(() => {
      const wasEligible = eligible();
      stop();
      if (wasEligible && elapsed >= 30_000) {
        finished = true; recommendations.record("dwell", context, Math.floor(elapsed));
      } else update();
    }, Math.max(0, 30_000 - elapsed));
  };
  const unsubscribe = import.meta.client ? subscribeViewport(update) : () => {};
  // Menus and overlays can cover the text without causing an intersection or
  // visibility event. Recheck only mounted reading surfaces, conservatively
  // excluding the unverified interval when such an obstruction appears.
  const pulse = import.meta.client ? setInterval(() => {
    if (started !== null && !eligible()) stop(false);
    else update();
  }, 500) : undefined;
  watch([() => toValue(documentId), recommendations.identityRevision], () => {
    generation++; stop(); elapsed = 0; context = undefined; contextAttempted = false; finished = false;
    if (import.meta.client) update();
  }, { immediate: true, flush: "sync" });
  watch([() => toValue(active), () => bodyElement === undefined ? undefined : toValue(bodyElement)], () => {
    observer?.disconnect();
    const node = bodyElement === undefined ? undefined : toValue(bodyElement);
    if (import.meta.client && node && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(update, { threshold: [0, 0.01, 0.5, 1] }); observer.observe(node);
    }
    if (import.meta.client) update();
  }, { immediate: true, flush: "post" });
  onScopeDispose(() => { generation++; stop(); clearInterval(pulse); observer?.disconnect(); unsubscribe(); });
}
