/**
 * 接口层：对接 ik-server（`/v1`，见 ikserver-rs `docs/api-guidelines.md`）。
 *
 * 组件只认 `~/types/entities` 里的前端实体；这里负责把后端 DTO（camelCase、雪花 id 字符串、
 * 游标分页 `{ items, nextCursor }`、RFC 9457 错误）翻译成这些实体，接口差异不外溢到页面。
 */
import { readonly, ref } from "vue";
import type { QueryClient, QueryKey } from "@tanstack/vue-query";
import type { Pagination } from "~/types/api";
import type {
  AccountSecurity,
  AuthSessionItem,
  Author,
  Avatar,
  AvatarType,
  BilibiliVideoInfo,
  BlockedUser,
  BusinessCard,
  BusinessCardType,
  Category,
  Comment,
  CommentReply,
  CoverImage,
  DailyExpStatus,
  DraftArticle,
  ExternalVideo,
  ExamAttemptReview,
  ExamConfig,
  ExamQuestion,
  ExamStartResult,
  ExamStatus,
  ExamSubmitResult,
  MihoyoBinding,
  Post,
  PostCategory,
  Tag,
  PostTag,
  ArticleFeed,
  ArticleSort,
  ZzzRoleBadge,
  LikeToggleResult,
  FavoriteToggleResult,
  FollowToggleResult,
  UserBlockToggleResult,
  Profile,
  SignedUploadResult,
  UploadedFile,
} from "~/types/entities";
import { DEFAULT_PAGE_SIZE, toPage } from "~/utils/pagination";
import type { MentionCandidate } from "~/composables/useMentionInput";
import { toMediaUrl } from "~/utils/image";
import {
  BENEFIT_MAX_LEVEL,
  benefitsForLevel,
  clampBenefitLevel,
} from "~/utils/benefits";
import type { BenefitValues } from "~/utils/benefits";

// ── 集中定义 queryKey，便于写接口精准 invalidate ─────────────
const qk = {
  me: {
    self: ["me", "self"] as QueryKey,
    profile: ["me", "profile"] as QueryKey,
    drafts: ["me", "drafts"] as QueryKey,
    draft: (id: string) => ["me", "drafts", id] as QueryKey,
    businessCards: (type: BusinessCardType | "all", page: number, pageSize: number) =>
      ["me", "business-cards", type, page, pageSize] as QueryKey,
    avatars: ["me", "avatars"] as QueryKey,
    uploads: (page: number, pageSize: number) => ["me", "uploads", page, pageSize] as QueryKey,
    pinnedArticles: ["me", "pinned-articles"] as QueryKey,
  },
  categories: {
    list: ["categories", "list"] as QueryKey,
  },
  articles: {
    search: (query: string, category: string, page: string, limit: number, sort = "latest", tag = "") =>
      (tag
        ? ["articles", "search", query, category, page, limit, sort, { tag }]
        : ["articles", "search", query, category, page, limit, sort]) as QueryKey,
    searchAll: ["articles", "search"] as QueryKey,
    detail: (id: string) => ["articles", "detail", id] as QueryKey,
    detailAll: ["articles", "detail"] as QueryKey,
    comments: (postId: string, cursor: string, limit: number) =>
      ["articles", "comments", postId, cursor, limit] as QueryKey,
    commentsOf: (postId: string) =>
      ["articles", "comments", postId] as QueryKey,
  },
  profile: {
    detail: (userId: string) => ["profile", userId] as QueryKey,
    articles: (userId: string, cursor: string, limit: number) =>
      ["profile", userId, "articles", cursor, limit] as QueryKey,
    articlesOf: (userId: string) => ["profile", userId, "articles"] as QueryKey,
    allArticles: (userId: string, cursor: string, limit: number) =>
      ["profile", userId, "articles", "all", cursor, limit] as QueryKey,
    comments: (userId: string, cursor: string, limit: number) =>
      ["profile", userId, "comments", cursor, limit] as QueryKey,
    commentsOf: (userId: string) => ["profile", userId, "comments"] as QueryKey,
  },
};

// 单条资源类接口的默认 staleTime（稍短），列表可稍长
const STALE_DETAIL = 2 * 60 * 1000; // 2 min
const STALE_LIST = 1 * 60 * 1000; // 1 min
const STALE_ME = 2 * 60 * 1000; // 2 min

/** 主页精选最多几篇（PROFILE 规则：与旧系统一致）。 */
const SHOWCASE_MAX = 6;

// 客户端已经持久化成功的已读 id。旧的列表请求可能晚于标记请求写入缓存，
// 因而每次消费列表/快照都要合并确认状态，不能只在 queryFn 内补齐一次。
// 已读单调（不会变回未读），登录/登出时随 clearAllCache 清空。
const knownReadIds = new Set<string>();
const readStatusRevision = ref(0);
let readStatusEpoch = 0;

const rememberReadIds = (ids: Iterable<string>) => {
  const previousSize = knownReadIds.size;
  for (const id of ids) if (id) knownReadIds.add(id);
  if (knownReadIds.size !== previousSize) readStatusRevision.value += 1;
};

// 首页使用 shallowRef，卡片用对象 prop：有变化时必须替换节点引用，
// 不能原地修改查询缓存或路由快照，否则组件可能不更新，回滚基线也会被污染。
const mergeReadStatus = <T extends { id: string; isRead?: boolean }>(nodes: T[]): T[] => {
  if (!import.meta.client || !knownReadIds.size) return nodes;
  let changed = false;
  const merged = nodes.map((node) => {
    if (node.isRead || !knownReadIds.has(node.id)) return node;
    changed = true;
    return { ...node, isRead: true };
  });
  return changed ? merged : nodes;
};

const mergeReadPage = (page: Pagination<Post>): Pagination<Post> => {
  const nodes = mergeReadStatus(page.nodes);
  return nodes === page.nodes ? page : { ...page, nodes };
};

/** 实时搜索联想项（GET /v1/search/suggest） */
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
  /** 登录成功的账号（会话 Cookie 已由服务端种下） */
  user: Author;
}

export interface MihoyoQrCreateResult {
  qrUrl: string;
  ticket: string;
  expiresIn: number;
  mode: "login" | "bind" | "delete";
}

export type MihoyoQrPollResult =
  | { status: "waiting" | "scanned" | "expired" | "cancelled" }
  | {
      status: "confirmed";
      mode: "bind";
      binding: MihoyoBinding | null;
      /** 这个米游社号原先挂在一个误建的空壳号上，绑定时已被接管并清理 */
      takeover: { fromUsername: string } | null;
    }
  | {
      status: "confirmed";
      mode: "login";
      isNewUser: boolean;
      binding: MihoyoBinding | null;
      auth: AuthResult;
    }
  | {
      status: "confirmed";
      mode: "delete";
      /** 扫到的米游社账号是否就是当前账号本人；false 时前端提示换号重扫 */
      matched: boolean;
    };

interface SendCodeResult {
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
  /** 自己图库里的媒体 id */
  images?: string[];
}

interface PagedResult {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

interface MyBusinessCardsResult {
  cards: BusinessCard[];
  equippedCardDocumentId: string | null;
  equippedCard: BusinessCard | null;
  pagination: PagedResult;
}

interface MyUploadsResult {
  uploads: UploadedFile[];
  pagination: PagedResult;
}

interface MediaMeta {
  url: string;
  width?: number;
  height?: number;
}

export interface PinnedCandidate {
  documentId: string;
  title: string;
  cover: MediaMeta | null;
  updatedAt?: string;
}

export interface PinnedArticlesPage {
  /** null = 未配置（默认展示最新 6 篇）；string[] = 已配置（可能为空） */
  pinned: string[] | null;
  /** 已选帖子的卡片数据（按保存顺序） */
  pinnedItems?: PinnedCandidate[];
  candidates: PinnedCandidate[];
  max: number;
  total?: number;
  hasNextPage: boolean;
}

export type ProfileArticlesPage = Pagination<Post> & {
  /** 访客可见的全部帖子数（不受精选配置影响） */
  articleTotal?: number;
};

export type ProfileAllArticlesPage = ProfileArticlesPage & {
  /** 当前精选配置；null = 默认展示最新 6 篇，undefined = 不是本人主页 */
  pinnedIds?: string[] | null;
};

// ── 后端 DTO（只列这里读到的字段；完整定义见 ik-server 的 OpenAPI） ─────────

type Rec = Record<string, unknown>;

interface MediaDto {
  id: string;
  url: string;
  thumbUrl?: string;
  mime?: string;
  size?: number;
  width?: number | null;
  height?: number | null;
  name?: string;
  createdAt?: string;
}

interface AuthorDto {
  id?: string | null;
  name: string;
  anonymous?: boolean;
  avatarUrl?: string | null;
  level?: number | null;
}

interface CategoryRefDto { id: string; name: string; slug: string }
interface TagRefDto { name: string; slug: string }

interface CursorPage<T> {
  items: T[];
  nextCursor?: string | null;
}

function str(input: unknown): string | undefined {
  return typeof input === "string" && input ? input : undefined;
}

function num(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function normalizeMediaUrl(input: unknown): string {
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

function toMediaMeta(raw: MediaDto | null | undefined): MediaMeta | null {
  if (!raw) return null;
  const url = normalizeMediaUrl(raw.url);
  if (!url) return null;
  return { url, width: num(raw.width) || undefined, height: num(raw.height) || undefined };
}

function toCoverImage(raw: MediaDto): CoverImage | null {
  const meta = toMediaMeta(raw);
  return meta ? { documentId: raw.id, ...meta } : null;
}

function toCoverImages(raw: unknown): CoverImage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => toCoverImage(m as MediaDto)).filter((c): c is CoverImage => c !== null);
}

const VALID_CARD_TYPES = new Set(["character", "city", "news"]);

function toCosmeticKind(raw: unknown): BusinessCardType {
  const kind = String(raw || "character");
  return (VALID_CARD_TYPES.has(kind) ? kind : "character") as BusinessCardType;
}

function toBusinessCard(raw: unknown): BusinessCard | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Rec;
  if (!data.id) return undefined;
  const image = toMediaMeta(data.image as MediaDto | undefined);
  const story = str(data.story);
  return {
    documentId: String(data.id),
    name: String(data.name || ""),
    description: str(data.description),
    // 旧数据是 Strapi blocks；新后端是 Markdown 字符串，包成一个段落交给现有渲染。
    story: story
      ? [{ type: "paragraph", children: [{ type: "text", text: story }] }]
      : undefined,
    type: toCosmeticKind(data.kind),
    image: image?.url || normalizeMediaUrl(data.imageUrl) || undefined,
    imageWidth: image?.width,
    imageHeight: image?.height,
  };
}

