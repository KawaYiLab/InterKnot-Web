/**
 * usePresence —— 在线人数心跳与轮询（模块级单例）。
 *
 * - 生成并持久化随机 presenceId（localStorage），用于匿名访客去重。
 * - 定时 POST /api/presence/ping 上报心跳，用返回值更新在线人数与头像堆叠。
 * - 页面隐藏时停止心跳，可见时立即恢复。
 * - 无需登录即可运行。
 */
import { computed } from "vue";

const PING_PATH = "/api/presence/ping";
const PING_INTERVAL_MS = 20_000;
const STORAGE_KEY = "presence:id";

interface PingResponse {
  data: { online: number; avatars?: string[] };
}

interface PresenceState {
  online: ReturnType<typeof useState<number>>;
  avatars: ReturnType<typeof useState<string[]>>;
}

let started = false;
let pingTimer: ReturnType<typeof setInterval> | null = null;

const getPresenceId = (): string => {
  if (!import.meta.client) return "";
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
};

const doPing = async (state: PresenceState): Promise<void> => {
  try {
    const { $api } = useNuxtApp();
    const presenceId = getPresenceId();
    const resp = await $api<PingResponse>(PING_PATH, {
      method: "POST",
      body: { presenceId },
    });
    const n = resp?.data?.online;
    if (typeof n === "number") state.online.value = n;
    const avatars = resp?.data?.avatars;
    if (Array.isArray(avatars)) {
      state.avatars.value = avatars.filter((u): u is string => typeof u === "string");
    }
  } catch {
    /* fail-open */
  }
};

const onVisibility = (state: PresenceState) => {
  if (document.visibilityState === "hidden") {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  } else {
    void doPing(state);
    if (!pingTimer) {
      pingTimer = setInterval(() => void doPing(state), PING_INTERVAL_MS);
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

    void doPing(state);
    pingTimer = setInterval(() => void doPing(state), PING_INTERVAL_MS);

    visibilityHandler = () => onVisibility(state);
    document.addEventListener("visibilitychange", visibilityHandler);
  };

  const stop = () => {
    started = false;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
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
