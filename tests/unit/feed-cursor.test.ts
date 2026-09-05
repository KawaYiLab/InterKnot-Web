import { describe, expect, it, vi } from "vitest";
import { useApi } from "~/composables/useApi";

/**
 * 信息流游标分页（§3.2）。重点是兼容期两条路都得走通：
 * 后端给了 meta.pagination.nextCursor 就走游标，没给就必须退回 offset —— 前端会先上线，
 * 这个回退挂了等于线上信息流翻不了页。
 *
 * useApi 只依赖 useNuxtApp / useRuntimeConfig 两个 Nuxt 自动导入，纯 vitest 环境里把它们
 * 塞成全局桩就能直接测真实实现，不用另抄一份请求逻辑。$queryClient 故意留空：
 * cachedRead 会直接跑 queryFn，每次调用都是一次真实请求，断言请求参数才有意义。
 */
type Query = Record<string, unknown>;

function stubNuxt(respond: (query: Query, url: string) => unknown) {
  const calls: { url: string; query: Query }[] = [];
  const $api = vi.fn(async (url: string, options?: { query?: Query }) => {
    const query = options?.query ?? {};
    calls.push({ url, query });
    return respond(query, url);
  });
  const g = globalThis as unknown as Record<string, unknown>;
  g.useNuxtApp = () => ({ $api, $queryClient: undefined });
  g.useRuntimeConfig = () => ({ public: { apiBaseUrl: "" } });
  return {
    calls,
    lastCall: () => calls[calls.length - 1]!,
  };
}

const post = (id: string) => ({ documentId: id, title: `委托 ${id}` });

/** 一页 20 条，id 按位置生成，用来断言「续传位置对不对」 */
const pageAt = (offset: number) =>
  Array.from({ length: 20 }, (_, i) => post(`a${offset + i}`));

/** 已上游标分页的后端：第一页给 nextCursor，第二页到底 */
const cursorBackend = (query: Query) =>
  query.cursor
    ? {
        data: [post("a3")],
        meta: { pagination: { start: 0, limit: 20, total: 3, pageCount: 1, hasMore: false, nextCursor: null } },
      }
    : {
        data: [post("a1"), post("a2")],
        meta: { pagination: { start: 0, limit: 20, total: 3, pageCount: 1, hasMore: true, nextCursor: "cur-2" } },
      };

/** 还没部署游标的后端：只有老的 offset 口径 */
const offsetBackend = (query: Query) => ({
  data: [post(`a-${String(query.start ?? "0")}`)],
  meta: { pagination: { start: Number(query.start ?? 0), limit: 20, total: 50, pageCount: 3 } },
});

describe("searchArticles 游标模式", () => {
  it("第一页不带 cursor，请求与切游标之前逐字节一致", async () => {
    const nuxt = stubNuxt(cursorBackend);
    const page = await useApi().searchArticles("", "");

    expect(nuxt.lastCall().url).toBe("/api/articles/list");
    expect(nuxt.lastCall().query).toEqual({ sort: "latest", start: "0", limit: "20" });
    expect(page.nodes.map((p) => p.id)).toEqual(["a1", "a2"]);
    expect(page.endCursor).toBe("2~cur-2");
    expect(page.hasNextPage).toBe(true);
  });

  it("拿到 nextCursor 后翻页发 cursor，并把已加载条数一起当 start 发（兜后端回滚）", async () => {
    const nuxt = stubNuxt(cursorBackend);
    const api = useApi();
    const first = await api.searchArticles("", "");
    const second = await api.searchArticles("", first.endCursor);

    // start 与 cursor 同时给：新后端按契约忽略 start，老后端忽略 cursor 时也能落在正确窗口
    expect(nuxt.lastCall().query).toEqual({ sort: "latest", cursor: "cur-2", start: "2", limit: "20" });
    expect(second.nodes.map((p) => p.id)).toEqual(["a3"]);
  });

  it("endCursor 里带着已加载条数，不是裸 token", async () => {
    stubNuxt(cursorBackend);
    // 第一页 2 条 → 已加载 2 条
    expect((await useApi().searchArticles("", "")).endCursor).toBe("2~cur-2");
  });

  it("最后一页（hasMore=false / nextCursor=null）停下，且不会被误判成未部署", async () => {
    const nuxt = stubNuxt(cursorBackend);
    const api = useApi();
    const second = await api.searchArticles("", (await api.searchArticles("", "")).endCursor);

    expect(second.hasNextPage).toBe(false);
    // 若走成 offset 回退，这里会是 "20"（然后被当游标发出去）
    expect(second.endCursor).toBe("");
    expect(nuxt.calls).toHaveLength(2);
  });

  it("空串与旧的 \"0\" 哨兵都当第一页（老快照恢复后不能把 \"0\" 当游标发出去）", async () => {
    const nuxt = stubNuxt(cursorBackend);
    const api = useApi();
    await api.searchArticles("", "");
    const first = nuxt.lastCall().query;
    await api.searchArticles("", "0");
    const legacy = nuxt.lastCall().query;

    expect(legacy).toEqual(first);
    expect(legacy.cursor).toBeUndefined();
    expect(legacy.start).toBe("0");
  });
});

