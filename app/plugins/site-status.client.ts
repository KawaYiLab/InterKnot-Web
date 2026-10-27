/** 客户端启动时拉取站点公告与维护状态，并定时刷新（见 composables/useSiteStatus.ts）。 */
import type { SiteStatus } from "~/composables/useSiteStatus";

export default defineNuxtPlugin({
  name: "site-status",
  setup(nuxtApp) {
    const api = nuxtApp.$api;
    startSiteStatus(() => api<SiteStatus>("/v1/site"));
  },
});
