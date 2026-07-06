/**
 * useEmotes —— 表情清单（manifest）的拉取与缓存。
 *
 * 使用 TanStack Vue Query 在全局缓存 manifest，staleTime 设为 30 分钟——
 * 表情集合变化频率极低，无需频繁重拉。
 *
 * 暴露：
 * - emotes: Ref<Emote[]>（扁平列表，按 group 分区由调用方处理）
 * - emoteMap: Ref<Map<string, Emote>>（code → Emote，供 EmoteImage 快速查找）
 * - loading: Ref<boolean>
 *
 * 首次调用时自动 fetch，后续调用复用全局缓存。
 */

import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useNuxtApp, useRuntimeConfig } from "#app";

export interface Emote {
  code: string;
  name: string;
  group: string;
  url: string;
  width: number | null;
  height: number | null;
}

interface ManifestResponse {
  emotes: Emote[];
}

const EMOTE_STALE_TIME = 30 * 60 * 1000; // 30 min

/** 全局 queryKey，确保所有调用方共享同一份缓存 */
const EMOTE_MANIFEST_KEY = ["emotes", "manifest"] as const;

/** 相对路径（本地 upload provider）补上 API 域名；绝对 URL（S3/CDN）原样返回 */
function normalizeEmoteUrl(url: string, apiBaseUrl: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("//")) return url;
  if (url.startsWith("/")) return `${apiBaseUrl}${url}`;
  return `${apiBaseUrl}/${url}`;
}

export function useEmotes() {
  const { $api } = useNuxtApp();
  const config = useRuntimeConfig();
  const apiBaseUrl = String(config.public.apiBaseUrl || "");

  const query = useQuery<Emote[]>({
    queryKey: EMOTE_MANIFEST_KEY as unknown as readonly unknown[],
    queryFn: async () => {
      const response = await $api("/api/emotes/manifest");
      const data = (response || {}) as ManifestResponse;
      const list = Array.isArray(data.emotes) ? data.emotes : [];
      return list.map((e) => ({ ...e, url: normalizeEmoteUrl(e.url, apiBaseUrl) }));
    },
    staleTime: EMOTE_STALE_TIME,
    gcTime: 60 * 60 * 1000, // 1 hour gc
  });

  const emotes: Ref<Emote[]> = computed(() => query.data.value ?? []);

  /** code → Emote 快速查找表 */
  const emoteMap: Ref<Map<string, Emote>> = computed(() => {
    const map = new Map<string, Emote>();
    for (const e of emotes.value) {
      map.set(e.code, e);
    }
    return map;
  });

  /** 按 group 分区返回，保持原始顺序 */
  const groupedEmotes = computed(() => {
    const groups = new Map<string, Emote[]>();
    for (const e of emotes.value) {
      const g = e.group || "general";
      let arr = groups.get(g);
      if (!arr) {
        arr = [];
        groups.set(g, arr);
      }
      arr.push(e);
    }
    return groups;
  });

  return {
    emotes,
    emoteMap,
    groupedEmotes,
    loading: computed(() => query.isLoading.value),
  };
}
