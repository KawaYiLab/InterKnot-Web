import { onBeforeUnmount } from "vue";

/**
 * 监听 window.visualViewport，把底部被浏览器工具栏/键盘遮住的高度
 * 以及当前可见视口高度写入 CSS 变量：
 *   --vv-bottom : 底部工具栏高度（px）
 *   --vv-height : 可见视口高度（px）
 *
 * 用于把 position: fixed 的底部面板放在浏览器工具栏上方，而不是被压住。
 * 在不支持 visualViewport 的浏览器里不写入变量，保留原有 CSS 降级。
 */
export function useVisualViewport() {
  if (typeof window === "undefined") return;

  const vv = window.visualViewport;
  if (!vv) return;

  const update = () => {
    // bottom = 布局视口底部到视觉视口底部的距离（底部工具栏/键盘高度）
    const bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const height = vv.height;
    const root = document.documentElement;
    root.style.setProperty("--vv-bottom", `${bottom}px`);
    root.style.setProperty("--vv-height", `${height}px`);
  };

  update();
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);

  onBeforeUnmount(() => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    const root = document.documentElement;
    root.style.removeProperty("--vv-bottom");
    root.style.removeProperty("--vv-height");
  });
}
