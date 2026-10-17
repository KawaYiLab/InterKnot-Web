/**
 * 客户端桥接：登录态下接上私聊 / 收件箱的实时事件，拉一次收件箱第一页。
 *
 * - 事件跑在共享的 /v1/realtime 连接上（plugins/realtime.client.ts）：私信、通知变化、
 *   别的端已读等都由 useDmConversations 处理；连接重连后它会自己用 REST 补齐。
 * - 切回前台时静默 refresh 兜底。
 *
 * dm.refresh() 只拉收件箱的**第一页**（游标分页），顺带取回跨全部条目的权威未读总数
 * （totalUnread）——这正是红点需要的；列表更多内容由 KnockKnockModal 滚动到底时按需追加。
 */
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return;

  const auth = useAuthStore();
  const dm = useDmConversations();

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible" && auth.isLogin) {
      void dm.refresh({ silent: true });
    }
  };

  watch(
    () => [auth.isLogin, auth.generation] as const,
    ([loggedIn]) => {
      if (!loggedIn) return;
      dm.startStream();
      void dm.refresh();
    },
    { immediate: true },
  );

  document.addEventListener("visibilitychange", onVisibilityChange);

  window.addEventListener("auth:logout", () => {
    dm.reset();
  });
});
