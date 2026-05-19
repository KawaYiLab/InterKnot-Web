export interface Author {
  id?: string | number;
  documentId?: string;
  authorId?: string;
  username?: string;
  login?: string;
  name?: string;
  email?: string;
  avatar?: string;
  exp?: number;
  level?: number;
}

export interface CoverImage {
  documentId?: string;
  url: string;
  width?: number;
  height?: number;
}

export interface Discussion {
  id: string;
  title: string;
  body?: string;
  bodyText?: string;
  rawBodyText?: string;
  covers: CoverImage[];
  cover?: string;
  coverWidth?: number;
  coverHeight?: number;
  views?: number;
  likesCount?: number;
  commentsCount?: number;
  isRead?: boolean;
  liked?: boolean;
  createdAt?: string;
  updatedAt?: string;
  author: Author;
}

export interface CommentReply {
  id: string;
  content: string;
  liked?: boolean;
  likesCount?: number;
  createdAt?: string;
  author: Author;
}

export interface Comment {
  id: string;
  content: string;
  liked?: boolean;
  likesCount?: number;
  createdAt?: string;
  author: Author;
  replies: CommentReply[];
  articleId?: string;
  articleTitle?: string;
  parentContent?: string;
  parentAuthorName?: string;
}

export interface ProfileStats {
  articleCount: number;
  commentCount: number;
  totalViews: number;
  totalComments: number;
  totalLikes: number;
}

export type BusinessCardType = "character" | "city" | "news";

export interface BusinessCard {
  documentId: string;
  name: string;
  description?: string;
  story?: unknown[];
  type: BusinessCardType;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export type AvatarType = BusinessCardType;

export interface Avatar {
  documentId: string;
  name: string;
  type: AvatarType;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export interface Profile {
  documentId: string;
  uid?: number;
  login?: string;
  name?: string;
  bio?: string;
  avatar?: string;
  level?: number;
  exp?: number;
  isSelf?: boolean;
  isHidden?: boolean;
  profileHidden?: boolean;
  stats?: ProfileStats;
  equippedCard?: BusinessCard;
  equippedAvatar?: Avatar;
}

export interface LikeToggleResult {
  liked: boolean;
  likesCount: number;
}

export type UploadStatus =
  | "pending"
  | "compressing"
  | "uploading"
  | "done"
  | "error";

export interface UploadTask {
  localId: string;
  filename: string;
  file: File;
  status: UploadStatus;
  progress: number;
  previewUrl: string;
  serverId?: string;
  serverUrl?: string;
  error?: string;
}

export interface DraftArticle {
  documentId: string;
  title: string;
  text: string;
  editorState?: unknown[];
  cover?: CoverImage[];
  hasPublishedVersion: boolean;
  createdAt?: string;
  updatedAt?: string;
  author?: Author;
}

export interface SignedUploadResult {
  uploadUrl: string;
  uploadToken: string;
  method: string;
  objectKey: string;
  publicUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
  // 内容级去重命中：服务端检测到同 SHA-256 的已存在文件，直接复用，跳过 S3 PUT。
  existing?: UploadedFile;
}

export interface UploadedFile {
  id: number;
  documentId: string;
  url: string;
  width?: number;
  height?: number;
}

// ── Knock Knock（私信弹窗）相关 ──────────────────────────

export type NotificationType =
  | "comment"
  | "reply"
  | "like"
  | "favorite"
  | "mention"
  | "system";

export interface NotificationSenderAvatar {
  url: string;
  width?: number;
  height?: number;
}

export interface NotificationSenderAuthor {
  documentId: string | null;
  name: string | null;
  avatar: NotificationSenderAvatar | null;
}

export interface NotificationSender {
  id: number | null;
  username: string | null;
  level: number | null;
  author: NotificationSenderAuthor | null;
}

export interface NotificationArticleRef {
  documentId: string;
  title: string;
  coverAspectRatio: number | null;
}

export interface NotificationCommentRef {
  documentId: string;
  content: string;
  isAnonymous: boolean;
}

export interface NotificationDto {
  documentId: string;
  type: NotificationType;
  rawType?: NotificationType;
  isRead: boolean;
  createdAt: string;
  sender: NotificationSender | null;
  article: NotificationArticleRef | null;
  comment: NotificationCommentRef | null;
}

/** 私聊弹窗里的子分类。private chat tab 顶层切换用。 */
export type KnockCategory = "contacts" | "anonymous" | "other";

/**
 * 一个会话 = 一组关联到同一对端的 notifications 聚合视图。
 * 后端 `/api/knock/conversations` 只返回摘要（无 items）；具体消息流由
 * `/api/knock/conversations/:id/messages` 懒加载，前端按 conversation id 缓存。
 */
export interface KnockConversation {
  category: KnockCategory;
  /** 稳定的会话 key：base64url 编码后的 `${category}:${peerKey}` */
  id: string;
  /** 对端身份的原始 key（sender.id / 匿名 seed / "system"） */
  peerKey: string;
  peerName: string;
  peerAvatar: string | null;
  unread: number;
  lastPreview: string;
  lastAt: string;
  /** 最近一条通知的 type，用于在列表上展示图标 */
  lastType: NotificationType;
}

/** 后端 SSE 推送的事件类型 */
export type KnockSseEventType =
  | "notification.created"
  | "notification.read"
  | "notification.read.bulk";

export interface KnockSseEvent {
  type: KnockSseEventType;
  conversationId?: string;
  notificationId?: string;
  count?: number;
  at: string;
}
