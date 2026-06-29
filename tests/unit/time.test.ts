import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatTime } from "~/utils/time";

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
