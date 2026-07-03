import { computed, reactive, ref } from "vue";
import type { StickerItem, StickerPack } from "~/types/entities";

/**
 * 表情包全局状态：
 * - catalog：系统表情包目录（登录后拉一次，全员免费可用）
 * - stickerMap：documentId → 表情图片信息。目录 + 各列表接口随响应下发的
 *   stickerMap（覆盖已下架的历史表情）合并而成，渲染端 O(1) 查询。
 * - recents：最近使用（localStorage，本机维度）
 *
 * 模块级单例：多处组件（评论、私信、回应）共享同一份数据。
 */

export interface StickerMapEntry {
  url: string;
  name?: string | null;
  width?: number | null;
  height?: number | null;
}

const stickerMap = reactive<Record<string, StickerMapEntry>>({});
const packs = ref<StickerPack[]>([]);
const catalogLoaded = ref(false);
let catalogPromise: Promise<void> | null = null;

const RECENTS_KEY = "ik-sticker-recents";
const MAX_RECENTS = 24;
const recents = ref<string[]>([]);
let recentsLoaded = false;

const loadRecents = () => {
  if (recentsLoaded || !import.meta.client) return;
  recentsLoaded = true;
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      recents.value = parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    /* 坏数据直接忽略 */
  }
};

export function mergeStickerMap(map: unknown) {
  if (!map || typeof map !== "object") return;
  for (const [documentId, entry] of Object.entries(map as Record<string, unknown>)) {
    if (!documentId || !entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.url !== "string" || !e.url) continue;
    stickerMap[documentId] = {
      url: e.url,
      name: typeof e.name === "string" ? e.name : null,
      width: typeof e.width === "number" ? e.width : null,
      height: typeof e.height === "number" ? e.height : null,
    };
  }
}

export function useStickers() {
  const api = useApi();

  const ensureCatalog = () => {
    if (catalogLoaded.value) return Promise.resolve();
    if (!catalogPromise) {
      catalogPromise = api
        .getStickerCatalog()
        .then((result) => {
          packs.value = result;
          for (const pack of result) {
            for (const s of pack.stickers) {
              stickerMap[s.documentId] = {
                url: s.url,
                name: s.name,
                width: s.width ?? null,
                height: s.height ?? null,
              };
            }
          }
          catalogLoaded.value = true;
        })
        .catch((err) => {
          // 失败允许下次重试
          catalogPromise = null;
          throw err;
        });
    }
    return catalogPromise;
  };

  const resolveSticker = (documentId: string): StickerMapEntry | null =>
    stickerMap[documentId] ?? null;

  loadRecents();
  const recordRecent = (documentId: string) => {
    if (!documentId) return;
    const next = [documentId, ...recents.value.filter((id) => id !== documentId)].slice(
      0,
      MAX_RECENTS,
    );
    recents.value = next;
    if (import.meta.client) {
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* 存储满等场景忽略 */
      }
    }
  };

  const recentStickers = computed<StickerItem[]>(() =>
    recents.value
      .map((id): StickerItem | null => {
        const entry = stickerMap[id];
        if (!entry) return null;
        return {
          documentId: id,
          name: entry.name ?? "",
          url: entry.url,
          width: entry.width ?? undefined,
          height: entry.height ?? undefined,
        };
      })
      .filter((s): s is StickerItem => !!s),
  );

  return {
    packs,
    catalogLoaded,
    ensureCatalog,
    resolveSticker,
    recordRecent,
    recentStickers,
  };
}
