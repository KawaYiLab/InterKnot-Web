import { describe, expect, it } from "vitest";
import type { AuthSessionItem } from "~/types/entities";
import { groupSessionsByDate, maskIpAddress } from "~/utils/session-display";

const localTime = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).toISOString();
const session = (id: number, data: Partial<AuthSessionItem> = {}): AuthSessionItem => ({
  id, lastSeenAt: null, ...data,
});

describe("session date groups", () => {
  it("groups local calendar days and sorts newest first without mutating the input", () => {
    const sessions = [
      session(1, { loginAt: localTime(2026, 9, 17, 23, 59) }),
      session(2, { loginAt: localTime(2026, 9, 18, 0, 1) }),
      session(3, { loginAt: localTime(2026, 9, 16, 15, 20) }),
      session(4, { loginAt: localTime(2026, 9, 18, 1, 14) }),
    ];
    const groups = groupSessionsByDate(sessions, new Date(2026, 8, 18, 2));
    expect(groups.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "2026-09-18", label: "今天" },
      { key: "2026-09-17", label: "昨天" },
      { key: "2026-09-16", label: "2026年9月16日" },
    ]);
    expect(groups[0]!.items.map(({ session }) => session.id)).toEqual([4, 2]);
    expect(groups[0]!.items[0]).toMatchObject({ time: "01:14", timeLabel: "登录时间" });
    expect(sessions.map(({ id }) => id)).toEqual([1, 2, 3, 4]);
  });

  it("recognizes yesterday across a year boundary even when more than 24 hours ago", () => {
    const groups = groupSessionsByDate([
      session(1, { loginAt: localTime(2025, 12, 31, 0, 1) }),
      session(2, { loginAt: localTime(2025, 12, 30, 23, 59) }),
    ], new Date(2026, 0, 1, 23, 59));
    expect(groups.map(({ label }) => label)).toEqual(["昨天", "2025年12月30日"]);
  });

  it("keeps the original login time when token rotation and activity are newer", () => {
    const loginAt = localTime(2026, 9, 16, 9, 5);
    const item = session(1, {
      loginMethod: "password", loginAt,
      createdAt: localTime(2026, 9, 18, 12), lastSeenAt: localTime(2026, 9, 18, 14),
    });
    const [group] = groupSessionsByDate([item], new Date(2026, 8, 18, 15));
    expect(group).toMatchObject({ label: "2026年9月16日" });
    expect(group!.items[0]).toMatchObject({ title: "账号密码登录", time: "09:05", datetime: loginAt, timeLabel: "登录时间" });
  });

  it("labels legacy activity explicitly and never presents token creation as a login", () => {
    const groups = groupSessionsByDate([
      session(1, { loginAt: "invalid", lastSeenAt: localTime(2026, 9, 18, 10, 8) }),
      session(2, { createdAt: localTime(2026, 9, 18, 11), lastSeenAt: "invalid" }),
      session(3),
    ], new Date(2026, 8, 18, 12));
    expect(groups.map(({ label }) => label)).toEqual(["今天", "时间未知"]);
    expect(groups[0]!.items[0]).toMatchObject({ time: "10:08", timeLabel: "最近活跃" });
    expect(groups[1]!.items.map(({ session }) => session.id)).toEqual([2, 3]);
    expect(groups[1]!.items[0]).toMatchObject({ time: "--:--", datetime: "", timeLabel: "时间未知" });
  });

  it("shows the browser, location and masked IP, with honest missing metadata fallbacks", () => {
    const [group] = groupSessionsByDate([
      session(1, { loginMethod: "mihoyo", userAgent: "Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36", location: " 陕西省，西安市 ", ip: "36.40.123.21" }),
      session(2, { location: "   ", ip: "not-an-address" }),
    ]);
    expect(group!.items[0]).toMatchObject({ title: "米游社扫码登录", browser: "Chrome", location: "陕西省，西安市", ip: "36.40.***.21" });
    expect(group!.items[1]).toMatchObject({ title: "登录", browser: "未知浏览器", location: "归属地未知", ip: "未知IP" });
  });

  it("returns no groups for an empty list", () => {
    expect(groupSessionsByDate([])).toEqual([]);
  });
});

describe("session IP masking", () => {
  it("masks IPv4 without leaking the hidden octet", () => {
    expect(maskIpAddress(" 36.40.123.21 ")).toBe("36.40.***.21");
    expect(maskIpAddress("0.0.0.0")).toBe("0.0.***.0");
  });

  it.each([undefined, null, "", "unknown", "256.1.2.3", "01.2.3.4", "1.2.3", "1.2.3.4:8080", "1.2.3.4, 5.6.7.8", "2001:::1", "2001:db8::1::2", "2001:db8:0:0:0:0:0:0:1", "2001:db8", "fe80::1%eth0", "::ffff:256.1.2.3"])("does not echo malformed or missing addresses: %s", (address) => {
    expect(maskIpAddress(address)).toBe("未知IP");
  });

  it("masks the whole IPv6 interface identifier for expanded and compressed addresses", () => {
    expect(maskIpAddress("240E:1234:5678:ABCD:1234:5678:abcd:ef01")).toBe("240e:1234:5678:abcd:****");
    expect(maskIpAddress("2001:db8::1234:5678")).toBe("2001:db8:0:0:****");
    expect(maskIpAddress("[2001:db8::1234:5678]")).toBe("2001:db8:0:0:****");
    expect(maskIpAddress("::1")).toBe("0:0:0:0:****");
    expect(maskIpAddress("::")).toBe("0:0:0:0:****");
  });

  it("masks the embedded address in both IPv4-mapped IPv6 notations", () => {
    expect(maskIpAddress("::ffff:192.0.2.128")).toBe("::ffff:192.0.***.128");
    expect(maskIpAddress("0:0:0:0:0:ffff:c000:0280")).toBe("::ffff:192.0.***.128");
  });
});
