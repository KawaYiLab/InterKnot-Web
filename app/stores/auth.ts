import { defineStore } from "pinia";
import type { Author } from "~/types/entities";

const TOKEN_KEY = "access_token";
const USER_ID_KEY = "user_id";

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
  }),
  getters: {
    isLogin: (state) => !!state.token,
    profilePath: (state): string | null => {
      const id = state.user?.authorId || state.user?.documentId;
      return id ? `/profile/${id}` : null;
    },
  },
  actions: {
    hydrateFromStorage() {
      if (!import.meta.client) return;
      this.token = localStorage.getItem(TOKEN_KEY) || "";
      if (this.token) {
        this.fetchSelfUser();
      }
      // Listen for session expiry events from the API plugin
      window.addEventListener("auth:session-expired", () => {
        this.clearSession();
      });
    },
    async fetchSelfUser() {
      try {
        const api = useApi();
        const user = await api.getSelfUser();
        this.user = user;
        persistUserId(user);
      } catch {
        this.clearSession();
      }
    },
    setSession(token: string, user: Author) {
      this.token = token;
      this.user = user;
      if (import.meta.client) {
        localStorage.setItem(TOKEN_KEY, token);
        persistUserId(user);
      }
    },
    clearSession() {
      this.token = "";
      this.user = null;
      if (import.meta.client) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_ID_KEY);
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
  },
});
