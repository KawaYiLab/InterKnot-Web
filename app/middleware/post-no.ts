/**
 * 帖子地址统一用短编号：`/post/<帖子 id>` 换成 `/post/<编号>`（参数、锚点一并保留）。
 * 查到的详情已经缓存在帖子 id 名下，跳转后不会再请求一次；查不到就原样放行，交给页面报错。
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const id = String(to.params.id ?? "");
  if (!isPostSnowflake(id)) return;
  try {
    const post = await useApi().getPost(id);
    if (post.postNo == null) return;
    return navigateTo({ path: postPath(post.id, post.postNo), query: to.query, hash: to.hash }, { replace: true });
  } catch {
    // 交给页面处理（404、拉黑等）
  }
});
