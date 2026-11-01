import type { Profile } from "~/types/entities";

/**
 * boneyard 截取骨架时会在页面里设置 window.__BONEYARD_BUILD。
 * 此时页面不请求接口，改用下面的示例数据渲染，截出来的骨架就是真实布局。
 */
export function isBoneyardCapture(): boolean {
  return import.meta.client && (window as { __BONEYARD_BUILD?: boolean }).__BONEYARD_BUILD === true;
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
