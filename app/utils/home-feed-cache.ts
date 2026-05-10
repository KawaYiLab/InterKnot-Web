import type { Discussion } from "~/types/entities";

const STORAGE_PREFIX = "ik-home-feed:v1:";

export interface HomeFeedSnapshot {
  version: 1;
  savedAt: number;
  query: string;
  nodes: Discussion[];
  endCursor: string;
  hasNextPage: boolean;
}

export function homeFeedStorageKey(query: string): string {
  return STORAGE_PREFIX + encodeURIComponent(query);
}

export function readHomeFeedSnapshot(query: string): HomeFeedSnapshot | null {
  if (!import.meta.client) return null;
  const key = homeFeedStorageKey(query);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<HomeFeedSnapshot>;
    if (data.version !== 1 || typeof data.savedAt !== "number") return null;
    if (typeof data.query !== "string" || data.query !== query) return null;
    if (!Array.isArray(data.nodes)) return null;
    if (typeof data.endCursor !== "string") return null;
    if (typeof data.hasNextPage !== "boolean") return null;
    return data as HomeFeedSnapshot;
  } catch {
    return null;
  }
}

export function writeHomeFeedSnapshot(payload: {
  query: string;
  nodes: Discussion[];
  endCursor: string;
  hasNextPage: boolean;
}): void {
  if (!import.meta.client) return;
  const key = homeFeedStorageKey(payload.query);
  const snapshot: HomeFeedSnapshot = {
    version: 1,
    savedAt: Date.now(),
    query: payload.query,
    nodes: payload.nodes,
    endCursor: payload.endCursor,
    hasNextPage: payload.hasNextPage,
  };
  try {
    sessionStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // QuotaExceededError or private mode — ignore
  }
}

export function clearHomeFeedSnapshot(query: string): void {
  if (!import.meta.client) return;
  try {
    sessionStorage.removeItem(homeFeedStorageKey(query));
  } catch {
    // ignore
  }
}