describe("searchArticles 回退到 offset（后端还没部署游标）", () => {
  it("没有 nextCursor 时按 start + total 推 endCursor / hasNextPage", async () => {
    stubNuxt(offsetBackend);
    const page = await useApi().searchArticles("", "");

    expect(page.endCursor).toBe("20");
    expect(page.hasNextPage).toBe(true);
  });

  it("回退路径下翻页继续发 start，不会把 \"20\" 当游标发出去", async () => {
    const nuxt = stubNuxt(offsetBackend);
    const api = useApi();
    const first = await api.searchArticles("", "");
    await api.searchArticles("", first.endCursor);

    expect(nuxt.lastCall().query.start).toBe("20");
    expect(nuxt.lastCall().query.cursor).toBeUndefined();
  });

  it("走到 total 末尾时 hasNextPage 变 false", async () => {
    stubNuxt(offsetBackend);
    const page = await useApi().searchArticles("", "40");

    expect(page.endCursor).toBe("60");
    expect(page.hasNextPage).toBe(false);
  });

  it("搜索接口（/api/articles/search）不带 sort，仍走 offset", async () => {
    const nuxt = stubNuxt(offsetBackend);
    const page = await useApi().searchArticles("绳网", "");

    expect(nuxt.lastCall().url).toBe("/api/articles/search");
    expect(nuxt.lastCall().query).toEqual({ q: "绳网", start: "0", limit: "20" });
    expect(page.endCursor).toBe("20");
  });
});

/**
 * 兼容期最难的一段：**游标已经翻到一半时**后端换成了没有游标的实例（回滚，或滚动发布期间
 * 两页请求落在新旧两个实例上）。这时不能把位置丢回第一页 —— 那 20 条会被首页的 seenIds
 * 全量去重，列表一条不长，hasNextPage 又按 total 算成 true，用户看到的是「信息流不动了」。
 */
describe("searchArticles 游标翻到一半后端回滚", () => {
  /** 前 cursorPages 次响应带游标（位置由 token 决定，与 start 无关），之后的实例只认 start */
  const rollingBackend = (cursorPages: number) => {
    let served = 0;
    return (query: Query) => {
      served += 1;
      if (served <= cursorPages) {
        return {
          data: pageAt((served - 1) * 20),
          // 游标模式下后端对 start/total/pageCount 的口径是「不承诺」，明确回 0
          meta: {
            pagination: {
              start: 0, limit: 20, total: 0, pageCount: 0,
              hasMore: true, nextCursor: `cur-${served + 1}`,
            },
          },
        };
      }
      const start = Number(query.start ?? 0);
      return {
        data: pageAt(start),
        meta: { pagination: { start, limit: 20, total: 200, pageCount: 10 } },
      };
    };
  };

  it("回滚那一页仍落在正确窗口，续传位置接着已加载条数走", async () => {
    const nuxt = stubNuxt(rollingBackend(2));
    const api = useApi();
    const p1 = await api.searchArticles("", "");
    const p2 = await api.searchArticles("", p1.endCursor);
    expect(p2.nodes.map((p) => p.id)[0]).toBe("a20");
    expect(p2.endCursor).toBe("40~cur-3");

    // 第三页：后端已回滚，忽略 cursor 只认 start —— start 必须是已加载的 40，不是 0
    const p3 = await api.searchArticles("", p2.endCursor);
    expect(nuxt.lastCall().query).toEqual({ sort: "latest", cursor: "cur-3", start: "40", limit: "20" });
    // 拿到的是接着的一页（不是被去重掉的第一页），endCursor 从 40 往后而不是重置成 "20"
    expect(p3.nodes.map((p) => p.id)[0]).toBe("a40");
    expect(p3.endCursor).toBe("60");
    expect(p3.hasNextPage).toBe(true);

    // 之后正常按 offset 续翻
    const p4 = await api.searchArticles("", p3.endCursor);
    expect(nuxt.lastCall().query.start).toBe("60");
    expect(p4.nodes.map((p) => p.id)[0]).toBe("a60");
  });

  it("游标模式的响应缺了 cursorFields（total=0）时不被无声截断", async () => {
    // 后端 article.ts 的第三分支：给不出游标位置时整段省掉 hasMore/nextCursor，
    // 而游标模式的 total 恒为 0 —— 拿它算 hasNextPage 会得到 false，信息流提前截断。
    const dirtyTail = (query: Query) =>
      query.cursor
        ? { data: pageAt(20), meta: { pagination: { start: 0, limit: 20, total: 0, pageCount: 0 } } }
        : {
            data: pageAt(0),
            meta: {
              pagination: {
                start: 0, limit: 20, total: 0, pageCount: 0,
                hasMore: true, nextCursor: "cur-2",
              },
            },
          };
    stubNuxt(dirtyTail);
    const api = useApi();
    const second = await api.searchArticles("", (await api.searchArticles("", "")).endCursor);

    expect(second.nodes.map((p) => p.id)[0]).toBe("a20");
    expect(second.hasNextPage).toBe(true);
    expect(second.endCursor).toBe("40");
  });
});
