import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatTime, formatFullTime } from "~/utils/time";

describe("formatTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("空值返回空串", () => {
    expect(formatTime()).toBe("");
    expect(formatTime("")).toBe("");
  });

  it("一分钟内显示「刚刚」", () => {
    expect(formatTime("2026-06-29T11:59:30Z")).toBe("刚刚");
  });

  it("分钟 / 小时 / 天 级相对时间", () => {
    expect(formatTime("2026-06-29T11:30:00Z")).toBe("30分钟前");
    expect(formatTime("2026-06-29T09:00:00Z")).toBe("3小时前");
    expect(formatTime("2026-06-27T12:00:00Z")).toBe("2天前");
  });

  it("超过 30 天显示绝对日期（YYYY-MM-DD）", () => {
    // 绝对日期用本地时区格式化，故只校验格式而非具体日（避免跨时区 flaky）。
    expect(formatTime("2026-01-15T12:00:00Z")).toMatch(/^2026-01-\d{2}$/);
  });
});

describe("formatFullTime", () => {
  it("空值 / 非法日期返回空串", () => {
    expect(formatFullTime()).toBe("");
    expect(formatFullTime("")).toBe("");
    expect(formatFullTime("not-a-date")).toBe("");
  });

  it("输出 YYYY-MM-DD HH:mm:ss 完整时间戳（本地时区）", () => {
    // 本地时区格式化，只校验格式与日期部分（避免跨时区 flaky）
    expect(formatFullTime("2026-06-29T12:34:56Z")).toMatch(
      /^2026-06-\d{2} \d{2}:\d{2}:56$/,
    );
  });
});
