import { dispatchPostModalPopState } from "~/utils/post-modal-history";

export default defineNuxtPlugin({
  name: "post-modal-history",
  // Window 的 popstate 按注册顺序分发，capture 不能抢在 nuxt:router（-20）前面。
  order: -30,
  setup(nuxtApp) {
    window.addEventListener("popstate", dispatchPostModalPopState);
    nuxtApp.vueApp.onUnmount(() => {
      window.removeEventListener("popstate", dispatchPostModalPopState);
    });
  },
});
