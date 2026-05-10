import type { Discussion, Profile } from "~/types/entities";

const STORAGE_PREFIX = "ik-profile:v1:";

export interface ProfilePageSnapshot {
  version: 1;
  savedAt: number;
  profileId: string;
  profile: Profile;
  articles: Discussion[];
  articleCursor: string;
  articleHasNext: boolean;
}

export function profilePageStorageKey(profileId: string): string {
  return STORAGE_PREFIX + encodeURIComponent(profileId);
}

function isProfileRecord(v: unknown): v is Profile {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as Profile).documentId === "string" &&
    (v as Profile).documentId.length > 0
  );
}

export function readProfilePageSnapshot(profileId: string): ProfilePageSnapshot | null {
  if (!import.meta.client || !profileId) return null;
  try {
    const raw = sessionStorage.getItem(profilePageStorageKey(profileId));
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<ProfilePageSnapshot>;
    if (data.version !== 1 || typeof data.savedAt !== "number") return null;
    if (typeof data.profileId !== "string" || data.profileId !== profileId) return null;
    if (!isProfileRecord(data.profile) || data.profile.documentId !== profileId) return null;
    if (!Array.isArray(data.articles)) return null;
    if (typeof data.articleCursor !== "string") return null;
    if (typeof data.articleHasNext !== "boolean") return null;
    return data as ProfilePageSnapshot;
  } catch {
    return null;
  }
}

export function writeProfilePageSnapshot(payload: {
  profileId: string;
  profile: Profile;
  articles: Discussion[];
  articleCursor: string;
  articleHasNext: boolean;
}): void {
  if (!import.meta.client || !payload.profileId) return;
  const snapshot: ProfilePageSnapshot = {
    version: 1,
    savedAt: Date.now(),
    profileId: payload.profileId,
    profile: payload.profile,
    articles: payload.articles,
    articleCursor: payload.articleCursor,
    articleHasNext: payload.articleHasNext,
  };
  try {
    sessionStorage.setItem(profilePageStorageKey(payload.profileId), JSON.stringify(snapshot));
  } catch {
    // QuotaExceededError or private mode — ignore
  }
}

export function clearProfilePageSnapshot(profileId: string): void {
  if (!import.meta.client || !profileId) return;
  try {
    sessionStorage.removeItem(profilePageStorageKey(profileId));
  } catch {
    // ignore
  }
}
