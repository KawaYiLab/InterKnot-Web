import { describe, expect, it } from "vitest";
import {
  CHECK_IN_TRACK_SIZE,
  buildCheckInTrack,
  checkInRewardForDay,
} from "~/utils/check-in";

describe("checkInRewardForDay", () => {
  it("基础 6，每多连签 1 天 +1", () => {
    expect(checkInRewardForDay(1)).toBe(6);
    expect(checkInRewardForDay(2)).toBe(7);
    expect(checkInRewardForDay(3)).toBe(8);
    expect(checkInRewardForDay(4)).toBe(9);
  });

  it("连签 5 天起封顶在 10", () => {
    expect(checkInRewardForDay(5)).toBe(10);
    expect(checkInRewardForDay(6)).toBe(10);
    expect(checkInRewardForDay(365)).toBe(10);
  });

  it("0 / 负数不会算出低于基础值的奖励", () => {
    expect(checkInRewardForDay(0)).toBe(6);
    expect(checkInRewardForDay(-7)).toBe(6);
  });
});

describe("buildCheckInTrack", () => {
  it("永远是 7 格，且有且仅有一格是今天", () => {
    for (const day of [1, 2, 4, 5, 12, 400]) {
      const cells = buildCheckInTrack(day);
      expect(cells).toHaveLength(CHECK_IN_TRACK_SIZE);
      expect(cells.filter((c) => c.today)).toHaveLength(1);
    }
  });

  it("连签 ≤ 4 天时窗口贴住第 1 天", () => {
    const first = buildCheckInTrack(1);
    expect(first.map((c) => c.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(first.findIndex((c) => c.today)).toBe(0);
    expect(first.filter((c) => c.done)).toHaveLength(0);

    const fourth = buildCheckInTrack(4);
    expect(fourth.map((c) => c.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(fourth.findIndex((c) => c.today)).toBe(3);
    expect(fourth.filter((c) => c.done)).toHaveLength(3);
  });

  it("连签超过 4 天后轨道向前滑，今天固定在第 4 格", () => {
    expect(buildCheckInTrack(5).map((c) => c.day)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(buildCheckInTrack(23).map((c) => c.day)).toEqual([20, 21, 22, 23, 24, 25, 26]);
    expect(buildCheckInTrack(23).findIndex((c) => c.today)).toBe(3);
  });

  it("每格奖励与 checkInRewardForDay 一致，且不超过 10", () => {
    for (const cell of buildCheckInTrack(3)) {
      expect(cell.reward).toBe(checkInRewardForDay(cell.day));
      expect(cell.reward).toBeLessThanOrEqual(10);
    }
  });

  it("done / today / future 三态互斥且覆盖每一格", () => {
    for (const cell of buildCheckInTrack(9)) {
      expect([cell.done, cell.today, cell.future].filter(Boolean)).toHaveLength(1);
    }
  });

  it("非法输入退回第 1 天而不是崩掉", () => {
    expect(buildCheckInTrack(0)[0]?.day).toBe(1);
    expect(buildCheckInTrack(-5).findIndex((c) => c.today)).toBe(0);
    expect(buildCheckInTrack(Number.NaN).findIndex((c) => c.today)).toBe(0);
  });
});
