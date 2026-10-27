import { nextTick } from "vue";
import type { Comment } from "~/types/entities";

/**
 * 删掉一条评论后的时间线：去掉它；回复它的评论保留，引用改成「原评论已删除」；
 * 它回复的那条评论回复数减一。
 */
export function removeFromTimeline(list: Comment[], removed: Comment): Comment[] {
  const targetId = removed.replyTo?.comment?.id;
  return list.filter((c) => {
    if (c.id === removed.id) return false;
    if (c.replyTo?.comment?.id === removed.id) {
      c.replyTo = { ...c.replyTo, deleted: true, comment: null };
    }
    if (targetId && c.id === targetId) {
      c.replyCount = Math.max(0, (c.replyCount ?? 0) - 1);
    }
    return true;
  });
}

/** 新发的评论回复了列表里的某条：那条的回复数加一（同一条评论在顶部副本和时间线里各一份）。 */
export function countNewReply(lists: Comment[][], created: Comment) {
  const targetId = created.replyTo?.comment?.id;
  if (!targetId) return;
  for (const list of lists) {
    for (const c of list) {
      if (c.id === targetId) c.replyCount = (c.replyCount ?? 0) + 1;
    }
  }
}

/**
 * 往时间线前面插入更早的评论时保持视口不跳：记下当前第一条评论在屏幕上的位置，
 * 插入后把滚动容器（不传时是页面）补回同样的偏移。
 */
export async function prependKeepingPosition(
  firstId: string | undefined,
  prepend: () => void,
  scroller?: HTMLElement | null,
) {
  const find = () =>
    firstId
      ? (document.querySelector(`[data-comment-id="${CSS.escape(firstId)}"]`) as HTMLElement | null)
      : null;
  const before = find()?.getBoundingClientRect().top;
  prepend();
  await nextTick();
  const after = find()?.getBoundingClientRect().top;
  if (before === undefined || after === undefined) return;
  const delta = after - before;
  if (scroller) scroller.scrollTop += delta;
  else window.scrollBy(0, delta);
}

const scrollPositionCleanup = new WeakMap<HTMLElement, () => void>();

/** 刷新移动端评论时保留列表高度，避免骨架屏收缩和浏览器滚动锚定挪动整页。 */
export async function refreshKeepingPosition(
  scroller: HTMLElement | null,
  content: HTMLElement | null,
  refresh: () => Promise<void>,
) {
  if (!scroller || !content) {
    await refresh();
    return;
  }

  const height = content.getBoundingClientRect().height;
  scrollPositionCleanup.get(content)?.();
  const minHeight = content.style.minHeight;
  const overflowAnchor = scroller.style.overflowAnchor;
  content.style.minHeight = `${height}px`;
  scroller.style.overflowAnchor = "none";
  try {
    await refresh();
  } finally {
    await nextTick();
    // 以刷新完成时的位置为准，保留用户在请求期间继续滚动的操作。
    const scrollTop = scroller.scrollTop;
    const requiredHeight = scrollTop + scroller.clientHeight;
    content.style.minHeight = minHeight;
    const naturalScrollHeight = scroller.scrollHeight;
    const missingHeight = requiredHeight - naturalScrollHeight;
    if (missingHeight > 0) {
      // 新列表过短或请求失败时，只补足维持当前位置所需的高度，防止浏览器强制回滚。
      content.style.minHeight = `${Math.ceil(content.getBoundingClientRect().height + missingHeight)}px`;
      const release = () => {
        content.style.minHeight = minHeight;
        scroller.removeEventListener("scroll", onScroll);
        scrollPositionCleanup.delete(content);
      };
      const onScroll = () => {
        if (scroller.scrollTop <= Math.max(0, naturalScrollHeight - scroller.clientHeight)) release();
      };
      scroller.addEventListener("scroll", onScroll, { passive: true });
      scrollPositionCleanup.set(content, release);
    }
    scroller.scrollTop = scrollTop;
    scroller.style.overflowAnchor = overflowAnchor;
  }
}
