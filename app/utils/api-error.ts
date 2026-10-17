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
  // 表单校验失败：后端在 errors[] 里逐字段说明原因，比笼统的「请求参数不合法」有用。
  if (e.code === "VALIDATION_FAILED" && Array.isArray(e.details?.errors)) {
    const first = (e.details.errors as Array<{ detail?: unknown }>)[0];
    if (first && typeof first.detail === "string" && first.detail) return first.detail;
  }
  // 网络错误：无 statusCode 且命中网络错误特征
  if (!statusCode && NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
    return "网络异常，请稍后重试";
  }
  // 后端返回了具体的业务 code 或可读文案（Problem 的 code / detail，见 plugins/api.ts:toApiError）：
  // 优先展示后端文案（5xx 的 detail 也是给用户看的通用中文文案）。
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
