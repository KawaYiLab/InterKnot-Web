/**
 * useEmotes —— 表情清单（manifest）的拉取与缓存。
 *
 * 使用 TanStack Vue Query 在全局缓存 manifest，staleTime 60s：
 * 同一页面内反复渲染不重拉，但后台增删表情后能很快被前端感知
 * （EmotePicker 每次打开时调 refreshIfStale 重拉过期清单）。
 *
 * 暴露：
 * - emotes: Ref<Emote[]>（扁平列表）
 * - groupedEmotes: 按后台分组（名称 + order）分区排序
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
  /** 分组名称（后台维护，未分组时为「通用」） */
  group: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface EmoteGroup {
  name: string;
  order: number;
  /** 分组自定义图标 URL（后台维护），未设置时为 null，前端降级用首个表情 */
  iconUrl: string | null;
}

interface ManifestResponse {
  groups?: EmoteGroup[];
  emotes: Emote[];
}

interface ManifestData {
  groups: EmoteGroup[];
  emotes: Emote[];
}

const EMOTE_STALE_TIME = 60 * 1000; // 60s

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

  const query = useQuery<ManifestData>({
    queryKey: EMOTE_MANIFEST_KEY as unknown as readonly unknown[],
    queryFn: async () => {
      // cache: "no-cache" 强制走条件请求，避免旧的浏览器 HTTP 缓存把清单钉住
      const response = await $api("/api/emotes/manifest", { cache: "no-cache" });
      const data = (response || {}) as ManifestResponse;
      const list = Array.isArray(data.emotes) ? data.emotes : [];
      return {
        groups: (Array.isArray(data.groups) ? data.groups : []).map((g) => ({
          ...g,
          iconUrl: g.iconUrl ? normalizeEmoteUrl(g.iconUrl, apiBaseUrl) : null,
        })),
        emotes: list.map((e) => ({ ...e, url: normalizeEmoteUrl(e.url, apiBaseUrl) })),
      };
    },
    staleTime: EMOTE_STALE_TIME,
    gcTime: 60 * 60 * 1000, // 1 hour gc
  });

  const emotes: Ref<Emote[]> = computed(() => query.data.value?.emotes ?? []);
  const emoteGroups: Ref<EmoteGroup[]> = computed(() => query.data.value?.groups ?? []);

  /** code → Emote 快速查找表 */
  const emoteMap: Ref<Map<string, Emote>> = computed(() => {
    const map = new Map<string, Emote>();
    for (const e of emotes.value) {
      map.set(e.code, e);
    }
    return map;
  });

  /** 按分组名分区，分组顺序跟随 manifest.groups（未知分组追加在后） */
  const groupedEmotes = computed(() => {
    const groups = new Map<string, Emote[]>();
    for (const g of emoteGroups.value) {
      groups.set(g.name, []);
    }
    for (const e of emotes.value) {
      const name = e.group || "通用";
      let arr = groups.get(name);
      if (!arr) {
        arr = [];
        groups.set(name, arr);
      }
      arr.push(e);
    }
    // 去掉没有任何表情的空分组
    for (const [name, arr] of groups) {
      if (arr.length === 0) groups.delete(name);
    }
    return groups;
  });

  /** 清单已过期时重拉一次（EmotePicker 打开时调用） */
  function refreshIfStale() {
    if (query.isStale.value) void query.refetch();
  }

  return {
    emotes,
    emoteGroups,
    emoteMap,
    groupedEmotes,
    loading: computed(() => query.isLoading.value),
    refreshIfStale,
  };
}
