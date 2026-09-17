import { defineStore } from "pinia";
import { $fetch } from "ofetch";
import type { Author } from "~/types/entities";
import { isTokenExpired } from "~/utils/request-auth";
import { LOGOUT_KEY, SESSION_HINT_KEY, staleAuthError, withAuthCookieLock } from "~/utils/auth-session";

const TOKEN_KEY = "access_token";
const USER_ID_KEY = "user_id";
let hydration = new WeakMap<object, Promise<void>>();
const renewals = new WeakMap<object, { generation: number; promise: Promise<string | null> }>();

export function _resetHydratedForTest() {
  hydration = new WeakMap();
}

function persistUserId(user: Author | null) {
  if (!import.meta.client || !user) return;
  const id = user.authorId || user.documentId;
  if (id) {
    localStorage.setItem(USER_ID_KEY, String(id));
  }
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    token: "" as string,
    user: null as Author | null,
    generation: 0,
    hydrationReady: false,
  }),
  getters: {
    isLogin: (state) => !!state.token,
    /** 已登录但还没通过入站考试（管理员 / AI 账号豁免） */
    needExam: (state): boolean =>
      !!state.token &&
      !!state.user &&
      state.user.examPassed === false &&
      !state.user.isAdmin &&
      !state.user.isAiAgent,
    profilePath: (state): string | null => {
      const id = state.user?.authorId || state.user?.documentId;
      return id ? `/profile/${id}` : null;
    },
  },
  actions: {
    hydrate() {
      return this.hydrateFromStorage();
    },
    hydrateFromStorage(): Promise<void> {
      if (!import.meta.client) return Promise.resolve();
      const existing = hydration.get(this);
      if (existing) return existing;
      const generation = this.generation;
      const pending = (async () => {
        try {
          if (localStorage.getItem(LOGOUT_KEY)) {
            if (localStorage.getItem(LOGOUT_KEY) === "pending") await this.logout();
            return;
          }
          const storedToken = localStorage.getItem(TOKEN_KEY) || "";
          if (storedToken && !isTokenExpired(storedToken)) {
            this.token = storedToken;
            localStorage.setItem(SESSION_HINT_KEY, "1");
          } else if (storedToken || localStorage.getItem(SESSION_HINT_KEY)) {
            // A fresh visitor has no session to restore; do not probe the refresh endpoint.
            await this.renewToken();
          }
          if (this.generation === generation && this.token) await this.fetchSelfUser();
        } finally {
          this.hydrationReady = true;
        }
      })();
      hydration.set(this, pending);
      return pending;
    },
    renewToken(): Promise<string | null> {
      const generation = this.generation;
      const existing = renewals.get(this);
      if (existing?.generation === generation) return existing.promise;
      const config = useRuntimeConfig();
      const pending = withAuthCookieLock(async () => {
        if (this.generation !== generation || localStorage.getItem(LOGOUT_KEY)) return null;
        if (!this.token && !localStorage.getItem(TOKEN_KEY) && !localStorage.getItem(SESSION_HINT_KEY)) return null;
        const result = await $fetch<{ accessToken?: string; jwt?: string }>("/api/auth/session/refresh", {
          baseURL: config.public.apiBaseUrl, method: "POST", credentials: "include", retry: 0,
        });
        if (this.generation !== generation || localStorage.getItem(LOGOUT_KEY)) return null;
        const token = result.accessToken || result.jwt;
        if (typeof token !== "string" || !token) throw new Error("刷新登录响应无效");
        this.token = token;
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(SESSION_HINT_KEY, "1");
        return token;
      }).catch((err) => {
        if (this.generation === generation && (err?.statusCode === 401 || err?.statusCode === 403)) {
          this.clearSession();
        }
        return null;
      }).finally(() => {
        if (renewals.get(this)?.promise === pending) renewals.delete(this);
      });
      renewals.set(this, { generation, promise: pending });
      return pending;
    },
    async fetchSelfUser() {
      const generation = this.generation;
      try {
        const user = await useApi().getSelfUser();
        if (this.generation !== generation) return;
        this.user = user;
        persistUserId(user);
      } catch (err: any) {
        if (this.generation === generation && err?.statusCode === 401) this.clearSession();
      }
    },
    setSession(token: string, user: Author) {
      this.clearSession();
      this.token = token;
      this.user = user;
      if (import.meta.client) {
        localStorage.removeItem(LOGOUT_KEY);
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(SESSION_HINT_KEY, "1");
        persistUserId(user);
        // 登录后通知首页刷新委托列表，使已读状态正确合并
        window.dispatchEvent(new CustomEvent("ik:home-refresh"));
      }
    },
    async logout() {
      // Explicit logout survives reload even when the server cannot be reached.
      if (import.meta.client) localStorage.setItem(LOGOUT_KEY, "pending");
      this.clearSession();
      const generation = this.generation;
      if (!import.meta.client) return true;
      const config = useRuntimeConfig();
      try {
        await withAuthCookieLock(async () => {
          if (this.generation !== generation) throw staleAuthError();
          await $fetch("/api/auth/session/logout", {
            baseURL: config.public.apiBaseUrl, method: "POST", credentials: "include", retry: 0,
          });
        });
        if (this.generation === generation) localStorage.setItem(LOGOUT_KEY, "1");
        return true;
      } catch {
        return false;
      }
    },
    clearSession() {
      this.generation += 1;
      this.token = "";
      this.user = null;
      if (import.meta.client) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_ID_KEY);
        localStorage.removeItem(SESSION_HINT_KEY);
        // 登出/会话过期：清空查询缓存，避免上一用户的 liked/isRead 等残留到新登录
        try {
          const api = useApi();
          api.clearAllCache();
        } catch {
          // useApi 依赖 Nuxt 上下文，极端情况下可能不可用，忽略
        }
        // 通知其它模块（如敲敲 composable）一并清理本地状态 / 断开 SSE
        try {
          window.dispatchEvent(new CustomEvent("auth:logout"));
        } catch {
          // 老浏览器对 CustomEvent 的兼容已经不需要考虑
        }
      }
    },
    /**
     * 乐观更新用户部分字段（如签到后的绳网信用/等级/丁尼）
     */
    updateUserPartial(updates: Partial<Author>) {
      if (this.user) {
        this.user = { ...this.user, ...updates };
      }
    },
  },
});
