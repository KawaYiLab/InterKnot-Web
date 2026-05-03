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
  stats?: ProfileStats;
  equippedCard?: BusinessCard;
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
}

export interface UploadedFile {
  id: number;
  documentId: string;
  url: string;
  width?: number;
  height?: number;
}
