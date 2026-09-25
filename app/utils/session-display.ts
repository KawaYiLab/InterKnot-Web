import type { AuthSessionItem } from "~/types/entities";
import { parseUserAgent } from "~/utils/device";

export interface SessionDisplayItem {
  session: AuthSessionItem;
  title: string;
  browser: string;
  location: string;
  ip: string;
  time: string;
  datetime: string;
  timeLabel: string;
}

export interface SessionDateGroup {
  key: string;
  label: string;
  items: SessionDisplayItem[];
}

const LOGIN_TITLES: Record<string, string> = {
  password: "账号密码登录",
  mihoyo: "米游社扫码登录",
  email_code: "邮箱验证码登录",
  password_change: "修改密码后登录",
  password_reset: "重置密码后登录",
  oauth: "第三方账号登录",
};

function ipv4Parts(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) {
    return null;
  }
  return parts.map(Number);
}

function ipv6Parts(value: string): number[] | null {
  let address = value;
  if (address.includes(".")) {
    const separator = address.lastIndexOf(":");
    if (separator < 0) return null;
    const ipv4 = ipv4Parts(address.slice(separator + 1));
    if (!ipv4) return null;
    address = `${address.slice(0, separator + 1)}${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const parts = [...left, ...right];
  if (parts.some((part) => !/^[\da-f]{1,4}$/i.test(part))) return null;
  if (halves.length === 1 && parts.length !== 8) return null;
  if (halves.length === 2 && parts.length >= 8) return null;
  return [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array<number>(8 - parts.length).fill(0),
    ...right.map((part) => Number.parseInt(part, 16)),
  ];
}

/** Mask addresses locally; never render an unvalidated or unmasked IP fallback. */
export function maskIpAddress(value?: string | null): string {
  if (typeof value !== "string" || !value.trim()) return "未知IP";
  const raw = value.trim();
  const ipv4 = ipv4Parts(raw);
  if (ipv4) return `${ipv4[0]}.${ipv4[1]}.***.${ipv4[3]}`;

  const address = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  const ipv6 = ipv6Parts(address);
  if (!ipv6) return "未知IP";
  // IPv4-mapped IPv6 has the same identifying address as its IPv4 form.
  if (ipv6.slice(0, 5).every((part) => part === 0) && ipv6[5] === 0xffff) {
    return `::ffff:${ipv6[6]! >> 8}.${ipv6[6]! & 255}.***.${ipv6[7]! & 255}`;
  }
  // Retain the network prefix and conceal the entire 64-bit interface identifier.
  return `${ipv6.slice(0, 4).map((part) => part.toString(16)).join(":")}:****`;
}

function validDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Group by local calendar date, using an explicit activity fallback for legacy sessions. */
export function groupSessionsByDate(sessions: AuthSessionItem[], now = new Date()): SessionDateGroup[] {
  const today = dateKey(now);
  const previousDay = new Date(now);
  previousDay.setDate(previousDay.getDate() - 1);
  const yesterday = dateKey(previousDay);
  const entries = sessions.map((session) => {
    const loginAt = validDate(session.loginAt);
    const date = loginAt ?? validDate(session.lastSeenAt);
    return { session, date, timeLabel: loginAt ? "登录时间" : date ? "最近活跃" : "时间未知" };
  }).sort((a, b) => (b.date?.getTime() ?? -Infinity) - (a.date?.getTime() ?? -Infinity));
  const groups = new Map<string, SessionDateGroup>();

  for (const { session, date, timeLabel } of entries) {
    const key = date ? dateKey(date) : "unknown";
    let group = groups.get(key);
    if (!group) {
      const label = !date ? "时间未知" : key === today ? "今天" : key === yesterday ? "昨天"
        : date.getFullYear() === now.getFullYear() ? `${date.getMonth() + 1}月${date.getDate()}日`
        : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
      group = { key, label, items: [] };
      groups.set(key, group);
    }
    group.items.push({
      session,
      title: session.loginMethod && Object.hasOwn(LOGIN_TITLES, session.loginMethod)
        ? LOGIN_TITLES[session.loginMethod]! : "登录",
      browser: parseUserAgent(session.userAgent).browser,
      location: session.location?.trim() || "归属地未知",
      ip: maskIpAddress(session.ip),
      time: date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : "--:--",
      datetime: date?.toISOString() ?? "",
      timeLabel,
    });
  }
  return [...groups.values()];
}
