/**
 * 主页「展示委托」的选择状态。
 * draft 为 null 表示默认展示（主页显示最新 N 篇）；数组表示自定义展示，顺序即主页顺序。
 */
export type PinnedDraft = string[] | null;

export type ToggleResult =
  | { draft: string[]; status: "added" | "removed" }
  | { draft: PinnedDraft; status: "full" };

export function togglePinned(draft: PinnedDraft, id: string, max: number): ToggleResult {
  const current = draft ?? [];
  if (current.includes(id)) {
    return { draft: current.filter((x) => x !== id), status: "removed" };
  }
  if (current.length >= max) return { draft, status: "full" };
  return { draft: [...current, id], status: "added" };
}

export function movePinned(draft: string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= draft.length || target < 0 || target >= draft.length) return draft;
  const next = [...draft];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function samePinned(a: PinnedDraft, b: PinnedDraft): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * 去掉已失效（已删除/撤回/转匿名）的已选 id。
 * known 为 undefined 时说明后端未返回已选卡片数据，无法判断，原样保留。
 */
export function pruneStalePinned(pinned: PinnedDraft, known: ReadonlySet<string> | undefined): PinnedDraft {
  if (pinned === null || !known) return pinned;
  return pinned.filter((id) => known.has(id));
}
