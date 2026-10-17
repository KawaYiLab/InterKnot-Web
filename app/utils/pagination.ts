import type { Pagination } from "~/types/api";

export const DEFAULT_PAGE_SIZE = 20;

/**
 * 后端一律游标分页（`{ items, nextCursor }`，见 ikserver-rs docs/api-guidelines.md「分页」）。
 * Pagination<T> 的 endCursor 是「原样存下来、下次原样回传」的不透明串；空串 = 没有下一页。
 */
export function toPage<T>(nodes: T[], nextCursor: string | null | undefined): Pagination<T> {
  return {
    nodes,
    endCursor: nextCursor || "",
    hasNextPage: !!nextCursor,
  };
}
