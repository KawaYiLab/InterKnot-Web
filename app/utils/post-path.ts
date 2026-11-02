/**
 * 帖子地址用短编号（`/post/7012`），没有编号时用帖子 id。
 * 雪花 id 一定 >= 2^22，编号远小于它；迁移来的旧帖编号就是旧 id。
 */
export const POST_SNOWFLAKE_MIN = 2 ** 22;

// 卡片和详情加载时记下编号与 id 的对应：用编号打开帖子时按 id 读缓存，用 id 打开时直接拼短地址。
const idByNo = new Map<string, string>();
const noById = new Map<string, number>();

export function rememberPostNo(id: string, postNo: number | undefined): void {
  if (!id || postNo == null) return;
  idByNo.set(String(postNo), id);
  noById.set(id, postNo);
}

/** 地址里的编号换成已知的帖子 id；不认识的原样返回。 */
export function knownPostId(ref: string): string {
  return idByNo.get(ref) ?? ref;
}

/** 是否是雪花 id（不是编号）。 */
export function isPostSnowflake(ref: string): boolean {
  return /^\d+$/.test(ref) && Number(ref) >= POST_SNOWFLAKE_MIN;
}

export function postPath(postId?: string | null, postNo?: number | null): string {
  const key = postNo ?? (postId ? noById.get(postId) : undefined) ?? postId;
  return key == null || key === "" ? "" : `/post/${encodeURIComponent(String(key))}`;
}
