import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  buildPagination,
  parseStart,
} from "~/utils/pagination";

describe("parseStart", () => {
  it("解析数字游标", () => {
    expect(parseStart("40")).toBe(40);
  });

  it("空串 / 非法值回退为 0", () => {
    expect(parseStart("")).toBe(0);
    expect(parseStart("abc")).toBe(0);
  });
});

describe("buildPagination", () => {
  const nodes = Array.from({ length: DEFAULT_PAGE_SIZE }, (_, i) => i);

  it("有 total 时用 total 判定 hasNextPage", () => {
    const page = buildPagination(nodes, 0, { limit: 20, total: 50 });
    expect(page.endCursor).toBe("20");
    expect(page.hasNextPage).toBe(true);
  });

  it("到达 total 末尾时 hasNextPage 为 false", () => {
    const page = buildPagination(nodes, 40, { limit: 20, total: 50 });
    // nextStart=60 >= total=50
    expect(page.hasNextPage).toBe(false);
    expect(page.endCursor).toBe("60");
  });

  it("无 total 时按返回条数推断（满页则可能有下一页）", () => {
    const full = buildPagination(nodes, 0);
    expect(full.hasNextPage).toBe(true);

    const partial = buildPagination(nodes.slice(0, 5), 0);
    expect(partial.hasNextPage).toBe(false);
  });

  it("缺省 limit 时使用 DEFAULT_PAGE_SIZE 计算 endCursor", () => {
    const page = buildPagination(nodes, 0);
    expect(page.endCursor).toBe(String(DEFAULT_PAGE_SIZE));
    expect(page.nodes).toEqual(nodes);
  });
});
