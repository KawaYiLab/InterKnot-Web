/**
 * 弹窗 overlay 的 history URL 辅助。
 *
 * 使用当前页 path + query（ik_knock / ik_post）而非 /knock、/post/:id，
 * 避免 popstate 时 Vue Router 切到 knock.vue / post/[id].vue，
 * 进而触发整页导航与顶部进度条刷新动画。
 */
export const OVERLAY_KNOCK_KEY = "ik_knock";
export const OVERLAY_KNOCK_TAB = "ik_knock_tab";
export const OVERLAY_KNOCK_CONV = "ik_knock_c";
export const OVERLAY_POST_KEY = "ik_post";

export function readLocationUrl(): URL {
  return new URL(window.location.href);
}

export function serializeHistoryUrl(url: URL): string {
  return url.pathname + url.search + url.hash;
}

/** 敲敲弹窗：在当前 URL 上写入 ik_knock* 参数（会清除 ik_post） */
export function knockHistoryUrl(
  tab: string,
  conversationId?: string | null,
  base?: URL,
): string {
  const url = base ? new URL(base.href) : readLocationUrl();
  url.searchParams.set(OVERLAY_KNOCK_KEY, "1");
  url.searchParams.delete(OVERLAY_POST_KEY);

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

/** 帖子弹窗：在当前 URL 上追加 ik_post，保留敲敲等其它 query */
export function postHistoryUrl(postId: string, base?: URL): string {
  const url = base ? new URL(base.href) : readLocationUrl();
  url.searchParams.set(OVERLAY_POST_KEY, postId);
  return serializeHistoryUrl(url);
}
