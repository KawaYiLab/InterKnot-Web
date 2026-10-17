/**
 * 应用启动即打开实时通道（游客也连：在线人数按连接数统计，新帖提醒也走它）。
 * 身份变化（登录 / 登出 / 换号）时重连，让服务端按新身份投递事件。
 */
export default defineNuxtPlugin(() => {
  const auth = useAuthStore();
  const realtime = useRealtime();

  realtime.start();

  watch(
    () => (auth.isLogin ? String(auth.user?.id || "") : ""),
    (identity, previous) => {
      // 刷新页面时连接本来就带着 Cookie 连上了，会话恢复完成时身份已经一致，不必重连。
      if (identity !== previous && realtime.userId.value !== (identity || null)) realtime.reconnect();
    },
  );
});
