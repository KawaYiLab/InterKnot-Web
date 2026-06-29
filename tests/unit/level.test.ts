import { describe, expect, it } from "vitest";
import {
  LEVEL_THRESHOLDS,
  MAX_LEVEL,
  expNeededWithinLevel,
} from "~/utils/level";

describe("level", () => {
  it("MAX_LEVEL 与门槛数组长度一致", () => {
    expect(MAX_LEVEL).toBe(LEVEL_THRESHOLDS.length);
  });

  it("expNeededWithinLevel 返回相邻门槛差", () => {
    expect(expNeededWithinLevel(1)).toBe(500); // 500 - 0
    expect(expNeededWithinLevel(2)).toBe(1500); // 2000 - 500
    expect(expNeededWithinLevel(3)).toBe(4000); // 6000 - 2000
  });

  it("满级及以上返回 0", () => {
    expect(expNeededWithinLevel(MAX_LEVEL)).toBe(0);
    expect(expNeededWithinLevel(MAX_LEVEL + 5)).toBe(0);
  });
});
