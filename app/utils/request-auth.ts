export function isPublicEndpoint(path: string, method: string): boolean {
  if (
    path.startsWith("/api/auth/") &&
    !path.startsWith("/api/auth/renew") &&
    !path.startsWith("/api/auth/sessions") &&
    // 米游社接口需要带 token：binding 查询/解绑必须鉴权，
    // qr 创建/轮询带 token 时才会进入绑定模式（而非登录模式）
    !path.startsWith("/api/auth/mihoyo/")
  ) {
    return true;
  }

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

export function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("utf-8");
    const payload = JSON.parse(json);
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const exp = decodeJwtExp(token);
  if (!exp) return false;
  return Date.now() >= exp;
}

export function isTokenNearExpiry(
  token: string,
  thresholdMs = 2 * 60 * 1000,
): boolean {
  const exp = decodeJwtExp(token);
  if (!exp) return false;
  return exp - Date.now() < thresholdMs;
}
