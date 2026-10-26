import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * 滚动提示：容器上方 / 下方还有内容时分别为 true，用来显示游戏里那种 ▲ ▼ 小三角，
 * 代替隐藏掉的滚动条。容器自身和直接子元素的尺寸变化（评论加载、图片撑开）都会重算。
 */
export function useScrollHint(target: Ref<HTMLElement | null>) {
  const up = ref(false);
  const down = ref(false);

  const update = () => {
    const el = target.value;
    if (!el) {
      up.value = false;
      down.value = false;
      return;
    }
    // 留 2px 容差，避免缩放下的小数像素让箭头一直亮着
    up.value = el.scrollTop > 2;
    down.value = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
  };

  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;

  const observeChildren = (el: HTMLElement) => {
    resizeObserver?.disconnect();
    resizeObserver?.observe(el);
    for (const child of Array.from(el.children)) resizeObserver?.observe(child);
    update();
  };

  const detach = (el: HTMLElement | null) => {
    el?.removeEventListener("scroll", update);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = null;
    mutationObserver = null;
  };

  watch(
    target,
    (el, prev) => {
      detach(prev ?? null);
      if (!el || !import.meta.client) {
        update();
        return;
      }
      el.addEventListener("scroll", update, { passive: true });
      resizeObserver = new ResizeObserver(update);
      mutationObserver = new MutationObserver(() => observeChildren(el));
      mutationObserver.observe(el, { childList: true });
      observeChildren(el);
    },
    { immediate: true, flush: "post" },
  );

  onBeforeUnmount(() => detach(target.value));

  return { up, down, update };
}
