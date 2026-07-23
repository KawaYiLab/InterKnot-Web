import type { QueryClient, QueryKey } from "@tanstack/vue-query";
import type { ApiClientError, Pagination } from "~/types/api";
import type {
  AccountSecurity,
  Author,
  Avatar,
  AvatarType,
  BlockedUser,
  BusinessCard,
  BusinessCardType,
  Category,
  Comment,
  CoverImage,
  DailyExpStatus,
  DraftArticle,
  ExamAttemptReview,
  ExamStartResult,
  ExamStatus,
  ExamSubmitResult,
  MihoyoBinding,
  NsfwStatus,
  Post,
  PostCategory,
  ArticleFeed,
  ZzzRoleBadge,
  LikeToggleResult,
  FavoriteToggleResult,
  FollowToggleResult,
  UserBlockToggleResult,
  Profile,
  SignedUploadResult,
  UploadedFile,
} from "~/types/entities";
import {
  buildPagination,
  type BackendPaginationMeta,
  DEFAULT_PAGE_SIZE,
  parseStart,
} from "~/utils/pagination";
import type { MentionCandidate } from "~/composables/useMentionInput";
import { toMediaUrl } from "~/utils/image";
import {
  BENEFIT_MAX_LEVEL,
  benefitsForLevel,
  clampBenefitLevel,
} from "~/utils/benefits";
import type { BenefitKey, BenefitValues } from "~/utils/benefits";

// ── 集中定义 queryKey，便于写接口精准 invalidate ─────────────
const qk = {
  me: {
    self: ["me", "self"] as QueryKey,
    profile: ["me", "profile"] as QueryKey,
    drafts: ["me", "drafts"] as QueryKey,
    draft: (id: string) => ["me", "drafts", id] as QueryKey,
    businessCards: (type?: BusinessCardType) =>
      type ? (["me", "business-cards", type] as QueryKey) : (["me", "business-cards"] as QueryKey),
    avatars: ["me", "avatars"] as QueryKey,
    uploads: (page: number, pageSize: number) => ["me", "uploads", page, pageSize] as QueryKey,
    pinnedArticles: ["me", "pinned-articles"] as QueryKey,
  },
  categories: {
    list: ["categories", "list"] as QueryKey,
  },
  articles: {
    search: (query: string, category: string, start: number, limit: number) =>
      ["articles", "search", query, category, start, limit] as QueryKey,
    searchAll: ["articles", "search"] as QueryKey,
    detail: (id: string) => ["articles", "detail", id] as QueryKey,
    detailAll: ["articles", "detail"] as QueryKey,
    comments: (postId: string, start: number, limit: number) =>
      ["articles", "comments", postId, start, limit] as QueryKey,
    commentsOf: (postId: string) =>
      ["articles", "comments", postId] as QueryKey,
  },
  profile: {
    detail: (documentId: string) => ["profile", documentId] as QueryKey,
    articles: (documentId: string, start: number, limit: number) =>
      ["profile", documentId, "articles", start, limit] as QueryKey,
    articlesOf: (documentId: string) => ["profile", documentId, "articles"] as QueryKey,
    comments: (documentId: string, start: number, limit: number) =>
      ["profile", documentId, "comments", start, limit] as QueryKey,
    commentsOf: (documentId: string) => ["profile", documentId, "comments"] as QueryKey,
  },
};

// 单条资源类接口的默认 staleTime（稍短），列表可稍长
const STALE_DETAIL = 2 * 60 * 1000; // 2 min
const STALE_LIST = 1 * 60 * 1000; // 1 min
const STALE_ME = 2 * 60 * 1000; // 2 min

// 客户端累积的「乐观已读」文章 id 集合。列表/搜索/个人页接口现已对登录用户内联
// isRead（服务端权威态）；但点开委托时的乐观标记请求可能尚未落库，此时若切分类
// 强制重拉，服务端可能仍返回 isRead=false，导致「已读 → 闪回未读」跳动。这里把
// 乐观已读 id 跨频道/分页保留，构造列表时同步补齐，消除该窗口内的闪烁。
// 已读单调（不会变回未读），仅在客户端维护；登录/登出时随 clearAllCache 清空。
const knownReadIds = new Set<string>();

const rememberReadIds = (ids: Iterable<string>) => {
  for (const id of ids) if (id) knownReadIds.add(id);
};

// 用累积的乐观已读集合补齐节点 isRead，覆盖「标记请求尚未落库」窗口。
const seedReadStatus = <T extends { id: string; isRead?: boolean }>(nodes: T[]): T[] => {
  if (!import.meta.client || !knownReadIds.size) return nodes;
  for (const node of nodes) {
    if (!node.isRead && knownReadIds.has(node.id)) node.isRead = true;
  }
  return nodes;
};

/** 实时搜索联想项（GET /api/articles/suggest） */
export interface SearchSuggestion {
  documentId: string;
  title: string;
  /** 高亮后的标题（<mark> 包裹命中片段，需用 v-html 渲染） */
  titleHighlighted: string;
  /** 正文命中片段（裁剪 + 高亮） */
  excerpt: string;
  authorName: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  isAnonymous: boolean;
}

export interface AuthResult {
  token: string | null;
  user: Author;
}

export interface MihoyoQrCreateResult {
  qrUrl: string;
  ticket: string;
  expiresIn: number;
  mode: "login" | "bind";
}

export type MihoyoQrPollResult =
  | { status: "waiting" | "scanned" | "expired" | "cancelled" }
  | {
      status: "confirmed";
      mode: "bind";
      binding: MihoyoBinding | null;
    }
  | {
      status: "confirmed";
      mode: "login";
      isNewUser: boolean;
      binding: MihoyoBinding | null;
      auth: AuthResult;
    };

interface SendRegisterCodeResult {
  email: string;
  sent: boolean;
  expiresIn: number;
  cooldown: number;
}

interface SendResetCodeResult {
  email: string;
  sent: boolean;
  expiresIn: number;
  cooldown: number;
}

interface PostCommentPayload {
  postId: string;
  content: string;
  parentId?: string;
  authorDocumentId?: string;
  isAnonymous?: boolean;
  images?: string[];
}

interface MyBusinessCardsResult {
  cards: BusinessCard[];
  equippedCardDocumentId: string | null;
  equippedCard: BusinessCard | null;
}

interface MyUploadsResult {
  uploads: UploadedFile[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

interface MediaMeta {
  url: string;
  width?: number;
  height?: number;
  nsfwStatus?: NsfwStatus;
  nsfwScores?: Record<string, number>;
}

function normalizeMediaUrl(input: unknown, _apiBaseUrl: string): string {
  if (typeof input !== "string" || !input.trim()) {
    return "";
  }
  const url = input.trim();
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:") ||
    url.startsWith("data:")
  ) {
    return toMediaUrl(url);
  }
  if (url.startsWith("/")) {
    return `https://im.tiwat.cn${url}`;
  }
  return `https://im.tiwat.cn/${url}`;
}

function parsePositiveNumber(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return input;
  }
  if (typeof input === "string") {
    const parsed = Number(input);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

const NSFW_STATUS_VALUES: NsfwStatus[] = ["safe", "sensitive", "error"];

function parseNsfwStatus(input: unknown): NsfwStatus | undefined {
  if (typeof input === "string" && NSFW_STATUS_VALUES.includes(input as NsfwStatus)) {
    return input as NsfwStatus;
  }
  return undefined;
}

function parseNsfwScores(input: unknown): Record<string, number> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function extractMediaMeta(raw: unknown, apiBaseUrl: string): MediaMeta | null {
  if (typeof raw === "string") {
    const url = normalizeMediaUrl(raw, apiBaseUrl);
    return url ? { url } : null;
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const media = extractMediaMeta(item, apiBaseUrl);
      if (media) return media;
    }
    return null;
  }

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;

    const directUrl = normalizeMediaUrl(record.url, apiBaseUrl);
    if (directUrl) {
      return {
        url: directUrl,
        width: parsePositiveNumber(record.width),
        height: parsePositiveNumber(record.height),
        nsfwStatus: parseNsfwStatus(record.nsfwStatus),
        nsfwScores: parseNsfwScores(record.nsfwScores),
      };
    }

    const attributes = record.attributes;
    if (attributes && typeof attributes === "object") {
      const attrs = attributes as Record<string, unknown>;
      const attrUrl = normalizeMediaUrl(attrs.url, apiBaseUrl);
      if (attrUrl) {
        return {
          url: attrUrl,
          width: parsePositiveNumber(attrs.width),
          height: parsePositiveNumber(attrs.height),
          nsfwStatus: parseNsfwStatus(attrs.nsfwStatus),
          nsfwScores: parseNsfwScores(attrs.nsfwScores),
        };
      }
    }

    if (record.data) {
      return extractMediaMeta(record.data, apiBaseUrl);
    }
  }

  return null;
}

