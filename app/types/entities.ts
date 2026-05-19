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

// ── DM 私聊（真实双向）相关 ──────────────────────────────
// 后端契约：`server/src/api/conversation/controllers/conversation.ts`
//          `server/src/api/message/controllers/message.ts`
//          `server/src/api/conversation/utils/ws-server.ts`

export type DmConversationKind = "direct" | "group";
export type DmMemberRole = "owner" | "admin" | "member";
/**
 * DM 消息形态：
 * - `text` / `image` / `system`：真实落库的 DM 消息
 * - `notification`：会话式融合的「敲敲通知」虚拟消息（不入 message 表，
 *   由后端在序列化阶段从 notification 表拼出来），气泡需要按
 *   `notificationKind` 走专门渲染（点赞/收藏/评论/回复/@提到/系统等）
 */
export type DmMessageKind = "text" | "image" | "system" | "notification";

/** 通知 kind 子分类（仅 kind === "notification" 时有意义） */
export type DmNotificationKind =
  | "like"
  | "favorite"
  | "comment"
  | "reply"
  | "mention"
  | "system";

/**
 * pseudo conversation id 类型标记。真 DM 的 documentId 是 strapi 给的 hash；
 * 这三种 pseudo 仅出现在「会话融合」语义下：
 * - `pseudo:user:${userId}`   通知 sender 但还没和当前用户开 DM
 * - `pseudo:anonymous:${seed}` 匿名通知聚合
 * - `pseudo:system`            系统通知聚合
 *
 * 与真 DM 在前端的区别：
 * - 列表项可正常展示与点击
 * - 选中后能拉到通知历史，但 `pseudo:user` 不能直接发消息
 *   （要先调 direct API 升级为真 DM）；anonymous / system 永远不可发消息
 */
export type DmPseudoConversationId =
  | `pseudo:user:${number}`
  | `pseudo:anonymous:${string}`
  | "pseudo:system";

/** 私聊会话里的对端简要信息（仅 direct 会话非空） */
export interface DmPeer {
  userId: number;
  authorDocumentId: string;
  name: string;
  avatar: string | null;
  level: number | null;
}

/** 自己在该会话上的偏好与状态（mute/pin/lastRead） */
export interface DmSelfState {
  role: DmMemberRole;
  muted: boolean;
  pinned: boolean;
  lastReadAt: string | null;
}

/** 列表预览里的最后一条消息（已对撤回/图片/系统态做兜底文案） */
export interface DmLastMessagePreview {
  documentId: string;
  content: string;
  createdAt: string;
  kind: DmMessageKind;
  senderUserId: number | null;
}

/** GET /api/dm/conversations 返回的单条会话摘要 */
export interface DmConversationSummary {
  documentId: string;
  kind: DmConversationKind;
  title: string | null;
  avatar: string | null;
  peer: DmPeer | null;
  memberCount: number;
  lastMessageAt: string | null;
  lastMessage: DmLastMessagePreview | null;
  unreadCount: number;
  self: DmSelfState;
  /**
   * 仅在「会话融合」语义下出现，标识该会话项是否是 pseudo 形态：
   * - `null` / undefined：真 DM 会话
   * - `"user"`：通知 sender 但暂无 DM 会话；前端首次发消息时调 direct API 升级
   * - `"anonymous"`：匿名通知聚合（不可发消息）
   * - `"system"`：系统通知聚合（不可发消息）
   *
   * 字段值与 `documentId` 前缀一致：例如 pseudoKind === "user" 对应
   * documentId 为 `pseudo:user:${userId}`。
   */
  pseudoKind?: "user" | "anonymous" | "system" | null;
}

/** 单条消息的 sender 简要信息（撤回后仍保留发送者，便于灰条占位） */
export interface DmMessageSender {
  userId: number;
  authorDocumentId: string | null;
  name: string;
  avatar: string | null;
  level: number | null;
}

/** 引用消息的简化视图（被撤回时 content 为 null） */
export interface DmMessageReplyTo {
  documentId: string;
  content: string | null;
  senderUserId: number | null;
}

/** kind === "notification" 时的引用帖子简要信息 */
export interface DmNotificationArticleRef {
  documentId: string;
  title: string;
  coverAspectRatio?: number;
}

/** kind === "notification" 时的引用评论简要信息（like-on-comment 等场景） */
export interface DmNotificationCommentRef {
  documentId: string;
  content: string;
  isAnonymous: boolean;
}

/** GET /api/dm/conversations/:id/messages 单条消息 */
export interface DmMessage {
  /**
   * 通用消息 documentId。
   * - 真 DM 消息：strapi message.documentId
   * - 通知虚拟消息：`notif:${notification.documentId}` —— 加前缀避免与 DM
   *   消息 documentId 命名空间冲突，前端做编辑/撤回时也能据此判定不可操作。
   */
  documentId: string;
  kind: DmMessageKind;
  /**
   * - text/image/system：消息正文，撤回后 null
   * - notification：预渲染好的文案（"赞了你的评论" 等），保证旧版式渲染兼容
   */
  content: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  sender: DmMessageSender | null;
  replyTo: DmMessageReplyTo | null;

  // ── 仅 kind === "notification" 出现的字段 ──────────────────
  /** 通知子类型：决定气泡左侧 / quote 卡 的展示文案 */
  notificationKind?: DmNotificationKind;
  /** 原 notification.documentId，用于 mark-read / 跳转 */
  notificationDocumentId?: string;
  /** 通知是否已读（与该消息所在会话的 unreadCount 是相互独立的字段） */
  notificationRead?: boolean;
  /** 通知关联的帖子；点击 quote 卡可跳转 */
  article?: DmNotificationArticleRef | null;
  /** 通知关联的评论；like-on-comment 时存在 */
  comment?: DmNotificationCommentRef | null;
}

/** WS 服务端 → 客户端事件 type 联合 */
export type DmWsEventType =
  | "hello"
  | "pong"
  | "message.created"
  | "message.edited"
  | "message.deleted"
  | "conversation.read"
  | "conversation.updated"
  | "conversation.member.removed"
  | "typing"
  | "error";

/** WS 事件公共结构（不同 type 的 data 形态见 controller 推送处） */
export interface DmWsEvent<TData = unknown> {
  type: DmWsEventType;
  conversationId?: string;
  messageId?: string;
  data?: TData;
  at: string;
}