function toAvatar(raw: unknown): Avatar | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Rec;
  if (!data.id) return undefined;
  const image = toMediaMeta(data.image as MediaDto | undefined);
  return {
    documentId: String(data.id),
    name: String(data.name || ""),
    type: toCosmeticKind(data.kind) as AvatarType,
    image: image?.url,
    imageWidth: image?.width,
    imageHeight: image?.height,
  };
}

/** 帖子 / 评论 / 通知里的作者展示（匿名时没有 id）。 */
function toAuthor(raw: AuthorDto | null | undefined): Author {
  const id = raw?.anonymous ? undefined : str(raw?.id ?? undefined);
  return {
    id,
    documentId: id,
    authorId: id,
    username: raw?.name,
    name: raw?.name || "Unknown",
    avatar: normalizeMediaUrl(raw?.avatarUrl),
    level: num(raw?.level) ?? 1,
    exp: 0,
    isAiAgent: false,
  };
}

function toPostCategory(raw: CategoryRefDto | null | undefined): PostCategory | null {
  if (!raw || (!raw.slug && !raw.name)) return null;
  return { name: raw.name, slug: raw.slug };
}

function toPostTags(raw: unknown): PostTag[] {
  if (!Array.isArray(raw)) return [];
  return (raw as TagRefDto[])
    .filter((t) => t && t.slug && t.name)
    .map((t) => ({ name: t.name, slug: t.slug }));
}

/** 视频（详情 externalVideos / 编辑视图 videos）→ 前端的 ExternalVideo。 */
function toExternalVideo(raw: Rec): ExternalVideo {
  return {
    provider: String(raw.provider || "bilibili"),
    bvid: str(raw.bvid) ?? null,
    aid: num(raw.aid) ?? null,
    cid: num(raw.cid) ?? null,
    p: num(raw.page) ?? null,
    page: num(raw.page) ?? null,
    embedUrl: str(raw.embedUrl) ?? null,
    coverUrl: str(raw.coverUrl) ?? null,
    title: str(raw.title) ?? null,
    duration: num(raw.duration) ?? null,
    source: str(raw.source),
  };
}

/** 前端的 ExternalVideo → 保存帖子时提交的视频字符串（链接 / BV 号，服务端自己解析）。 */
function videoSource(video: ExternalVideo): string | null {
  if (video.source) return video.source;
  const page = video.page ?? video.p;
  const suffix = page && page > 1 ? `?p=${page}` : "";
  if (video.bvid) return `https://www.bilibili.com/video/${video.bvid}${suffix}`;
  if (video.aid) return `https://www.bilibili.com/video/av${video.aid}${suffix}`;
  return null;
}

/** 信息流卡片（PostCard）或详情（PostDetail）→ Post。 */
function toPost(raw: unknown): Post {
  const data = (raw || {}) as Rec;
  const detail = Array.isArray(data.covers);
  let covers: CoverImage[] = detail
    ? toCoverImages(data.covers)
    : (data.cover ? [toCoverImage(data.cover as MediaDto)].filter((c): c is CoverImage => !!c) : []);
  const externalVideos = Array.isArray(data.externalVideos)
    ? (data.externalVideos as Rec[]).map(toExternalVideo)
    : data.video && typeof data.video === "object"
      ? [toExternalVideo(data.video as Rec)]
      : undefined;
  let coverUrl = covers[0]?.url || "";
  let coverW = covers[0]?.width;
  let coverH = covers[0]?.height;
  if (!coverUrl && externalVideos?.[0]?.coverUrl) {
    coverUrl = externalVideos[0].coverUrl;
    coverW = undefined;
    coverH = undefined;
    covers = [];
  }

  return {
    id: String(data.id || ""),
    title: String(data.title || "无标题"),
    body: "",
    // 正文是 Markdown：详情给全文 body，卡片只有纯文本摘要 excerpt。
    bodyText: String((detail ? data.body : data.excerpt) ?? ""),
    rawBodyText: detail ? "" : String(data.excerpt ?? ""),
    externalVideos,
    covers,
    cover: coverUrl,
    coverWidth: coverW,
    coverHeight: coverH,
    views: Number(data.viewCount ?? 0),
    likesCount: Number(data.likeCount ?? 0),
    commentsCount: Number(data.commentCount ?? 0),
    isRead: data.isRead === true,
    liked: data.liked === true,
    favorited: data.favorited === true,
    favoritesCount: Number(data.favoriteCount ?? 0),
    dennyCount: Number(data.dennyCount ?? 0),
    hasGivenDenny: data.dennyGiven === true,
    isAnonymous: data.isAnonymous === true,
    isHidden: data.isHidden === true,
    isPinned: data.isPinned === true,
    pinnedAt: str(data.pinnedAt) ?? null,
    solvedAt: str(data.solvedAt) ?? (data.isSolved === true ? String(data.bumpedAt || "") || null : null),
    allowCommentAccept: data.allowCommentAccept === true,
    isOwner: data.isOwner === true,
    category: toPostCategory(data.category as CategoryRefDto | undefined),
    tags: toPostTags(data.tags),
    createdAt: str(data.firstPublishedAt) ?? str(data.publishedAt),
    updatedAt: str(data.editedAt) ?? str(data.publishedAt),
    editedAt: str(data.editedAt),
    publishedAt: str(data.publishedAt),
    firstPublishedAt: str(data.firstPublishedAt) ?? str(data.publishedAt) ?? null,
    bumpedAt: str(data.bumpedAt) ?? null,
    bumpedBySelf: data.bumpedBySelf === true,
    author: toAuthor(data.author as AuthorDto | undefined),
  };
}

/**
 * 单条回复的映射。回复有两个来源：评论列表内联的前几条，以及「展开更多」走的
 * /v1/comments/:id/replies —— 两处都是 CommentView，映射必须是同一份。
 */
function toCommentReply(raw: unknown): CommentReply {
  const reply = (raw || {}) as Rec;
  return {
    id: String(reply.id || ""),
    content: String(reply.body || ""),
    images: toCoverImages(reply.images),
    liked: reply.liked === true,
    likesCount: Number(reply.likeCount ?? 0),
    createdAt: str(reply.createdAt),
    author: toAuthor(reply.author as AuthorDto | undefined),
  };
}

/**
 * 每条顶层评论「已展开到第几页回复」的游标。用 WeakMap 挂在评论对象上，而不是塞进 Comment
 * 类型：游标是纯客户端翻页状态，不该混进后端返回的实体形状；评论列表被重建（切帖 / 刷新 /
 * 置顶后重拉）时旧对象随之回收，游标自动失效，不用到处手动重置。
 */
const repliesCursors = new WeakMap<
  Comment,
  { cursor: string; done: boolean; inflight?: Promise<number> }
>();

/** 顶层评论的可见回复总数：优先用后端口径的 repliesCount（列表接口只内联前几条回复）。 */
export function totalRepliesOf(comment: Pick<Comment, "replies" | "repliesCount">): number {
  const loaded = comment.replies?.length ?? 0;
  const total = comment.repliesCount;
  return typeof total === "number" && total > loaded ? total : loaded;
}

/**
 * 删掉一条顶层评论后帖子剩下的评论总数。回复分页后 comment.replies 只有前几条，
 * 按 replies.length 扣减会漏掉没展开的回复，必须按 repliesCount 扣。
 */
export function commentsCountAfterDelete(
  commentsCount: number | undefined,
  comment: Pick<Comment, "replies" | "repliesCount">,
): number {
  return Math.max(0, (commentsCount ?? 0) - 1 - totalRepliesOf(comment));
}

/** ThreadView（顶层评论 + 前几条回复）或作者主页的评论 → Comment。 */
function toComment(raw: unknown): Comment {
  const data = (raw || {}) as Rec;
  const replies = Array.isArray(data.replies) ? data.replies.map(toCommentReply) : [];
  const repliesCount = typeof data.replyCount === "number" ? data.replyCount : replies.length;
  return {
    id: String(data.id || ""),
    content: String(data.body || ""),
    images: toCoverImages(data.images),
    liked: data.liked === true,
    likesCount: Number(data.likeCount ?? 0),
    createdAt: str(data.createdAt),
    author: toAuthor(data.author as AuthorDto | undefined),
    replies,
    repliesCount,
    repliesHasMore:
      typeof data.repliesHasMore === "boolean"
        ? data.repliesHasMore
        : repliesCount > replies.length,
    articleId: str(data.postId),
    articleTitle: str(data.postTitle),
    isPinned: data.isPinned === true,
    isAccepted: data.isAccepted === true,
    floor: num(data.floor),
  };
}

function toUploadedFile(raw: MediaDto): UploadedFile {
  return {
    id: 0,
    documentId: String(raw.id || ""),
    name: raw.name,
    url: normalizeMediaUrl(raw.url),
    mime: raw.mime,
    size: num(raw.size),
    width: num(raw.width) || undefined,
    height: num(raw.height) || undefined,
    createdAt: raw.createdAt,
  };
}

function toSendCodeResult(raw: unknown, email: string): SendCodeResult {
  const data = (raw || {}) as Rec;
  return {
    email,
    sent: data.sent === true,
    expiresIn: Number(data.expiresInSecs || 600),
    cooldown: Number(data.cooldownSecs || 60),
  };
}

function toMihoyoBinding(raw: unknown): MihoyoBinding | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Rec;
  const zzz = (b.zzz || null) as Rec | null;
  return {
    aid: String(b.aid || ""),
    zzzUid: str(zzz?.uid) ?? null,
    zzzNickname: str(zzz?.nickname) ?? null,
    zzzLevel: num(zzz?.level) ?? null,
    zzzRegion: str(zzz?.region) ?? null,
    zzzRegionName: str(zzz?.regionName) ?? null,
    lastSyncedAt: str(b.lastSyncedAt) ?? null,
  };
}

/** 账号基本信息（MeView）→ Author；头像、经验、余额由 getSelfUser 另外补齐。 */
function toSelfAuthor(raw: unknown): Author {
  const me = (raw || {}) as Rec;
  const id = String(me.id || "");
  return {
    id,
    documentId: id,
    authorId: id,
    username: str(me.username),
    login: str(me.username),
    name: str(me.username) || "Unknown",
    email: str(me.email),
    level: num(me.level) ?? 0,
    exp: 0,
    isAiAgent: me.isAiAgent === true,
    isAdmin: me.role === "admin",
    examPassed: me.examPassed === true,
  };
}

function toExamConfig(raw: unknown): ExamConfig {
  const c = (raw || {}) as Rec;
  return {
    questionCount: Number(c.questionCount || 0),
    passScorePercent: Number(c.passScorePercent || 0),
    timeLimitSeconds: Number(c.timeLimitSecs || 0),
    maxFailsBeforeCooldown: Number(c.maxFailsBeforeCooldown || 0),
    failCooldownSeconds: Number(c.failCooldownSecs || 0),
    rewardDenny: Number(c.rewardDenny || 0),
    rewardExp: Number(c.rewardExp || 0),
  };
}

