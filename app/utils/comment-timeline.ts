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
