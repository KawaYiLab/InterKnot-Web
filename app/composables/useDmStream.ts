/**
 * useDmStream —— DM 私聊 WebSocket 客户端（与 SSE 的敲敲通知通道完全独立）。
 *
 * 设计要点：
 *  - 模块级单例：整个 SPA 共用一条 WS 连接；多个 composable 订阅事件互不冲突。
 *  - Ticket 鉴权：连接前先调 `POST /api/dm/socket/ticket` 拿 30s 一次性 ticket，
 *    再用 `wss://.../dm/socket?ticket=xxx` 升级 WebSocket。Token 永远不上 URL。
 *  - 重连退避：意外断开按指数退避重连，连续 6 次失败放弃（避免封禁账号死循环）。
 *  - 应用层心跳：每 20s 主动 send `{type:'ping'}`；服务端会回 pong（同时 ws 库
 *    自动响应 WS 控制帧 ping，双重保险）。
 *  - 事件分发：on(type, handler) 注册回调，返回 unsubscribe；同 type 多订阅。
 *
 * 这个 composable 只关心传输层（连接 / 重连 / 收发）。具体业务（patch 列表 /
 * 写入消息缓存）由 useDmConversations 订阅本 composable 的事件来完成。
 */
import { computed, type ComputedRef } from "vue";
import type { DmWsEvent, DmWsEventType } from "~/types/entities";

const TOKEN_KEY = "access_token";
const WS_PATH = "/dm/socket";
const TICKET_PATH = "/api/dm/socket/ticket";

/** 应用层 ping 间隔；不要短于 ws-server 的 HEARTBEAT_MS（25s）以避免双向重复 */
const APP_PING_MS = 20_000;

/** 重连退避基数（ms）：1s → 2s → 4s → 8s → 16s → 32s（上限） */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 32_000;
const RECONNECT_MAX_ATTEMPTS = 6;

interface TicketResponse {
  data: { ticket: string; ttlSec: number };
}

type AnyHandler = (event: DmWsEvent<unknown>) => void;

// ──────────────────────────────────────────────────────
// 模块级单例：跨多个 useDmStream() 调用共享。
// ──────────────────────────────────────────────────────
let ws: WebSocket | null = null;
let started = false;
let connectInFlight = false;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let manualStop = false;

// 事件订阅：Map<type, Set<handler>>，"*" 表示订阅所有事件
const listeners = new Map<string, Set<AnyHandler>>();

/** 当前连接状态——用 useState 让组件可响应式订阅 */
const useDmStreamConnected = () =>
  useState<boolean>("dm:wsConnected", () => false);

/**
 * 把 apiBaseUrl 转成 WebSocket origin。
 *  - apiBaseUrl = "" → 与当前页面同源
 *  - apiBaseUrl = "https://api.x.com" → wss://api.x.com
 *  - apiBaseUrl = "http://localhost:1337" → ws://localhost:1337
 */
const buildWsUrl = (apiBaseUrl: string, ticket: string): string => {
  const trimmed = apiBaseUrl.replace(/\/+$/, "");
  let origin: string;
  if (!trimmed) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    origin = `${proto}//${window.location.host}`;
  } else if (trimmed.startsWith("https://")) {
    origin = `wss://${trimmed.slice("https://".length)}`;
  } else if (trimmed.startsWith("http://")) {
    origin = `ws://${trimmed.slice("http://".length)}`;
  } else {
    // 已经是 ws:// / wss:// 的兜底
    origin = trimmed;
  }
  return `${origin}${WS_PATH}?ticket=${encodeURIComponent(ticket)}`;
};

const emit = (event: DmWsEvent<unknown>) => {
  const exact = listeners.get(event.type);
  if (exact) {
    for (const h of exact) {
      try { h(event); } catch { /* 防止单个 handler 抛错影响其它订阅 */ }
    }
  }
  const wildcard = listeners.get("*");
  if (wildcard) {
    for (const h of wildcard) {
      try { h(event); } catch { /* noop */ }
    }
  }
};

const clearTimers = () => {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
};

const teardownSocket = () => {
  if (!ws) return;
  try {
    ws.onopen = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.onmessage = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  } catch { /* noop */ }
  ws = null;
};

const scheduleReconnect = (connected: ReturnType<typeof useDmStreamConnected>) => {
  if (manualStop) return;
  if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
    // 放弃重连：通常意味着账号被封 / 后端 WS 端口不可达；不再骚扰后端
    started = false;
    return;
  }
  reconnectAttempts += 1;
  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1),
    RECONNECT_MAX_MS,
  );
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void doConnect(connected);
  }, delay);
};

