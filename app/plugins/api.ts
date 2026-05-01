import {
  $fetch,
  type FetchContext,
  type FetchOptions,
  type FetchResponse,
} from "ofetch";
import type { ApiClientError } from "~/types/api";
import { shouldAttachToken } from "~/utils/request-auth";

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
const RENEW_ENDPOINT = "/api/auth/renew";
// Renew proactively when token has less than this many ms remaining
const RENEW_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
// Check interval for proactive renewal
const RENEW_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _renewPromise: Promise<string | null> | null = null;
let _renewTimer: ReturnType<typeof setInterval> | null = null;

function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isTokenNearExpiry(token: string): boolean {
  const exp = decodeJwtExp(token);
  if (!exp) return false;
  return exp - Date.now() < RENEW_THRESHOLD_MS;
}

function isTokenExpired(token: string): boolean {
  const exp = decodeJwtExp(token);
  if (!exp) return false;
  return Date.now() >= exp;
}

async function doRenewToken(baseURL: string): Promise<string | null> {
  const currentToken = localStorage.getItem(TOKEN_KEY);
  if (!currentToken) return null;

  try {
    const res = await $fetch<{ jwt?: string }>(RENEW_ENDPOINT, {
      baseURL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentToken}`,
      },
    });
    const newToken = res?.jwt;
    if (typeof newToken === "string" && newToken) {
      localStorage.setItem(TOKEN_KEY, newToken);
      return newToken;
    }
  } catch {
    // Renewal failed — token is invalid or server error
  }
  return null;
}

function renewToken(baseURL: string): Promise<string | null> {
  if (!_renewPromise) {
    _renewPromise = doRenewToken(baseURL).finally(() => {
      _renewPromise = null;
    });
  }
  return _renewPromise;
}

export default defineNuxtPlugin(() => {
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
        if (shouldAttachToken(path, method, token)) {
          options.headers = {
            ...options.headers,
            Authorization: `Bearer ${token}`,
          };
        }
      }
    },
    onResponseError(ctx: FetchContext & { response?: FetchResponse<unknown> }) {
      throw toApiError(ctx.response?.status, ctx.response?._data);
    },
  });

  // Wrapper that intercepts 401 for automatic token renewal + retry
  const api = (async (request: any, options?: any) => {
    try {
      return await baseApi(request, options);
    } catch (err: any) {
      if (
        import.meta.client &&
        err?.statusCode === 401 &&
        !String(request).includes(RENEW_ENDPOINT)
      ) {
        const currentToken = localStorage.getItem(TOKEN_KEY);
        if (currentToken) {
          const newToken = await renewToken(baseURL);
          if (newToken) {
            // Retry the original request with the fresh token
            return await baseApi(request, {
              ...options,
              headers: {
                ...(options?.headers || {}),
                Authorization: `Bearer ${newToken}`,
              },
            });
          }
          // Renewal failed — clear session and notify store
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem("user_id");
          window.dispatchEvent(new Event("auth:session-expired"));
        }
      }
      throw err;
    }
  }) as typeof $fetch;

  // Proactive token renewal timer (client-side only)
  if (import.meta.client) {
    const proactiveRenew = () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (token && isTokenNearExpiry(token) && !isTokenExpired(token)) {
        renewToken(baseURL);
      }
    };

    // Initial check after a short delay
    setTimeout(proactiveRenew, 5000);
    _renewTimer = setInterval(proactiveRenew, RENEW_CHECK_INTERVAL_MS);
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
