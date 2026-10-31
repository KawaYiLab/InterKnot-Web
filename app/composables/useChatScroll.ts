import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { useEventListener, usePreferredReducedMotion, useResizeObserver } from "@vueuse/core";

const BOTTOM_THRESHOLD = 16;
const FOLLOW_TIME_CONSTANT_MS = 50;

export function useChatScroll(
  viewport: Ref<HTMLElement | null>,
  content: Ref<HTMLElement | null>,
) {
  const isFollowing = ref(true);
  const isAtBottom = ref(true);
  const reducedMotion = usePreferredReducedMotion();
  const ownerDocument = computed(() => viewport.value?.ownerDocument);
  let frame: number | null = null;
  let lastFrameAt = 0;
  // 保留小数位置，不能把浏览器取整后的 scrollTop 当作每一帧的起点。
  let animatedTop = 0;
  let velocity = 0;
  let lastScrollTop = 0;
  let lastMaxScrollTop = 0;
  let pointerHeld = false;
  let touchY: number | null = null;
  let scrollingDown = false;

  const maxScrollTop = (el: HTMLElement) => Math.max(0, el.scrollHeight - el.clientHeight);

  const updatePosition = () => {
    isAtBottom.value = !viewport.value || lastMaxScrollTop - Math.max(0, lastScrollTop) <= BOTTOM_THRESHOLD;
  };

  const cancelAnimation = () => {
    if (frame != null) cancelAnimationFrame(frame);
    frame = null;
    velocity = 0;
  };

  const stopFollowing = () => {
    isFollowing.value = false;
    scrollingDown = false;
    cancelAnimation();
    updatePosition();
  };

  const writeScrollTop = (el: HTMLElement, top: number, max: number) => {
    el.scrollTop = top;
    // 程序滚动也会触发 scroll；以浏览器实际落下的位置为基线。
    lastScrollTop = el.scrollTop;
    lastMaxScrollTop = max;
    updatePosition();
  };

  const followFrame = (now: number) => {
    frame = null;
    const el = viewport.value;
    if (!el || !isFollowing.value || pointerHeld || touchY != null) return;
    const target = maxScrollTop(el);
    const gap = target - animatedTop;
    if (gap <= 0.5 || reducedMotion.value === "reduce") {
      animatedTop = target;
      velocity = 0;
      writeScrollTop(el, target, target);
      return;
    }
    const elapsed = Math.min(Math.max(now - lastFrameAt, 1), 64);
    lastFrameAt = now;
    // 临界阻尼：换行只更新目标，沿用当前位置和速度，不重新加速起步。
    const displacement = animatedTop - target;
    const coefficient = velocity + displacement / FOLLOW_TIME_CONSTANT_MS;
    const decay = Math.exp(-elapsed / FOLLOW_TIME_CONSTANT_MS);
    const nextTop = target + (displacement + coefficient * elapsed) * decay;
    velocity = (velocity - coefficient * elapsed / FOLLOW_TIME_CONSTANT_MS) * decay;
    animatedTop = Math.min(target, Math.max(animatedTop, nextTop));
    writeScrollTop(el, animatedTop, target);
    frame = requestAnimationFrame(followFrame);
  };

  const scheduleFollow = () => {
    const el = viewport.value;
    if (!el || !isFollowing.value || pointerHeld || touchY != null) return;
    if (reducedMotion.value === "reduce") {
      cancelAnimation();
      const target = maxScrollTop(el);
      writeScrollTop(el, target, target);
    } else if (frame == null) {
      animatedTop = el.scrollTop;
      velocity = 0;
      lastFrameAt = performance.now();
      frame = requestAnimationFrame(followFrame);
    }
  };

  const scrollToBottom = (behavior: "smooth" | "instant" = "smooth") => {
    isFollowing.value = true;
    scrollingDown = false;
    pointerHeld = false;
    touchY = null;
    cancelAnimation();
    const el = viewport.value;
    if (el && behavior === "instant") {
      const target = maxScrollTop(el);
      writeScrollTop(el, target, target);
    } else scheduleFollow();
  };

  const reset = () => {
    cancelAnimation();
    isFollowing.value = true;
    isAtBottom.value = true;
    pointerHeld = false;
    touchY = null;
    scrollingDown = false;
    lastScrollTop = 0;
    lastMaxScrollTop = 0;
  };

  const syncLayoutPosition = (el: HTMLElement, top: number, max: number) => {
    const previousTop = Math.max(0, Math.min(lastScrollTop, max));
    const ownsPosition = isFollowing.value && reducedMotion.value !== "reduce" && !pointerHeld && touchY == null;
    if (ownsPosition && Math.abs(top - previousTop) > 0.5) {
      // 布局可能先于 ResizeObserver 调整 scrollTop，不能把这段跳跃当成动画已经走过。
      writeScrollTop(el, previousTop, max);
    } else {
      lastScrollTop = top;
      lastMaxScrollTop = max;
      updatePosition();
    }
    scheduleFollow();
  };

  const onScroll = () => {
    const el = viewport.value;
    if (!el) return;
    const top = Math.max(0, el.scrollTop);
    const max = maxScrollTop(el);
    // 内容收缩、浏览器滚动锚定引起的位移不代表用户上翻。
    if (Math.abs(max - lastMaxScrollTop) > 1) {
      syncLayoutPosition(el, top, max);
      return;
    }
    const movedUp = top < lastScrollTop - 1;
    const movedDown = top > lastScrollTop + 1;
    lastScrollTop = top;
    lastMaxScrollTop = max;
    updatePosition();

    if (movedUp) stopFollowing();
    else if (movedDown && isAtBottom.value && (scrollingDown || pointerHeld)) {
      isFollowing.value = true;
      scheduleFollow();
    }
  };

  const nestedScrollerCanConsume = (target: EventTarget | null, delta: number) => {
    const el = viewport.value;
    let node = target instanceof Element ? target : null;
    while (node && node !== el) {
      if (node instanceof HTMLElement) {
        const overflow = node.ownerDocument.defaultView?.getComputedStyle(node).overflowY;
        if (overflow && /auto|scroll|overlay/.test(overflow)) {
          if (delta < 0 ? node.scrollTop > 0 : maxScrollTop(node) - node.scrollTop > 1) return true;
        }
      }
      node = node.parentElement;
    }
    return false;
  };

  const scrollIntent = (delta: number) => {
    if (delta < 0) stopFollowing();
    else if (delta > 0) {
      scrollingDown = true;
      updatePosition();
      if (isAtBottom.value) {
        isFollowing.value = true;
        scheduleFollow();
      }
    }
  };

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    if (!nestedScrollerCanConsume(event.target, event.deltaY)) scrollIntent(event.deltaY);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === " " && target?.closest("button, a, [role='button']")) return;
    const delta = ["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)
      ? -1
      : ["ArrowDown", "PageDown", "End", " "].includes(event.key) ? 1 : 0;
    if (delta && !nestedScrollerCanConsume(event.target, delta)) scrollIntent(delta);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    pointerHeld = true;
    cancelAnimation();
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a, [role='button']")) stopFollowing();
  };

  const onPointerUp = () => {
    if (!pointerHeld) return;
    pointerHeld = false;
    scheduleFollow();
  };

  const onTouchStart = (event: TouchEvent) => {
    touchY = event.touches[0]?.clientY ?? null;
    cancelAnimation();
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a, [role='button']")) stopFollowing();
  };

  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (touchY == null || y == null) return;
    const delta = touchY - y;
    touchY = y;
    if (!nestedScrollerCanConsume(event.target, delta)) scrollIntent(delta);
  };

  const onTouchEnd = () => {
    touchY = null;
    scheduleFollow();
  };

  const onSelectionChange = () => {
    const el = viewport.value;
    const selection = el?.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed &&
      (el?.contains(selection.anchorNode) || el?.contains(selection.focusNode))) {
      stopFollowing();
    }
  };

  useEventListener(viewport, "scroll", onScroll, { passive: true });
  useEventListener(viewport, "wheel", onWheel, { passive: true });
  useEventListener(viewport, "keydown", onKeyDown);
  useEventListener(viewport, "pointerdown", onPointerDown, { passive: true });
  useEventListener(ownerDocument, ["pointerup", "pointercancel"], onPointerUp, { passive: true });
  useEventListener(viewport, "touchstart", onTouchStart, { passive: true });
  useEventListener(viewport, "touchmove", onTouchMove, { passive: true });
  useEventListener(ownerDocument, ["touchend", "touchcancel"], onTouchEnd, { passive: true });
  useEventListener(ownerDocument, "selectionchange", onSelectionChange);

  watch([viewport, isFollowing], ([el, following], _previous, onCleanup) => {
    if (!el || !following) return;
    const anchor = el.style.getPropertyValue("overflow-anchor");
    const priority = el.style.getPropertyPriority("overflow-anchor");
    el.style.setProperty("overflow-anchor", "none", priority);
    onCleanup(() => {
      if (anchor) el.style.setProperty("overflow-anchor", anchor, priority);
      else el.style.removeProperty("overflow-anchor");
    });
  }, { flush: "sync", immediate: true });

  useResizeObserver([viewport, content], () => {
    const el = viewport.value;
    if (!el) return;
    syncLayoutPosition(el, Math.max(0, el.scrollTop), maxScrollTop(el));
  });

  watch([viewport, content], ([el, inner]) => {
    cancelAnimation();
    if (!el || !inner) return;
    lastScrollTop = el.scrollTop;
    lastMaxScrollTop = maxScrollTop(el);
    updatePosition();
    if (isFollowing.value) scrollToBottom("instant");
  }, { flush: "post", immediate: true });

  watch(reducedMotion, scheduleFollow);
  onScopeDispose(cancelAnimation);

  return {
    isFollowing,
    showBackToBottom: computed(() => !isFollowing.value && !isAtBottom.value),
    scrollToBottom,
    stopFollowing,
    reset,
  };
}
