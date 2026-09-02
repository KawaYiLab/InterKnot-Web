/**
 * 客户端桥接：登录态就绪后评估是否弹出「今日签到」提醒。
 *
 * watch auth.user 的 null → 有值，一个入口同时覆盖：
 *   - 新登录（LoginDialog 邮箱登录 / 米游社扫码）
 *   - hydrateFromStorage() 恢复会话（刷新页面、重开浏览器）
 * LoginDialog 会调 setSession 两次（第二次补全 author 关联），去重交给
 * useCheckInReminder 内部的 evaluatedForDay。
 *
 * ik:tab-visible / focus 是「标签页开着过夜」的兜底：跨过凌晨 4:00 后 auth.user
 * 不再变化，watcher 不会重新触发，用户在这个标签页里就永远看不到新一天的提醒。
 * 前者由 cache-revalidation.client.ts 在 visibilitychange 时统一派发（本站的可见性
 * 中枢，首页也听它）；后者补上「切到别的应用又切回来、但标签页一直可见」这一档，
 * 那种情况 visibilitychange 不一定触发。两条都只是往 evaluate() 撞一下，闸门在里面。
 *
 * enforce: "post" —— useApi() 会在调用当时就把 $queryClient 解构走（见 useApi.ts
 * 顶部），而 plugins 默认按文件名排序、vue-query.ts 排在 check-in-reminder 之后。
 * 不推到 post 的话这里拿到的 api 对象里 $queryClient 永久为 undefined，所有
 * cachedRead / invalidateQueries 会静默失效。
 */
export default defineNuxtPlugin({
  name: "check-in-reminder",
  enforce: "post",
  setup() {
    if (!import.meta.client) return;

    const auth = useAuthStore();
    const reminder = useCheckInReminder();

    // useApi / useRouter 必须在插件的 Nuxt 上下文内同步取好——evaluate() 会在
    // DOM 事件回调和 await 之后运行，那时再调这些 composable 会拿不到上下文。
    reminder.init({ api: useApi(), router: useRouter(), auth });

    watch(
      () => auth.user,
      (user) => {
        if (user) void reminder.evaluate();
      },
      { immediate: true },
    );

    const onMaybeNewDay = () => void reminder.evaluate();
    window.addEventListener("ik:tab-visible", onMaybeNewDay);
    window.addEventListener("focus", onMaybeNewDay);

    window.addEventListener("auth:logout", reminder.reset);
  },
});
