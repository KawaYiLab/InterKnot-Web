import type { AuthSessionItem } from "~/types/entities";

function protocolError(): never {
  throw new Error("账号接口响应无效，请重试");
}

export function requireAccountSuccess<K extends "ok" | "success">(response: unknown, key: K): Record<K, true> {
  if (!response || typeof response !== "object" || (response as Record<string, unknown>)[key] !== true) protocolError();
  return { [key]: true } as Record<K, true>;
}

export function parseAuthSessions(response: unknown): AuthSessionItem[] {
  const rows = (response as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(rows)) return protocolError();
  const date = (value: unknown): string | null =>
    typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
  return rows.map((row: unknown) => {
    if (!row || typeof row !== "object") return protocolError();
    const item = row as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || Number(item.id) <= 0 || typeof item.isCurrent !== "boolean") return protocolError();
    return {
      id: Number(item.id), isCurrent: item.isCurrent,
      deviceId: typeof item.deviceId === "string" ? item.deviceId : null,
      userAgent: typeof item.userAgent === "string" ? item.userAgent : null,
      ip: typeof item.ip === "string" ? item.ip : "",
      location: typeof item.location === "string" ? item.location.trim() || null : null,
      loginMethod: typeof item.loginMethod === "string" && ["password", "mihoyo", "email_code", "password_change", "password_reset", "oauth"].includes(item.loginMethod)
        ? item.loginMethod as AuthSessionItem["loginMethod"] : null,
      loginAt: date(item.loginAt),
      lastSeenAt: date(item.lastSeenAt), createdAt: date(item.createdAt), expiresAt: date(item.expiresAt),
    };
  });
}
