export function isPublicEndpoint(path: string, method: string): boolean {
  if (path.startsWith("/api/auth/") && !path.startsWith("/api/auth/renew")) return true;

  const upperMethod = method.toUpperCase();
  if (upperMethod !== "GET") return false;

  return (
    (path.startsWith("/api/articles") &&
      !path.includes("/my") &&
      !path.includes("/publish") &&
      !path.includes("/unpublish")) ||
    (path.startsWith("/api/comments") && !path.includes("/likes")) ||
    path.startsWith("/api/authors") ||
    path.startsWith("/api/profiles")
  );
}

export const isPublicGetEndpoint = isPublicEndpoint;

export function shouldAttachToken(path: string, method: string, token: string): boolean {
  if (!token) return false;
  const upperMethod = method.toUpperCase();
  const pathname = path.split("?")[0] || path;
  if (
    upperMethod === "GET" &&
    (pathname.startsWith("/api/articles/detail/") ||
      // 首页列表本身公开，但 feed=following/favorites 需后端识别当前用户；
      // 带上 token（存在时）才能让 optional-auth 填充 ctx.state.user。
      pathname.startsWith("/api/articles/list") ||
      pathname.startsWith("/api/comments/list") ||
      pathname.startsWith("/api/profiles/") ||
      // /api/authors/search 走鉴权（后端按 user.id 做 Redis 限流），但路径前缀
      // 与公共的 /api/authors/* 撞车，必须显式列在白名单里把 token 带上。
      pathname.startsWith("/api/authors/search"))
  ) {
    return true;
  }
  return !isPublicEndpoint(path, method);
}
