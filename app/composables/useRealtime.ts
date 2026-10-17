/**
 * useRealtime —— ik-server 实时通道（WebSocket `/v1/realtime`）的客户端。
 *
 * 协议见 ikserver-rs `docs/api-guidelines.md`「实时」：
 *   客户端 → { op: "subscribe" | "unsubscribe" | "ping" | "typing", seq?, t?, d? }
 *   服务端 → { op: "hello", d } / { op: "ack", seq } / { op: "event", t, d } / { op: "error", seq?, d }
 *
 * 设计要点：
 *  - 模块级单例：整个 SPA 共用一条连接（每个用户最多 5 条，多开标签页也够用）。
 *  - 同源：网页登录态靠会话 Cookie，握手自动带上；没登录时以游客连接，只收广播
 *    （新帖 / 顶帖）。在线人数按连接数统计，所以游客也保持连接。
 *  - 身份变化（登录、登出、换号）时重连，换成新的身份。
 *  - 断线按指数退避重连；按关闭码区分：4000 被同账号更新的连接挤掉、4001 会话失效 → 不重连
 *    （4001 交给 auth 退出登录，之后以游客重连）。
 *  - WS 不保证不丢事件：每次（重新）连上都广播 "open"，订阅方据此用 REST 补齐。
 */
import { computed, type ComputedRef, type Ref } from "vue";

const WS_PATH = "/v1/realtime";
/** 应用层 ping：服务端 30s 没收到任何帧会发 ping，60s 断开；25s 发一次足够保活。 */
const APP_PING_MS = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export interface RealtimeEvent<T = unknown> {
  /** 事件名，例如 `post.published`、`dm.message.created` */
  t: string;
  d: T;
}

type Handler = (event: RealtimeEvent<unknown>) => void;

let ws: WebSocket | null = null;
let started = false;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let seq = 0;
/** 当前订阅的频道（重连后自动重新订阅）：`${t}:${JSON.stringify(d)}` → frame 数据 */
const subscriptions = new Map<string, { t: string; d: Record<string, unknown> }>();
const listeners = new Map<string, Set<Handler>>();

/**
 * 重连在定时器里发生，已经脱离 Nuxt 的 setup 上下文，不能再调 useState / useRuntimeConfig；
 * start() 时把要用的东西取好存在这里。
 */
let ctx: {
  apiBaseUrl: string;
  realtimeUrl: string;
  connected: Ref<boolean>;
  userId: Ref<string | null>;
  auth: ReturnType<typeof useAuthStore>;
} | null = null;

const useConnectedState = () => useState<boolean>("realtime:connected", () => false);
const useUserIdState = () => useState<string | null>("realtime:userId", () => null);

