import type { ApiClientError, Pagination } from "~/types/api";
import type {
  Author,
  BusinessCard,
  BusinessCardType,
  Comment,
  DraftArticle,
  Discussion,
  LikeToggleResult,
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

interface AuthResult {
  token: string | null;
  user: Author;
}

interface SendRegisterCodeResult {
  email: string;
  sent: boolean;
  expiresIn: number;
  cooldown: number;
}

interface DiscussionCommentPayload {
  discussionId: string;
  content: string;
  parentId?: string;
  authorDocumentId?: string;
}

interface MediaMeta {
  url: string;
  width?: number;
  height?: number;
}

function normalizeMediaUrl(input: unknown, apiBaseUrl: string): string {
  if (typeof input !== "string" || !input.trim()) {
    return "";
  }
  const url = input.trim();
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  if (url.startsWith("/")) {
    return `${apiBaseUrl}${url}`;
  }
  return `${apiBaseUrl}/${url}`;
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

  if (Array.isArray(raw)) {
    const results: MediaMeta[] = [];
    for (const item of raw) {
      const media = extractMediaMeta(item, apiBaseUrl);
      if (media) results.push(media);
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

function toAuthor(raw: unknown, apiBaseUrl: string): Author {
  const data = (raw || {}) as Record<string, unknown>;
  const authorRelation = data.author && typeof data.author === "object" ? data.author as Record<string, unknown> : null;
  const avatar = typeof data.avatar === "string"
    ? data.avatar
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
  };
}

function toDiscussion(raw: unknown, apiBaseUrl: string): Discussion {
  const data = (raw || {}) as Record<string, unknown>;

  let covers: MediaMeta[];
  let coverUrl: string;
  let coverW: number | undefined;
  let coverH: number | undefined;

  if (typeof data.cover === "string" || data.cover === null || data.cover === undefined) {
    coverUrl = (typeof data.cover === "string" ? data.cover : "");
    coverW = typeof data.coverWidth === "number" ? data.coverWidth : undefined;
    coverH = typeof data.coverHeight === "number" ? data.coverHeight : undefined;
    covers = coverUrl ? [{ url: coverUrl, width: coverW, height: coverH }] : [];
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
  }

  return {
    id: String(data.documentId || data.id || ""),
    title: String(data.title || "无标题"),
    body: (data.body as string | undefined) || "",
    bodyText: (data.text as string | undefined) || "",
    rawBodyText: (data.rawBodyText as string | undefined) || "",
    covers,
    cover: coverUrl,
    coverWidth: coverW,
    coverHeight: coverH,
    views: Number(data.views || 0),
    likesCount: Number(data.likesCount ?? 0),
    commentsCount: Number(data.commentsCount ?? 0),
    isRead: data.isRead === true,
    liked: data.liked === true,
    createdAt: data.createdAt as string | undefined,
    updatedAt: data.updatedAt as string | undefined,
    author: toAuthor(data.author, apiBaseUrl),
  };
}

function toDraftArticle(raw: Record<string, unknown>): DraftArticle {
  const coverRaw = raw.cover;
  const covers: { documentId?: string; url: string; width?: number; height?: number }[] = [];
  const parseCover = (c: Record<string, unknown>) => {
    const url = String(c.url || "");
    if (url) {
      covers.push({
        documentId: typeof c.documentId === "string" ? c.documentId : undefined,
        url,
        width: parsePositiveNumber(c.width),
        height: parsePositiveNumber(c.height),
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
    createdAt: raw.createdAt as string | undefined,
    updatedAt: raw.updatedAt as string | undefined,
  };
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
  const parentRaw = data.parent as Record<string, unknown> | null | undefined;
  return {
    id: String(data.documentId || data.id || ""),
    content: String(data.content || ""),
    liked: data.liked === true,
    likesCount: Number(data.likesCount ?? 0),
    createdAt: data.createdAt as string | undefined,
    author: toAuthor(data.author, apiBaseUrl),
    replies: repliesRaw.map((item) => {
      const reply = item as Record<string, unknown>;
      return {
        id: String(reply.documentId || reply.id || ""),
        content: String(reply.content || ""),
        liked: reply.liked === true,
        likesCount: Number(reply.likesCount ?? 0),
        createdAt: reply.createdAt as string | undefined,
        author: toAuthor(reply.author, apiBaseUrl),
      };
    }),
    articleId: articleRaw ? String(articleRaw.documentId || "") : undefined,
    articleTitle: articleRaw ? String(articleRaw.title || "") : undefined,
    parentContent: parentRaw ? String(parentRaw.content || "").slice(0, 60) : undefined,
    parentAuthorName: parentRaw && parentRaw.author
      ? String((parentRaw.author as Record<string, unknown>).name || "")
      : undefined,
  };
}

export function useApi() {
  const { $api } = useNuxtApp();
  const config = useRuntimeConfig();
  const apiBaseUrl = String(config.public.apiBaseUrl || "").replace(/\/+$/, "");

  const login = async (
    email: string,
    password: string,
  ): Promise<AuthResult> => {
    const response = await $api("/api/auth/local", {
      method: "POST",
      body: { identifier: email, password },
    });
    const data = response as Record<string, unknown>;
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
    return {
      token: (data.jwt as string | undefined) || null,
      user: toAuthor(data.user, apiBaseUrl),
    };
  };

  const getSelfUser = async (): Promise<Author> => {
    const response = await $api("/api/me/profile");
    return toAuthor(response, apiBaseUrl);
  };

  const mergeReadStatus = async (discussions: Discussion[]) => {
    if (!import.meta.client || !discussions.length) return;
    const userId = localStorage.getItem("user_id");
    if (!userId) return;
    const ids = discussions.map((d) => d.id);
    try {
      const res = await $api("/api/article-reads/batch", {
        method: "POST",
        body: { articleDocumentIds: ids },
      });
      const list = unwrapData<Array<{ articleDocumentId?: string; isRead?: boolean }>>(res);
      if (!Array.isArray(list)) return;
      const readSet = new Set<string>();
      for (const item of list) {
        if (item.isRead && item.articleDocumentId) {
          readSet.add(item.articleDocumentId);
        }
      }
      for (const d of discussions) {
        if (readSet.has(d.id)) d.isRead = true;
      }
    } catch {
      // ignore read status failures
    }
  };

  const searchArticles = async (
    query: string,
    endCur = "",
  ): Promise<Pagination<Discussion>> => {
    const start = parseStart(endCur);
    const endpoint = query ? "/api/articles/search" : "/api/articles/list";
    const response = await $api(endpoint, {
      query: {
        ...(query ? { q: query } : {}),
        start: String(start),
        limit: String(DEFAULT_PAGE_SIZE),
      },
    });
    const meta = extractPaginationMeta(response);
    const data = unwrapData<unknown[]>(response) || [];
    const page = buildPagination(data.map((item) => toDiscussion(item, apiBaseUrl)), start, meta);
    await mergeReadStatus(page.nodes);
    return page;
  };

  const getDiscussion = async (id: string): Promise<Discussion> => {
    const response = await $api(`/api/articles/detail/${id}`);
    const discussion = toDiscussion(unwrapData(response), apiBaseUrl);
    await mergeReadStatus([discussion]);
    return discussion;
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
    discussionId: string,
    endCur = "",
  ): Promise<Pagination<Comment>> => {
    const start = parseStart(endCur);
    const response = await $api("/api/comments/list", {
      query: {
        article: discussionId,
        start: String(start),
        limit: String(DEFAULT_PAGE_SIZE),
      },
    });
    const meta = extractPaginationMeta(response);
    const data = unwrapData<unknown[]>(response) || [];
    return buildPagination(data.map((item) => toComment(item, apiBaseUrl)), start, meta);
  };

  const addDiscussionComment = async ({
    discussionId,
    content,
    parentId,
    authorDocumentId,
  }: DiscussionCommentPayload) => {
    return await $api("/api/comments", {
      method: "POST",
      body: {
        data: {
          article: discussionId,
          content,
          ...(authorDocumentId ? { author: authorDocumentId } : {}),
          ...(parentId ? { parent: parentId } : {}),
        },
      },
    });
  };

  const deleteComment = async (commentId: string): Promise<void> => {
    await $api(`/api/comments/${commentId}`, {
      method: "DELETE",
    });
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

  const markAsReadBatch = async (articleDocumentIds: string[]) => {
    if (!articleDocumentIds.length) return;
    await $api("/api/article-reads/batch", {
      method: "POST",
      body: { articleDocumentIds, markAsRead: true },
    });
  };

  const getProfile = async (documentId: string): Promise<Profile> => {
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

    const equippedCardRaw = data.equippedCard;
    const equippedCard = toBusinessCard(equippedCardRaw, apiBaseUrl);

    return {
      documentId: String(data.documentId || documentId),
      uid: data.userId != null ? Number(data.userId) : undefined,
      login: (userRaw?.username as string) || (data.login as string | undefined),
      name: data.name as string | undefined,
      bio: bioText,
      avatar: avatarUrl,
      level: Number(userRaw?.level ?? data.level ?? 1),
      exp: Number(userRaw?.exp ?? data.exp ?? 0),
      isSelf: data.isSelf === true,
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
    };
  };

  const getProfileArticles = async (
    documentId: string,
    endCur = "",
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<Pagination<Discussion>> => {
    const start = parseStart(endCur);
    const response = await $api(`/api/profiles/${documentId}/articles`, {
      query: {
        start: String(start),
        limit: String(limit),
      },
    });
    const meta = extractPaginationMeta(response);
    const data = unwrapData<unknown[]>(response) || [];
    const page = buildPagination(data.map((item) => toDiscussion(item, apiBaseUrl)), start, meta);
    await mergeReadStatus(page.nodes);
    return page;
  };

  const getProfileComments = async (
    documentId: string,
    endCur = "",
  ): Promise<Pagination<Comment>> => {
    const start = parseStart(endCur);
    const response = await $api(`/api/profiles/${documentId}/comments`, {
      query: {
        start: String(start),
        limit: String(DEFAULT_PAGE_SIZE),
      },
    });
    const meta = extractPaginationMeta(response);
    const data = unwrapData<unknown[]>(response) || [];
    return buildPagination(data.map((item) => toComment(item, apiBaseUrl)), start, meta);
  };

  const createArticleDraft = async (payload: {
    title: string;
    text: string;
    editorState?: unknown[];
    coverId?: string | string[];
    authorId?: string;
  }): Promise<DraftArticle> => {
    const data: Record<string, unknown> = {
      title: payload.title,
      text: payload.text,
      editorState: payload.editorState,
    };
    if (payload.coverId != null) {
      data.cover = payload.coverId;
    }
    if (payload.authorId) {
      data.author = { connect: [{ documentId: payload.authorId }] };
    }
    const response = await $api("/api/articles", {
      method: "POST",
      query: { status: "draft" },
      body: { data },
    });
    const raw = unwrapData<Record<string, unknown>>(response);
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
    },
  ): Promise<DraftArticle> => {
    const data: Record<string, unknown> = {};
    if (payload.title !== undefined) data.title = payload.title;
    if (payload.text !== undefined) data.text = payload.text;
    data.editorState = payload.editorState;
    if (payload.coverId !== undefined) {
      data.cover = payload.coverId ?? [];
    }
    const response = await $api(`/api/articles/${id}`, {
      method: "PUT",
      query: { status: "draft" },
      body: { data },
    });
    const raw = unwrapData<Record<string, unknown>>(response);
    return toDraftArticle(raw);
  };

  const publishArticleDraft = async (id: string): Promise<void> => {
    await $api(`/api/articles/${id}/publish`, {
      method: "POST",
      body: {},
    });
  };

  const deleteArticle = async (id: string): Promise<void> => {
    await $api(`/api/articles/${id}`, {
      method: "DELETE",
    });
  };

  const getMyDrafts = async (
    endCur = "",
  ): Promise<Pagination<DraftArticle>> => {
    const start = parseStart(endCur);
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
  };

  const getMyDraftDetail = async (documentId: string): Promise<DraftArticle> => {
    const response = await $api(`/api/articles/my/detail/${documentId}`);
    const raw = unwrapData<Record<string, unknown>>(response);
    return toDraftArticle(raw);
  };

  const signUpload = async (payload: {
    filename: string;
    mimeType: string;
    size: number;
  }): Promise<SignedUploadResult> => {
    const response = await $api("/api/direct-upload/sign", {
      method: "POST",
      body: payload,
    });
    const data = unwrapData<Record<string, unknown>>(response);
    return {
      uploadUrl: String(data.uploadUrl || ""),
      uploadToken: String(data.uploadToken || ""),
      method: String(data.method || "PUT"),
      objectKey: String(data.objectKey || ""),
      publicUrl: String(data.publicUrl || ""),
      headers: (data.headers as Record<string, string>) || {},
      expiresAt: String(data.expiresAt || ""),
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
    const data = unwrapData<Record<string, unknown>>(response);
    return {
      id: Number(data.id || 0),
      documentId: String(data.documentId || ""),
      url: String(data.url || ""),
      width: parsePositiveNumber(data.width),
      height: parsePositiveNumber(data.height),
    };
  };

  const uploadImage = async (
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<UploadedFile> => {
    onProgress?.(0);

    const signed = await signUpload({
      filename: file.name,
      mimeType: file.type || "image/jpeg",
      size: file.size,
    });
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

  const getMyBusinessCards = async (): Promise<{ cards: BusinessCard[]; equippedCardDocumentId: string | null }> => {
    const response = await $api("/api/me/business-cards");
    const data = response as Record<string, unknown>;
    const rawCards = Array.isArray(data.data) ? data.data : [];
    return {
      cards: rawCards.map((item) => toBusinessCard(item, apiBaseUrl)).filter(Boolean) as BusinessCard[],
      equippedCardDocumentId: (data.equippedCardDocumentId as string) || null,
    };
  };

  const equipBusinessCard = async (documentId: string | null): Promise<void> => {
    await $api("/api/me/business-cards/equip", {
      method: "PUT",
      body: { documentId },
    });
  };

  const updateMyName = async (name: string): Promise<{ name: string }> => {
    const response = await $api("/api/me/profile/name", {
      method: "PUT",
      body: { name },
    });
    const data = response as Record<string, unknown>;
    return { name: String(data.name || name) };
  };

  const updateMyBio = async (bio: string): Promise<{ bio: string }> => {
    const response = await $api("/api/me/profile/bio", {
      method: "PUT",
      body: { bio },
    });
    const data = response as Record<string, unknown>;
    return { bio: String(data.bio ?? bio) };
  };

  return {
    login,
    sendRegisterCode,
    registerWithCode,
    getSelfUser,
    searchArticles,
    getDiscussion,
    recordArticleView,
    getComments,
    addDiscussionComment,
    deleteComment,
    toggleLike,
    batchCheckLikes,
    markAsReadBatch,
    getProfile,
    getProfileArticles,
    getProfileComments,
    createArticleDraft,
    updateArticleDraft,
    publishArticleDraft,
    deleteArticle,
    getMyDrafts,
    getMyDraftDetail,
    signUpload,
    completeUpload,
    uploadImage,
    getMyBusinessCards,
    equipBusinessCard,
    updateMyName,
    updateMyBio,
  };
}

export function isApiClientError(err: unknown): err is ApiClientError {
  return !!err && typeof err === "object" && "message" in (err as object);
}
