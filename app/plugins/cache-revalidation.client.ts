import type { QueryClient } from "@tanstack/vue-query";

/**
 * Tab/窗口可见性兜底：
 * - 用户从其他 Tab/应用切回到本站时，将所有 query 标记为 stale，
 *   下一次 fetchQuery 调用会真实命中后端，避免长时间显示陈旧数据。
 * - 同时派发 `ik:tab-visible` 事件，关键页面（如首页）可监听并主动跳一次轮询/刷新。
 *
 * 注意：必须在客户端执行；与 vue-query 插件互相独立，仅依赖 $queryClient 注入。
 */
export default defineNuxtPlugin(() => {
  if (typeof document === "undefined") return;

  // 节流：避免短时间内频繁切换标签时打爆缓存（设为 5s 冷却足够）
  const COOLDOWN_MS = 5_000;
  let lastInvalidateAt = 0;

  const handleVisible = () => {
    if (document.visibilityState !== "visible") return;

    const now = Date.now();
    const shouldInvalidate = now - lastInvalidateAt > COOLDOWN_MS;
    if (shouldInvalidate) {
      lastInvalidateAt = now;
      const queryClient = useNuxtApp().$queryClient as QueryClient | undefined;
      if (queryClient) {
        // 不指定 queryKey ⇒ 失效所有 query（仅标记 stale，不立即重拉）
        queryClient.invalidateQueries();
      }
    }

    // 即使在冷却期内也派发事件，让页面有机会自行决定是否轮询/刷新
    window.dispatchEvent(new Event("ik:tab-visible"));
  };

  document.addEventListener("visibilitychange", handleVisible);
});