function extractAllMediaMeta(raw: unknown, apiBaseUrl: string): MediaMeta[] {
  if (!raw) return [];

  if (typeof raw === "string") {
    const url = normalizeMediaUrl(raw, apiBaseUrl);
    return url ? [{ url }] : [];
  }

  const sharedStatus = parseNsfwStatus((raw as Record<string, unknown>)?.nsfwStatus);
  const sharedScores = parseNsfwScores((raw as Record<string, unknown>)?.nsfwScores);

  if (Array.isArray(raw)) {
    const results: MediaMeta[] = [];
    for (const item of raw) {
      const media = extractMediaMeta(item, apiBaseUrl);
      if (media) {
        if (sharedStatus && !media.nsfwStatus) media.nsfwStatus = sharedStatus;
        if (sharedScores && !media.nsfwScores) media.nsfwScores = sharedScores;
        results.push(media);
      }
    }
    return results;
  }

  const single = extractMediaMeta(raw, apiBaseUrl);
  return single ? [single] : [];
}

function unwrapData<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function extractPaginationMeta(payload: unknown): BackendPaginationMeta | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const meta = (payload as Record<string, unknown>).meta;
  if (!meta || typeof meta !== "object") return undefined;
  const pagination = (meta as Record<string, unknown>).pagination;
  if (!pagination || typeof pagination !== "object") return undefined;
  const p = pagination as Record<string, unknown>;
  return {
    start: typeof p.start === "number" ? p.start : undefined,
    limit: typeof p.limit === "number" ? p.limit : undefined,
    total: typeof p.total === "number" ? p.total : undefined,
    pageCount: typeof p.pageCount === "number" ? p.pageCount : undefined,
  };
}

const VALID_CARD_TYPES = new Set(["character", "city", "news"]);

function toBusinessCard(raw: unknown, apiBaseUrl: string): BusinessCard | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  const imageMeta = extractMediaMeta(data.image, apiBaseUrl);
  const rawType = String(data.type || "character");
  return {
    documentId: String(data.documentId || ""),
    name: String(data.name || ""),
    description: (data.description as string | undefined) || undefined,
    story: Array.isArray(data.story) ? data.story : undefined,
    type: (VALID_CARD_TYPES.has(rawType) ? rawType : "character") as BusinessCardType,
    image: imageMeta?.url,
    imageWidth: imageMeta?.width,
    imageHeight: imageMeta?.height,
  };
}

function toAvatar(raw: unknown, apiBaseUrl: string): Avatar | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  const imageMeta = extractMediaMeta(data.image, apiBaseUrl);
  const rawType = String(data.type || "character");
  if (!data.documentId) return undefined;
  return {
    documentId: String(data.documentId),
    name: String(data.name || ""),
    type: (VALID_CARD_TYPES.has(rawType) ? rawType : "character") as AvatarType,
    image: imageMeta?.url,
    imageWidth: imageMeta?.width,
    imageHeight: imageMeta?.height,
  };
}

function toAuthor(raw: unknown, apiBaseUrl: string): Author {
  const data = (raw || {}) as Record<string, unknown>;
  const authorRelation = data.author && typeof data.author === "object" ? data.author as Record<string, unknown> : null;
  const avatar = typeof data.avatar === "string"
    ? normalizeMediaUrl(data.avatar, apiBaseUrl)
    : extractMediaMeta(data.avatar, apiBaseUrl)?.url
      || (authorRelation ? extractMediaMeta(authorRelation.avatar, apiBaseUrl)?.url : "")
      || "";

  return {
    id: data.id as string | number | undefined,
    documentId: (data.documentId as string | undefined) || (data.id as string | undefined),
    authorId: (data.authorId as string | undefined) || (authorRelation?.documentId as string | undefined) || (data.documentId as string | undefined),
    username: data.username as string | undefined,
    login: data.login as string | undefined,
    name:
      (data.name as string | undefined) ||
      (data.username as string | undefined) ||
      (data.login as string | undefined) ||
      "Unknown",
    email: data.email as string | undefined,
    avatar,
    exp: (data.exp as number | undefined) || 0,
    level: (data.level as number | undefined) || 1,
    isAiAgent: data.isAiAgent === true,
    isAdmin: data.isAdmin === true,
    examPassed: typeof data.examPassed === "boolean" ? data.examPassed : undefined,
  };
}

function toPostCategory(raw: unknown): PostCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const slug = typeof c.slug === "string" ? c.slug : "";
  const name = typeof c.name === "string" ? c.name : "";
  if (!slug && !name) return null;
  return {
    name,
    slug,
  };
}

function toPost(raw: unknown, apiBaseUrl: string): Post {
  const data = (raw || {}) as Record<string, unknown>;

  let covers: MediaMeta[];
  let coverUrl: string;
  let coverW: number | undefined;
  let coverH: number | undefined;

  let coverNsfw: NsfwStatus | undefined;

  if (typeof data.cover === "string" || data.cover === null || data.cover === undefined) {
    coverUrl = (typeof data.cover === "string" ? toMediaUrl(data.cover) : "");
    coverW = typeof data.coverWidth === "number" ? data.coverWidth : undefined;
    coverH = typeof data.coverHeight === "number" ? data.coverHeight : undefined;
    coverNsfw = parseNsfwStatus(data.coverNsfwStatus);
    covers = coverUrl ? [{ url: coverUrl, width: coverW, height: coverH, nsfwStatus: coverNsfw }] : [];
  } else {
    covers =
      extractAllMediaMeta(data.cover, apiBaseUrl).length
        ? extractAllMediaMeta(data.cover, apiBaseUrl)
        : extractAllMediaMeta(data.coverImages, apiBaseUrl).length
          ? extractAllMediaMeta(data.coverImages, apiBaseUrl)
          : extractAllMediaMeta(data.covers, apiBaseUrl);
    const firstCover = covers[0] || null;
    coverUrl = firstCover?.url || "";
    coverW = firstCover?.width;
    coverH = firstCover?.height;
    coverNsfw = firstCover?.nsfwStatus;
  }

  return {
    id: String(data.documentId || data.id || ""),
    title: String(data.title || "无标题"),
    body: (data.body as string | undefined) || "",
    bodyText: (data.text as string | undefined) || "",
    rawBodyText: (data.rawBodyText as string | undefined) || "",
    covers,
    cover: coverUrl,
    coverNsfwStatus: coverNsfw,
    coverWidth: coverW,
    coverHeight: coverH,
    views: Number(data.views || 0),
    likesCount: Number(data.likesCount ?? 0),
    commentsCount: Number(data.commentsCount ?? 0),
    isRead: data.isRead === true,
    liked: data.liked === true,
    favorited: data.favorited === true,
    favoritesCount: Number(data.favoritesCount ?? 0),
    dennyCount: Number(data.dennyCount ?? 0),
    hasGivenDenny: data.hasGivenDenny === true,
    isAnonymous: data.isAnonymous === true,
    isHidden: data.isHidden === true,
    isOwner: data.isOwner === true,
    category: toPostCategory(data.category),
    createdAt: data.createdAt as string | undefined,
    updatedAt: data.updatedAt as string | undefined,
    editedAt: data.editedAt as string | undefined,
    author: toAuthor(data.author, apiBaseUrl),
  };
}

function toDraftArticle(raw: Record<string, unknown>): DraftArticle {
  const coverRaw = raw.cover;
  const covers: CoverImage[] = [];
  const parseCover = (c: Record<string, unknown>) => {
    const url = normalizeMediaUrl(c.url, "");
    if (url) {
      covers.push({
        documentId: typeof c.documentId === "string" ? c.documentId : undefined,
        url,
        width: parsePositiveNumber(c.width),
        height: parsePositiveNumber(c.height),
        nsfwStatus: parseNsfwStatus(c.nsfwStatus),
        nsfwScores: parseNsfwScores(c.nsfwScores),
      });
    }
  };
  if (Array.isArray(coverRaw)) {
    for (const item of coverRaw) {
      if (item && typeof item === "object") parseCover(item as Record<string, unknown>);
    }
  } else if (coverRaw && typeof coverRaw === "object") {
    parseCover(coverRaw as Record<string, unknown>);
  }

  return {
    documentId: String(raw.documentId || raw.id || ""),
    title: String(raw.title || ""),
    text: String(raw.text || ""),
    editorState: Array.isArray(raw.editorState) ? raw.editorState : undefined,
    cover: covers,
    hasPublishedVersion: raw.hasPublishedVersion === true,
    category: toPostCategory(raw.category),
    createdAt: raw.createdAt as string | undefined,
    updatedAt: raw.updatedAt as string | undefined,
  };
}

// 用浏览器原生 SubtleCrypto 计算文件内容 SHA-256（hex 小写），用于内容级去重。
// 在非安全上下文（HTTP 且非 localhost）或不支持 SubtleCrypto 的环境下返回 undefined，
// 此时上传链路自动退化为普通直传，不影响功能。
async function computeFileSha256(file: File): Promise<string | undefined> {
  if (typeof globalThis === "undefined") return undefined;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof file.arrayBuffer !== "function") return undefined;
  try {
    const buffer = await file.arrayBuffer();
    const digest = await subtle.digest("SHA-256", buffer);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i += 1) {
      hex += bytes[i]!.toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    return undefined;
  }
}

