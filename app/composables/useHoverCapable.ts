/**
 * useHoverCapable —— 当前设备是否支持「悬停」（鼠标类精确指针）。
 *
 * 用于在触屏 / 窄屏上跳过纯桌面交互（如 UserHoverCard 悬浮卡）：这些组件在
 * 触屏上本就不弹，却仍会为每张卡片实例化一堆 composable，属纯浪费。用本判断
 * 配合 `v-if` 可在移动端彻底不挂载它们。
 *
 * 实现为模块级单例：整个应用只注册一个 matchMedia 监听，避免每个 PostCard
 * 各建一个监听器带来的额外开销。SSR 阶段返回 false（保守，避免水合不一致）。
 */
// 与 UserHoverCard.isMobileEnv 同义：窄屏 / 触屏一律视作「不可悬停」。
// 既覆盖真机触屏（hover:none / pointer:coarse），也覆盖 ≤768px 窄视口
// （桌面浏览器缩窄到移动断点时同样跳过悬浮卡，避免无意义实例化）。
const HOVER_QUERY =
  "(hover: hover) and (pointer: fine) and (min-width: 769px)";

const hoverCapable = ref(false);
let initialized = false;

function ensureInitialized() {
  if (initialized || typeof window === "undefined" || !window.matchMedia) return;
  initialized = true;
  const mql = window.matchMedia(HOVER_QUERY);
  hoverCapable.value = mql.matches;
  const onChange = (e: MediaQueryListEvent) => {
    hoverCapable.value = e.matches;
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
  } else if (typeof mql.addListener === "function") {
    // Safari < 14 回退
    mql.addListener(onChange);
  }
}

export function useHoverCapable() {
  if (import.meta.client) ensureInitialized();
  return readonly(hoverCapable);
}
