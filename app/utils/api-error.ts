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
  if (!statusCode && NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
    return "网络异常，请稍后重试";
  }
  if (statusCode && statusCode >= 500) {
    return "服务器异常，请稍后重试";
  }
  return message || fallback;
}
