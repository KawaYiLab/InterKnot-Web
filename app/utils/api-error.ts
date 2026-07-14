import type { ApiClientError } from "~/types/api";

const NETWORK_ERROR_PATTERNS = [
  "<no response>",
  "Failed to fetch",
  "fetch failed",
  "NetworkError",
  "Load failed",
];

export function normalizeApiError(error: unknown): ApiClientError {
  if (error instanceof Error) {
    return error as ApiClientError;
  }
  return new Error("未知请求异常") as ApiClientError;
}

/** 判断 API 错误是否为 404 Not Found */
export function isNotFoundError(error: unknown): boolean {
  const e = normalizeApiError(error);
  return typeof e.statusCode === "number" && e.statusCode === 404;
}

/** 判断 API 错误是否为 403 用户已被拉黑 */
export function isUserBlockedError(error: unknown): boolean {
  const e = normalizeApiError(error);
  return e.statusCode === 403 || e.code === "USER_BLOCKED";
}

export function resolveErrorMessage(error: unknown, fallback = "请求失败"): string {
  const e = normalizeApiError(error);
  const message = e.message || "";
  const statusCode = typeof e.statusCode === "number" ? e.statusCode : undefined;
  const retryAfter = e.details?.retryAfter;
  const attemptsRemaining = e.details?.attemptsRemaining;
  if (e.code === "REGISTER_CODE_COOLDOWN" && typeof retryAfter === "number") {
    return `发送太频繁，请 ${retryAfter} 秒后再试`;
  }
  if (e.code === "REGISTER_CODE_INVALID" && typeof attemptsRemaining === "number") {
    return `验证码错误，还可尝试 ${attemptsRemaining} 次`;
  }
  // 网络错误：无 statusCode 且命中网络错误特征
  if (!statusCode && NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
    return "网络异常，请稍后重试";
  }
  // 后端返回了具体的业务 code 或可读 message（即 plugins/api.ts:toApiError 从 body 提取到了 error.code/error.message）
  // 优先展示后端文案，避免被 5xx 等通用文案覆盖（如后端把 "账号或密码错误" 用 5xx + ValidationError 返回的情况）
  const hasBusinessCode = typeof e.code === "string" && e.code.length > 0;
  const hasBusinessMessage = !!message && message !== "请求失败";
  if (hasBusinessCode || hasBusinessMessage) {
    return message || fallback;
  }
  // 兜底：服务器错误且无业务文案时给通用提示
  if (statusCode && statusCode >= 500) {
    return "服务器异常，请稍后重试";
  }
  return message || fallback;
}