function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function toComment(raw: unknown, apiBaseUrl: string): Comment {
  const data = (raw || {}) as Record<string, unknown>;
  const repliesRaw = Array.isArray(data.replies) ? data.replies : [];
  const articleRaw = data.article as Record<string, unknown> | null | undefined;
  return {
    id: String(data.documentId || data.id || ""),
    content: String(data.content || ""),
    images: extractAllMediaMeta(data.images, apiBaseUrl),
    liked: data.liked === true,
    likesCount: Number(data.likesCount ?? 0),
    createdAt: data.createdAt as string | undefined,
    author: toAuthor(data.author, apiBaseUrl),
    replies: repliesRaw.map((item) => {
      const reply = item as Record<string, unknown>;
      return {
        id: String(reply.documentId || reply.id || ""),
        content: String(reply.content || ""),
        images: extractAllMediaMeta(reply.images, apiBaseUrl),
        liked: reply.liked === true,
        likesCount: Number(reply.likesCount ?? 0),
        createdAt: reply.createdAt as string | undefined,
        author: toAuthor(reply.author, apiBaseUrl),
      };
    }),
    articleId: articleRaw ? String(articleRaw.documentId || "") : undefined,
    articleTitle: articleRaw ? String(articleRaw.title || "") : undefined,
    isPinned: data.isPinned === true,
    pinnedAt: data.pinnedAt as string | undefined,
    floor: typeof data.floor === "number" ? data.floor : undefined,
  };
}

