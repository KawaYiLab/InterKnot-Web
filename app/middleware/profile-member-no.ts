/**
 * 主页地址统一用会员号：`/profile/<用户 id>` 换成 `/profile/<会员号>`（子页、参数一并保留）。
 * 雪花 id 一定 >= 2^22，会员号远小于它；查不到就原样放行，交给页面报错。
 */
const SNOWFLAKE_MIN = 2 ** 22;

export default defineNuxtRouteMiddleware(async (to) => {
  const id = String(to.params.id ?? "");
  if (!/^\d+$/.test(id) || Number(id) < SNOWFLAKE_MIN) return;
  try {
    const profile = await useApi().getProfile(id);
    if (profile.memberNo == null) return;
    const path = to.path.replace(`/profile/${id}`, `/profile/${profile.memberNo}`);
    return navigateTo({ path, query: to.query, hash: to.hash }, { replace: true });
  } catch {
    // 交给页面处理（404 等）
  }
});
