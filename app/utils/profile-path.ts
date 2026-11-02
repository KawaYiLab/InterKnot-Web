/**
 * 用户主页地址。有会员号就用会员号（`/profile/123`），没有再用用户 id；
 * 用 id 打开的主页加载完会换成会员号地址。
 */
export function profilePath(userId?: string | number | null, memberNo?: number | null): string {
  const key = memberNo ?? userId;
  return key == null || key === "" ? "" : `/profile/${encodeURIComponent(String(key))}`;
}
