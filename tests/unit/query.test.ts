import { describe, expect, it } from "vitest";
import { pickFirstQuery } from "~/utils/query";

describe("pickFirstQuery", () => {
  it("数组取首个元素", () => {
    expect(pickFirstQuery(["a", "b"])).toBe("a");
  });

  it("空数组返回空串", () => {
    expect(pickFirstQuery([])).toBe("");
  });

  it("字符串原样返回", () => {
    expect(pickFirstQuery("hello")).toBe("hello");
  });

  it("undefined 返回空串", () => {
    expect(pickFirstQuery(undefined)).toBe("");
  });
});
