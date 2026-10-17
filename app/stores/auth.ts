import { defineStore } from "pinia";
import { $fetch } from "ofetch";
import type { Author } from "~/types/entities";
import { useHomeStateCache } from "~/composables/useHomeStateCache";
import { LOGOUT_KEY, SESSION_HINT_KEY } from "~/utils/auth-session";

// 会话是 HttpOnly Cookie（ik_session），前端读不到也不保存令牌。
// localStorage 里只留一个提示：上次登录的用户 id。有提示时启动才去问 /v1/me，
// 游客打开页面不会白发一个 401；另一个标签页换号时也靠它的变化来同步身份。
const USER_ID_KEY = "user_id";
let restoring = new WeakMap<object, { generation: number; promise: Promise<void> }>();
const profileLoads = new WeakMap<object, Set<{ generation: number; updates: Partial<Author> }>>();

export function _resetHydratedForTest() {
  restoring = new WeakMap();
}

function resetPersonalizedCache() {
  if (!import.meta.client) return;
  useHomeStateCache().reset();
  try {
    useApi().clearAllCache();
  } catch {
    // The store can also be reset before Nuxt has installed the API plugin.
  }
}

function persistUserId(user: Author | null) {
  if (!import.meta.client || !user?.id) return;
  const id = String(user.id);
  localStorage.setItem(USER_ID_KEY, id);
  localStorage.setItem(SESSION_HINT_KEY, id);
}

/** 上次登录留下的提示：有就先按已登录渲染（页面在 setup 里同步判断登录态），/v1/me 再确认。 */
function hasSessionHint(): boolean {
  if (!import.meta.client) return false;
  try {
    return !!localStorage.getItem(SESSION_HINT_KEY) && localStorage.getItem(LOGOUT_KEY) !== "pending";
  } catch {
    return false;
  }
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    loggedIn: hasSessionHint(),
    user: null as Author | null,
    generation: 0,
    hydrationReady: false,
    credentialsReady: false,
  }),
  getters: {
    isLogin: (state) => state.loggedIn,
    /** 已登录但还没通过入站考试（管理员 / AI 账号豁免） */
    needExam: (state): boolean =>
      state.loggedIn &&
      !!state.user &&
      state.user.examPassed === false &&
      !state.user.isAdmin &&
      !state.user.isAiAgent,
    profilePath: (state): string | null => {
      const id = state.user?.id;
      return id ? `/profile/${id}` : null;
    },
  },
  actions: {
    hydrate() {
      return this.restoreSession();
    },
    hydrateFromStorage() {
      return this.restoreSession();
    },
    /**
     * 有登录提示时用 Cookie 恢复会话（提示让 loggedIn 一开始就是 true，这里拉资料确认；
     * Cookie 已失效时 /v1/me 回 401，clearSession 退回游客）。没有提示就是游客，直接就绪。
     */
    restoreSession(): Promise<void> {
      if (!import.meta.client) return Promise.resolve();
      const existing = restoring.get(this);
      if (existing?.generation === this.generation) return existing.promise;
      const generation = this.generation;
      const pending = (async () => {
        try {
          if (localStorage.getItem(LOGOUT_KEY) === "pending") {
            await this.logout();
            return;
          }
          if (!localStorage.getItem(SESSION_HINT_KEY)) return;
          await this.fetchSelfUser({ restoring: true });
        } catch {
          // 网络抖动：保持游客态，下次请求或刷新再试，不在启动时抛未处理的异常。
        } finally {
          if (this.generation === generation) {
            this.hydrationReady = true;
            this.credentialsReady = true;
          }
        }
      })().finally(() => {
        if (restoring.get(this)?.promise === pending) restoring.delete(this);
      });
      restoring.set(this, { generation, promise: pending });
      return pending;
    },
    /** 等会话恢复完（信息流等个性化请求要在这之后发，才能带上已读等字段）。 */
    async ensureCredentials(): Promise<number> {
      if (import.meta.client && !this.credentialsReady) await this.restoreSession();
      return this.generation;
    },
    async fetchSelfUser(opts?: { restoring?: boolean }) {
      const generation = this.generation;
      const load = { generation, updates: {} as Partial<Author> };
      const loads = profileLoads.get(this) ?? new Set<typeof load>();
      profileLoads.set(this, loads);
      loads.add(load);
      try {
        const api = useApi();
        const user = await api.getSelfUser();
        if (this.generation !== generation) return;
        // 请求开始后的签到/投币等更新比返回的资料快照更新，不能被覆盖。
        this.user = { ...user, ...load.updates };
        // 恢复会话不换代、不清缓存：Cookie 每个请求都带着，恢复前发出的请求服务端
        // 本来就是按这个账号处理的，结果可以直接用（清掉反而会让在途请求报 CancelledError）。
        this.loggedIn = true;
        if (Object.keys(load.updates).length) api.patchSelfUserCache(load.updates);
        persistUserId(this.user);
      } catch (err) {
        const apiErr = err as { statusCode?: number };
        if (this.generation === generation && apiErr?.statusCode === 401) this.clearSession();
        else if (opts?.restoring) throw err;
      } finally {
        loads.delete(load);
        if (!loads.size && profileLoads.get(this) === loads) profileLoads.delete(this);
      }
    },
    /** 登录 / 注册成功：服务端已经种下会话 Cookie，这里只记下身份。 */
    setSession(user: Author) {
      this.clearSession();
      this.loggedIn = true;
      this.user = user;
      this.credentialsReady = true;
      this.hydrationReady = true;
      if (import.meta.client) {
        localStorage.removeItem(LOGOUT_KEY);
        persistUserId(user);
      }
    },
    async logout() {
      // Explicit logout survives reload even when the server cannot be reached.
      if (import.meta.client) localStorage.setItem(LOGOUT_KEY, "pending");
      this.clearSession();
      if (!import.meta.client) return true;
      const config = useRuntimeConfig();
      const generation = this.generation;
      try {
        await $fetch("/v1/auth/logout", {
          baseURL: String(config.public.apiBaseUrl || "").replace(/\/+$/, ""),
          method: "POST",
          credentials: "include",
          retry: 0,
        });
        if (this.generation === generation) localStorage.setItem(LOGOUT_KEY, "1");
        return true;
      } catch (err) {
        // 401：会话本来就失效了，也算退出成功。
        if ((err as { statusCode?: number })?.statusCode === 401) {
          localStorage.setItem(LOGOUT_KEY, "1");
          return true;
        }
        return false;
      }
    },
    clearSession() {
      this.generation += 1;
      this.loggedIn = false;
      this.user = null;
      this.credentialsReady = true;
      if (import.meta.client) {
        localStorage.removeItem(USER_ID_KEY);
        localStorage.removeItem(SESSION_HINT_KEY);
        // 旧版（JWT）残留的令牌没有用了，一并清掉。
        localStorage.removeItem("access_token");
        resetPersonalizedCache();
        // 通知其它模块（如敲敲 composable）一并清理本地状态 / 断开实时连接
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
      for (const load of profileLoads.get(this) ?? []) {
        if (load.generation === this.generation) Object.assign(load.updates, updates);
      }
      if (this.user) {
        this.user = { ...this.user, ...updates };
        if (import.meta.client) {
          try {
            useApi().patchSelfUserCache(updates);
          } catch {
            // The store may also be used before the API plugin is installed.
          }
        }
      }
    },
  },
});
