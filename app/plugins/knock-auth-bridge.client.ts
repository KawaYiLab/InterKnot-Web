/**
 * 客户端桥接：登录态下启动敲敲相关长连接。
 *
 * - DM WebSocket：私信 message.created 等
 * - Knock SSE（/api/knock/stream）：notification.created → 静默刷新 /api/dm/conversations，更新 Header 未读
 * - 切回前台时静默 refresh 兜底（SSE 断线期间）
 */
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return;

  const auth = useAuthStore();
  const dm = useDmConversations();
  const knock = useKnockKnockConversations();

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible" && auth.isLogin) {
      void dm.refresh({ silent: true });
    }
  };

  watch(
    () => auth.isLogin,
    (loggedIn) => {
      if (!loggedIn) return;
      dm.startStream();
      knock.startStream();
      void dm.refresh();
    },
  );

  document.addEventListener("visibilitychange", onVisibilityChange);

  window.addEventListener("auth:logout", () => {
    knock.reset();
    dm.reset();
  });
});
