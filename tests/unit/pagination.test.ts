import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  buildCursorPagination,
  buildPagination,
  composeCursor,
  extractCursorMeta,
  parseStart,
  resolveCursor,
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

describe("resolveCursor", () => {
  it("空串与旧的 \"0\" 哨兵都当第一页", () => {
    expect(resolveCursor("")).toEqual({ cursor: "", start: 0 });
    expect(resolveCursor("0")).toEqual({ cursor: "", start: 0 });
    expect(resolveCursor(null)).toEqual({ cursor: "", start: 0 });
    expect(resolveCursor(undefined)).toEqual({ cursor: "", start: 0 });
  });

  it("纯数字串仍走 offset（老后端攒出来的 endCursor）", () => {
    expect(resolveCursor("20")).toEqual({ cursor: "", start: 20 });
    expect(resolveCursor("40")).toEqual({ cursor: "", start: 40 });
  });

  it("不透明 token 原样当 cursor", () => {
    expect(resolveCursor("MjAyNi0wOS0wM3xhYmM")).toEqual({
      cursor: "MjAyNi0wOS0wM3xhYmM",
      start: 0,
    });
  });

  it("带条数前缀的游标串拆成 token + 已加载条数（后端回滚时靠它接着翻）", () => {
    expect(resolveCursor("80~MjAyNi0wOS0wM3xhYmM")).toEqual({
      cursor: "MjAyNi0wOS0wM3xhYmM",
      start: 80,
    });
    expect(resolveCursor(composeCursor(0, "tok"))).toEqual({ cursor: "tok", start: 0 });
  });

  it("前缀不是纯数字时整串当 token（base64url 里没有 ~，这种串只可能是别的东西）", () => {
    expect(resolveCursor("abc~tok")).toEqual({ cursor: "abc~tok", start: 0 });
    expect(resolveCursor("~tok")).toEqual({ cursor: "~tok", start: 0 });
    expect(resolveCursor("80~")).toEqual({ cursor: "80~", start: 0 });
  });
});

describe("composeCursor", () => {
  it("拼成「已加载条数~token」", () => {
    expect(composeCursor(80, "tok")).toBe("80~tok");
  });

  it("没有 token 就是到底了，回落成第一页哨兵", () => {
    expect(composeCursor(80, null)).toBe("");
    expect(composeCursor(80, "")).toBe("");
  });

  it("条数取整取正，保证 resolveCursor 能拆回来", () => {
    expect(resolveCursor(composeCursor(-1, "tok"))).toEqual({ cursor: "tok", start: 0 });
    expect(resolveCursor(composeCursor(20.7, "tok"))).toEqual({ cursor: "tok", start: 20 });
  });
});

describe("extractCursorMeta", () => {
  it("信息流：字段挂在 meta.pagination 下", () => {
    const meta = extractCursorMeta({
      data: [],
      meta: { pagination: { start: 0, limit: 20, total: 99, hasMore: true, nextCursor: "c2" } },
    });
    expect(meta).toEqual({ hasMore: true, nextCursor: "c2" });
  });

  it("评论回复：字段挂在 meta 下", () => {
    expect(extractCursorMeta({ data: [], meta: { hasMore: false, nextCursor: null } })).toEqual({
      hasMore: false,
      nextCursor: null,
    });
  });

  it("后端未部署（只有 offset 字段）时返回 undefined，调用方据此退回 offset", () => {
    expect(
      extractCursorMeta({ data: [], meta: { pagination: { start: 0, limit: 20, total: 99, pageCount: 5 } } }),
    ).toBeUndefined();
    expect(extractCursorMeta({ data: [] })).toBeUndefined();
    expect(extractCursorMeta(null)).toBeUndefined();
  });

  it("只有 hasMore 没有 nextCursor 时不算游标模式（别的接口可能也叫 hasMore）", () => {
    expect(extractCursorMeta({ meta: { pagination: { start: 0, total: 99, hasMore: true } } })).toBeUndefined();
  });

  it("最后一页的 nextCursor=null 仍算游标模式（不能被误判成未部署）", () => {
    expect(
      extractCursorMeta({ meta: { pagination: { start: 0, total: 99, hasMore: false, nextCursor: null } } }),
    ).toEqual({ hasMore: false, nextCursor: null });
  });
});

describe("buildCursorPagination", () => {
  const nodes = [1, 2, 3];

  it("nextCursor 原样成为 endCursor，hasMore 决定 hasNextPage", () => {
    const page = buildCursorPagination(nodes, { hasMore: true, nextCursor: "c2" });
    expect(page).toEqual({ nodes, endCursor: "c2", hasNextPage: true });
  });

  it("到底时 endCursor 回落成第一页哨兵，hasNextPage 为 false", () => {
    const page = buildCursorPagination(nodes, { hasMore: false, nextCursor: null });
    expect(page.endCursor).toBe("");
    expect(page.hasNextPage).toBe(false);
  });

  it("hasMore=true 但没给 nextCursor 时也停下，避免拿空游标重刷第一页", () => {
    expect(buildCursorPagination(nodes, { hasMore: true, nextCursor: null }).hasNextPage).toBe(false);
  });

  it("后端没表态 hasMore 时以 nextCursor 是否存在为准", () => {
    expect(buildCursorPagination(nodes, { nextCursor: "c2" }).hasNextPage).toBe(true);
    expect(buildCursorPagination(nodes, { nextCursor: null }).hasNextPage).toBe(false);
  });

  it("传了 loadedBefore（信息流）时 endCursor 带上已加载条数", () => {
    const page = buildCursorPagination(nodes, { hasMore: true, nextCursor: "c2" }, 20);
    expect(page.endCursor).toBe("23~c2");
    expect(resolveCursor(page.endCursor)).toEqual({ cursor: "c2", start: 23 });
  });

  it("不传 loadedBefore（评论回复）时 endCursor 仍是裸 token，能原样回传给后端", () => {
    expect(buildCursorPagination(nodes, { hasMore: true, nextCursor: "c2" }).endCursor).toBe("c2");
  });
});
