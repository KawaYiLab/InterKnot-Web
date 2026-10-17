/**
 * usePresence —— 在线人数（模块级单例）。
 *
 * 在线人数由服务端按实时连接（/v1/realtime）统计，本页面自己的连接由
 * plugins/realtime.client.ts 维持；这里只定时读 GET /v1/presence 展示人数与头像堆叠。
 * 页面隐藏时停止轮询，可见时立即恢复。无需登录。
 */
import { computed } from "vue";

const POLL_INTERVAL_MS = 30_000;

interface PresenceResponse {
  online: number;
  users?: Array<{ id: string; username: string; avatarUrl: string }>;
}

interface PresenceState {
  online: ReturnType<typeof useState<number>>;
  avatars: ReturnType<typeof useState<string[]>>;
}

let started = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const doPoll = async (state: PresenceState): Promise<void> => {
  try {
    const { $api } = useNuxtApp();
    const resp = await $api<PresenceResponse>("/v1/presence");
    if (typeof resp?.online === "number") state.online.value = resp.online;
    if (Array.isArray(resp?.users)) {
      state.avatars.value = resp.users
        .map((u) => u.avatarUrl)
        .filter((u): u is string => typeof u === "string" && !!u);
    }
  } catch {
    /* fail-open */
  }
};

const onVisibility = (state: PresenceState) => {
  if (document.visibilityState === "hidden") {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } else {
    void doPoll(state);
    if (!pollTimer) {
      pollTimer = setInterval(() => void doPoll(state), POLL_INTERVAL_MS);
    }
  }
};

let visibilityHandler: (() => void) | null = null;

export function usePresence() {
  const online = useState<number>("presence:online", () => 0);
  const avatars = useState<string[]>("presence:avatars", () => []);
  const state: PresenceState = { online, avatars };

  const start = () => {
    if (!import.meta.client) return;
    if (started) return;
    started = true;

    // 等实时连接建好再读第一次，自己这条连接才算在内。
    setTimeout(() => void doPoll(state), 1_500);
    pollTimer = setInterval(() => void doPoll(state), POLL_INTERVAL_MS);

    visibilityHandler = () => onVisibility(state);
    document.addEventListener("visibilitychange", visibilityHandler);
  };

  const stop = () => {
    started = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (visibilityHandler) {
      document.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = null;
    }
  };

  return {
    online: computed(() => online.value),
    avatars: computed(() => avatars.value),
    start,
    stop,
  };
}
