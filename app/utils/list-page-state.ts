import { onHistoryBranchDiscarded } from "~/utils/history-branches";

export interface ListPageSnapshot<T> {
  data: T;
  heights: Map<string | number, number>;
  scrollY: number;
}

const entries = new Map<string, { position: number; snapshot: ListPageSnapshot<unknown> }>();
const pendingScroll = new Map<string, number>();
let generation: number | undefined;

export function listPagePosition(route: string, state: Record<string, unknown>): number {
  return Number(state.modalBackgroundRoute === route ? state.modalBackgroundPosition : state.position);
}

function prepare(currentGeneration: number) {
  if (generation === currentGeneration) return;
  entries.clear();
  pendingScroll.clear();
  generation = currentGeneration;
}

export function readListPageState<T>(route: string, position: number, currentGeneration: number) {
  prepare(currentGeneration);
  const key = `${position}:${route}`;
  const snapshot = entries.get(key)?.snapshot as ListPageSnapshot<T> | undefined;
  if (snapshot) pendingScroll.set(key, snapshot.scrollY);
  return snapshot;
}

export function saveListPageState<T>(route: string, position: number, currentGeneration: number, snapshot: ListPageSnapshot<T>) {
  prepare(currentGeneration);
  entries.set(`${position}:${route}`, { position, snapshot });
}

export function consumeListPageScroll(route: string, state: Record<string, unknown>) {
  const key = `${listPagePosition(route, state)}:${route}`;
  const scrollY = pendingScroll.get(key);
  pendingScroll.delete(key);
  return scrollY;
}

onHistoryBranchDiscarded((firstDiscardedPosition) => {
  for (const [key, entry] of entries) {
    if (entry.position >= firstDiscardedPosition) {
      entries.delete(key);
      pendingScroll.delete(key);
    }
  }
});
