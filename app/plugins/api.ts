import {
  $fetch,
  type FetchContext,
  type FetchResponse,
} from "ofetch";
import type { ApiClientError } from "~/types/api";
import { useHomeStateCache } from "~/composables/useHomeStateCache";
import { SESSION_HINT_KEY, staleAuthError } from "~/utils/auth-session";

/**
 * 把后端的 RFC 9457 Problem（`{ type, title, status, detail, code, errors, requestId }`）
 * 转成前端统一的 ApiClientError。`detail` 是给用户看的中文文案，`code` 是稳定的英文错误码。
 */
export function toApiError(
  statusCode: number | undefined,
  data: unknown,
  headers?: Headers,
): ApiClientError {
  const error = new Error("请求失败") as ApiClientError;
  error.statusCode = statusCode;

  if (data && typeof data === "object") {
    const problem = data as Record<string, unknown>;
    if (typeof problem.detail === "string" && problem.detail) {
      error.message = problem.detail;
    }
    if (typeof problem.code === "string") {
      error.code = problem.code;
    }
    const details: Record<string, unknown> = {};
    if (Array.isArray(problem.errors)) details.errors = problem.errors;
    if (typeof problem.requestId === "string") details.requestId = problem.requestId;
    const retryAfter = Number(headers?.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) details.retryAfter = retryAfter;
    if (Object.keys(details).length) error.details = details;
  }

  return error;
}

export default defineNuxtPlugin(() => {
  const auth = useAuthStore();
  const config = useRuntimeConfig();
  // 网页与接口同源（nginx 把 /v1 反代到 ik-server，见 ikserver-rs ADR 0002），
  // 会话靠 HttpOnly Cookie，不再在前端保存令牌。apiBaseUrl 只在本地联调别的地址时设置。
  const baseURL = String(config.public.apiBaseUrl || "").replace(/\/+$/, "");

  const baseApi = $fetch.create({
    baseURL,
    credentials: "include",
    retry: 0,
    headers: {
      "Content-Type": "application/json",
    },
    onResponseError(ctx: FetchContext & { response?: FetchResponse<unknown> }) {
      throw toApiError(ctx.response?.status, ctx.response?._data, ctx.response?.headers);
    },
  });

  // 包一层：登录身份在请求途中切换（登出 / 另一个标签页换号）时丢弃结果，避免串号。
  const api = (async (request: Parameters<typeof $fetch>[0], options?: Parameters<typeof $fetch>[1]) => {
    const generation = auth.generation;
    try {
      const result = await baseApi(request, options);
      if (auth.generation !== generation) throw staleAuthError();
      return result;
    } catch (err: unknown) {
      if (auth.generation !== generation) throw staleAuthError();
      const apiErr = err as ApiClientError;
      // 未通过入站考试的写操作被后端拒绝：广播事件，由 app.vue 引导去 /exam
      if (import.meta.client && apiErr?.statusCode === 403 && apiErr?.code === "EXAM_REQUIRED") {
        window.dispatchEvent(new Event("exam:required"));
      }
      // 会话过期 / 被吊销：本地也退出登录。登录接口本身的 401（密码错误）不算。
      if (
        import.meta.client &&
        apiErr?.statusCode === 401 &&
        auth.isLogin &&
        !String(request).startsWith("/v1/auth/")
      ) {
        auth.clearSession();
      }
      throw err;
    }
  }) as typeof $fetch;

  if (import.meta.client) {
    // 其他标签页登录 / 登出 / 换号：会话 Cookie 是共享的，这里跟着刷新身份。
    window.addEventListener("storage", (event) => {
      if (event.key !== SESSION_HINT_KEY || (event.storageArea && event.storageArea !== localStorage)) return;
      const hint = localStorage.getItem(SESSION_HINT_KEY) || "";
      const currentId = auth.user?.id ? String(auth.user.id) : "";
      if (hint && hint === currentId) return;
      auth.generation += 1;
      auth.user = null;
      auth.loggedIn = false;
      useApi().clearAllCache();
      useHomeStateCache().reset();
      window.dispatchEvent(new CustomEvent("auth:logout"));
      if (hint) void auth.restoreSession();
    });
  }

  return {
    provide: {
      api,
    },
  };
});

declare module "#app" {
  interface NuxtApp {
    $api: typeof $fetch;
  }
}

declare module "vue" {
  interface ComponentCustomProperties {
    $api: typeof $fetch;
  }
}
