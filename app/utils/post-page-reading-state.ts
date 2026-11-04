import type { Comment } from "~/types/entities";
import type { CommentSort } from "~/composables/useApi";

export interface PostPageReadingState {
  postId: string;
  sort: CommentSort;
  comments: Comment[];
  featured: Comment[];
  cursor: string;
  previousCursor: string;
  hasNext: boolean;
  scroll: Array<{ top: number; left: number }>;
}

const entries = new Map<string, PostPageReadingState>();
let savedGeneration: number | undefined;

/** 浮层返回时的临时 URL 属于浮层，阅读位置仍归属于最初的独立页面。 */
export function postPageReadingKey(route: string, state: Record<string, unknown>): string {
  const position = state.modalBackgroundRoute === route ? state.modalBackgroundPosition : state.position;
  return `${position}:${route}`;
}

export function postPageReadingCache(generation: number) {
  if (savedGeneration !== generation) {
    entries.clear();
    savedGeneration = generation;
  }
  return entries;
}
