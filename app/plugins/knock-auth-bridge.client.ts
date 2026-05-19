/**
 * 客户端桥接：登出 / 会话过期 → 清掉敲敲 composable 的本地状态 + 断开 SSE / WS。
 *
 * 设计原因：
 * - `useKnockKnockConversations` 维护了模块级的 `EventSource` 单例和 `useState` 缓存。
 * - `useDmConversations` 维护了模块级的 WebSocket 单例和 `useState` 缓存。
 *   `clearSession()` 只清 token / 路由 / API 缓存，碰不到这些。
 * - 旧 token 的 SSE / WS 连接如果不在登出时断掉，会继续接收前一个账号的事件，
 *   切到新账号后看到上一个用户的私聊推送 —— 显然是个泄漏。
 * - 不直接在 `auth.ts` 里 import composable，避免 store ↔ composable 互相依赖。
 *   走 window 事件总线最干净。
 */
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return;

  const { reset: resetKnock } = useKnockKnockConversations();
  const { reset: resetDm } = useDmConversations();

  window.addEventListener("auth:logout", () => {
    resetKnock();
    resetDm();
  });
  // session-expired 走的是 store 内部 clearSession，会自带 auth:logout，
  // 所以这里不重复挂。如果以后链路变动，可以再补一个监听。
});
