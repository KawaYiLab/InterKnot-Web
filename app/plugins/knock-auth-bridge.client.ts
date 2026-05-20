/**
 * 客户端桥接：在登录态变化时启动 / 关闭敲敲相关的后台连接与状态。
 *
 * 行为：
 * - 登录（auth.isLogin 由 false → true）：启动 DM WebSocket + 拉一次会话列表，
 *   让 AppHeader 的"敲敲"未读 badge 立即有数据，无需等用户打开弹窗。
 *   stream 是模块级单例，KnockKnockModal 后续打开时调 startStream() 是幂等的。
 * - 登出 / 会话过期：清掉敲敲 composable 的本地状态 + 断开 SSE / WS。
 *
 * 设计原因：
 * - `useKnockKnockConversations` 维护了模块级的 `EventSource` 单例和 `useState` 缓存。
 * - `useDmConversations` 维护了模块级的 WebSocket 单例和 `useState` 缓存。
 *   `clearSession()` 只清 token / 路由 / API 缓存，碰不到这些。
 * - 旧 token 的 SSE / WS 连接如果不在登出时断掉，会继续接收前一个账号的事件，
 *   切到新账号后看到上一个用户的私聊推送 —— 显然是个泄漏。
 * - 不直接在 `auth.ts` 里 import composable，避免 store ↔ composable 互相依赖。
 *   走 window 事件总线 + Pinia 响应式 watch 最干净。
 */
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return;

  const auth = useAuthStore();
  const dm = useDmConversations();
  const { reset: resetKnock } = useKnockKnockConversations();

  // 登录态变化触发 DM 启动。
  // 注意：不用 `immediate: true`——plugin 执行时机早于 app.vue 的
  // `auth.hydrateFromStorage()`，此时 isLogin 一定是 false；hydrate 把 token
  // 写回 store 后这里的 watch 会自动触发。
  watch(
    () => auth.isLogin,
    (loggedIn) => {
      if (!loggedIn) return;
      dm.startStream();
      void dm.refresh();
    },
  );

  window.addEventListener("auth:logout", () => {
    resetKnock();
    dm.reset();
  });
  // session-expired 走的是 store 内部 clearSession，会自带 auth:logout，
  // 所以这里不重复挂。如果以后链路变动，可以再补一个监听。
});