const doConnect = async (
  connected: ReturnType<typeof useDmStreamConnected>,
): Promise<void> => {
  if (!import.meta.client) return;
  if (connectInFlight) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  connectInFlight = true;

  try {
    const token = localStorage.getItem(TOKEN_KEY) || "";
    if (!token) {
      // 未登录：放弃，不重连
      started = false;
      reconnectAttempts = 0;
      return;
    }

    // 同步阶段先把 Nuxt 上下文相关的资源都拿到——await 之后 useNuxtApp /
    // useRuntimeConfig 可能因为脱离 setup() 上下文而抛错，被外层 catch 静默
    // 吞掉时会导致连接循环（一直 POST ticket 但永远不到 new WebSocket）。
    const { $api } = useNuxtApp();
    const config = useRuntimeConfig();
    const apiBaseUrl = String((config.public as { apiBaseUrl?: string })?.apiBaseUrl || "");

    // 1) 拿 ticket
    const resp = await $api<TicketResponse>(TICKET_PATH, { method: "POST" });
    const ticket = resp?.data?.ticket;
    if (!ticket) {
      scheduleReconnect(connected);
      return;
    }

    // 2) 构造 WS URL 并连接
    const url = buildWsUrl(apiBaseUrl, ticket);

    teardownSocket(); // 防御性：上一个旧实例必须先清掉

    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      // 注：上线后 hello 帧会立刻到达；hello 收到时再算"连接稳定"，
      // 这里先标记一次，避免 onopen 与 hello 之间用户看不到状态
      reconnectAttempts = 0;
      connected.value = true;

      // 应用层 ping
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          try { socket.send(JSON.stringify({ type: "ping" })); } catch { /* noop */ }
        }
      }, APP_PING_MS);
    };

    socket.onmessage = (ev) => {
      // 服务端只发 JSON 文本帧（见 ws-server.ts sendEvent）
      try {
        const event = JSON.parse(String(ev.data)) as DmWsEvent<unknown>;
        if (!event || typeof event.type !== "string") return;
        emit(event);
      } catch {
        /* malformed payload — ignore */
      }
    };

    socket.onerror = (ev) => {
      // 把握手 / 升级失败的具体原因暴露到 console，便于定位 CSP / 代理 /
      // 端口等部署侧问题；onclose 紧跟着会到，重连逻辑放在 onclose 里。
      // eslint-disable-next-line no-console
      console.warn("[dm-ws] socket error", ev);
    };

    socket.onclose = (ev) => {
      connected.value = false;
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (ws === socket) ws = null;
      // 异常关闭（code != 1000 / 1001）打 console 帮助定位，比如 1006 通常是
      // 网络中断 / 反代未配置 ws upgrade；1008 是后端拒绝（ticket 失效等）。
      if (ev.code !== 1000 && ev.code !== 1001) {
        // eslint-disable-next-line no-console
        console.warn(`[dm-ws] socket closed code=${ev.code} reason=${ev.reason || "<none>"}`);
      }
      // 服务端主动关闭 + 客户端主动 stop 都不重连
      if (!manualStop) scheduleReconnect(connected);
    };
  } catch (err) {
    // ticket 401 / 网络异常 / new WebSocket SyntaxError 等：打 console 而不是静默
    // eslint-disable-next-line no-console
    console.warn("[dm-ws] doConnect failed", err);
    connected.value = false;
    scheduleReconnect(connected);
  } finally {
    connectInFlight = false;
  }
};

export function useDmStream() {
  const isConnected = useDmStreamConnected();

  const start = () => {
    if (!import.meta.client) return;
    if (started) return;
    started = true;
    manualStop = false;
    reconnectAttempts = 0;
    void doConnect(isConnected);
  };

  const stop = () => {
    manualStop = true;
    started = false;
    reconnectAttempts = 0;
    clearTimers();
    teardownSocket();
    isConnected.value = false;
  };

  /**
   * 订阅 WS 事件。
   *
   * @param type 事件类型；传 "*" 订阅全部
   * @returns 取消订阅
   */
  const on = <T = unknown>(
    type: DmWsEventType | "*",
    handler: (event: DmWsEvent<T>) => void,
  ): (() => void) => {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(handler as AnyHandler);
    return () => {
      const s = listeners.get(type);
      if (!s) return;
      s.delete(handler as AnyHandler);
      if (s.size === 0) listeners.delete(type);
    };
  };

  /** 发送 typing 状态；节流由调用方控制 */
  const sendTyping = (conversationId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!conversationId) return;
    try {
      ws.send(JSON.stringify({ type: "typing", conversationId }));
    } catch { /* noop */ }
  };

  return {
    isConnected: computed(() => isConnected.value) as ComputedRef<boolean>,
    start,
    stop,
    on,
    sendTyping,
  };
}
