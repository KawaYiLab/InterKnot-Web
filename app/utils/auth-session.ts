/** Serialize responses that mutate the shared HttpOnly refresh cookie. */
let cookieQueue: Promise<unknown> = Promise.resolve();

export function withAuthCookieLock<T>(action: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => typeof navigator !== "undefined" && navigator.locks
    ? await navigator.locks.request("ik:auth-cookie", action)
    : await action();
  const pending = cookieQueue.then(run, run);
  cookieQueue = pending.catch(() => {});
  return pending;
}

export function staleAuthError() {
  return Object.assign(new Error("登录状态已变更，请重试"), { code: "AUTH_CONTEXT_CHANGED" });
}

export const LOGOUT_KEY = "ik:auth:logged-out";
// Only a hint to attempt cookie recovery; the server still authenticates the HttpOnly cookie.
export const SESSION_HINT_KEY = "ik:auth:has-session";
