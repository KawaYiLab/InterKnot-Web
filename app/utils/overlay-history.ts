/**
 * 敲敲弹窗 overlay 的 history URL 辅助。
 *
 * 敲敲使用当前页 path + query（ik_knock*），避免 popstate 时 Vue Router
 * 切到独立路由页并触发整页导航。
 *
 * 委托弹窗仍用 /post/:id（见 usePostModal），与敲敲方案分离。
 */
export const OVERLAY_KNOCK_KEY = "ik_knock";
export const OVERLAY_KNOCK_TAB = "ik_knock_tab";
export const OVERLAY_KNOCK_CONV = "ik_knock_c";

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

/** 敲敲弹窗：在当前 URL 上写入 ik_knock* 参数 */
export function knockHistoryUrl(
  tab: string,
  conversationId?: string | null,
  base?: URL,
): string {
  const url = base ? new URL(base.href) : readLocationUrl();
  url.searchParams.set(OVERLAY_KNOCK_KEY, "1");

  if (tab && tab !== "contacts") {
    url.searchParams.set(OVERLAY_KNOCK_TAB, tab);
  } else {
    url.searchParams.delete(OVERLAY_KNOCK_TAB);
  }

  if (conversationId) {
    url.searchParams.set(OVERLAY_KNOCK_CONV, conversationId);
  } else {
    url.searchParams.delete(OVERLAY_KNOCK_CONV);
  }

  return serializeHistoryUrl(url);
}
