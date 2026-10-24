/**
 * Cloudflare Web Analytics。
 * 首屏加载完、主线程空闲后再注入：beacon 解析执行会产生数百毫秒长任务，
 * 直接放 <head> 会和首屏渲染抢主线程。它读取的 LCP / FCP 等指标来自
 * buffered PerformanceObserver，晚注入不影响统计。
 */
const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";
const BEACON_TOKEN = "87a21c330b51466ca19ec0b32ff89a51";

export default defineNuxtPlugin(() => {
  const inject = () => {
    const script = document.createElement("script");
    script.src = BEACON_SRC;
    script.defer = true;
    script.dataset.cfBeacon = JSON.stringify({ token: BEACON_TOKEN });
    document.head.appendChild(script);
  };

  const scheduleInject = () => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(inject, { timeout: 5000 });
    } else {
      setTimeout(inject, 2000);
    }
  };

  if (document.readyState === "complete") {
    scheduleInject();
  } else {
    window.addEventListener("load", scheduleInject, { once: true });
  }
});
