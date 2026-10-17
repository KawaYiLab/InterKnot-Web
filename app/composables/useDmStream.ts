/**
 * useDmStream —— 私聊 / 收件箱的实时事件（跑在共享的 /v1/realtime 连接上，见 useRealtime）。
 *
 * 这里只做协议翻译：把服务端的 `dm.*` / `inbox.*` / `notification.*` 事件转成 useDmConversations
 * 处理的 DmWsEvent（type + conversationId + messageId + data）。消息体的形状翻译
 * （MessageView → DmMessage）需要会话上下文（对方是谁），交给订阅方用 `rawMessage` 自己做。
 *
 * 事件对照（服务端 → 本地 type）：
 *   dm.message.created / edited / withdrawn → message.created / message.edited / message.deleted
 *   dm.message.delta / dm.message.workflow  → message.delta / message.workflow
 *   dm.typing                               → typing
 *   dm.conversation.updated / left          → conversation.updated / conversation.left
 *   inbox.read / inbox.read.all             → inbox.read / conversation.read.all
 *   notification.created / removed / read   → notification.changed
 *   连接（重新）建立                          → resync（WS 不保证不丢事件，订阅方用 REST 补齐）
 */
import type { ComputedRef } from "vue";
import type { DmWsEvent } from "~/types/entities";

/** 本地事件名（比 DmWsEventType 多出新协议里的几种） */
export type DmStreamEventType =
  | "message.created"
  | "message.edited"
  | "message.delta"
  | "message.workflow"
  | "message.deleted"
  | "typing"
  | "conversation.updated"
  | "conversation.left"
  | "conversation.read.all"
  | "inbox.read"
  | "notification.changed"
  | "resync";

export interface DmStreamEvent<T = unknown> extends Omit<DmWsEvent<T>, "type"> {
  type: DmStreamEventType;
}

type AnyHandler = (event: DmStreamEvent<unknown>) => void;

const listeners = new Map<string, Set<AnyHandler>>();
let offRealtime: Array<() => void> = [];

const emit = (event: DmStreamEvent<unknown>) => {
  for (const key of [event.type, "*"]) {
    const set = listeners.get(key);
    if (!set) continue;
    for (const handler of set) {
      try {
        handler(event);
      } catch {
        // 防止单个 handler 抛错影响其它订阅
      }
    }
  }
};

type Payload = Record<string, unknown>;

const at = () => new Date().toISOString();

/** 服务端事件 → 本地事件（不认识的返回 null）。 */
function translate(t: string, d: Payload): DmStreamEvent<unknown> | null {
  const conversationId = typeof d.conversationId === "string" ? d.conversationId : undefined;
  const message = (d.message || null) as Payload | null;
  const messageId = typeof d.messageId === "string"
    ? d.messageId
    : typeof message?.id === "string" ? message.id : undefined;
  switch (t) {
    case "dm.message.created":
      return { type: "message.created", conversationId, messageId, data: { rawMessage: message }, at: at() };
    case "dm.message.edited":
      return { type: "message.edited", conversationId, messageId, data: { rawMessage: message }, at: at() };
    case "dm.message.withdrawn":
      return {
        type: "message.deleted",
        conversationId,
        messageId,
        data: { deletedAt: message?.withdrawnAt ?? at(), rawMessage: message },
        at: at(),
      };
    case "dm.message.delta":
      return { type: "message.delta", conversationId, messageId, data: { content: d.content }, at: at() };
    case "dm.message.workflow":
      return { type: "message.workflow", conversationId, messageId, data: { event: d.event }, at: at() };
    case "dm.typing":
      return { type: "typing", conversationId, data: { userId: d.userId }, at: at() };
    case "dm.conversation.updated":
      return { type: "conversation.updated", conversationId, data: d, at: at() };
    case "dm.conversation.left":
      return { type: "conversation.left", conversationId, data: d, at: at() };
    case "inbox.read":
      return { type: "inbox.read", data: d, at: at() };
    case "inbox.read.all":
      return { type: "conversation.read.all", data: d, at: at() };
    case "notification.created":
    case "notification.removed":
    case "notification.read":
      return { type: "notification.changed", conversationId, data: { ...d, kind: t }, at: at() };
    default:
      return null;
  }
}

export function useDmStream() {
  const realtime = useRealtime();

  /** 开始转发（幂等）。连接本身由 plugins/realtime.client.ts 维持。 */
  const start = () => {
    if (!import.meta.client || offRealtime.length) return;
    offRealtime = [
      realtime.on<Payload>("*", (ev) => {
        const event = translate(ev.t, (ev.d || {}) as Payload);
        if (event) emit(event);
      }),
      realtime.on("open", () => emit({ type: "resync", at: at() })),
    ];
  };

  const stop = () => {
    for (const off of offRealtime.splice(0)) off();
  };

  /**
   * 订阅事件；type 传 "*" 订阅全部。返回取消订阅函数。
   */
  const on = <T = unknown>(
    type: DmStreamEventType | "*",
    handler: (event: DmStreamEvent<T>) => void,
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

  return {
    isConnected: realtime.isConnected as ComputedRef<boolean>,
    start,
    stop,
    on,
    sendTyping: realtime.sendTyping,
  };
}
