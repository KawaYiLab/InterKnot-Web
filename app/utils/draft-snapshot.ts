import type { ExternalVideo } from "~/types/entities";

/**
 * 编辑器里「用户可改且会发到服务端」的全部内容。
 *
 * 指纹与 payload 共用这一份，是为了在类型层面排除掉一整类静默缺陷：payload 里加了
 * 字段、指纹忘了加 —— 那个字段的单独改动会算出与上次完全相同的指纹，保存被直接跳过。
 * `isAnonymous` 就这样丢过：只拨匿名开关不会触发任何保存。往这个接口加字段，
 * buildDraftSnapshot 与 buildDraftPayload 会一起编译不过，逼着两边同时更新。
 *
 * 刻意**不**收 authorId：它来自登录态而非编辑器内容，异步到位时会凭空改变指纹、
 * 多打一次零变更 PUT。它作为 buildDraftPayload 的独立参数传入。
 */
export interface DraftEditorContent {
  title: string;
  text: string;
  /** 站外视频。注意它自带 coverLoadError 这类纯渲染状态，与 payload 保持同构故不剔除 */
  externalVideos: ExternalVideo[];
  /** 封面：0 张为 []，1 张为该图 id，多张为 id 数组 —— 就是 payload 里的 coverId */
  cover: string | string[];
  /** 已经兜过默认值的分类 slug。空串与默认分类在这里必须已经归一，否则「指纹变了、
   *  payload 没变」会白发一次 PUT */
  category: string;
  isAnonymous: boolean;
}

/**
 * 指纹只用于相等比较，不做持久化，因此 JSON.stringify 的键序由这里的字面量固定即可。
 * 标题与正文按 trim 后比较：只多敲一个空格再删掉，不该算一次改动 —— 与 payload 同步 trim。
 */
export function buildDraftSnapshot(input: DraftEditorContent): string {
  return JSON.stringify({
    title: input.title.trim(),
    text: input.text.trim(),
    externalVideos: input.externalVideos,
    cover: input.cover,
    category: input.category,
    isAnonymous: input.isAnonymous,
  });
}

export interface DraftSavePayload {
  title: string;
  text: string;
  externalVideos: ExternalVideo[];
  coverId: string | string[];
  category: string;
  /** 必须无条件带上：updateArticleDraft 按 `!== undefined` 决定是否进 data，
   *  漏掉 false 就是「匿名开关只能开不能关」*/
  isAnonymous: boolean;
  authorId?: string;
}

/** 与 buildDraftSnapshot 同源：同一个 content 算出的指纹与 payload 描述的是同一份内容。 */
export function buildDraftPayload(
  input: DraftEditorContent,
  authorId?: string,
): DraftSavePayload {
  return {
    title: input.title.trim(),
    text: input.text.trim(),
    externalVideos: input.externalVideos,
    coverId: input.cover,
    category: input.category,
    isAnonymous: input.isAnonymous,
    authorId,
  };
}
