import type { Author, Comment, Post, Profile } from "~/types/entities";

/**
 * boneyard 截取骨架时会在页面里设置 window.__BONEYARD_BUILD。
 * 此时页面不请求接口，改用下面的示例数据渲染，截出来的骨架就是真实布局。
 */
export function isBoneyardCapture(): boolean {
  return import.meta.client && (window as { __BONEYARD_BUILD?: boolean }).__BONEYARD_BUILD === true;
}

const claimedCaptures = new Set<string>();

/** 截取模式下，同名的展示位只让第一个组件实例用示例数据渲染（如页面上有多张悬浮卡片）。 */
export function claimBoneyardCapture(key: string): boolean {
  if (!isBoneyardCapture() || claimedCaptures.has(key)) return false;
  claimedCaptures.add(key);
  return true;
}

/** 占用展示位的组件卸载时释放，让之后挂载的实例接手（如加载态切到内容态）。 */
export function releaseBoneyardCapture(key: string): void {
  claimedCaptures.delete(key);
}

/** 个人主页骨架的示例资料：他人主页、有绝区零徽章和签名，字数取常见长度。 */
export const SAMPLE_PROFILE: Profile = {
  documentId: "0",
  uid: "0",
  memberNo: 10086,
  name: "绳网用户",
  bio: "这里是一段长度适中的个人签名。",
  level: 10,
  isSelf: false,
  zzz: { uid: "0", nickname: "绳网用户", level: 60, regionName: "国服" },
  followersCount: 100,
  followingCount: 10,
  stats: { articleCount: 0, commentCount: 0, totalViews: 1000, totalComments: 100, totalLikes: 1000 },
};

/** 帖子页骨架的示例作者。 */
export const SAMPLE_AUTHOR: Author = {
  documentId: "0",
  name: "绳网用户",
  level: 10,
};

/** 帖子页骨架的示例帖子：只用到头部作者栏，正文和封面仍用手写占位。 */
export const SAMPLE_POST: Post = {
  id: "0",
  title: "示例委托标题",
  covers: [],
  likesCount: 100,
  commentsCount: 10,
  author: SAMPLE_AUTHOR,
};

/** 评论骨架的示例评论：一行正文，不带回复引用和图片。 */
export const SAMPLE_COMMENT: Comment = {
  id: "0",
  content: "这是一条长度适中的示例评论。",
  likesCount: 10,
  replyCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  floor: 2,
  author: SAMPLE_AUTHOR,
};
