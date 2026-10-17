export function staleAuthError() {
  return Object.assign(new Error("登录状态已变更，请重试"), { code: "AUTH_CONTEXT_CHANGED" });
}

export const LOGOUT_KEY = "ik:auth:logged-out";
// Only a hint (the last signed-in user id) to attempt cookie recovery; the server still
// authenticates the HttpOnly session cookie.
export const SESSION_HINT_KEY = "ik:auth:has-session";