export function useApi() {
  const { $api, $queryClient } = useNuxtApp();
  const config = useRuntimeConfig();
  const apiBaseUrl = String(config.public.apiBaseUrl || "").replace(/\/+$/, "");

  // 统一的读接口缓存包裹器（staleTime 内同 queryKey 直接命中，不触发 queryFn）
  const cachedRead = <T>(
    queryKey: QueryKey,
    queryFn: () => Promise<T>,
    staleTime = STALE_LIST,
  ): Promise<T> => {
    const qc = $queryClient as QueryClient | undefined;
    if (!qc) return queryFn();
    return qc.fetchQuery({ queryKey, queryFn, staleTime });
  };

  const invalidate = (queryKey: QueryKey) => {
    const qc = $queryClient as QueryClient | undefined;
    if (!qc) return;
    // 非 exact：以 queryKey 为前缀批量失效；下次 fetchQuery 时会真正重新拉取
    qc.invalidateQueries({ queryKey });
  };

  const clearAllCache = () => {
    const qc = $queryClient as QueryClient | undefined;
    qc?.clear();
    // 身份变更：清掉累积的已读集合，避免把上个用户的已读态带给新用户。
    knownReadIds.clear();
  };

  // 供页面在"用户明确刷新"等场景下跳过 staleTime 缓存使用
  const invalidateQueries = (queryKey: QueryKey) => invalidate(queryKey);

  const login = async (
    email: string,
    password: string,
  ): Promise<AuthResult> => {
    const response = await $api("/api/auth/local", {
      method: "POST",
      body: { identifier: email, password },
    });
    const data = response as Record<string, unknown>;
    // 身份变更：清空所有缓存，避免带上旧用户的 isRead / liked 等个性化字段
    clearAllCache();
    return {
      token: (data.jwt as string | undefined) || null,
      user: toAuthor(data.user, apiBaseUrl),
    };
  };

  const sendRegisterCode = async (
    email: string,
  ): Promise<SendRegisterCodeResult> => {
    const response = await $api("/api/auth/send-register-code", {
      method: "POST",
      body: { email },
    });
    const data = response as Record<string, unknown>;
    return {
      email: String(data.email || email),
      sent: data.sent === true,
      expiresIn: Number(data.expiresIn || 600),
      cooldown: Number(data.cooldown || 60),
    };
  };

  const registerWithCode = async (
    email: string,
    code: string,
    password: string,
  ): Promise<AuthResult> => {
    const response = await $api("/api/auth/register-with-code", {
      method: "POST",
      body: { email, code, password },
    });
    const data = response as Record<string, unknown>;
    clearAllCache();
    return {
      token: (data.jwt as string | undefined) || null,
      user: toAuthor(data.user, apiBaseUrl),
    };
  };

  const sendResetCode = async (
    email: string,
  ): Promise<SendResetCodeResult> => {
    const response = await $api("/api/auth/send-reset-code", {
      method: "POST",
      body: { email },
    });
    const data = response as Record<string, unknown>;
    return {
      email: String(data.email || email),
      sent: data.sent === true,
      expiresIn: Number(data.expiresIn || 600),
      cooldown: Number(data.cooldown || 60),
    };
  };

  const resetPassword = async (
    email: string,
    code: string,
    password: string,
  ): Promise<{ success: boolean }> => {
    const response = await $api("/api/auth/reset-password", {
      method: "POST",
      body: { email, code, password },
    });
    const data = response as Record<string, unknown>;
    return { success: data.success === true };
  };

  // ── 米游社扫码登录 / 绑定 ──────────────────────────
  // $api 会自动带上 Authorization：已登录时创建的二维码是绑定模式，
  // 未登录（登录框）则是登录模式，由后端按会话区分。
  const createMihoyoQr = async (): Promise<MihoyoQrCreateResult> => {
    const response = await $api("/api/auth/mihoyo/qr", {
      method: "POST",
      body: {},
    });
    const data = response as Record<string, unknown>;
    return {
      qrUrl: String(data.qrUrl || ""),
      ticket: String(data.ticket || ""),
      expiresIn: Number(data.expiresIn || 180),
      mode: data.mode === "bind" ? "bind" : "login",
    };
  };

  const pollMihoyoQr = async (ticket: string): Promise<MihoyoQrPollResult> => {
    const response = await $api("/api/auth/mihoyo/qr/status", {
      method: "POST",
      body: { ticket },
    });
    const data = response as Record<string, unknown>;
    const status = String(data.status || "expired");
    if (status !== "confirmed") {
      return { status: status as "waiting" | "scanned" | "expired" | "cancelled" };
    }
    const binding = (data.binding as MihoyoBinding | null) ?? null;
    if (data.mode === "bind") {
      return { status: "confirmed", mode: "bind", binding };
    }
    clearAllCache();
    return {
      status: "confirmed",
      mode: "login",
      isNewUser: data.isNewUser === true,
      binding,
      auth: {
        token: (data.jwt as string | undefined) || null,
        user: toAuthor(data.user, apiBaseUrl),
      },
    };
  };

  const getMihoyoBinding = async (): Promise<MihoyoBinding | null> => {
    const response = await $api("/api/auth/mihoyo/binding");
    const data = response as Record<string, unknown>;
    return (data.binding as MihoyoBinding | null) ?? null;
  };

  const unbindMihoyo = async (): Promise<{ success: boolean }> => {
    const response = await $api("/api/auth/mihoyo/binding", {
      method: "DELETE",
    });
    const data = response as Record<string, unknown>;
    return { success: data.success === true };
  };

  const getSelfUser = async (): Promise<Author> => {
    return cachedRead(
      qk.me.self,
      async () => {
        const response = await $api("/api/me/profile");
        return toAuthor(response, apiBaseUrl);
      },
      STALE_ME,
    );
  };

  const searchArticles = async (
    query: string,
    endCur = "",
    category = "",
    feed: ArticleFeed = "recommend",
  ): Promise<Pagination<Post>> => {
    const start = parseStart(endCur);
    // feed != recommend 时把 feed 折进 category 缓存槽，避免推荐/关注/收藏互相串缓存。
    const cacheCategory = feed === "recommend" ? category : `${feed}|${category}`;
    return cachedRead(
      qk.articles.search(query, cacheCategory, start, DEFAULT_PAGE_SIZE),
      async () => {
        const endpoint = query ? "/api/articles/search" : "/api/articles/list";
        const response = await $api(endpoint, {
          query: {
            ...(query ? { q: query } : {}),
            ...(category ? { category } : {}),
            ...(feed !== "recommend" ? { feed } : {}),
            start: String(start),
            limit: String(DEFAULT_PAGE_SIZE),
          },
        });
        const meta = extractPaginationMeta(response);
        const data = unwrapData<unknown[]>(response) || [];
        const page = buildPagination(data.map((item) => toPost(item, apiBaseUrl)), start, meta);
        // 列表/搜索接口已对登录用户内联 isRead（权威态）；这里仅用本地乐观已读集合
        // 补齐「标记请求尚未落库」窗口内的节点，避免切分类重拉时已读短暂闪回未读。
        seedReadStatus(page.nodes);
        return page;
      },
      STALE_LIST,
    );
  };

  /**
   * 同步读取 searchArticles 的缓存——不触发网络请求。
   * 用于 pages/index.vue 在切回首页时同步预填 list，跳过 skeleton → fade → list
   * 双重过渡 440ms 的拖慢体验。命中后调用方应继续走 searchArticles 拿权威数据
   * （fresh 时同步返回相同引用，stale 时后台 refetch 并替换）。
   */
  const peekArticles = (
    query: string,
    endCur = "",
    category = "",
    feed: ArticleFeed = "recommend",
  ): Pagination<Post> | undefined => {
    const qc = $queryClient as QueryClient | undefined;
    if (!qc) return undefined;
    const start = parseStart(endCur);
    const cacheCategory = feed === "recommend" ? category : `${feed}|${category}`;
    return qc.getQueryData<Pagination<Post>>(
      qk.articles.search(query, cacheCategory, start, DEFAULT_PAGE_SIZE),
    );
  };

  /**
   * 实时联想搜索（GET /api/articles/suggest）：边输入边搜。
   * 走 Meilisearch，不走 TanStack 缓存（调用方自行防抖 + 丢弃过期响应）。
   */
  const suggestArticles = async (
    query: string,
    category = "",
  ): Promise<SearchSuggestion[]> => {
    const q = query.trim();
    if (!q) return [];
    const response = await $api("/api/articles/suggest", {
      query: {
        q,
        ...(category ? { category } : {}),
      },
    });
    const data = unwrapData<unknown[]>(response) || [];
    return data
      .map((raw): SearchSuggestion | null => {
        if (!raw || typeof raw !== "object") return null;
        const s = raw as Record<string, unknown>;
        const documentId = typeof s.documentId === "string" ? s.documentId : "";
        const title = typeof s.title === "string" ? s.title : "";
        if (!documentId || !title) return null;
        return {
          documentId,
          title,
          titleHighlighted:
            typeof s.titleHighlighted === "string" && s.titleHighlighted
              ? s.titleHighlighted
              : title,
          excerpt: typeof s.excerpt === "string" ? s.excerpt : "",
          authorName: typeof s.authorName === "string" ? s.authorName : null,
          categoryName: typeof s.categoryName === "string" ? s.categoryName : null,
          categorySlug: typeof s.categorySlug === "string" ? s.categorySlug : null,
          isAnonymous: s.isAnonymous === true,
        };
      })
      .filter((s): s is SearchSuggestion => s !== null);
  };

  /** 频道列表（GET /api/categories/list）：返回已上架分类，按 order 升序。 */
  const getCategories = async (): Promise<Category[]> => {
    return cachedRead(
      qk.categories.list,
      async () => {
        const response = await $api("/api/categories/list");
        const data = unwrapData<unknown[]>(response) || [];
        return data
          .map((raw): Category | null => {
            if (!raw || typeof raw !== "object") return null;
            const c = raw as Record<string, unknown>;
            const slug = typeof c.slug === "string" ? c.slug : "";
            const name = typeof c.name === "string" ? c.name : "";
            if (!slug || !name) return null;
            return {
              documentId: typeof c.documentId === "string" ? c.documentId : undefined,
              name,
              slug,
              order: typeof c.order === "number" ? c.order : undefined,
              adminOnly: c.adminOnly === true,
            };
          })
          .filter((c): c is Category => c !== null);
      },
      STALE_LIST,
    );
  };

  const getPost = async (id: string): Promise<Post> => {
    return cachedRead(
      qk.articles.detail(id),
      async () => {
        const response = await $api(`/api/articles/detail/${id}`);
        const post = toPost(unwrapData(response), apiBaseUrl);
        // 详情接口已对登录用户内联 isRead；本地乐观已读集合补齐尚未落库窗口。
        seedReadStatus([post]);
        return post;
      },
      STALE_DETAIL,
    );
  };

  const recordArticleView = async (id: string): Promise<number | undefined> => {
    if (!id) return undefined;
    const response = await $api(`/api/articles/${id}/view`, {
      method: "POST",
      body: {},
    });
    const data = response as Record<string, unknown>;
    const views = Number(data.views);
    return Number.isFinite(views) && views >= 0 ? views : undefined;
  };

  const getComments = async (
    postId: string,
    endCur = "",
    force = false,
  ): Promise<Pagination<Comment>> => {
    const start = parseStart(endCur);
    // 弹窗/页面首次加载首屏评论时，强制让该帖子评论缓存失效，避免直接命中旧缓存
    if (force && start === 0) {
      const queryKey = qk.articles.comments(postId, start, DEFAULT_PAGE_SIZE);
      const state = $queryClient?.getQueryState(queryKey);
      // 如果已经有强制请求在 flight，直接复用该 promise，不再重复失效/重拉
      if (state?.fetchStatus !== "fetching") {
        // 只失效首屏，避免污染 loadMore 的后续分页缓存
        invalidate(queryKey);
      }
    }
    return cachedRead(
      qk.articles.comments(postId, start, DEFAULT_PAGE_SIZE),
      async () => {
        const response = await $api("/api/comments/list", {
          query: {
            article: postId,
            start: String(start),
            limit: String(DEFAULT_PAGE_SIZE),
          },
        });
        const meta = extractPaginationMeta(response);
        const data = unwrapData<unknown[]>(response) || [];
        const pinnedRaw = (response as Record<string, unknown>).pinned;
        const pinned = start === 0 && pinnedRaw ? toComment(pinnedRaw, apiBaseUrl) : null;
        const nodes = data.map((item) => toComment(item, apiBaseUrl));
        if (pinned) nodes.unshift(pinned);
        return buildPagination(nodes, start, meta);
      },
      STALE_LIST,
    );
  };

  const addPostComment = async ({
    postId,
    content,
    parentId,
    authorDocumentId,
    isAnonymous,
    images,
  }: PostCommentPayload) => {
    const res = await $api("/api/comments", {
      method: "POST",
      body: {
        data: {
          article: postId,
          content,
          ...(authorDocumentId ? { author: authorDocumentId } : {}),
          ...(parentId ? { parent: parentId } : {}),
          ...(isAnonymous ? { isAnonymous: true } : {}),
          ...(images?.length ? { images } : {}),
        },
      },
    });
    // 评论数 & 评论列表改变
    invalidate(qk.articles.commentsOf(postId));
    invalidate(qk.articles.detail(postId));
    return res;
  };

  const deleteComment = async (commentId: string): Promise<void> => {
    await $api(`/api/comments/${commentId}`, {
      method: "DELETE",
    });
    // 不知道 postId，保守批量失效所有评论列表 & 委托详情（评论数） & profile 评论
    invalidate(["articles", "comments"]);
    invalidate(["articles", "detail"]);
    invalidate(["profile"]);
  };

  const pinComment = async (commentId: string, postId: string): Promise<void> => {
    await $api(`/api/comments/${commentId}/pin`, {
      method: "POST",
    });
    invalidate(qk.articles.commentsOf(postId));
    invalidate(qk.articles.detail(postId));
  };

  const unpinComment = async (commentId: string, postId: string): Promise<void> => {
    await $api(`/api/comments/${commentId}/unpin`, {
      method: "POST",
    });
    invalidate(qk.articles.commentsOf(postId));
    invalidate(qk.articles.detail(postId));
  };

  const toggleLike = async (
    targetType: "article" | "comment",
    targetId: string,
  ): Promise<LikeToggleResult> => {
    const response = await $api("/api/likes/toggle", {
      method: "POST",
      body: {
        targetType,
        targetId,
      },
    });
    const data = response as Record<string, unknown>;
    return {
      liked: data.liked === true,
      likesCount: Number(data.likesCount || 0),
    };
  };

  const batchCheckLikes = async (
    targetType: "article" | "comment",
    targetIds: string[],
  ): Promise<Record<string, boolean>> => {
    if (!targetIds.length) return {};
    const response = await $api("/api/likes/check", {
      query: {
        targetType,
        targetIds: targetIds.join(","),
      },
    });
    return (unwrapData(response) as Record<string, boolean>) || {};
  };

  const createReport = async (payload: {
    targetType: "article" | "comment" | "user";
    targetId: string;
    reason: string;
    detail?: string;
  }): Promise<{ documentId: string }> => {
    const response = await $api("/api/reports", {
      method: "POST",
      body: {
        targetType: payload.targetType,
        targetId: payload.targetId,
        reason: payload.reason,
        ...(payload.detail ? { detail: payload.detail } : {}),
      },
    });
    const data = (unwrapData(response) || response || {}) as Record<string, unknown>;
    return { documentId: String(data.documentId || "") };
  };

  const batchCheckReports = async (
    targetType: "article" | "comment" | "user",
    targetIds: string[],
  ): Promise<Record<string, boolean>> => {
    if (!targetIds.length) return {};
    const response = await $api("/api/reports/check", {
      query: {
        targetType,
        targetIds: targetIds.join(","),
      },
    });
    return (unwrapData(response) as Record<string, boolean>) || {};
  };

  const toggleFavorite = async (
    articleDocumentId: string,
  ): Promise<FavoriteToggleResult> => {
    const response = await $api("/api/favorites/toggle", {
      method: "POST",
      body: { targetId: articleDocumentId },
    });
    const data = response as Record<string, unknown>;
    return {
      favorited: data.favorited === true,
      favoritesCount: Number(data.favoritesCount || 0),
    };
  };

  const batchCheckFavorites = async (
    targetIds: string[],
  ): Promise<Record<string, boolean>> => {
    if (!targetIds.length) return {};
    const response = await $api("/api/favorites/check", {
      query: { targetIds: targetIds.join(",") },
    });
    return (unwrapData(response) as Record<string, boolean>) || {};
  };

  const toggleFollow = async (
    authorDocumentId: string,
  ): Promise<FollowToggleResult> => {
    const response = await $api("/api/follows/toggle", {
      method: "POST",
      body: { authorDocumentId },
    });
    const data = response as Record<string, unknown>;
    return {
      following: data.following === true,
      followersCount: Number(data.followersCount || 0),
    };
  };

  const batchCheckFollows = async (
    authorDocumentIds: string[],
  ): Promise<Record<string, boolean>> => {
    if (!authorDocumentIds.length) return {};
    const response = await $api("/api/follows/check", {
      query: { authorIds: authorDocumentIds.join(",") },
    });
    return (unwrapData(response) as Record<string, boolean>) || {};
  };

  const toggleUserBlock = async (
    authorDocumentId: string,
  ): Promise<UserBlockToggleResult> => {
    const response = await $api("/api/user-blocks/toggle", {
      method: "POST",
      body: { authorDocumentId },
    });
    const data = response as Record<string, unknown>;
    return {
      blocked: data.blocked === true,
      authorDocumentId: String(data.authorDocumentId || authorDocumentId),
    };
  };

  const batchCheckUserBlocks = async (
    authorDocumentIds: string[],
  ): Promise<Record<string, boolean>> => {
    if (!authorDocumentIds.length) return {};
    const response = await $api("/api/user-blocks/check", {
      query: { authorIds: authorDocumentIds.join(",") },
    });
    return (unwrapData(response) as Record<string, boolean>) || {};
  };

  const getMyBlockedList = async (
    endCur = "",
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<Pagination<BlockedUser>> => {
    const start = parseStart(endCur);
    const response = await $api("/api/user-blocks/my-list", {
      query: { start: String(start), limit: String(limit) },
    });
    const meta = extractPaginationMeta(response);
    const data = unwrapData<unknown[]>(response) || [];
    const nodes = data
      .map((item) => {
        const u = item as Record<string, unknown>;
        const avatarUrl = u.avatar;
        return {
          documentId: String(u.documentId || ""),
          name: typeof u.name === "string" ? u.name : undefined,
          username: typeof u.username === "string" ? u.username : undefined,
          level: typeof u.level === "number" ? u.level : undefined,
          avatar: typeof avatarUrl === "string" && avatarUrl
            ? normalizeMediaUrl(avatarUrl, apiBaseUrl)
            : undefined,
          createdAt: typeof u.createdAt === "string" ? u.createdAt : undefined,
        };
      })
      .filter((u) => u.documentId);
    return buildPagination(nodes, start, meta);
  };

  /**
   * 把「已读」写回 query 缓存：遍历所有文章列表/详情/个人页文章缓存，
   * 命中 id 的节点置 isRead=true。否则乐观已读只活在当前页面的 list 里，
   * 缓存（peekArticles 预填 / staleTime 内复用）仍是 isRead=false，
   * 切走再回来就又显示未读。仅在确有变化时返回新引用，避免无谓重渲染。
   */
  const markReadInQueryCache = (articleDocumentIds: string[]) => {
    if (!articleDocumentIds.length) return;
    const ids = new Set(articleDocumentIds);
    // 乐观已读也累积到全局集合：切走再回来/切分类重拉时同样不丢已读态。
    rememberReadIds(ids);
    const qc = $queryClient as QueryClient | undefined;
    if (!qc) return;

    const markPost = (post: Post): Post =>
      post && ids.has(post.id) && !post.isRead ? { ...post, isRead: true } : post;

    qc.setQueriesData<unknown>(
      {
        predicate: (query) => {
          const key = query.queryKey as readonly unknown[];
          if (key[0] === "articles" && (key[1] === "search" || key[1] === "detail")) {
            return true;
          }
          // ["profile", documentId, "articles", ...]
          return key[0] === "profile" && key[2] === "articles";
        },
      },
      (data: unknown) => {
        if (!data || typeof data !== "object") return data;
        // 列表页：Pagination<Post>（含 nodes 数组）
        if (Array.isArray((data as Pagination<Post>).nodes)) {
          const page = data as Pagination<Post>;
          let changed = false;
          const nodes = page.nodes.map((node) => {
            const next = markPost(node);
            if (next !== node) changed = true;
            return next;
          });
          return changed ? { ...page, nodes } : page;
        }
        // 详情页：单个 Post
        if (typeof (data as Post).id === "string") {
          return markPost(data as Post);
        }
        return data;
      },
    );
  };

  const markAsReadBatch = async (articleDocumentIds: string[]) => {
    if (!articleDocumentIds.length) return;
    await $api("/api/article-reads/batch", {
      method: "POST",
      body: { articleDocumentIds, markAsRead: true },
    });
    // 持久化成功后写回缓存：保证切走再回来（peekArticles 预填 / staleTime 复用）
    // 拿到的也是已读态，而非旧的未读快照（否则已读 API 成功了，列表却仍显示未读）。
    // 失败则不写缓存，与服务端「未读」保持一致，由调用方回滚本地 list。
    markReadInQueryCache(articleDocumentIds);
  };

  const getProfile = async (documentId: string): Promise<Profile> => {
    return cachedRead(
      qk.profile.detail(documentId),
      () => getProfileImpl(documentId),
      STALE_DETAIL,
    );
  };

  const getProfileImpl = async (documentId: string): Promise<Profile> => {
    const response = await $api(`/api/profiles/${documentId}`);
    const data = unwrapData<Record<string, unknown>>(response);

    const avatarRaw = data.avatar as Record<string, unknown> | string | null | undefined;
    let avatarUrl: string | undefined;
    if (typeof avatarRaw === "string") {
      avatarUrl = normalizeMediaUrl(avatarRaw, apiBaseUrl);
    } else if (avatarRaw && typeof avatarRaw === "object" && typeof avatarRaw.url === "string") {
      avatarUrl = normalizeMediaUrl(avatarRaw.url, apiBaseUrl);
    }

    let bioText: string | undefined;
    const bioRaw = data.bio;
    if (typeof bioRaw === "string") {
      bioText = bioRaw;
    } else if (Array.isArray(bioRaw)) {
      const parts: string[] = [];
      for (const block of bioRaw) {
        if (block && typeof block === "object" && block.type === "paragraph" && Array.isArray(block.children)) {
          for (const child of block.children) {
            if (child && typeof child === "object" && child.type === "text" && typeof child.text === "string") {
              parts.push(child.text);
            }
          }
        }
      }
      bioText = parts.join("") || undefined;
    }

    const userRaw = data.user as Record<string, unknown> | null | undefined;
    const statsRaw = data.stats as Record<string, unknown> | null | undefined;

    const zzzRaw = data.zzz as Record<string, unknown> | null | undefined;
    const zzz: ZzzRoleBadge | null = zzzRaw?.uid
      ? {
          uid: String(zzzRaw.uid),
          nickname: (zzzRaw.nickname as string | undefined) || undefined,
          level: zzzRaw.level != null ? Number(zzzRaw.level) : undefined,
          regionName: (zzzRaw.regionName as string | undefined) || undefined,
        }
      : null;

    const equippedCardRaw = data.equippedCard;
    const equippedCard = toBusinessCard(equippedCardRaw, apiBaseUrl);

    const equippedAvatarRaw = data.equippedAvatar;
    const equippedAvatar = toAvatar(equippedAvatarRaw, apiBaseUrl);

    return {
      documentId: String(data.documentId || documentId),
      uid: data.userId != null ? Number(data.userId) : undefined,
      login: (userRaw?.username as string) || (data.login as string | undefined),
      name: data.name as string | undefined,
      bio: bioText,
      avatar: equippedAvatar?.image || avatarUrl,
      level: Number(userRaw?.level ?? data.level ?? 1),
      exp: Number(userRaw?.exp ?? data.exp ?? 0),
      isSelf: data.isSelf === true,
      isHidden: data.isHidden === true,
      profileHidden: data.profileHidden === true,
      isAiAgent: data.isAiAgent === true,
      isBlockedByMe: data.isBlockedByMe === true,
      hasBlockedMe: data.hasBlockedMe === true,
      zzz,
      isFollowing: data.isFollowing === true,
      followersCount: Number(data.followersCount || 0),
      followingCount: Number(data.followingCount || 0),
      stats: statsRaw
        ? {
            articleCount: Number(statsRaw.articleCount || 0),
            commentCount: Number(statsRaw.commentCount || 0),
            totalViews: Number(statsRaw.totalViews || 0),
            totalComments: Number(statsRaw.totalComments || 0),
            totalLikes: Number(statsRaw.totalLikes || 0),
          }
        : undefined,
      equippedCard,
      equippedAvatar,
    };
  };

  const getProfileArticles = async (
    documentId: string,
    endCur = "",
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<Pagination<Post>> => {
    const start = parseStart(endCur);
    return cachedRead(
      qk.profile.articles(documentId, start, limit),
      async () => {
        const response = await $api(`/api/profiles/${documentId}/articles`, {
          query: {
            start: String(start),
            limit: String(limit),
          },
        });
        const meta = extractPaginationMeta(response);
        const data = unwrapData<unknown[]>(response) || [];
        const page = buildPagination(data.map((item) => toPost(item, apiBaseUrl)), start, meta);
        // 个人页文章接口已对登录用户内联 isRead；这里仅用本地乐观已读集合补齐
        // 「标记请求尚未落库」窗口，避免重入个人页时已读短暂闪回未读。
        seedReadStatus(page.nodes);
        return page;
      },
      STALE_LIST,
    );
  };

  const getProfileComments = async (
    documentId: string,
    endCur = "",
  ): Promise<Pagination<Comment>> => {
    const start = parseStart(endCur);
    return cachedRead(
      qk.profile.comments(documentId, start, DEFAULT_PAGE_SIZE),
      async () => {
        const response = await $api(`/api/profiles/${documentId}/comments`, {
          query: {
            start: String(start),
            limit: String(DEFAULT_PAGE_SIZE),
          },
        });
        const meta = extractPaginationMeta(response);
        const data = unwrapData<unknown[]>(response) || [];
        return buildPagination(data.map((item) => toComment(item, apiBaseUrl)), start, meta);
      },
      STALE_LIST,
    );
  };

  const createArticleDraft = async (payload: {
    title: string;
    text: string;
    editorState?: unknown[];
    coverId?: string | string[];
    authorId?: string;
    isAnonymous?: boolean;
    category?: string;
  }): Promise<DraftArticle> => {
    const data: Record<string, unknown> = {
      title: payload.title,
      text: payload.text,
      editorState: payload.editorState,
    };
    if (payload.category) {
      data.category = payload.category;
    }
    if (payload.coverId != null) {
      data.cover = payload.coverId;
    }
    if (payload.authorId) {
      data.author = { connect: [{ documentId: payload.authorId }] };
    }
    if (payload.isAnonymous) {
      data.isAnonymous = true;
    }
    const response = await $api("/api/articles", {
      method: "POST",
      query: { status: "draft" },
      body: { data },
    });
    const raw = unwrapData<Record<string, unknown>>(response);
    invalidate(qk.me.drafts);
    return toDraftArticle(raw);
  };

  const updateArticleDraft = async (
    id: string,
    payload: {
      title?: string;
      text?: string;
      editorState?: unknown[];
      coverId?: string | string[] | null;
      authorId?: string;
      isAnonymous?: boolean;
      category?: string;
    },
  ): Promise<DraftArticle> => {
    const data: Record<string, unknown> = {};
    if (payload.title !== undefined) data.title = payload.title;
    if (payload.text !== undefined) data.text = payload.text;
    data.editorState = payload.editorState;
    if (payload.category) data.category = payload.category;
    if (payload.coverId !== undefined) {
      data.cover = payload.coverId ?? [];
    }
    if (payload.isAnonymous !== undefined) {
      data.isAnonymous = payload.isAnonymous;
    }
    const response = await $api(`/api/articles/${id}`, {
      method: "PUT",
      query: { status: "draft" },
      body: { data },
    });
    const raw = unwrapData<Record<string, unknown>>(response);
    invalidate(qk.me.draft(id));
    invalidate(qk.me.drafts);
    invalidate(qk.articles.detail(id));
    return toDraftArticle(raw);
  };

  const publishArticleDraft = async (id: string): Promise<void> => {
    await $api(`/api/articles/${id}/publish`, {
      method: "POST",
      body: {},
    });
    invalidate(qk.me.drafts);
    invalidate(qk.articles.detail(id));
    invalidate(qk.articles.searchAll);
    invalidate(["profile"]);
  };

  const discardArticleDraft = async (id: string): Promise<void> => {
    await $api(`/api/articles/${id}/discard-draft`, {
      method: "POST",
      body: {},
    });
    invalidate(qk.me.draft(id));
  };

  const deleteArticle = async (id: string): Promise<void> => {
    await $api(`/api/articles/${id}`, {
      method: "DELETE",
    });
    invalidate(qk.me.drafts);
    invalidate(qk.articles.detail(id));
    invalidate(qk.articles.searchAll);
    invalidate(["profile"]);
  };

  const getMyDrafts = async (
    endCur = "",
  ): Promise<Pagination<DraftArticle>> => {
    const start = parseStart(endCur);
    return cachedRead(
      ["me", "drafts", start, DEFAULT_PAGE_SIZE] as QueryKey,
      async () => {
        const response = await $api("/api/articles/my/drafts", {
          query: {
            start: String(start),
            limit: String(DEFAULT_PAGE_SIZE),
          },
        });
        const meta = extractPaginationMeta(response);
        const data = unwrapData<unknown[]>(response) || [];
        return buildPagination(
          data.map((item) => toDraftArticle(item as Record<string, unknown>)),
          start,
          meta,
        );
      },
      STALE_LIST,
    );
  };

  const getMyDraftDetail = async (documentId: string): Promise<DraftArticle> => {
    return cachedRead(
      qk.me.draft(documentId),
      async () => {
        const response = await $api(`/api/articles/my/detail/${documentId}`);
        const raw = unwrapData<Record<string, unknown>>(response);
        return toDraftArticle(raw);
      },
      STALE_DETAIL,
    );
  };

  const toUploadedFile = (raw: Record<string, unknown>): UploadedFile => ({
    id: Number(raw.id || 0),
    documentId: String(raw.documentId || ""),
    name: typeof raw.name === "string" ? raw.name : undefined,
    url: normalizeMediaUrl(raw.url, apiBaseUrl),
    mime: typeof raw.mime === "string" ? raw.mime : undefined,
    size: parsePositiveNumber(raw.size),
    width: parsePositiveNumber(raw.width),
    height: parsePositiveNumber(raw.height),
    nsfwStatus: parseNsfwStatus(raw.nsfwStatus),
    nsfwScores: parseNsfwScores(raw.nsfwScores),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
  });

  const getMyUploads = async (page = 1, pageSize = 24): Promise<MyUploadsResult> => {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.floor(pageSize));
    return cachedRead(
      qk.me.uploads(safePage, safePageSize),
      async () => {
        const response = await $api("/api/me/uploads", {
          query: {
            page: String(safePage),
            pageSize: String(safePageSize),
          },
        });
        const data = response as Record<string, unknown>;
        const rawUploads = Array.isArray(data.data) ? data.data : [];
        const meta = data.meta && typeof data.meta === "object" ? data.meta as Record<string, unknown> : {};
        const pagination = meta.pagination && typeof meta.pagination === "object"
          ? meta.pagination as Record<string, unknown>
          : {};
        const uploads = rawUploads
          .map((item) => toUploadedFile(item as Record<string, unknown>))
          .filter((upload) => upload.documentId && upload.url && (!upload.mime || upload.mime.startsWith("image/")));

        return {
          uploads,
          pagination: {
            page: parsePositiveNumber(pagination.page) ?? safePage,
            pageSize: parsePositiveNumber(pagination.pageSize) ?? safePageSize,
            total: parsePositiveNumber(pagination.total) ?? uploads.length,
            pageCount: parsePositiveNumber(pagination.pageCount) ?? 1,
          },
        };
      },
      STALE_ME,
    );
  };

  const deleteMyUpload = async (documentId: string): Promise<{ deleted: boolean; inUse: boolean }> => {
    const response = await $api(`/api/me/uploads/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
    });
    invalidate(["me", "uploads"]);
    const data = (response as Record<string, unknown>)?.data;
    const result = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    return {
      deleted: result.deleted === true,
      inUse: result.inUse === true,
    };
  };

  const signUpload = async (payload: {
    filename: string;
    mimeType: string;
    size: number;
    contentHash?: string;
  }): Promise<SignedUploadResult> => {
    const response = await $api("/api/direct-upload/sign", {
      method: "POST",
      body: payload,
    });
    const data = unwrapData<Record<string, unknown>>(response);
    const existingRaw = data.existing as Record<string, unknown> | undefined;
    return {
      uploadUrl: String(data.uploadUrl || ""),
      uploadToken: String(data.uploadToken || ""),
      method: String(data.method || "PUT"),
      objectKey: String(data.objectKey || ""),
      publicUrl: String(data.publicUrl || ""),
      headers: (data.headers as Record<string, string>) || {},
      expiresAt: String(data.expiresAt || ""),
      existing: existingRaw ? toUploadedFile(existingRaw) : undefined,
    };
  };

  const completeUpload = async (payload: {
    uploadToken: string;
    width?: number;
    height?: number;
  }): Promise<UploadedFile> => {
    const response = await $api("/api/direct-upload/complete", {
      method: "POST",
      body: payload,
    });
    return toUploadedFile(unwrapData<Record<string, unknown>>(response));
  };

  const uploadImage = async (
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<UploadedFile> => {
    onProgress?.(0);

    // 在签名前计算内容 SHA-256，用于服务端的内容级去重。
    const contentHash = await computeFileSha256(file);
    onProgress?.(5);

    const signed = await signUpload({
      filename: file.name,
      mimeType: file.type || "image/jpeg",
      size: file.size,
      contentHash,
    });

    // 服务端命中同内容的已有文件，直接复用，不走 S3 PUT 与 complete。
    if (signed.existing) {
      onProgress?.(100);
      return signed.existing;
    }
    onProgress?.(10);

    await fetch(signed.uploadUrl, {
      method: signed.method,
      headers: signed.headers,
      body: file,
    }).then((res) => {
      if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
    });
    onProgress?.(80);

    const dims = await getImageDimensions(file);
    const uploaded = await completeUpload({
      uploadToken: signed.uploadToken,
      width: dims?.width,
      height: dims?.height,
    });
    onProgress?.(100);

    return uploaded;
  };

  const getMyBusinessCards = async (type?: BusinessCardType): Promise<MyBusinessCardsResult> => {
    return cachedRead(
      qk.me.businessCards(type),
      async () => {
        const response = await $api("/api/me/business-cards", {
          query: type ? { type } : undefined,
        });
        const data = response as Record<string, unknown>;
        const rawCards = Array.isArray(data.data) ? data.data : [];
        return {
          cards: rawCards.map((item) => toBusinessCard(item, apiBaseUrl)).filter(Boolean) as BusinessCard[],
          equippedCardDocumentId: (data.equippedCardDocumentId as string) || null,
          equippedCard: toBusinessCard(data.equippedCard, apiBaseUrl) || null,
        };
      },
      STALE_ME,
    );
  };

  const equipBusinessCard = async (documentId: string | null): Promise<void> => {
    await $api("/api/me/business-cards/equip", {
      method: "PUT",
      body: { documentId },
    });
    invalidate(["me", "business-cards"]);
    invalidate(["profile"]);
  };

  const getMyAvatars = async (): Promise<{ avatars: Avatar[]; equippedAvatarDocumentId: string | null }> => {
    return cachedRead(
      qk.me.avatars,
      async () => {
        const response = await $api("/api/me/avatars");
        const data = response as Record<string, unknown>;
        const rawAvatars = Array.isArray(data.data) ? data.data : [];
        return {
          avatars: rawAvatars.map((item) => toAvatar(item, apiBaseUrl)).filter(Boolean) as Avatar[],
          equippedAvatarDocumentId: (data.equippedAvatarDocumentId as string) || null,
        };
      },
      STALE_ME,
    );
  };

  const equipAvatar = async (documentId: string | null): Promise<void> => {
    await $api("/api/me/avatars/equip", {
      method: "PUT",
      body: { documentId },
    });
    invalidate(qk.me.avatars);
    invalidate(qk.me.self);
    invalidate(["profile"]);
  };

  const uploadCustomAvatar = async (
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<{ url: string }> => {
    const uploaded = await uploadImage(file, (p) => onProgress?.(p * 0.8));
    const response = await $api("/api/me/avatars/upload-custom", {
      method: "PUT",
      body: { fileId: uploaded.id },
    });
    onProgress?.(100);
    const data = response as Record<string, unknown>;
    const avatar = data.avatar as Record<string, unknown> | undefined;
    invalidate(qk.me.avatars);
    invalidate(qk.me.self);
    invalidate(["profile"]);
    return { url: normalizeMediaUrl(avatar?.url, apiBaseUrl) };
  };

  const updateMyName = async (name: string): Promise<{ name: string }> => {
    const response = await $api("/api/me/profile/name", {
      method: "PUT",
      body: { name },
    });
    const data = response as Record<string, unknown>;
    invalidate(qk.me.self);
    invalidate(qk.me.profile);
    invalidate(["profile"]);
    return { name: String(data.name || name) };
  };

  const updateMyBio = async (bio: string): Promise<{ bio: string }> => {
    const response = await $api("/api/me/profile/bio", {
      method: "PUT",
      body: { bio },
    });
    const data = response as Record<string, unknown>;
    invalidate(qk.me.self);
    invalidate(qk.me.profile);
    invalidate(["profile"]);
    return { bio: String(data.bio ?? bio) };
  };

  const updateMyVisibility = async (profileHidden: boolean): Promise<{ profileHidden: boolean }> => {
    const response = await $api("/api/me/profile/visibility", {
      method: "PUT",
      body: { profileHidden },
    });
    const data = response as Record<string, unknown>;
    invalidate(qk.me.self);
    invalidate(qk.me.profile);
    invalidate(["profile"]);
    return { profileHidden: data.profileHidden === true };
  };

  const getMyProfileSettings = async (): Promise<{ profileHidden: boolean }> => {
    return cachedRead(
      qk.me.profile,
      async () => {
        const response = await $api("/api/me/profile");
        const data = response as Record<string, unknown>;
        return { profileHidden: data.profileHidden === true };
      },
      STALE_ME,
    );
  };

  // ── 账号安全（/api/me/security、邮箱绑定、密码设置） ─────────────

  const getMySecurity = async (): Promise<AccountSecurity> => {
    const response = await $api("/api/me/security");
    const data = response as Record<string, unknown>;
    return {
      email: String(data.email || ""),
      provider: data.provider === "local" ? "local" : "mihoyo",
      hasBoundEmail: data.hasBoundEmail === true,
      hasPassword: data.hasPassword === true,
    };
  };

  const sendBindEmailCode = async (email: string): Promise<SendRegisterCodeResult> => {
    const response = await $api("/api/me/email/send-code", {
      method: "POST",
      body: { email },
    });
    const data = response as Record<string, unknown>;
    return {
      email: String(data.email || email),
      sent: data.sent === true,
      expiresIn: Number(data.expiresIn || 600),
      cooldown: Number(data.cooldown || 60),
    };
  };

  const bindEmail = async (email: string, code: string): Promise<AccountSecurity> => {
    const response = await $api("/api/me/email", {
      method: "PUT",
      body: { email, code },
    });
    const data = response as Record<string, unknown>;
    invalidate(qk.me.self);
    invalidate(qk.me.profile);
    return {
      email: String(data.email || email),
      provider: data.provider === "local" ? "local" : "mihoyo",
      hasBoundEmail: data.hasBoundEmail === true,
      hasPassword: data.hasPassword === true,
    };
  };

  const getPinnedArticles = async (
    limit?: number,
  ): Promise<{
    pinned: string[] | null;
    candidates: Array<{
      documentId: string;
      title: string;
      cover: MediaMeta | null;
      updatedAt?: string;
    }>;
    max: number;
  }> => {
    return cachedRead(
      [...qk.me.pinnedArticles, limit ?? null] as QueryKey,
      async () => {
        const response = await $api("/api/me/profile/pinned-articles", {
          query: limit != null ? { limit: String(limit) } : undefined,
        });
        const data = response as Record<string, unknown>;
        const pinnedRaw = data.pinned;
        const pinned = Array.isArray(pinnedRaw)
          ? pinnedRaw.filter((id): id is string => typeof id === "string")
          : pinnedRaw === null
            ? null
            : null;
        const candidatesRaw = Array.isArray(data.candidates) ? data.candidates : [];
        const candidates = candidatesRaw.map((item) => {
          const c = item as Record<string, unknown>;
          return {
            documentId: String(c.documentId || ""),
            title: String(c.title || ""),
            cover: extractMediaMeta(c.cover, apiBaseUrl),
            updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : undefined,
          };
        });
        const max = Number(data.max) || 6;
        return { pinned, candidates, max };
      },
      STALE_ME,
    );
  };

  /**
   * 评论编辑器里 @ 触发的用户搜索。
   * - 不缓存：输入快、命中率低，缓存只会增加状态复杂度
   * - 限流交给后端 Redis 计数；前端只对 q 做最简校验
   */
  const searchAuthors = async (
    q: string,
    limit = 8,
  ): Promise<MentionCandidate[]> => {
    const trimmed = q?.trim() ?? "";
    if (!trimmed) return [];
    const response = await $api("/api/authors/search", {
      query: { q: trimmed, limit: String(limit) },
    });
    const data = (response as Record<string, unknown>)?.data;
    if (!Array.isArray(data)) return [];
    return data.map((raw) => {
      const item = raw as Record<string, unknown>;
      const avatarUrl = item.avatar;
      return {
        documentId: String(item.documentId || ""),
        name: String(item.name || ""),
        username: typeof item.username === "string" ? item.username : null,
        level: typeof item.level === "number" ? item.level : null,
        avatar: typeof avatarUrl === "string" && avatarUrl
          ? normalizeMediaUrl(avatarUrl, apiBaseUrl)
          : null,
      };
    });
  };

  const updatePinnedArticles = async (
    pinned: string[] | null,
  ): Promise<{ pinned: string[] | null }> => {
    const response = await $api("/api/me/profile/pinned-articles", {
      method: "PUT",
      body: { pinned },
    });
    const data = response as Record<string, unknown>;
    const result = data.pinned;
    invalidate(qk.me.pinnedArticles);
    invalidate(["profile"]);
    return {
      pinned: Array.isArray(result)
        ? result.filter((id): id is string => typeof id === "string")
        : result === null
          ? null
          : null,
    };
  };

  // ── 丁尼(Denny)货币系统 ───────────────────────────────

  /**
   * 获取当前用户的丁尼余额和最近记录
   */
  const getMyDenny = async (): Promise<{
    denny: number;
    dennyGiven: number;
    recentLogs: Array<{
      action: string;
      amount: number;
      balance: number;
      description: string;
      createdAt: string;
    }>;
  }> => {
    const response = await $api("/api/user-denny", {
      method: "GET",
    });
    const data = response as Record<string, unknown>;
    return {
      denny: Number(data.denny) || 0,
      dennyGiven: Number(data.dennyGiven) || 0,
      recentLogs: Array.isArray(data.recentLogs)
        ? data.recentLogs.map((log: any) => ({
            action: String(log.action || ""),
            amount: Number(log.amount) || 0,
            balance: Number(log.balance) || 0,
            description: String(log.description || ""),
            createdAt: String(log.createdAt || ""),
          }))
        : [],
    };
  };

  /**
   * 给委托投币
   */
  const giveDennyToArticle = async (
    articleId: string,
    message?: string,
  ): Promise<{
    success: boolean;
    newBalance: number;
    articleDennyCount: number;
  }> => {
    const response = await $api("/api/user-denny/give", {
      method: "POST",
      body: { articleId, message },
    });
    const data = response as Record<string, unknown>;
    return {
      success: Boolean(data.success),
      newBalance: Number(data.newBalance) || 0,
      articleDennyCount: Number(data.articleDennyCount) || 0,
    };
  };

  /**
   * 一键三连：点赞 + 收藏（幂等） + 投币（软失败）
   * 后端原子接口，一次返回三态；投币失败不影响点赞+收藏。
   */
  const tripleAction = async (
    articleId: string,
  ): Promise<{
    liked: boolean;
    likesCount: number;
    favorited: boolean;
    favoritesCount: number;
    coinGiven: boolean;
    coinReason: string;
    dennyCount: number;
    newBalance: number | null;
  }> => {
    const response = await $api("/api/articles/triple", {
      method: "POST",
      body: { articleId },
    });
    const d = response as Record<string, unknown>;
    return {
      liked: d.liked === true,
      likesCount: Number(d.likesCount || 0),
      favorited: d.favorited === true,
      favoritesCount: Number(d.favoritesCount || 0),
      coinGiven: d.coinGiven === true,
      coinReason: String(d.coinReason || "FAILED"),
      dennyCount: Number(d.dennyCount || 0),
      newBalance: typeof d.newBalance === "number" ? d.newBalance : null,
    };
  };

  // ── 签到系统 ──────────────────────────────────────────

  /**
   * 获取签到状态
   */
  const getCheckInStatus = async (): Promise<{
    canCheckIn: boolean;
    totalDays: number;
    consecutiveDays: number;
    rank: number;
    nextEligibleAt: string | null;
  }> => {
    const response = await $api("/api/check-in/status", {
      method: "GET",
    });
    const data = response as Record<string, unknown>;
    return {
      canCheckIn: Boolean(data.canCheckIn),
      totalDays: Number(data.totalDays) || 0,
      consecutiveDays: Number(data.consecutiveDays) || 0,
      rank: Number(data.rank) || 0,
      nextEligibleAt: typeof data.nextEligibleAt === "string" ? data.nextEligibleAt : null,
    };
  };

  /**
   * 执行签到
   */
  const checkIn = async (): Promise<{
    message: string;
    reward: number;
    dennyAdded: number;
    currentDenny: number;
    consecutiveDays: number;
    totalDays: number;
    rank: number;
    currentExp?: number;
    currentLevel?: number;
    nextEligibleAt?: string;
  }> => {
    const response = await $api("/api/check-in", {
      method: "POST",
    });
    const data = response as Record<string, unknown>;
    return {
      message: typeof data.message === "string" ? data.message : "签到成功",
      reward: Number(data.reward) || 0,
      dennyAdded: Number(data.dennyAdded) || 0,
      currentDenny: Number(data.currentDenny) || 0,
      consecutiveDays: Number(data.consecutiveDays) || 0,
      totalDays: Number(data.totalDays) || 0,
      rank: Number(data.rank) || 0,
      currentExp: typeof data.currentExp === "number" ? data.currentExp : undefined,
      currentLevel: typeof data.currentLevel === "number" ? data.currentLevel : undefined,
      nextEligibleAt:
        typeof data.nextEligibleAt === "string" ? data.nextEligibleAt : undefined,
    };
  };

  /**
   * 获取每日主动行为经验获取状态
   */
  const getDailyExpStatus = async (): Promise<DailyExpStatus> => {
    const response = await $api("/api/me/exp/daily", {
      method: "GET",
    });
    const data = response as Record<string, unknown>;
    const sources = data.sources as
      | Record<string, { done?: boolean; exp?: number } | undefined>
      | undefined;

    const source = (
      key: "checkIn" | "createArticle" | "createComment" | "likeGive",
    ) => {
      const s = sources?.[key];
      return {
        done: s?.done === true,
        exp: typeof s?.exp === "number" ? s.exp : 0,
      };
    };

    return {
      todaySelfGained: typeof data.todaySelfGained === "number" ? data.todaySelfGained : 0,
      todaySelfCap: typeof data.todaySelfCap === "number" ? data.todaySelfCap : 50,
      sources: {
        checkIn: source("checkIn"),
        createArticle: source("createArticle"),
        createComment: source("createComment"),
        likeGive: source("likeGive"),
      },
    };
  };

  // ── 入站考试 ──────────────────────────────────────────────
  /**
   * 获取当前用户的等级权益（未登录按 Lv.0）
   */
  const getMyBenefits = async (): Promise<{
    level: number;
    maxLevel: number;
    benefits: BenefitValues;
    nextLevel?: number;
    nextBenefits?: BenefitValues;
  }> => {
    const response = await $api("/api/benefits/me", { method: "GET" });
    const data = response as Record<string, unknown>;
    const level = clampBenefitLevel(data.level);
    const parse = (raw: unknown, fallbackLevel: number): BenefitValues => {
      const obj = (raw ?? {}) as Record<string, unknown>;
      const fallback = benefitsForLevel(fallbackLevel);
      const num = (key: BenefitKey) =>
        typeof obj[key] === "number" ? (obj[key] as number) : fallback[key];
      return {
        articleMaxImages: num("articleMaxImages"),
        commentMaxImages: num("commentMaxImages"),
        articleMaxBody: num("articleMaxBody"),
      };
    };
    const nextLevel =
      typeof data.nextLevel === "number" ? clampBenefitLevel(data.nextLevel) : undefined;
    return {
      level,
      maxLevel:
        typeof data.maxLevel === "number" ? data.maxLevel : BENEFIT_MAX_LEVEL,
      benefits: parse(data.benefits, level),
      ...(nextLevel != null
        ? { nextLevel, nextBenefits: parse(data.nextBenefits, nextLevel) }
        : {}),
    };
  };

  const getExamStatus = async (): Promise<ExamStatus> => {
    const response = await $api("/api/exam/status");
    return response as ExamStatus;
  };

  const startExam = async (): Promise<ExamStartResult> => {
    const response = await $api("/api/exam/start", { method: "POST" });
    return response as ExamStartResult;
  };

  const submitExam = async (
    attemptId: string,
    answers: Record<string, string[]>,
  ): Promise<ExamSubmitResult> => {
    const response = await $api("/api/exam/submit", {
      method: "POST",
      body: { attemptId, answers },
    });
    return response as ExamSubmitResult;
  };

  const getExamReview = async (attemptId?: string): Promise<ExamAttemptReview> => {
    const response = await $api("/api/exam/review", {
      method: "GET",
      query: attemptId ? { attemptId } : {},
    });
    return response as ExamAttemptReview;
  };

  return {
    clearAllCache,
    invalidateQueries,
    login,
    sendRegisterCode,
    registerWithCode,
    sendResetCode,
    resetPassword,
    getSelfUser,
    searchArticles,
    suggestArticles,
    peekArticles,
    getCategories,
    getPost,
    recordArticleView,
    getComments,
    addPostComment,
    deleteComment,
    pinComment,
    unpinComment,
    toggleLike,
    batchCheckLikes,
    toggleFavorite,
    batchCheckFavorites,
    createReport,
    batchCheckReports,
    toggleFollow,
    batchCheckFollows,
    toggleUserBlock,
    batchCheckUserBlocks,
    getMyBlockedList,
    markAsReadBatch,
    getProfile,
    getProfileArticles,
    getProfileComments,
    createArticleDraft,
    updateArticleDraft,
    publishArticleDraft,
    discardArticleDraft,
    deleteArticle,
    getMyDrafts,
    getMyDraftDetail,
    signUpload,
    completeUpload,
    uploadImage,
    getMyUploads,
    deleteMyUpload,
    getMyBusinessCards,
    equipBusinessCard,
    getMyAvatars,
    equipAvatar,
    uploadCustomAvatar,
    updateMyName,
    updateMyBio,
    updateMyVisibility,
    getMyProfileSettings,
    // 账号安全
    getMySecurity,
    sendBindEmailCode,
    bindEmail,
    getPinnedArticles,
    updatePinnedArticles,
    searchAuthors,
    // 丁尼系统
    getMyDenny,
    giveDennyToArticle,
    tripleAction,
    // 签到系统
    getCheckInStatus,
    checkIn,
    getDailyExpStatus,
    // 等级权益
    getMyBenefits,
    // 入站考试
    getExamStatus,
    startExam,
    submitExam,
    getExamReview,
    // 米游社登录 / 绑定
    createMihoyoQr,
    pollMihoyoQr,
    getMihoyoBinding,
    unbindMihoyo,
  };
}

export function isApiClientError(err: unknown): err is ApiClientError {
  return !!err && typeof err === "object" && "message" in (err as object);
}
