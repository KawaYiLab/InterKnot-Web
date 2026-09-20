import {
  $fetch,
  type FetchContext,
  type FetchOptions,
  type FetchResponse,
} from "ofetch";
import type { ApiClientError } from "~/types/api";
import { useHomeStateCache } from "~/composables/useHomeStateCache";
import {
  isTokenNearExpiry,
  isSameAuthSession,
  shouldAttachToken,
} from "~/utils/request-auth";
import { LOGOUT_KEY, SESSION_HINT_KEY, staleAuthError, withAuthCookieLock } from "~/utils/auth-session";

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
        // Match the identity captured by the request wrapper. A queued storage
        // event must not silently attach another tab's newer account token.
        const token = auth.token;
        const path = request;
        const method = (options.method || "GET").toUpperCase();
        // /api/articles/list、/api/articles/search 默认公开（匿名请求不带 token，
        // 走共享缓存）。但登录用户需要带 token，让后端为当前用户内联 isRead 等
        // 个性化字段；带 token 的请求也会绕过公开缓存（cacheAuthorizedRequests:false），
        // 匿名请求仍可命中共享缓存。
        // 发送与 401 续期共用同一判定，避免列表带了过期 token 却不重试。
        if (shouldAttachToken(path, method, token)) {
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
  const api = (async (request: Parameters<typeof $fetch>[0], options?: Parameters<typeof $fetch>[1]) => {
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
    } catch (err: unknown) {
      if (auth.generation !== generation) throw staleAuthError();
      const apiErr = err as ApiClientError;
      // 未通过入站考试的写操作被后端拒绝：广播事件，由 app.vue 引导去 /exam
      if (import.meta.client && apiErr?.statusCode === 403 && apiErr?.code === "EXAM_REQUIRED") {
        window.dispatchEvent(new Event("exam:required"));
      }
      if (
        import.meta.client &&
        apiErr?.statusCode === 401 &&
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
      if (localStorage.getItem(LOGOUT_KEY)) return;
      const token = auth.token || localStorage.getItem(TOKEN_KEY);
      if (auth.credentialRecoveryPending || (!auth.token && (token || localStorage.getItem(SESSION_HINT_KEY)))) {
        void auth.hydrateFromStorage();
        return;
      }
      if (token && isTokenNearExpiry(token, RENEW_THRESHOLD_MS)) {
        void auth.renewToken();
      }
    };

    // Initial check after a short delay
    setTimeout(proactiveRenew, 5000);
    setInterval(proactiveRenew, RENEW_CHECK_INTERVAL_MS);
    window.addEventListener("online", () => {
      if (!auth.isLogin && localStorage.getItem(LOGOUT_KEY) === "pending") void auth.logout();
      else proactiveRenew();
    });
    window.addEventListener("storage", (event) => {
      if (event.key === TOKEN_KEY && (!event.storageArea || event.storageArea === localStorage)) {
        // Other tabs may have completed several writes before this queued event.
        const token = localStorage.getItem(TOKEN_KEY) || "";
        if (token === auth.token) return;
        if (isSameAuthSession(auth.token, token) && !auth.credentialRecoveryPending) {
          auth.token = token;
          return;
        }
        // Invalidate pending requests before hydrating the other tab's login.
        auth.generation += 1;
        auth.user = null;
        auth.token = token;
        auth.credentialsReady = true;
        auth.credentialRecoveryPending = false;
        useApi().clearAllCache();
        useHomeStateCache().reset();
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
