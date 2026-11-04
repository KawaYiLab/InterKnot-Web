/** 普通左键点击由应用处理；修饰键和中键交给浏览器打开新标签页。 */
export function isPlainLinkClick(event: MouseEvent): boolean {
  return !event.defaultPrevented && event.button === 0 &&
    !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** 私信中的用户输入只允许网页、邮件和电话链接；相对地址按 HTTPS 解析。 */
export function isSafeLinkHref(href: string): boolean {
  if (!href.trim()) return false;
  try {
    const protocol = new URL(href, "https://localhost/").protocol;
    return ["http:", "https:", "mailto:", "tel:"].includes(protocol);
  } catch {
    return false;
  }
}

export interface PostLinkTarget {
  postId: string;
  commentId?: string;
}

/** 只接管本站完整的帖子路径，并保留评论定位。 */
export function readPostLink(href: string, base = window.location.href): PostLinkTarget | null {
  let url: URL;
  try { url = new URL(href, base); } catch { return null; }
  if (url.origin !== new URL(base).origin) return null;
  const match = /^\/post\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  return { postId: match[1]!, commentId: url.searchParams.get("comment") || undefined };
}

/** 富文本和普通锚点共用的帖子链接委托；其它链接保留原来的浏览器行为。 */
export function openPostLink(
  event: MouseEvent,
  open: (id: string, options?: { commentId?: string }) => void,
): boolean {
  if (!(event.target instanceof Element)) return false;
  const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor) return false;
  if (event.currentTarget instanceof Element && !event.currentTarget.contains(anchor)) return false;
  // 点击时再检查实际 href；修饰键、中键和 target 也不能放行危险协议。
  if (!isSafeLinkHref(anchor.href)) {
    event.preventDefault();
    return true;
  }
  if (!isPlainLinkClick(event) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return false;
  const target = readPostLink(anchor.href);
  if (!target) return false;
  event.preventDefault();
  open(target.postId, { commentId: target.commentId });
  return true;
}
