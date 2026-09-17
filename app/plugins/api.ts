import {
  $fetch,
  type FetchContext,
  type FetchOptions,
  type FetchResponse,
} from "ofetch";
import type { ApiClientError } from "~/types/api";
import {
  isTokenNearExpiry,
  shouldAttachToken,
} from "~/utils/request-auth";
import { LOGOUT_KEY, staleAuthError, withAuthCookieLock } from "~/utils/auth-session";

function toApiError(statusCode: number | undefined, data: unknown): ApiClientError {
  const error = new Error("请求失败") as ApiClientError;
  error.statusCode = statusCode;

  if (data && typeof data === "object") {
    const typed = data as Record<string, unknown>;
    const bodyError = typed.error as Record<string, unknown> | undefined;
    if (bodyError) {
      if (typeof bodyError.message === "string") {
        error.message = bodyError.message;
      }
      if (typeof bodyError.code === "string") {
        error.code = bodyError.code;
      }
      if (bodyError.details && typeof bodyError.details === "object") {
        error.details = bodyError.details as Record<string, unknown>;
      }
    }
  }

  return error;
}

// ── Token renewal helpers ──────────────────────────
const TOKEN_KEY = "access_token";
const RENEW_ENDPOINT = "/api/auth/session/refresh";
// Renew proactively when token has less than this many ms remaining
const RENEW_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes (V2 access tokens expire in 15 minutes)
// Check interval for proactive renewal
const RENEW_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

export default defineNuxtPlugin(() => {
  const auth = useAuthStore();
  const config = useRuntimeConfig();
  const baseURL = config.public.apiBaseUrl;

  // Preconnect to API domain to speed up first request
  if (import.meta.client && baseURL) {
    try {
      const origin = new URL(baseURL).origin;
      if (!document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = origin;
        document.head.appendChild(link);
      }
    } catch { /* invalid URL, skip */ }
  }

  const baseApi = $fetch.create({
    baseURL,
    credentials: "include",
    retry: 0,
    headers: {
      "Content-Type": "application/json",
    },
    onRequest(ctx: FetchContext) {
      const options = ctx.options as FetchOptions;
      const request = String(ctx.request);
      if (import.meta.client) {
        const token = localStorage.getItem(TOKEN_KEY) || "";
        const path = request;
        const method = (options.method || "GET").toUpperCase();
        // /api/articles/list、/api/articles/search 默认公开（匿名请求不带 token，
        // 走共享缓存）。但登录用户需要带 token，让后端为当前用户内联 isRead 等
        // 个性化字段；带 token 的请求也会绕过公开缓存（cacheAuthorizedRequests:false），
        // 匿名请求仍可命中共享缓存。
        const articleFeed =
          path.startsWith("/api/articles/list") ||
          path.startsWith("/api/articles/search");
        if (
          shouldAttachToken(path, method, token) ||
          (Boolean(token) && articleFeed)
        ) {
          const headers = new Headers(options.headers as HeadersInit);
          headers.set("Authorization", `Bearer ${token}`);
          options.headers = headers;
        }
      }
    },
    onResponseError(ctx: FetchContext & { response?: FetchResponse<unknown> }) {
      throw toApiError(ctx.response?.status, ctx.response?._data);
    },
  });

  // Wrapper that intercepts 401 for automatic token renewal + retry
  const api = (async (request: any, options?: any) => {
    const generation = auth.generation;
    const requestToken = auth.token;
    const cookieMutation = (String(request).startsWith("/api/auth/") && options?.method !== undefined) ||
      String(request) === "/api/me/delete-account";
    const perform = async () => {
      if (auth.generation !== generation) throw staleAuthError();
      const result = await baseApi(request, options);
      if (auth.generation !== generation) throw staleAuthError();
      return result;
    };
    try {
      return await (cookieMutation ? withAuthCookieLock(perform) : perform());
    } catch (err: any) {
      if (auth.generation !== generation) throw staleAuthError();
      // 未通过入站考试的写操作被后端拒绝：广播事件，由 app.vue 引导去 /exam
      if (import.meta.client && err?.statusCode === 403 && err?.code === "EXAM_REQUIRED") {
        window.dispatchEvent(new Event("exam:required"));
      }
      if (
        import.meta.client &&
        err?.statusCode === 401 &&
        !String(request).includes(RENEW_ENDPOINT) &&
        !String(request).includes("/api/auth/session/logout")
      ) {
        if (requestToken && shouldAttachToken(String(request), (options?.method || "GET").toUpperCase(), requestToken)) {
          const newToken = auth.token !== requestToken ? auth.token : await auth.renewToken();
          if (auth.generation !== generation) throw staleAuthError();
          if (newToken) return await (cookieMutation ? withAuthCookieLock(perform) : perform());
        }
      }
      throw err;
    }
  }) as typeof $fetch;

  // Proactive token renewal timer (client-side only)
  if (import.meta.client) {
    const proactiveRenew = () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (token && isTokenNearExpiry(token, RENEW_THRESHOLD_MS)) {
        void auth.renewToken();
      }
    };

    // Initial check after a short delay
    setTimeout(proactiveRenew, 5000);
    setInterval(proactiveRenew, RENEW_CHECK_INTERVAL_MS);
    window.addEventListener("online", () => {
      if (!auth.isLogin && localStorage.getItem(LOGOUT_KEY) === "pending") void auth.logout();
    });
    window.addEventListener("storage", (event) => {
      if (event.key === TOKEN_KEY && event.newValue !== auth.token) {
        // Invalidate pending requests before hydrating the other tab's login.
        auth.generation += 1;
        auth.user = null;
        auth.token = event.newValue || "";
        window.dispatchEvent(new CustomEvent("auth:logout"));
        if (auth.token) void auth.fetchSelfUser();
      }
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