function buildWsUrl(apiBaseUrl: string, realtimeUrl: string): string {
  if (realtimeUrl) return realtimeUrl;
  const trimmed = apiBaseUrl.replace(/\/+$/, "");
  if (!trimmed) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${WS_PATH}`;
  }
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice(8)}${WS_PATH}`;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice(7)}${WS_PATH}`;
  return `${trimmed}${WS_PATH}`;
}

function emit(type: string, event: RealtimeEvent<unknown>) {
  for (const key of [type, "*"]) {
    const set = listeners.get(key);
    if (!set) continue;
    for (const handler of set) {
      try {
        handler(event);
      } catch {
        // 单个订阅方抛错不影响其他订阅方
      }
    }
  }
}

function sendFrame(frame: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
}

function clearTimers() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function teardown() {
  if (!ws) return;
  const socket = ws;
  ws = null;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  try {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000);
    }
  } catch {
    // 已经关了
  }
}

function scheduleReconnect() {
  if (!started || reconnectTimer) return;
  reconnectAttempts += 1;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_MS);
  // 加一点抖动，避免服务端重启时所有客户端同一时刻涌回来。
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay * (0.75 + Math.random() * 0.5));
}

function connect() {
  if (!import.meta.client || !started || !ctx) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const { apiBaseUrl, realtimeUrl, connected, userId, auth } = ctx;

  let socket: WebSocket;
  try {
    socket = new WebSocket(buildWsUrl(apiBaseUrl, realtimeUrl));
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onmessage = (ev) => {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (frame.op === "hello") {
      const hello = (frame.d || {}) as { userId?: string | null };
      reconnectAttempts = 0;
      connected.value = true;
      userId.value = hello.userId ?? null;
      for (const sub of subscriptions.values()) {
        sendFrame({ op: "subscribe", t: sub.t, d: sub.d });
      }
      emit("open", { t: "open", d: hello });
      return;
    }
    if (frame.op === "event" && typeof frame.t === "string") {
      emit(frame.t, { t: frame.t, d: frame.d });
    }
  };

  socket.onopen = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => sendFrame({ op: "ping" }), APP_PING_MS);
  };

  socket.onerror = () => {
    // onclose 紧跟着会到，重连放在那里。
  };

  socket.onclose = (ev) => {
    if (ws !== socket) return;
    ws = null;
    connected.value = false;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    emit("close", { t: "close", d: { code: ev.code } });
    if (ev.code === 4000) {
      // 同一账号的连接太多，这条最旧的被挤掉：不要重连，否则会把别的标签页挤下去。
      started = false;
      return;
    }
    if (ev.code === 4001) {
      // 会话被吊销 / 过期 / 封禁：退出登录；身份变化的 watch 会以游客身份重新连上。
      if (auth.isLogin) auth.clearSession();
      else scheduleReconnect();
      return;
    }
    scheduleReconnect();
  };
}

function reconnectNow() {
  clearTimers();
  teardown();
  reconnectAttempts = 0;
  if (ctx) ctx.connected.value = false;
  if (!started && ctx) started = true;
  connect();
}

export function useRealtime() {
  const connected = useConnectedState();
  const userId = useUserIdState();

  /** 打开连接（幂等）。由 plugins/realtime.client.ts 在应用启动时调用。 */
  const start = () => {
    if (!import.meta.client || started) return;
    const config = useRuntimeConfig().public;
    ctx = {
      apiBaseUrl: String(config.apiBaseUrl || ""),
      realtimeUrl: String(config.realtimeUrl || ""),
      connected,
      userId,
      auth: useAuthStore(),
    };
    started = true;
    reconnectAttempts = 0;
    connect();
  };

  const stop = () => {
    started = false;
    clearTimers();
    teardown();
    connected.value = false;
  };

  /**
   * 订阅事件；type 为事件名，"*" 订阅全部，"open" 在每次（重新）连上时触发。
   * 返回取消订阅函数。
   */
  const on = <T = unknown>(type: string, handler: (event: RealtimeEvent<T>) => void): (() => void) => {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(handler as Handler);
    return () => {
      const current = listeners.get(type);
      if (!current) return;
      current.delete(handler as Handler);
      if (!current.size) listeners.delete(type);
    };
  };

  /** 订阅频道（目前只有公开帖子 `post`），重连后自动恢复；返回取消订阅函数。 */
  const subscribe = (t: string, d: Record<string, unknown>): (() => void) => {
    const key = `${t}:${JSON.stringify(d)}`;
    subscriptions.set(key, { t, d });
    sendFrame({ op: "subscribe", seq: ++seq, t, d });
    return () => {
      if (!subscriptions.delete(key)) return;
      sendFrame({ op: "unsubscribe", seq: ++seq, t, d });
    };
  };

  /** 私聊「正在输入」：服务端每条连接每秒最多处理 1 帧，节流由调用方控制。 */
  const sendTyping = (conversationId: string) => {
    if (!conversationId) return;
    sendFrame({ op: "typing", t: "dm", d: { conversationId } });
  };

  return {
    isConnected: computed(() => connected.value) as ComputedRef<boolean>,
    /** 服务端在 hello 里确认的当前身份（游客为 null） */
    userId: computed(() => userId.value) as ComputedRef<string | null>,
    start,
    stop,
    reconnect: reconnectNow,
    on,
    subscribe,
    sendTyping,
  };
}
