import type { Pagination } from "~/types/api";

export const DEFAULT_PAGE_SIZE = 20;

export function parseStart(endCursor: string): number {
  return Number.parseInt(endCursor || "0", 10) || 0;
}

export interface BackendPaginationMeta {
  start?: number;
  limit?: number;
  total?: number;
  pageCount?: number;
}

export function buildPagination<T>(
  nodes: T[],
  start: number,
  meta?: BackendPaginationMeta,
): Pagination<T> {
  const limit = meta?.limit ?? DEFAULT_PAGE_SIZE;
  const nextStart = start + limit;

  // Use backend total when available for accurate hasNextPage
  const hasNextPage =
    typeof meta?.total === "number"
      ? nextStart < meta.total
      : nodes.length >= DEFAULT_PAGE_SIZE;

  return {
    nodes,
    endCursor: String(nextStart),
    hasNextPage,
  };
}
