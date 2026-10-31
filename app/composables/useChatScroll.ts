import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { useEventListener, usePreferredReducedMotion, useResizeObserver } from "@vueuse/core";

const BOTTOM_THRESHOLD = 16;
const FOLLOW_TIME_CONSTANT_MS = 70;

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
  let lastScrollTop = 0;
  let lastMaxScrollTop = 0;
  let pointerHeld = false;
  let touchY: number | null = null;
  let scrollingDown = false;

  const maxScrollTop = (el: HTMLElement) => Math.max(0, el.scrollHeight - el.clientHeight);

  const updatePosition = () => {
    const el = viewport.value;
    isAtBottom.value = !el || maxScrollTop(el) - Math.max(0, el.scrollTop) <= BOTTOM_THRESHOLD;
  };

  const cancelAnimation = () => {
    if (frame != null) cancelAnimationFrame(frame);
    frame = null;
  };

  const stopFollowing = () => {
    isFollowing.value = false;
    scrollingDown = false;
    cancelAnimation();
    updatePosition();
  };

  const writeScrollTop = (el: HTMLElement, top: number) => {
    el.scrollTop = top;
    // 程序滚动也会触发 scroll；以浏览器实际落下的位置为基线。
    lastScrollTop = el.scrollTop;
    lastMaxScrollTop = maxScrollTop(el);
    updatePosition();
  };

  const followFrame = (now: number) => {
    frame = null;
    const el = viewport.value;
    if (!el || !isFollowing.value || pointerHeld || touchY != null) return;
    const target = maxScrollTop(el);
    const gap = target - el.scrollTop;
    if (gap <= 1 || reducedMotion.value === "reduce") {
      writeScrollTop(el, target);
      return;
    }
    const elapsed = Math.min(Math.max(now - lastFrameAt, 1), 64);
    lastFrameAt = now;
    const movement = Math.min(gap, Math.max(1, gap * (1 - Math.exp(-elapsed / FOLLOW_TIME_CONSTANT_MS))));
    writeScrollTop(el, el.scrollTop + movement);
    frame = requestAnimationFrame(followFrame);
  };

  const scheduleFollow = () => {
    const el = viewport.value;
    if (!el || !isFollowing.value || pointerHeld || touchY != null) return;
    if (reducedMotion.value === "reduce") {
      cancelAnimation();
      writeScrollTop(el, maxScrollTop(el));
    } else if (frame == null) {
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
    if (el && behavior === "instant") writeScrollTop(el, maxScrollTop(el));
    else scheduleFollow();
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

  const onScroll = () => {
    const el = viewport.value;
    if (!el) return;
    const top = Math.max(0, el.scrollTop);
    const max = maxScrollTop(el);
    const movedUp = top < lastScrollTop - 1;
    const movedDown = top > lastScrollTop + 1;
    const resized = Math.abs(max - lastMaxScrollTop) > 1;
    lastScrollTop = top;
    lastMaxScrollTop = max;
    updatePosition();

    // 内容收缩、浏览器滚动锚定引起的位移不代表用户上翻。
    if (movedUp && !resized) stopFollowing();
    else if (movedDown && !resized && isAtBottom.value && (scrollingDown || pointerHeld)) {
      isFollowing.value = true;
      scheduleFollow();
    }
  };

  const nestedScrollerCanConsume = (target: EventTarget | null, delta: number) => {
    const el = viewport.value;
    let node = target instanceof Element ? target : null;
    while (node && node !== el) {
      if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight) {
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
    if (!nestedScrollerCanConsume(event.target, delta)) scrollIntent(delta);
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

  useResizeObserver([viewport, content], () => {
    const el = viewport.value;
    if (!el) return;
    lastScrollTop = el.scrollTop;
    lastMaxScrollTop = maxScrollTop(el);
    updatePosition();
    scheduleFollow();
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