function toExamQuestion(raw: unknown): ExamQuestion {
  const q = (raw || {}) as Rec;
  return {
    questionId: String(q.id || ""),
    question: String(q.question || ""),
    type: (q.kind === "multiple" || q.kind === "boolean" ? q.kind : "single") as ExamQuestion["type"],
    options: Array.isArray(q.options) ? (q.options as ExamQuestion["options"]) : [],
    weight: Number(q.weight || 1),
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

/**
 * 页码式分页的组件（图库、名片）对接游标分页：记下每一页的起始游标，
 * 第 N 页要等第 N-1 页拉过才知道从哪开始；缺的页按顺序补拉。
 */
const pageCursors = new Map<string, Map<number, string>>();

/**
 * 帖子保存是整份提交（PUT 语义）：没传的字段沿用上次保存的值，免得自动保存漏带字段时把内容清空。
 */
const lastSavedInput = new Map<string, Record<string, unknown>>();

export function useApi() {
  const { $api, $queryClient } = useNuxtApp();

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
    // $api 返回与调用方 await 续体之间也可能发生身份切换。
    readStatusEpoch += 1;
    pageCursors.clear();
    lastSavedInput.clear();
    const qc = $queryClient as QueryClient | undefined;
    qc?.clear();
    // 身份变更：清掉累积的已读集合，避免把上个用户的已读态带给新用户。
    if (knownReadIds.size) {
      knownReadIds.clear();
      readStatusRevision.value += 1;
    }
  };

  // 供页面在"用户明确刷新"等场景下跳过 staleTime 缓存使用
  const invalidateQueries = (queryKey: QueryKey) => invalidate(queryKey);

  /** 按页码取游标分页接口的一页（见 pageCursors）。 */
  const fetchPageByNumber = async <T>(
    scope: string,
    page: number,
    fetchCursorPage: (cursor: string) => Promise<CursorPage<T>>,
  ): Promise<{ items: T[]; hasMore: boolean }> => {
    const cursors = pageCursors.get(scope) ?? new Map<number, string>([[1, ""]]);
    pageCursors.set(scope, cursors);
    let current = Math.max(1, ...[...cursors.keys()].filter((p) => p <= page));
    while (current < page) {
      const res = await fetchCursorPage(cursors.get(current) ?? "");
      if (!res.nextCursor) return { items: [], hasMore: false };
      current += 1;
      cursors.set(current, res.nextCursor);
    }
    const res = await fetchCursorPage(cursors.get(page) ?? "");
    if (res.nextCursor) cursors.set(page + 1, res.nextCursor);
    return { items: res.items, hasMore: !!res.nextCursor };
  };

  const pagedResult = (page: number, pageSize: number, count: number, hasMore: boolean): PagedResult => ({
    page,
    pageSize,
    // 游标分页没有总数：已知的条数，后面还有就再算一页。
    total: (page - 1) * pageSize + count + (hasMore ? pageSize : 0),
    pageCount: hasMore ? page + 1 : page,
  });

  // ── 账号与登录 ─────────────────────────────────────

  const login = async (
    email: string,
    password: string,
  ): Promise<AuthResult> => {
    const response = await $api<Rec>("/v1/auth/login", {
      method: "POST",
      body: { identifier: email, password, client: "web" },
    });
    // 缓存由 auth.setSession 在真正接受新身份时统一清理。
    return { user: toSelfAuthor(response.user) };
  };

  const sendEmailCode = async (
    email: string,
    purpose: "register" | "login" | "reset_password",
  ): Promise<SendCodeResult> => {
    const response = await $api("/v1/auth/email-codes", {
      method: "POST",
      body: { email, purpose },
    });
    return toSendCodeResult(response, email);
  };

  const sendRegisterCode = (email: string) => sendEmailCode(email, "register");

  const registerWithCode = async (
    email: string,
    code: string,
    password: string,
  ): Promise<AuthResult> => {
    const response = await $api<Rec>("/v1/auth/register", {
      method: "POST",
      body: { email, code, password, client: "web" },
    });
    return { user: toSelfAuthor(response.user) };
  };

  const sendResetCode = (email: string) => sendEmailCode(email, "reset_password");

  const resetPassword = async (
    email: string,
    code: string,
    password: string,
  ): Promise<{ success: boolean }> => {
    await $api("/v1/auth/password/reset", {
      method: "POST",
      body: { email, code, newPassword: password },
    });
    return { success: true };
  };

  // 发送登录验证码：仅对已注册且有真实邮箱的账号真正发码，
  // 后端对未注册邮箱同样返回成功结构以防枚举。
  const sendLoginCode = (email: string) => sendEmailCode(email, "login");

  // 邮箱验证码登录与密码登录复用同一资料契约。
  const loginWithCode = async (
    email: string,
    code: string,
  ): Promise<AuthResult> => {
    const response = await $api<Rec>("/v1/auth/login/email-code", {
      method: "POST",
      body: { email, code, client: "web" },
    });
    return { user: toSelfAuthor(response.user) };
  };

  // ── 米游社扫码登录 / 绑定 ──────────────────────────
  // mode 由调用方显式声明：login 时后端忽略当前会话，bind / delete 要求已登录。
  const createMihoyoQr = async (
    mode: "login" | "bind" | "delete" = "login",
  ): Promise<MihoyoQrCreateResult> => {
    const response = await $api<Rec>("/v1/auth/mihoyo/qr", {
      method: "POST",
      body: { mode },
    });
    const resolvedMode =
      response.mode === "bind" ? "bind" : response.mode === "delete" ? "delete" : "login";
    return {
      qrUrl: String(response.url || ""),
      ticket: String(response.qrId || ""),
      expiresIn: Number(response.expiresIn || 180),
      mode: resolvedMode,
    };
  };

  const pollMihoyoQr = async (ticket: string): Promise<MihoyoQrPollResult> => {
    const data = await $api<Rec>("/v1/auth/mihoyo/qr/poll", {
      method: "POST",
      body: { qrId: ticket, client: "web" },
    });
    const status = String(data.status || "expired");
    if (status !== "confirmed") {
      return { status: status as "waiting" | "scanned" | "expired" | "cancelled" };
    }
    if (data.mode === "delete") {
      return { status: "confirmed", mode: "delete", matched: data.matched === true };
    }
    const binding = toMihoyoBinding(data.binding);
    if (data.mode === "bind") {
      return { status: "confirmed", mode: "bind", binding, takeover: null };
    }
    const authRaw = (data.auth || {}) as Rec;
    return {
      status: "confirmed",
      mode: "login",
      isNewUser: data.isNewUser === true,
      binding,
      auth: { user: toSelfAuthor(authRaw.user) },
    };
  };

  const getMihoyoBinding = async (): Promise<MihoyoBinding | null> => {
    const response = await $api<Rec>("/v1/me/mihoyo");
    return toMihoyoBinding(response.binding);
  };

  const unbindMihoyo = async (): Promise<{ success: boolean }> => {
    await $api("/v1/me/mihoyo", { method: "DELETE" });
    return { success: true };
  };

  /** 当前用户的完整资料：账号 + 头像 + 经验 + 丁尼余额（四个接口并发）。 */
  const getSelfUser = async (): Promise<Author> => {
    return cachedRead(
      qk.me.self,
      async () => {
        const me = await $api<Rec>("/v1/me");
        const user = toSelfAuthor(me);
        const [profile, exp, wallet] = await Promise.all([
          $api<Rec>("/v1/me/profile").catch(() => null),
          $api<Rec>("/v1/me/exp").catch(() => null),
          $api<Rec>("/v1/me/wallet").catch(() => null),
        ]);
        const equipped = (profile?.equippedAvatar || null) as Rec | null;
        const avatar = toMediaMeta(profile?.avatar as MediaDto | undefined)?.url
          || toMediaMeta(equipped?.image as MediaDto | undefined)?.url
          || "";
        return {
          ...user,
          avatar,
          exp: num(exp?.exp) ?? 0,
          level: num(exp?.level) ?? user.level,
          denny: num(wallet?.balance),
        };
      },
      STALE_ME,
    );
  };

  // 只在 setSession 清理旧身份缓存之后调用，后续页面可直接复用登录资料。
  const seedSelfUser = (user: Author) => {
    ($queryClient as QueryClient | undefined)?.setQueryData(qk.me.self, user);
  };

  const patchSelfUserCache = (updates: Partial<Author>) => {
    const qc = $queryClient as QueryClient | undefined;
    const cached = qc?.getQueryState<Author>(qk.me.self);
    if (qc && cached?.data) {
      // 签到/投币后的余额和等级不能被登录时的缓存倒灌；也不延长其它资料的有效期。
      qc.setQueryData(qk.me.self, { ...cached.data, ...updates }, { updatedAt: cached.dataUpdatedAt });
    }
  };

  // ── 信息流 / 搜索 ─────────────────────────────────

  /** 分区 slug → id（发帖时提交 categoryId）。 */
  const categoryIdOf = async (slug: string | undefined): Promise<string | null> => {
    if (!slug) return null;
    const categories = await getCategories();
    return categories.find((c) => c.slug === slug)?.documentId ?? null;
  };

  const categorySlugOf = async (id: string | null | undefined): Promise<PostCategory | null> => {
    if (!id) return null;
    const categories = await getCategories().catch(() => [] as Category[]);
    const found = categories.find((c) => c.documentId === id);
    return found ? { name: found.name, slug: found.slug } : null;
  };

  /**
   * 首页 / 频道 / 搜索的统一入口。
   * - feed=all：sort 决定接口（最新 /v1/posts、热门 /v1/feed/hot、未看 /v1/feed/unread）
   * - feed=following：/v1/feed/following；feed=favorites：/v1/me/favorites
   * - 有关键词：/v1/search/posts
   * 置顶帖只在最新流第一页带上（后端单独给 pinned，排在最前）。
   */
  const searchArticles = async (
    query: string,
    endCur = "",
    category = "",
    feed: ArticleFeed = "all",
    sort: ArticleSort = "latest",
    tag = "",
  ): Promise<Pagination<Post>> => {
    // 搜索接口不支持标签过滤，不能把未过滤结果伪装为标签搜索。
    if (query && tag) throw new Error("标签筛选暂不支持全文搜索");
    // 先等会话恢复，避免登录用户的第一页按游客口径（没有已读标记）缓存下来。
    if (import.meta.client) await useAuthStore().ensureCredentials();
    const cursor = endCur && endCur !== "0" ? endCur : "";
    const cacheCategory = feed === "all" ? category : `${feed}|${category}`;
    const page = await cachedRead(
      qk.articles.search(query, cacheCategory, cursor, DEFAULT_PAGE_SIZE, sort, tag),
      async () => {
        const params: Record<string, string> = { limit: String(DEFAULT_PAGE_SIZE) };
        if (cursor) params.cursor = cursor;
        if (query) {
          params.q = query;
          if (category) params.category = category;
          const res = await $api<CursorPage<Rec>>("/v1/search/posts", { query: params });
          return toPage(res.items.map(toPost), res.nextCursor);
        }
        if (feed === "favorites") {
          const res = await $api<CursorPage<{ post: Rec }>>("/v1/me/favorites", { query: params });
          return toPage(res.items.map((item) => toPost(item.post)), res.nextCursor);
        }
        if (category) params.category = category;
        if (tag) params.tag = tag;
        const endpoint = feed === "following"
          ? "/v1/feed/following"
          : sort === "hot"
            ? "/v1/feed/hot"
            : sort === "unread"
              ? "/v1/feed/unread"
              : "/v1/posts";
        // 热门榜不分区、不分标签。
        if (endpoint === "/v1/feed/hot") {
          delete params.category;
          delete params.tag;
        }
        const res = await $api<CursorPage<Rec> & { pinned?: Rec[] }>(endpoint, { query: params });
        const nodes = res.items.map(toPost);
        if (!cursor && Array.isArray(res.pinned) && res.pinned.length) {
          const pinned = res.pinned.map(toPost);
          const pinnedIds = new Set(pinned.map((p) => p.id));
          return toPage([...pinned, ...nodes.filter((p) => !pinnedIds.has(p.id))], res.nextCursor);
        }
        return toPage(nodes, res.nextCursor);
      },
      STALE_LIST,
    );
    // 在 TanStack 完成写入后合并，也覆盖 fresh cache 命中和迟到响应覆盖缓存的竞态。
    return mergeReadPage(page);
  };

  /**
   * 实时事件提到的帖子的最新卡片（「有 N 条新内容」）。新帖和被顶起的帖都排在最新流前面，
   * 所以从最新流第一页往后找，最多翻几页；找不到的（已删除 / 被拉黑过滤）就不出现。
   */
  const getArticleUpdates = async (ids: string[], category = ""): Promise<Post[]> => {
    const wanted = new Set(ids.filter(Boolean));
    if (!wanted.size) return [];
    if (import.meta.client) await useAuthStore().ensureCredentials();

    const found = new Map<string, Post>();
    let cursor = "";
    for (let pageNo = 0; pageNo < 4 && found.size < wanted.size; pageNo += 1) {
      const res = await $api<CursorPage<Rec>>("/v1/posts", {
        query: {
          limit: "50",
          ...(category ? { category } : {}),
          ...(cursor ? { cursor } : {}),
        },
      });
      for (const raw of res.items) {
        const post = toPost(raw);
        if (wanted.has(post.id)) found.set(post.id, post);
      }
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    const posts = [...found.values()];
    posts.sort((a, b) => {
      const timeA = Date.parse(a.bumpedAt || a.firstPublishedAt || a.publishedAt || "") || 0;
      const timeB = Date.parse(b.bumpedAt || b.firstPublishedAt || b.publishedAt || "") || 0;
      return timeB - timeA || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    });
    return mergeReadStatus(posts);
  };

  /**
   * 同步读取 searchArticles 的缓存——不触发网络请求。
   * 用于 pages/index.vue 在切回首页时同步预填 list。
   */
  const peekArticles = (
    query: string,
    endCur = "",
    category = "",
    feed: ArticleFeed = "all",
    sort: ArticleSort = "latest",
    tag = "",
  ): Pagination<Post> | undefined => {
    if (query && tag) return undefined;
    const qc = $queryClient as QueryClient | undefined;
    if (!qc) return undefined;
    // 缓存槽的算法必须与 searchArticles 完全一致，否则预填永远命中不到。
    const cursor = endCur && endCur !== "0" ? endCur : "";
    const cacheCategory = feed === "all" ? category : `${feed}|${category}`;
    const page = qc.getQueryData<Pagination<Post>>(
      qk.articles.search(query, cacheCategory, cursor, DEFAULT_PAGE_SIZE, sort, tag),
    );
    return page ? mergeReadPage(page) : undefined;
  };

  /**
   * 实时联想搜索（GET /v1/search/suggest）：边输入边搜。
   * 不走 TanStack 缓存（调用方自行防抖 + 丢弃过期响应）。
   */
  const suggestArticles = async (
    query: string,
    category = "",
  ): Promise<SearchSuggestion[]> => {
    const q = query.trim();
    if (!q) return [];
    const data = await $api<Rec[]>("/v1/search/suggest", {
      query: { q, ...(category ? { category } : {}) },
    });
    return (Array.isArray(data) ? data : [])
      .map((s): SearchSuggestion | null => {
        const id = str(s.id);
        const title = str(s.title);
        if (!id || !title) return null;
        const author = s.author as AuthorDto | undefined;
        const cat = s.category as CategoryRefDto | undefined;
        return {
          documentId: id,
          title,
          titleHighlighted: str(s.titleHighlighted) ?? title,
          excerpt: String(s.excerpt || ""),
          authorName: author?.name ?? null,
          categoryName: cat?.name ?? null,
          categorySlug: cat?.slug ?? null,
          isAnonymous: s.isAnonymous === true,
        };
      })
      .filter((s): s is SearchSuggestion => s !== null);
  };

  /** 频道列表（GET /v1/categories）：启用中的分区，按排序。 */
  const getCategories = async (): Promise<Category[]> => {
    return cachedRead(
      qk.categories.list,
      async () => {
        const data = await $api<Rec[]>("/v1/categories");
        return (Array.isArray(data) ? data : [])
          .filter((c) => str(c.slug) && str(c.name))
          .map((c, index) => ({
            documentId: String(c.id),
            name: String(c.name),
            slug: String(c.slug),
            order: index,
            adminOnly: c.adminOnly === true,
          }));
      },
      STALE_LIST,
    );
  };

  /**
   * 标签联想（GET /v1/tags/suggest）：发帖打标框边输入边搜已有标签。
   * 不走 TanStack 缓存（调用方自行防抖 + 丢弃过期响应）。
   */
  const suggestTags = async (query: string, signal?: AbortSignal): Promise<Tag[]> => {
    const q = query.trim();
    if (!q) return [];
    const data = await $api<TagRefDto[]>("/v1/tags/suggest", { query: { q }, ...(signal ? { signal } : {}) });
    return toPostTags(data);
  };

  // ── 帖子详情 ──────────────────────────────────────

  const getPost = async (id: string): Promise<Post> => {
    const post = await cachedRead(
      qk.articles.detail(id),
      async () => toPost(await $api(`/v1/posts/${encodeURIComponent(id)}`)),
      STALE_DETAIL,
    );
    return mergeReadStatus([post])[0]!;
  };

  const recordArticleView = async (id: string): Promise<number | undefined> => {
    if (!id) return undefined;
    const data = await $api<Rec>(`/v1/posts/${encodeURIComponent(id)}/views`, { method: "POST" });
    const views = Number(data.viewCount);
    return data.viewCount != null && Number.isFinite(views) && views >= 0 ? views : undefined;
  };

  const getSuggestedArticles = async (articleId: string, limit = 6): Promise<Post[]> => {
    if (import.meta.client) await useAuthStore().ensureCredentials();
    const res = await $api<{ items: Rec[] }>(`/v1/posts/${encodeURIComponent(articleId)}/related`, {
      query: { limit },
    });
    return (res.items || []).map(toPost);
  };

  const pinArticle = async (id: string): Promise<void> => {
    await $api(`/v1/posts/${encodeURIComponent(id)}/pin`, { method: "PUT" });
    invalidate(qk.articles.detail(id));
    invalidate(qk.articles.searchAll);
  };

  const unpinArticle = async (id: string): Promise<void> => {
    await $api(`/v1/posts/${encodeURIComponent(id)}/pin`, { method: "DELETE" });
    invalidate(qk.articles.detail(id));
    invalidate(qk.articles.searchAll);
  };

  // ── 评论 ──────────────────────────────────────────

  const getComments = async (
    postId: string,
    endCur = "",
    force = false,
  ): Promise<Pagination<Comment>> => {
    const cursor = endCur && endCur !== "0" ? endCur : "";
    // 弹窗/页面首次加载首屏评论时，强制让该帖子评论缓存失效，避免直接命中旧缓存
    if (force && !cursor) {
      const queryKey = qk.articles.comments(postId, cursor, DEFAULT_PAGE_SIZE);
      const state = $queryClient?.getQueryState(queryKey);
      // 如果已经有强制请求在 flight，直接复用该 promise，不再重复失效/重拉
      if (state?.fetchStatus !== "fetching") {
        // 只失效首屏，避免污染 loadMore 的后续分页缓存
        invalidate(queryKey);
      }
    }
    return cachedRead(
      qk.articles.comments(postId, cursor, DEFAULT_PAGE_SIZE),
      async () => {
        const res = await $api<CursorPage<Rec> & { pinned?: Rec | null; accepted?: Rec | null }>(
          `/v1/posts/${encodeURIComponent(postId)}/comments`,
          { query: { limit: String(DEFAULT_PAGE_SIZE), ...(cursor ? { cursor } : {}) } },
        );
        const nodes = res.items.map(toComment);
        // 顶部顺序：最佳答案在最前，其次置顶（两者后端已互斥去重），再普通楼层。
        if (!cursor && res.pinned) nodes.unshift(toComment(res.pinned));
        if (!cursor && res.accepted) nodes.unshift(toComment(res.accepted));
        return toPage(nodes, res.nextCursor);
      },
      STALE_LIST,
    );
  };

  /**
   * 某条顶层评论的回复分页（GET /v1/comments/:id/replies，旧的在前）。
   * 刻意不进 TanStack 缓存：回复是「按需往下展开」的增量数据。
   */
  const getCommentReplies = async (
    commentId: string,
    endCur = "",
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<Pagination<CommentReply>> => {
    const res = await $api<CursorPage<Rec>>(`/v1/comments/${encodeURIComponent(commentId)}/replies`, {
      query: {
        // 空串 = 从头开始，此时不带 cursor 参数
        ...(endCur ? { cursor: endCur } : {}),
        limit: String(limit),
      },
    });
    return toPage(res.items.map(toCommentReply), res.nextCursor);
  };

  /**
   * 展开某条顶层评论的下一页回复：原地 append 到 comment.replies，并同步 repliesHasMore /
   * repliesCount。返回本次真正新增的条数，0 表示到底了 —— 「展开更多」按钮和 useCommentSeek
   * 的自动展开都靠这个返回值收手，别改成返回 void。
   *
   * 同一条评论并发展开会合流到同一个请求上：两路各发一次的话拿到的是同一页，后完成的那路
   * 去重后新增 0 条，会被调用方误当成「到底了」。
   */
  const loadMoreReplies = async (comment: Comment): Promise<number> => {
    const state = repliesCursors.get(comment) ?? { cursor: "", done: false };
    repliesCursors.set(comment, state);
    if (state.done) return 0;
    if (state.inflight) return state.inflight;
    const run = async () => {
      const page = await getCommentReplies(comment.id, state.cursor);
      state.cursor = page.endCursor;
      state.done = !page.hasNextPage;
      // 首次展开时 cursor 为空、后端从头给，前几条与列表接口已内联的重合；按 id 去重再 append。
      // 本地乐观插入的回复也在这里被认出来，不会变成两条。
      const existing = new Set(comment.replies.map((r) => r.id));
      const fresh = page.nodes.filter((r) => r.id && !existing.has(r.id));
      comment.replies.push(...fresh);
      // 乐观插入的回复是 push 到数组末尾的，而这里 append 的是比它更早的历史回复：
      // createdAt 齐全时按时间重排一次，与后端 asc 口径对齐。
      if (comment.replies.every((r) => typeof r.createdAt === "string")) {
        comment.replies.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      }
      comment.repliesHasMore = page.hasNextPage;
      // 已加载条数反超后端口径（乐观插入 / 隐藏过滤口径差）时抬上去，否则「展开更多(N)」会算出负数。
      if ((comment.repliesCount ?? 0) < comment.replies.length) {
        comment.repliesCount = comment.replies.length;
      }
      return fresh.length;
    };
    const inflight = run().finally(() => {
      state.inflight = undefined;
    });
    state.inflight = inflight;
    return inflight;
  };

  const addPostComment = async ({
    postId,
    content,
    parentId,
    isAnonymous,
    images,
  }: PostCommentPayload) => {
    const res = await $api<Rec>(`/v1/posts/${encodeURIComponent(postId)}/comments`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: {
        body: content,
        ...(parentId ? { parentId } : {}),
        ...(isAnonymous ? { isAnonymous: true } : {}),
        ...(images?.length ? { imageIds: images } : {}),
      },
    });
    // 评论数 & 评论列表改变
    invalidate(qk.articles.commentsOf(postId));
    invalidate(qk.articles.detail(postId));
    return { data: { documentId: String(res.id || ""), ...toCommentReply(res) } };
  };

  const deleteComment = async (commentId: string): Promise<void> => {
    await $api(`/v1/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
    // 不知道 postId，保守批量失效所有评论列表 & 委托详情（评论数） & profile 评论
    invalidate(["articles", "comments"]);
    invalidate(["articles", "detail"]);
    invalidate(["profile"]);
  };

  const setCommentFlag = async (
    commentId: string,
    postId: string,
    flag: "pin" | "accept",
    on: boolean,
  ): Promise<void> => {
    await $api(`/v1/comments/${encodeURIComponent(commentId)}/${flag}`, { method: on ? "PUT" : "DELETE" });
    invalidate(qk.articles.commentsOf(postId));
    invalidate(qk.articles.detail(postId));
  };

  const pinComment = (commentId: string, postId: string) => setCommentFlag(commentId, postId, "pin", true);
  const unpinComment = (commentId: string, postId: string) => setCommentFlag(commentId, postId, "pin", false);
  const acceptComment = (commentId: string, postId: string) => setCommentFlag(commentId, postId, "accept", true);
  const unacceptComment = (commentId: string, postId: string) => setCommentFlag(commentId, postId, "accept", false);

  // ── 互动（后端是幂等的 PUT / DELETE，切换方向由调用方当前的状态决定） ─────────

  const toggleLike = async (
    targetType: "article" | "comment",
    targetId: string,
    currentlyLiked: boolean,
  ): Promise<LikeToggleResult> => {
    const path = targetType === "article"
      ? `/v1/posts/${encodeURIComponent(targetId)}/like`
      : `/v1/comments/${encodeURIComponent(targetId)}/like`;
    const data = await $api<Rec>(path, { method: currentlyLiked ? "DELETE" : "PUT" });
    if (targetType === "article") invalidate(qk.articles.detail(targetId));
    return { liked: data.liked === true, likesCount: Number(data.likeCount || 0) };
  };

  const createReport = async (payload: {
    targetType: "article" | "comment" | "user";
    targetId: string;
    reason: string;
    detail?: string;
  }): Promise<{ documentId: string }> => {
    const data = await $api<Rec>("/v1/reports", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: {
        targetType: payload.targetType === "article" ? "post" : payload.targetType,
        targetId: payload.targetId,
        reason: payload.reason,
        ...(payload.detail ? { detail: payload.detail } : {}),
      },
    });
    return { documentId: String(data.id || "") };
  };

  const batchCheckReports = async (
    targetType: "article" | "comment" | "user",
    targetIds: string[],
  ): Promise<Record<string, boolean>> => {
    if (!targetIds.length) return {};
    const data = await $api<{ reported?: Record<string, boolean> }>("/v1/reports/check", {
      query: {
        targetType: targetType === "article" ? "post" : targetType,
        ids: targetIds.join(","),
      },
    });
    return data.reported || {};
  };

  const toggleFavorite = async (
    articleId: string,
    currentlyFavorited: boolean,
  ): Promise<FavoriteToggleResult> => {
    const data = await $api<Rec>(`/v1/posts/${encodeURIComponent(articleId)}/favorite`, {
      method: currentlyFavorited ? "DELETE" : "PUT",
    });
    invalidate(qk.articles.detail(articleId));
    return { favorited: data.favorited === true, favoritesCount: Number(data.favoriteCount || 0) };
  };

  const toggleFollow = async (
    userId: string,
    currentlyFollowing: boolean,
  ): Promise<FollowToggleResult> => {
    const data = await $api<Rec>(`/v1/users/${encodeURIComponent(userId)}/follow`, {
      method: currentlyFollowing ? "DELETE" : "PUT",
    });
    invalidate(qk.profile.detail(userId));
    return { following: data.following === true, followersCount: Number(data.followerCount || 0) };
  };

  /** 我与一批用户的关系（关注 / 拉黑）。 */
  const getRelations = async (userIds: string[]) => {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return [] as Array<{ userId: string; following: boolean; blocking: boolean }>;
    return $api<Array<{ userId: string; following: boolean; blocking: boolean }>>("/v1/me/relations", {
      query: { userIds: ids.join(",") },
    });
  };

  const batchCheckFollows = async (userIds: string[]): Promise<Record<string, boolean>> => {
    const rows = await getRelations(userIds);
    return Object.fromEntries(rows.map((r) => [r.userId, r.following]));
  };

  const toggleUserBlock = async (
    userId: string,
    currentlyBlocked: boolean,
  ): Promise<UserBlockToggleResult> => {
    const data = await $api<Rec>(`/v1/users/${encodeURIComponent(userId)}/block`, {
      method: currentlyBlocked ? "DELETE" : "PUT",
      ...(currentlyBlocked ? {} : { body: {} }),
    });
    invalidate(qk.profile.detail(userId));
    invalidate(qk.articles.searchAll);
    return { blocked: data.blocked === true, authorDocumentId: userId };
  };

  const batchCheckUserBlocks = async (userIds: string[]): Promise<Record<string, boolean>> => {
    const rows = await getRelations(userIds);
    return Object.fromEntries(rows.map((r) => [r.userId, r.blocking]));
  };

  const getMyBlockedList = async (
    endCur = "",
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<Pagination<BlockedUser>> => {
    const res = await $api<CursorPage<Rec>>("/v1/me/blocks", {
      query: { limit: String(limit), ...(endCur ? { cursor: endCur } : {}) },
    });
    const nodes = res.items
      .map((u): BlockedUser => ({
        documentId: String(u.id || ""),
        name: str(u.username),
        username: str(u.username),
        level: num(u.level),
        createdAt: str(u.since),
      }))
      .filter((u) => u.documentId);
    return toPage(nodes, res.nextCursor);
  };

  /**
   * 把「已读」写回 query 缓存：遍历所有文章列表/详情/个人页文章缓存，
   * 命中 id 的节点置 isRead=true。仅在确有变化时返回新引用，避免无谓重渲染。
   */
  const markReadInQueryCache = (articleIds: string[]) => {
    if (!articleIds.length) return;
    const ids = new Set(articleIds);
    // 成功持久化的已读累积到全局集合，通知当前首页和稍后恢复的快照。
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
          // ["profile", userId, "articles", ...]
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

  const markAsReadBatch = async (articleIds: string[]) => {
    if (!articleIds.length) return;
    const epoch = readStatusEpoch;
    // 后端单次最多 100 条。
    for (let start = 0; start < articleIds.length; start += 100) {
      await $api("/v1/me/reads", {
        method: "POST",
        body: { postIds: articleIds.slice(start, start + 100) },
      });
    }
    if (epoch !== readStatusEpoch) return;
    // 持久化成功后写回缓存；失败则不写缓存，由调用方回滚本地 list。
    markReadInQueryCache(articleIds);
  };

  // ── 作者主页 ──────────────────────────────────────

  const getProfile = async (userId: string): Promise<Profile> => {
    return cachedRead(
      qk.profile.detail(userId),
      () => getProfileImpl(userId),
      STALE_DETAIL,
    );
  };

  const getProfileImpl = async (userId: string): Promise<Profile> => {
    const data = await $api<Rec>(`/v1/users/${encodeURIComponent(userId)}`);
    const statsRaw = data.stats as Rec | null | undefined;
    const zzzRaw = data.zzz as Rec | null | undefined;
    const zzz: ZzzRoleBadge | null = zzzRaw?.uid
      ? {
          uid: String(zzzRaw.uid),
          nickname: str(zzzRaw.nickname),
          level: num(zzzRaw.level),
          regionName: str(zzzRaw.regionName),
        }
      : null;
    const equippedCard = toBusinessCard(data.equippedCard);
    const equippedAvatar = toAvatar(data.equippedAvatar);
    const avatarUrl = toMediaMeta(data.avatar as MediaDto | undefined)?.url;

    return {
      documentId: String(data.id || userId),
      uid: String(data.id || userId),
      login: str(data.username),
      name: str(data.username),
      bio: typeof data.bio === "string" ? data.bio : undefined,
      avatar: avatarUrl || equippedAvatar?.image,
      level: Number(data.level ?? 1),
      exp: Number(data.exp ?? 0),
      isSelf: data.isSelf === true,
      isHidden: data.isHidden === true,
      profileHidden: data.isSelf === true && data.isHidden === true,
      isAiAgent: data.isAiAgent === true,
      isBlockedByMe: data.isBlockedByMe === true,
      hasBlockedMe: data.hasBlockedMe === true,
      zzz,
      isFollowing: data.isFollowing === true,
      followersCount: Number(data.followerCount || 0),
      followingCount: Number(data.followingCount || 0),
      stats: statsRaw
        ? {
            articleCount: Number(statsRaw.postCount || 0),
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

  const fetchProfilePosts = async (
    userId: string,
    cursor: string,
    limit: number,
    scope: "default" | "all",
  ) => {
    const res = await $api<CursorPage<Rec> & { pinned?: boolean }>(
      `/v1/users/${encodeURIComponent(userId)}/posts`,
      {
        query: {
          limit: String(limit),
          ...(scope === "all" ? { scope } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
    );
    return { page: toPage(res.items.map(toPost), res.nextCursor), pinned: res.pinned === true };
  };

  /** 帖子总数：从主页资料的统计里取（列表接口是游标分页，没有总数）。 */
  const profilePostTotal = async (userId: string): Promise<number | undefined> => {
    try {
      return (await getProfile(userId)).stats?.articleCount;
    } catch {
      return undefined;
    }
  };

  /** 主页展示位：已自定义时返回精选（≤6），否则返回最新帖子。 */
  const getProfileArticles = async (
    userId: string,
    endCur = "",
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<ProfileArticlesPage> => {
    const page = await cachedRead<ProfileArticlesPage>(
      qk.profile.articles(userId, endCur, limit),
      async () => {
        const { page } = await fetchProfilePosts(userId, endCur, limit, "default");
        return { ...page, articleTotal: await profilePostTotal(userId) };
      },
      STALE_LIST,
    );
    return mergeReadPage(page) as ProfileArticlesPage;
  };

  /** 「全部委托」页：忽略精选配置，分页列出全部可见帖子。 */
  const getProfileAllArticles = async (
    userId: string,
    endCur = "",
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<ProfileAllArticlesPage> => {
    const page = await cachedRead<ProfileAllArticlesPage>(
      qk.profile.allArticles(userId, endCur, limit),
      async () => {
        const { page } = await fetchProfilePosts(userId, endCur, limit, "all");
        const isSelf = String(useAuthStore().user?.id || "") === userId;
        const pinnedIds = isSelf
          ? await getMyProfileRaw().then((p) => toPinnedIds(p.pinnedPostIds)).catch(() => undefined)
          : undefined;
        return { ...page, articleTotal: await profilePostTotal(userId), pinnedIds };
      },
      STALE_LIST,
    );
    return mergeReadPage(page) as ProfileAllArticlesPage;
  };

  const getProfileComments = async (
    userId: string,
    endCur = "",
  ): Promise<Pagination<Comment>> => {
    return cachedRead(
      qk.profile.comments(userId, endCur, DEFAULT_PAGE_SIZE),
      async () => {
        const res = await $api<CursorPage<Rec>>(`/v1/users/${encodeURIComponent(userId)}/comments`, {
          query: { limit: String(DEFAULT_PAGE_SIZE), ...(endCur ? { cursor: endCur } : {}) },
        });
        return toPage(res.items.map(toComment), res.nextCursor);
      },
      STALE_LIST,
    );
  };

  // ── 发帖 / 草稿 ───────────────────────────────────

  /** B 站视频预览（发帖页添加视频时）。 */
  const getBilibiliInfo = async (
    bvid?: string,
    aid?: number,
    page?: number | null,
  ): Promise<BilibiliVideoInfo | null> => {
    const id = bvid || (aid ? `av${aid}` : "");
    if (!id) return null;
    try {
      const source = `https://www.bilibili.com/video/${id}${page && page > 1 ? `?p=${page}` : ""}`;
      const data = await $api<Rec>("/v1/videos/resolve", { query: { source } });
      const video = (data.video || {}) as Rec;
      const pages = Array.isArray(data.pages)
        ? (data.pages as Rec[]).map((p) => ({
            cid: Number(p.cid),
            page: Number(p.page),
            part: str(p.part),
            duration: num(p.duration),
          }))
        : undefined;
      return {
        bvid: str(video.bvid),
        aid: num(video.aid),
        title: str(video.title),
        pic: str(video.coverUrl),
        duration: num(video.duration),
        cid: num(video.cid),
        videos: pages?.length,
        pages,
        owner: str(data.owner) ? { name: str(data.owner) } : undefined,
      };
    } catch {
      return null;
    }
  };

  interface DraftPayload {
    title?: string;
    text?: string;
    editorState?: unknown[];
    externalVideos?: ExternalVideo[];
    coverId?: string | string[] | null;
    authorId?: string;
    isAnonymous?: boolean;
    category?: string;
    tags?: string[];
  }

  /** 编辑视图（PostEditView）→ 编辑器用的 DraftArticle。 */
  const toDraftArticle = async (raw: Rec): Promise<DraftArticle> => ({
    documentId: String(raw.id || ""),
    title: String(raw.title || ""),
    text: String(raw.body || ""),
    editorState: Array.isArray(raw.editorState) ? raw.editorState : undefined,
    externalVideos: Array.isArray(raw.videos) ? (raw.videos as Rec[]).map(toExternalVideo) : [],
    cover: toCoverImages(raw.covers),
    hasPublishedVersion: !!raw.firstPublishedAt || raw.status === "published",
    // 必须映射：漏掉它 → 编辑器里 isAnonymous 一律置 false → 自动保存把 false 写回后端
    // → 用户勾过的匿名被静默清掉，发布时真名出面。
    isAnonymous: raw.isAnonymous === true,
    category: await categorySlugOf(str(raw.categoryId)),
    tags: toPostTags(raw.tags),
    updatedAt: str(raw.updatedAt),
  });

  const toPostInput = async (payload: DraftPayload, base?: Rec): Promise<Rec> => {
    const coverIds = payload.coverId === undefined
      ? base?.coverIds
      : payload.coverId === null
        ? []
        : Array.isArray(payload.coverId) ? payload.coverId : [payload.coverId];
    const videos = payload.externalVideos
      ?.map(videoSource)
      .filter((v): v is string => !!v);
    return {
      title: payload.title ?? base?.title ?? "",
      body: payload.text ?? base?.body ?? "",
      categoryId: payload.category ? await categoryIdOf(payload.category) : (base?.categoryId ?? null),
      tags: payload.tags ?? base?.tags ?? [],
      isAnonymous: payload.isAnonymous ?? base?.isAnonymous ?? false,
      externalVideos: videos ?? base?.externalVideos ?? [],
      editorState: payload.editorState ?? base?.editorState ?? null,
      coverIds: coverIds ?? [],
    };
  };

  const createArticleDraft = async (payload: DraftPayload): Promise<DraftArticle> => {
    const input = await toPostInput(payload);
    const raw = await $api<Rec>("/v1/posts", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: input,
    });
    lastSavedInput.set(String(raw.id), input);
    invalidate(qk.me.drafts);
    return toDraftArticle(raw);
  };

  const updateArticleDraft = async (id: string, payload: DraftPayload): Promise<DraftArticle> => {
    const input = await toPostInput(payload, lastSavedInput.get(id));
    const raw = await $api<Rec>(`/v1/posts/${encodeURIComponent(id)}/draft`, {
      method: "PUT",
      body: input,
    });
    lastSavedInput.set(id, input);
    invalidate(qk.me.draft(id));
    invalidate(qk.me.drafts);
    invalidate(qk.articles.detail(id));
    return toDraftArticle(raw);
  };

  const publishArticleDraft = async (id: string): Promise<void> => {
    await $api(`/v1/posts/${encodeURIComponent(id)}/publish`, { method: "POST" });
    invalidate(qk.me.drafts);
    invalidate(qk.articles.detail(id));
    invalidate(qk.articles.searchAll);
    invalidate(["profile"]);
  };

  const discardArticleDraft = async (id: string): Promise<void> => {
    await $api(`/v1/posts/${encodeURIComponent(id)}/draft`, { method: "DELETE" });
    lastSavedInput.delete(id);
    invalidate(qk.me.draft(id));
  };

  const deleteArticle = async (id: string): Promise<void> => {
    await $api(`/v1/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
    lastSavedInput.delete(id);
    invalidate(qk.me.drafts);
    invalidate(qk.articles.detail(id));
    invalidate(qk.articles.searchAll);
    invalidate(["profile"]);
  };

  /** 草稿箱：还没发布过的帖子（已发布帖子的修改不进草稿箱）。 */
  const getMyDrafts = async (
    endCur = "",
  ): Promise<Pagination<DraftArticle>> => {
    return cachedRead(
      ["me", "drafts", endCur, DEFAULT_PAGE_SIZE] as QueryKey,
      async () => {
        const res = await $api<CursorPage<Rec>>("/v1/me/posts", {
          query: { state: "draft", limit: String(DEFAULT_PAGE_SIZE), ...(endCur ? { cursor: endCur } : {}) },
        });
        const nodes = res.items.map((item): DraftArticle => ({
          documentId: String(item.id || ""),
          title: String(item.title || ""),
          text: "",
          hasPublishedVersion: !!item.publishedAt,
          isAnonymous: item.isAnonymous === true,
          updatedAt: str(item.updatedAt),
        }));
        return toPage(nodes, res.nextCursor);
      },
      STALE_LIST,
    );
  };

  const getMyDraftDetail = async (id: string): Promise<DraftArticle> => {
    return cachedRead(
      qk.me.draft(id),
      async () => {
        const raw = await $api<Rec>(`/v1/posts/${encodeURIComponent(id)}/edit`);
        lastSavedInput.set(id, {
          title: raw.title,
          body: raw.body,
          categoryId: raw.categoryId ?? null,
          tags: toPostTags(raw.tags).map((t) => t.name),
          isAnonymous: raw.isAnonymous === true,
          externalVideos: Array.isArray(raw.externalVideos) ? raw.externalVideos : [],
          editorState: raw.editorState ?? null,
          coverIds: Array.isArray(raw.covers) ? (raw.covers as MediaDto[]).map((c) => c.id) : [],
        });
        return toDraftArticle(raw);
      },
      STALE_DETAIL,
    );
  };

  // ── 上传与图库 ─────────────────────────────────────

  const getMyUploads = async (page = 1, pageSize = 24): Promise<MyUploadsResult> => {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(50, Math.max(1, Math.floor(pageSize)));
    return cachedRead(
      qk.me.uploads(safePage, safePageSize),
      async () => {
        const { items, hasMore } = await fetchPageByNumber<MediaDto>(
          `uploads:${safePageSize}`,
          safePage,
          (cursor) => $api<CursorPage<MediaDto>>("/v1/me/uploads", {
            query: { limit: String(safePageSize), ...(cursor ? { cursor } : {}) },
          }),
        );
        const uploads = items
          .map(toUploadedFile)
          .filter((upload) => upload.documentId && upload.url && (!upload.mime || upload.mime.startsWith("image/")));
        return { uploads, pagination: pagedResult(safePage, safePageSize, items.length, hasMore) };
      },
      STALE_ME,
    );
  };

  /** 从图库移除（文件本身不删，已经用在帖子里的照常显示）。 */
  const deleteMyUpload = async (id: string): Promise<{ deleted: boolean; inUse: boolean }> => {
    await $api(`/v1/me/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
    pageCursors.forEach((_, key) => key.startsWith("uploads:") && pageCursors.delete(key));
    invalidate(["me", "uploads"]);
    return { deleted: true, inUse: false };
  };

  const signUpload = async (payload: {
    filename: string;
    mimeType: string;
    size: number;
    contentHash?: string;
  }): Promise<SignedUploadResult> => {
    const data = await $api<Rec>("/v1/uploads/sign", {
      method: "POST",
      body: payload,
    });
    const existing = data.existing === true && data.media ? toUploadedFile(data.media as MediaDto) : undefined;
    return {
      uploadUrl: String(data.uploadUrl || ""),
      uploadToken: String(data.uploadId || ""),
      method: String(data.method || "PUT"),
      objectKey: "",
      publicUrl: "",
      headers: (data.headers as Record<string, string>) || {},
      expiresAt: String(data.expiresAt || ""),
      existing,
    };
  };

  const completeUpload = async (payload: {
    uploadToken: string;
    width?: number;
    height?: number;
  }): Promise<UploadedFile> => {
    const data = await $api<MediaDto>(`/v1/uploads/${encodeURIComponent(payload.uploadToken)}/complete`, {
      method: "POST",
      body: { width: payload.width ?? null, height: payload.height ?? null },
    });
    return toUploadedFile(data);
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
      invalidate(["me", "uploads"]);
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
    pageCursors.forEach((_, key) => key.startsWith("uploads:") && pageCursors.delete(key));
    invalidate(["me", "uploads"]);

    return uploaded;
  };

  // ── 装扮 ──────────────────────────────────────────

  const getMyBusinessCards = async (
    type?: BusinessCardType,
    page = 1,
    pageSize = 30,
  ): Promise<MyBusinessCardsResult> => {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(50, Math.max(1, Math.floor(pageSize)));
    return cachedRead(
      qk.me.businessCards(type ?? "all", safePage, safePageSize),
      async () => {
        let equipped: BusinessCard | null = null;
        const { items, hasMore } = await fetchPageByNumber<Rec>(
          `cards:${type ?? "all"}:${safePageSize}`,
          safePage,
          async (cursor) => {
            const res = await $api<CursorPage<Rec> & { equippedCard?: Rec | null }>("/v1/me/cards", {
              query: {
                limit: String(safePageSize),
                ...(type ? { kind: type } : {}),
                ...(cursor ? { cursor } : {}),
              },
            });
            equipped = toBusinessCard(res.equippedCard) ?? null;
            return res;
          },
        );
        const cards = items.map(toBusinessCard).filter((c): c is BusinessCard => !!c);
        const equippedCard = equipped as BusinessCard | null;
        return {
          cards,
          equippedCardDocumentId: equippedCard?.documentId ?? null,
          equippedCard,
          pagination: pagedResult(safePage, safePageSize, items.length, hasMore),
        };
      },
      STALE_ME,
    );
  };

  const equipBusinessCard = async (cardId: string | null): Promise<void> => {
    await $api("/v1/me/cards/equipped", {
      method: "PUT",
      body: { cardId },
    });
    invalidate(["me", "business-cards"]);
    invalidate(["profile"]);
  };

  const getMyAvatars = async (): Promise<{ avatars: Avatar[]; equippedAvatarDocumentId: string | null }> => {
    return cachedRead(
      qk.me.avatars,
      async () => {
        const data = await $api<{ items: Rec[]; equippedAvatarId?: string | null }>("/v1/me/avatars");
        return {
          avatars: (data.items || []).map(toAvatar).filter((a): a is Avatar => !!a),
          equippedAvatarDocumentId: data.equippedAvatarId ?? null,
        };
      },
      STALE_ME,
    );
  };

  const equipAvatar = async (avatarId: string | null): Promise<void> => {
    // 装备系统头像时把自定义头像清掉（主页与作者展示优先用自定义头像）。
    if (avatarId) await $api("/v1/me/avatar", { method: "DELETE" }).catch(() => undefined);
    await $api("/v1/me/avatars/equipped", {
      method: "PUT",
      body: { avatarId },
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
    const data = await $api<Rec>("/v1/me/avatar", {
      method: "PUT",
      body: { mediaId: uploaded.documentId },
    });
    onProgress?.(100);
    const avatar = data.avatar as MediaDto | undefined;
    invalidate(qk.me.avatars);
    invalidate(qk.me.self);
    invalidate(["profile"]);
    if (typeof data.balance === "number") useAuthStore().updateUserPartial({ denny: data.balance });
    return { url: normalizeMediaUrl(avatar?.url) || uploaded.url };
  };

  // ── 个人资料设置 ───────────────────────────────────

  const getMyProfileRaw = () => $api<Rec>("/v1/me/profile");

  const toPinnedIds = (raw: unknown): string[] | null =>
    Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : null;

  /** 改名（付费）。 */
  const updateMyName = async (name: string): Promise<{ name: string }> => {
    const data = await $api<Rec>("/v1/me/username", {
      method: "PUT",
      body: { username: name },
    });
    invalidate(qk.me.self);
    invalidate(qk.me.profile);
    invalidate(["profile"]);
    if (typeof data.balance === "number") useAuthStore().updateUserPartial({ denny: data.balance });
    return { name: String(data.username || name) };
  };

  const updateMyBio = async (bio: string): Promise<{ bio: string }> => {
    const data = await $api<Rec>("/v1/me/profile", {
      method: "PATCH",
      body: { bio },
    });
    invalidate(qk.me.self);
    invalidate(qk.me.profile);
    invalidate(["profile"]);
    return { bio: String(data.bio ?? bio) };
  };

  const updateMyVisibility = async (profileHidden: boolean): Promise<{ profileHidden: boolean }> => {
    const data = await $api<Rec>("/v1/me/profile", {
      method: "PATCH",
      body: { hidden: profileHidden },
    });
    invalidate(qk.me.self);
    invalidate(qk.me.profile);
    invalidate(["profile"]);
    return { profileHidden: data.hidden === true };
  };

  const getMyProfileSettings = async (): Promise<{ profileHidden: boolean }> => {
    return cachedRead(
      qk.me.profile,
      async () => ({ profileHidden: (await getMyProfileRaw()).hidden === true }),
      STALE_ME,
    );
  };

  // ── 账号安全（安全概览、邮箱绑定、注销） ─────────────

  const toSecurity = (data: Rec): AccountSecurity => ({
    email: String(data.email || ""),
    provider: data.mihoyoBound === true && !data.hasPassword ? "mihoyo" : "local",
    hasBoundEmail: !!str(data.email),
    hasPassword: data.hasPassword === true,
  });

  const getMySecurity = async (): Promise<AccountSecurity> => {
    const data = await $api<Rec>("/v1/me/security");
    if (!data || typeof data.hasPassword !== "boolean") {
      throw new Error("账号安全信息响应无效，请重试");
    }
    return toSecurity(data);
  };

  const sendBindEmailCode = async (email: string): Promise<SendCodeResult> => {
    const response = await $api("/v1/me/email/code", {
      method: "POST",
      body: { email },
    });
    return toSendCodeResult(response, email);
  };

  const bindEmail = async (email: string, code: string): Promise<AccountSecurity> => {
    await $api("/v1/me/email", {
      method: "PUT",
      body: { email, code },
    });
    invalidate(qk.me.self);
    invalidate(qk.me.profile);
    return getMySecurity();
  };

  const sendDeleteAccountCode = async (): Promise<SendCodeResult> => {
    const response = await $api("/v1/me/delete-account/code", { method: "POST" });
    return toSendCodeResult(response, "");
  };

  // 注销核验：有真实邮箱的账号传 code（邮箱验证码），纯米游社扫码号传 ticket（重新扫码的 qrId）。
  const deleteAccount = async (params: { code?: string; ticket?: string }): Promise<{ success: boolean }> => {
    await $api("/v1/me/delete-account", {
      method: "POST",
      body: { code: params.code ?? null, qrId: params.ticket ?? null },
    });
    return { success: true };
  };

  // ── 已登录设备与会话 ──────────────────────────────

  const getMySessions = async (): Promise<AuthSessionItem[]> => {
    const res = await $api<CursorPage<Rec>>("/v1/me/sessions");
    return res.items.map((s) => ({
      id: String(s.id),
      isCurrent: s.current === true,
      userAgent: str(s.userAgent) ?? null,
      ip: String(s.ip || ""),
      location: str(s.location) ?? null,
      loginMethod: (str(s.loginMethod) ?? null) as AuthSessionItem["loginMethod"],
      loginAt: str(s.createdAt) ?? null,
      lastSeenAt: str(s.lastSeenAt) ?? null,
      createdAt: str(s.createdAt) ?? null,
      expiresAt: str(s.expiresAt) ?? null,
    }));
  };

  const revokeSession = async (id: string): Promise<{ ok: boolean }> => {
    await $api(`/v1/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    return { ok: true };
  };

  const revokeOtherSessions = async (): Promise<{ ok: boolean }> => {
    await $api("/v1/me/sessions/revoke-others", { method: "POST" });
    return { ok: true };
  };

  // ── 主页精选 ──────────────────────────────────────

  const toPinnedCandidate = (post: Post): PinnedCandidate => ({
    documentId: post.id,
    title: post.title,
    cover: post.cover ? { url: post.cover, width: post.coverWidth, height: post.coverHeight } : null,
    updatedAt: post.updatedAt,
  });

  const getPinnedArticles = async (
    options: { start?: number; limit?: number; q?: string } = {},
  ): Promise<PinnedArticlesPage> => {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const q = options.q?.trim() ?? "";
    return cachedRead(
      [...qk.me.pinnedArticles, limit, q] as QueryKey,
      async () => {
        const selfId = String(useAuthStore().user?.id || "");
        const profile = await getMyProfileRaw();
        const pinned = toPinnedIds(profile.pinnedPostIds);
        // 配置了精选时，本人主页的默认列表就是精选（按保存顺序，带封面）。
        const pinnedItems = pinned?.length && selfId
          ? (await fetchProfilePosts(selfId, "", SHOWCASE_MAX, "default")).page.nodes.map(toPinnedCandidate)
          : [];
        const res = await $api<CursorPage<Rec>>("/v1/me/profile/pin-candidates", {
          query: { limit: String(Math.min(50, Math.max(1, limit))), ...(q ? { q } : {}) },
        });
        const candidates = res.items.map((c): PinnedCandidate => ({
          documentId: String(c.id),
          title: String(c.title || ""),
          cover: null,
          updatedAt: str(c.publishedAt),
        }));
        return { pinned, pinnedItems, candidates, max: SHOWCASE_MAX, hasNextPage: !!res.nextCursor };
      },
      STALE_ME,
    );
  };

  /**
   * 评论编辑器里 @ 触发的用户搜索。
   * - 不缓存：输入快、命中率低，缓存只会增加状态复杂度
   */
  const searchAuthors = async (
    q: string,
    limit = 8,
  ): Promise<MentionCandidate[]> => {
    const trimmed = q?.trim() ?? "";
    if (!trimmed) return [];
    const data = await $api<Rec[]>("/v1/users/mention-candidates", {
      query: { q: trimmed, limit: String(limit) },
    });
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({
      documentId: String(item.id || ""),
      name: String(item.username || ""),
      username: str(item.username) ?? null,
      level: num(item.level) ?? null,
      avatar: normalizeMediaUrl(item.avatarUrl) || null,
    }));
  };

  const updatePinnedArticles = async (
    pinned: string[] | null,
  ): Promise<{ pinned: string[] | null }> => {
    const data = await $api<Rec>("/v1/me/profile/pinned-posts", {
      method: "PUT",
      body: { postIds: pinned },
    });
    invalidate(qk.me.pinnedArticles);
    invalidate(["profile"]);
    return { pinned: toPinnedIds(data.pinnedPostIds) };
  };

  // ── 丁尼(Denny)货币系统 ───────────────────────────────

  /**
   * 获取当前用户的丁尼余额、累计投出与最近流水
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
    const [wallet, logs] = await Promise.all([
      $api<Rec>("/v1/me/wallet"),
      $api<CursorPage<Rec>>("/v1/me/denny-logs", { query: { limit: "20" } }),
    ]);
    return {
      denny: Number(wallet.balance) || 0,
      dennyGiven: Number(wallet.given) || 0,
      recentLogs: logs.items.map((log) => ({
        action: String(log.action || ""),
        amount: Number(log.amount) || 0,
        balance: Number(log.balance) || 0,
        description: String(log.description || ""),
        createdAt: String(log.createdAt || ""),
      })),
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
    const data = await $api<Rec>(`/v1/posts/${encodeURIComponent(articleId)}/denny`, {
      method: "POST",
      body: message ? { message } : {},
    });
    invalidate(qk.articles.detail(articleId));
    return {
      success: true,
      newBalance: Number(data.balance) || 0,
      articleDennyCount: Number(data.dennyCount) || 0,
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
    const d = await $api<Rec>(`/v1/posts/${encodeURIComponent(articleId)}/triple`, { method: "POST" });
    invalidate(qk.articles.detail(articleId));
    return {
      liked: true,
      likesCount: Number(d.likeCount || 0),
      favorited: true,
      favoritesCount: Number(d.favoriteCount || 0),
      coinGiven: d.dennyGiven === true,
      coinReason: str(d.dennyError) ?? (d.dennyGiven === true ? "OK" : "FAILED"),
      dennyCount: Number(d.dennyCount || 0),
      newBalance: typeof d.balance === "number" ? d.balance : null,
    };
  };

  // ── 签到系统 ──────────────────────────────────────────

  /**
   * 获取签到状态
   *
   * nextConsecutiveDays / nextReward 描述「本签到日这一次签到」：canCheckIn 时是
   * 现在签到能拿到的，已签到时是今天已经拿到的。
   */
  const getCheckInStatus = async (): Promise<{
    canCheckIn: boolean;
    totalDays: number;
    consecutiveDays: number;
    rank: number;
    checkInDay: string | null;
    nextEligibleAt: string | null;
    currentDenny: number;
    nextConsecutiveDays: number | null;
    nextReward: number | null;
  }> => {
    const data = await $api<Rec>("/v1/me/check-in");
    return {
      canCheckIn: data.canCheckIn === true,
      totalDays: Number(data.totalDays) || 0,
      consecutiveDays: Number(data.streak) || 0,
      rank: Number(data.rank) || 0,
      checkInDay: str(data.day) ?? null,
      nextEligibleAt: str(data.nextEligibleAt) ?? null,
      currentDenny: Number(data.balance) || 0,
      nextConsecutiveDays: num(data.nextStreak) ?? null,
      nextReward: num(data.nextDenny) ?? null,
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
    const data = await $api<Rec>("/v1/me/check-in", { method: "POST" });
    return {
      message: "签到成功",
      reward: Number(data.dennyGained) || 0,
      dennyAdded: Number(data.dennyGained) || 0,
      currentDenny: Number(data.balance) || 0,
      consecutiveDays: Number(data.streak) || 0,
      totalDays: Number(data.totalDays) || 0,
      rank: Number(data.rank) || 0,
      currentExp: num(data.exp),
      currentLevel: num(data.level),
      nextEligibleAt: str(data.nextEligibleAt),
    };
  };

  /**
   * 获取每日主动行为经验获取状态
   */
  const getDailyExpStatus = async (): Promise<DailyExpStatus> => {
    const data = await $api<Rec>("/v1/me/exp");
    const sources = (data.sources || {}) as Record<string, { done?: boolean; exp?: number } | undefined>;
    const source = (key: string) => {
      const s = sources[key];
      return { done: s?.done === true, exp: typeof s?.exp === "number" ? s.exp : 0 };
    };
    return {
      todaySelfGained: num(data.todayActiveGained) ?? 0,
      todaySelfCap: num(data.todayActiveCap) ?? 50,
      sources: {
        checkIn: source("checkIn"),
        createArticle: source("createPost"),
        createComment: source("createComment"),
        likeGive: source("likeGive"),
      },
    };
  };

  // ── 等级权益 ──────────────────────────────────────────
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
    const data = await $api<Rec>("/v1/benefits");
    const level = clampBenefitLevel(data.level);
    const parse = (raw: unknown, fallbackLevel: number): BenefitValues => {
      const obj = (raw ?? {}) as Rec;
      const fallback = benefitsForLevel(fallbackLevel);
      return {
        articleMaxImages: num(obj.postMaxImages) ?? fallback.articleMaxImages,
        commentMaxImages: num(obj.commentMaxImages) ?? fallback.commentMaxImages,
        articleMaxBody: num(obj.postMaxBodyChars) ?? fallback.articleMaxBody,
      };
    };
    const nextLevel =
      typeof data.nextLevel === "number" ? clampBenefitLevel(data.nextLevel) : undefined;
    return {
      level,
      maxLevel: num(data.maxLevel) ?? BENEFIT_MAX_LEVEL,
      benefits: parse(data.benefits, level),
      ...(nextLevel != null
        ? { nextLevel, nextBenefits: parse(data.nextBenefits, nextLevel) }
        : {}),
    };
  };

  // ── 入站考试 ──────────────────────────────────────────

  const getExamStatus = async (): Promise<ExamStatus> => {
    const data = await $api<Rec>("/v1/exam");
    const active = data.activeAttempt as Rec | null | undefined;
    return {
      passed: data.passed === true,
      passedAt: str(data.passedAt) ?? null,
      cooldownRemaining: Number(data.cooldownRemainingSecs || 0),
      activeAttempt: active
        ? {
            attemptId: String(active.id),
            startedAt: String(active.startedAt),
            expiresAt: String(active.expiresAt),
            questionCount: Number(active.questionCount || 0),
          }
        : null,
      config: toExamConfig(data.config),
    };
  };

  const startExam = async (): Promise<ExamStartResult> => {
    const data = await $api<Rec>("/v1/exam/attempts", { method: "POST" });
    return {
      attemptId: String(data.attemptId),
      resumed: data.resumed === true,
      startedAt: String(data.startedAt),
      expiresAt: String(data.expiresAt),
      questions: Array.isArray(data.questions) ? data.questions.map(toExamQuestion) : [],
      config: toExamConfig(data.config),
    };
  };

  const submitExam = async (
    attemptId: string,
    answers: Record<string, string[]>,
  ): Promise<ExamSubmitResult> => {
    const data = await $api<Rec>(`/v1/exam/attempts/${encodeURIComponent(attemptId)}/submit`, {
      method: "POST",
      body: { answers },
    });
    const reward = data.reward as Rec | null | undefined;
    invalidate(qk.me.self);
    return {
      passed: data.passed === true,
      score: Number(data.score || 0),
      totalScore: Number(data.totalScore || 0),
      scorePercent: Number(data.scorePercent || 0),
      correctCount: Number(data.correctCount || 0),
      questionCount: Number(data.questionCount || 0),
      passScorePercent: Number(data.passScorePercent || 0),
      cooldownRemaining: Number(data.cooldownRemainingSecs || 0),
      reward: reward ? { denny: Number(reward.denny || 0), exp: Number(reward.exp || 0) } : null,
    };
  };

  const getExamReview = async (attemptId?: string): Promise<ExamAttemptReview> => {
    const [data, status] = await Promise.all([
      $api<Rec>("/v1/exam/review", { query: attemptId ? { attemptId } : {} }),
      getExamStatus(),
    ]);
    return {
      attemptId: String(data.attemptId),
      passed: data.passed === true,
      score: Number(data.score || 0),
      totalScore: Number(data.totalScore || 0),
      scorePercent: Number(data.scorePercent || 0),
      correctCount: Number(data.correctCount || 0),
      questionCount: Number(data.questionCount || 0),
      submittedAt: String(data.submittedAt || ""),
      config: status.config,
      questions: Array.isArray(data.questions)
        ? (data.questions as Rec[]).map((q) => ({
            ...toExamQuestion(q),
            userAnswer: Array.isArray(q.userAnswer) ? (q.userAnswer as string[]) : [],
            isCorrect: q.isCorrect === true,
            score: Number(q.score || 0),
            explanation: str(q.explanation) ?? null,
          }))
        : [],
    };
  };

  return {
    clearAllCache,
    invalidateQueries,
    mergeReadStatus,
    readStatusRevision: readonly(readStatusRevision),
    login,
    sendRegisterCode,
    registerWithCode,
    sendResetCode,
    resetPassword,
    sendLoginCode,
    loginWithCode,
    getSelfUser,
    seedSelfUser,
    patchSelfUserCache,
    searchArticles,
    getSuggestedArticles,
    getArticleUpdates,
    suggestArticles,
    peekArticles,
    getCategories,
    suggestTags,
    getPost,
    recordArticleView,
    pinArticle,
    unpinArticle,
    getComments,
    getCommentReplies,
    loadMoreReplies,
    addPostComment,
    deleteComment,
    pinComment,
    unpinComment,
    acceptComment,
    unacceptComment,
    toggleLike,
    toggleFavorite,
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
    getProfileAllArticles,
    getProfileComments,
    getBilibiliInfo,
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
    sendDeleteAccountCode,
    deleteAccount,
    // 已登录设备与会话
    getMySessions,
    revokeSession,
    revokeOtherSessions,
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
