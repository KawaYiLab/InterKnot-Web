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
      pathname.startsWith("/api/comments/list") ||
      pathname.startsWith("/api/profiles/"))
  ) {
    return true;
  }
  return !isPublicEndpoint(path, method);
}
