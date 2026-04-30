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
        this.token = "";
        this.user = null;
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
      }
    },
  },
});
