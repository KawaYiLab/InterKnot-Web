/**
 * 敲敲弹窗 overlay 的 history URL 辅助。
 *
 * 敲敲使用 /knock/:tab/:conversationId。
 *
 * 委托弹窗仍用 /post/:id（见 usePostModal），与敲敲方案分离。
 */
export type KnockTab = "contacts" | "calls" | "groups";
export interface KnockTarget {
  tab: KnockTab;
  dmConversationId?: string;
}

const knockTab = (tab: string | undefined): KnockTab =>
  tab === "calls" || tab === "groups" ? tab : "contacts";

/** 从路径读取弹窗的标签和会话。 */
export function readKnockTarget(url: URL): KnockTarget | null {
  const path = /^\/knock(?:\/(contacts|calls|groups)(?:\/([^/]+))?)?\/?$/.exec(url.pathname);
  if (!path) return null;
  let id = path[2];
  if (id) {
    try { id = decodeURIComponent(id); } catch { return null; }
  }
  return {
    tab: knockTab(path[1]),
    dmConversationId: id,
  };
}

export function readLocationUrl(): URL {
  return new URL(window.location.href);
}

export function serializeHistoryUrl(url: URL): string {
  return url.pathname + url.search + url.hash;
}

/**
 * 原生 pushState / replaceState 时合并 overlay 标记，保留 Vue Router 的 history.state。
 *
 * 若整对象覆盖 router 状态（back / current / position 等），后续 router.push
 * 会读到 current === undefined，拼出错误地址（如 https://interk.netundefined/）。
 */
export function overlayHistoryState(
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const prev = window.history.state;
  if (!prev || typeof prev !== "object") {
    return { ...extra };
  }
  return { ...prev, ...extra };
}

/** 敲敲弹窗地址；私聊列表使用最短的 /knock。 */
export function knockHistoryUrl(
  tab: KnockTab,
  conversationId?: string | null,
): string {
  const path = tab === "contacts" && !conversationId ? "/knock" : `/knock/${tab}`;
  return conversationId ? `${path}/${encodeURIComponent(conversationId)}` : path;
}
