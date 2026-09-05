import { describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import {
  commentsCountAfterDelete,
  totalRepliesOf,
  useApi,
} from "~/composables/useApi";
import { useCommentSeek } from "~/composables/useCommentSeek";
import type { Comment } from "~/types/entities";

/**
 * 评论回复分页（§3.1）。列表接口只内联前 3 条回复，于是「回复有多少条」这件事
 * 不能再看 replies.length —— 本文件盯住三处：字段映射的兜底、按需展开的拼接、
 * 以及删顶层评论时的计数（原来按 replies.length 扣，回复分页后会少扣）。
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
  return { calls, lastCall: () => calls[calls.length - 1]! };
}

const reply = (id: string, createdAt = "2026-09-01T00:00:00.000Z") => ({
  documentId: id,
  content: `回复 ${id}`,
  createdAt,
  author: { documentId: `u-${id}`, name: id },
});

const commentsPayload = (extra: Record<string, unknown>) => ({
  data: [
    {
      documentId: "c1",
      content: "顶层评论",
      author: { documentId: "u1", name: "阿一" },
      replies: [reply("r1"), reply("r2"), reply("r3")],
      ...extra,
    },
  ],
  meta: { pagination: { start: 0, limit: 20, total: 1, pageCount: 1 } },
});

describe("toComment 映射回复计数", () => {
  it("后端给了 repliesCount / repliesHasMore 就原样用", async () => {
    stubNuxt(() => commentsPayload({ repliesCount: 12, repliesHasMore: true }));
    const page = await useApi().getComments("p1");
    const comment = page.nodes[0]!;

    expect(comment.replies).toHaveLength(3);
    expect(comment.repliesCount).toBe(12);
    expect(comment.repliesHasMore).toBe(true);
  });

  it("后端没给时按「全部已加载」兜底（老后端回复本来就是全量的）", async () => {
    stubNuxt(() => commentsPayload({}));
    const comment = (await useApi().getComments("p1")).nodes[0]!;

    expect(comment.repliesCount).toBe(3);
    expect(comment.repliesHasMore).toBe(false);
  });

  it("只给了 repliesCount 时自己推 hasMore", async () => {
    stubNuxt(() => commentsPayload({ repliesCount: 9 }));
    const comment = (await useApi().getComments("p1")).nodes[0]!;

    expect(comment.repliesHasMore).toBe(true);
  });

  it("回复形状与列表接口内联的一致（同一份映射）", async () => {
    stubNuxt(() => commentsPayload({ repliesCount: 3 }));
    const inlined = (await useApi().getComments("p1")).nodes[0]!.replies[0]!;

    expect(inlined).toMatchObject({ id: "r1", content: "回复 r1", liked: false, likesCount: 0 });
    expect(inlined.author.name).toBe("r1");
  });
});

describe("getCommentReplies", () => {
  it("第一页不带 cursor，把 meta.nextCursor 拼成 endCursor", async () => {
    const nuxt = stubNuxt(() => ({
      data: [reply("r4"), reply("r5")],
      meta: { hasMore: true, nextCursor: "cur-2" },
    }));
    const page = await useApi().getCommentReplies("c1");

    expect(nuxt.lastCall().url).toBe("/api/comments/c1/replies");
    expect(nuxt.lastCall().query).toEqual({ limit: "20" });
    expect(page.nodes.map((r) => r.id)).toEqual(["r4", "r5"]);
    expect(page.endCursor).toBe("cur-2");
    expect(page.hasNextPage).toBe(true);
  });

  it("带上游标续传，到底时 hasNextPage 为 false", async () => {
    const nuxt = stubNuxt(() => ({ data: [reply("r6")], meta: { hasMore: false, nextCursor: null } }));
    const page = await useApi().getCommentReplies("c1", "cur-2");

    expect(nuxt.lastCall().query).toEqual({ cursor: "cur-2", limit: "20" });
    expect(page.hasNextPage).toBe(false);
  });
});

describe("loadMoreReplies", () => {
  /** 25 条回复的评论：列表已内联前 3 条，剩下的分两页给 */
  const pagedBackend = () => {
    const all = Array.from({ length: 25 }, (_, i) =>
      reply(`r${i + 1}`, `2026-09-0${(i % 9) + 1}T00:00:0${i % 10}.000Z`),
    );
    return (query: Query) =>
      query.cursor
        ? { data: all.slice(20), meta: { hasMore: false, nextCursor: null } }
        : { data: all.slice(0, 20), meta: { hasMore: true, nextCursor: "cur-2" } };
  };

  const seededComment = (): Comment => ({
    id: "c1",
    content: "顶层评论",
    author: { name: "阿一" },
    replies: [
      { id: "r1", content: "回复 r1", createdAt: "2026-09-01T00:00:00.000Z", author: { name: "r1" } },
      { id: "r2", content: "回复 r2", createdAt: "2026-09-02T00:00:01.000Z", author: { name: "r2" } },
      { id: "r3", content: "回复 r3", createdAt: "2026-09-03T00:00:02.000Z", author: { name: "r3" } },
    ],
    repliesCount: 25,
    repliesHasMore: true,
  });

  it("按 id 去重后 append，并同步 repliesHasMore", async () => {
    stubNuxt(pagedBackend());
    const comment = seededComment();
    const added = await useApi().loadMoreReplies(comment);

    // 第一页 20 条里有 3 条是列表已内联的，只新增 17 条
    expect(added).toBe(17);
    expect(comment.replies).toHaveLength(20);
    expect(new Set(comment.replies.map((r) => r.id)).size).toBe(20);
    expect(comment.repliesHasMore).toBe(true);
  });

  it("第二次展开带上游标，到底后返回 0 且不再发请求", async () => {
    const nuxt = stubNuxt(pagedBackend());
    const api = useApi();
    const comment = seededComment();

    await api.loadMoreReplies(comment);
    const second = await api.loadMoreReplies(comment);
    expect(nuxt.lastCall().query.cursor).toBe("cur-2");
    expect(second).toBe(5);
    expect(comment.replies).toHaveLength(25);
    expect(comment.repliesHasMore).toBe(false);

    const callsBefore = nuxt.calls.length;
    expect(await api.loadMoreReplies(comment)).toBe(0);
    expect(nuxt.calls).toHaveLength(callsBefore);
  });

  it("已加载条数反超后端口径时把 repliesCount 抬上去（避免「展开更多(-1)」）", async () => {
    stubNuxt(() => ({ data: [reply("r4")], meta: { hasMore: false, nextCursor: null } }));
    const comment = seededComment();
    comment.repliesCount = 3;

    await useApi().loadMoreReplies(comment);
    expect(comment.replies).toHaveLength(4);
    expect(comment.repliesCount).toBe(4);
  });

  it("展开后回复仍按 createdAt 升序（乐观插入的那条不会卡在中间）", async () => {
    stubNuxt(() => ({
      data: [reply("r4", "2026-09-04T00:00:00.000Z")],
      meta: { hasMore: false, nextCursor: null },
    }));
    const comment = seededComment();
    // 用户刚发的回复被 push 到末尾，时间却是最新的
    comment.replies.push({
      id: "local",
      content: "我刚发的",
      createdAt: "2026-09-09T00:00:00.000Z",
      author: { name: "我" },
    });

    await useApi().loadMoreReplies(comment);
    expect(comment.replies.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "local"]);
  });

  it("同一条评论并发展开合流成一个请求，不会把「到底了」误判出来", async () => {
    // seek 的自动展开撞上用户点「展开更多」：两路各发一次的话，后完成的那路去重后新增 0 条，
    // 调用方会据此把按钮永久收起 / 把这条评论标记成已翻完。
    const nuxt = stubNuxt(pagedBackend());
    const api = useApi();
    const comment = seededComment();

    const [a, b] = await Promise.all([
      api.loadMoreReplies(comment),
      api.loadMoreReplies(comment),
    ]);

    expect(nuxt.calls).toHaveLength(1);
    expect([a, b]).toEqual([17, 17]);
    expect(comment.replies).toHaveLength(20);
    expect(comment.repliesHasMore).toBe(true);

    // 合流结束后游标已推进，下一次展开正常拿第二页
    expect(await api.loadMoreReplies(comment)).toBe(5);
    expect(nuxt.lastCall().query.cursor).toBe("cur-2");
  });
});

describe("删除评论后的计数", () => {
  const comment = {
    replies: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
    repliesCount: 20,
  } as unknown as Comment;

  it("按 repliesCount 扣减，而不是只扣已加载的 3 条", () => {
    // 30 - 1（自己）- 20（全部回复）= 9；按 replies.length 会错算成 26
    expect(commentsCountAfterDelete(30, comment)).toBe(9);
  });

  it("后端没给 repliesCount 时退回已加载条数", () => {
    const legacy = { replies: [{ id: "r1" }, { id: "r2" }] } as unknown as Comment;
    expect(commentsCountAfterDelete(10, legacy)).toBe(7);
    expect(totalRepliesOf(legacy)).toBe(2);
  });

  it("不会算成负数", () => {
    expect(commentsCountAfterDelete(1, comment)).toBe(0);
    expect(commentsCountAfterDelete(undefined, comment)).toBe(0);
  });

  it("repliesCount 落后于已加载条数时按已加载条数算", () => {
    const stale = { replies: [{ id: "r1" }, { id: "r2" }], repliesCount: 1 } as unknown as Comment;
    expect(totalRepliesOf(stale)).toBe(2);
  });
});

describe("useCommentSeek 自动展开回复", () => {
  // jsdom 不实现 CSS.escape，而 scrollToTarget 用它拼选择器；补个最小桩，
  // 定位到目标后 querySelector 找不到元素会直接 return，不影响断言。
  const withCss = globalThis as unknown as { CSS?: { escape: (value: string) => string } };
  if (!withCss.CSS) withCss.CSS = { escape: (value: string) => value };

  const mkComment = (id: string, replyIds: string[], hasMore: boolean): Comment => ({
    id,
    content: id,
    author: { name: id },
    replies: replyIds.map((rid) => ({ id: rid, content: rid, author: { name: rid } })),
    repliesCount: hasMore ? replyIds.length + 1 : replyIds.length,
    repliesHasMore: hasMore,
  });

  /** 按脚本给每条评论逐页补回复；脚本用尽即到底 */
  const scriptedLoader = (script: Record<string, string[][]>) => {
    const cursors: Record<string, number> = {};
    return vi.fn(async (comment: Comment) => {
      const pages = script[comment.id] ?? [];
      const index = cursors[comment.id] ?? 0;
      const page = pages[index];
      cursors[comment.id] = index + 1;
      if (!page) {
        comment.repliesHasMore = false;
        return 0;
      }
      comment.replies.push(...page.map((rid) => ({ id: rid, content: rid, author: { name: rid } })));
      comment.repliesHasMore = index + 1 < pages.length;
      return page.length;
    });
  };

  function mount<T>(factory: () => T) {
    const scope = effectScope();
    return { result: scope.run(factory)!, dispose: () => scope.stop() };
  }

  it("目标回复不在已加载的前 3 条里时，逐页展开直到找到", async () => {
    const comments = ref<Comment[]>([
      mkComment("c1", ["r1"], true),
      mkComment("c2", ["r2"], true),
    ]);
    const loadMoreReplies = scriptedLoader({ c1: [["r10"]], c2: [["r20"], ["target"]] });
    const { result, dispose } = mount(() =>
      useCommentSeek({
        targetCommentId: ref("target"),
        comments,
        commentsHasNext: ref(false),
        loadComments: vi.fn(async () => {}),
        loadMoreReplies,
      }),
    );

    await result.seek();

    expect(result.targetFound.value).toBe(true);
    expect(result.highlightedCommentId.value).toBe("target");
    dispose();
  });

  it("找不到时受次数上限保护，不会无限展开", async () => {
    // 每次展开都还剩更多，但永远给不出目标 —— 没有上限就是死循环
    const endless = vi.fn(async (comment: Comment) => {
      comment.replies.push({ id: `${comment.id}-${comment.replies.length}`, content: "x", author: {} });
      comment.repliesHasMore = true;
      return 1;
    });
    const { result, dispose } = mount(() =>
      useCommentSeek({
        targetCommentId: ref("missing"),
        comments: ref<Comment[]>([mkComment("c1", ["r1"], true), mkComment("c2", ["r2"], true)]),
        commentsHasNext: ref(false),
        loadComments: vi.fn(async () => {}),
        loadMoreReplies: endless,
        maxReplyExpands: 3,
      }),
    );

    await result.seek();

    expect(endless).toHaveBeenCalledTimes(3);
    expect(result.targetFound.value).toBe(false);
    expect(result.seeking.value).toBe(false);
    dispose();
  });

  it("展开预算在多条评论间轮转，不被回复最多的那条独吞", async () => {
    const loader = scriptedLoader({ c1: [["a"], ["b"], ["c"]], c2: [["d"]] });
    const { result, dispose } = mount(() =>
      useCommentSeek({
        targetCommentId: ref("d"),
        comments: ref<Comment[]>([mkComment("c1", ["r1"], true), mkComment("c2", ["r2"], true)]),
        commentsHasNext: ref(false),
        loadComments: vi.fn(async () => {}),
        loadMoreReplies: loader,
        maxReplyExpands: 4,
      }),
    );

    await result.seek();

    expect(result.targetFound.value).toBe(true);
    // c1 只翻了一页就轮到 c2，目标在 c2 第一页
    expect(loader).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("不传 loadMoreReplies 时退化为老行为（只在已加载的回复里找）", async () => {
    const { result, dispose } = mount(() =>
      useCommentSeek({
        targetCommentId: ref("r1"),
        comments: ref<Comment[]>([mkComment("c1", ["r1"], true)]),
        commentsHasNext: ref(false),
        loadComments: vi.fn(async () => {}),
      }),
    );

    await result.seek();
    expect(result.targetFound.value).toBe(true);
    dispose();
  });

  it("展开抛错不会让整个定位流程炸掉", async () => {
    const boom = vi.fn(async () => {
      throw new Error("network");
    });
    const { result, dispose } = mount(() =>
      useCommentSeek({
        targetCommentId: ref("missing"),
        comments: ref<Comment[]>([mkComment("c1", ["r1"], true)]),
        commentsHasNext: ref(false),
        loadComments: vi.fn(async () => {}),
        loadMoreReplies: boom,
      }),
    );

    await expect(result.seek()).resolves.toBeUndefined();
    // 同一条评论失败一次就标记到底，不会反复重试
    expect(boom).toHaveBeenCalledTimes(1);
    expect(result.targetFound.value).toBe(false);
    dispose();
  });

  it("目标是下一页的顶层评论时先翻评论页，不先烧展开预算", async () => {
    // 展开优先会把 maxReplyExpands 全烧在第一页评论上：8 个串行请求之后才第一次请求评论第 2 页，
    // 顺带把两条无关评论的楼中楼自己展开了。
    const comments = ref<Comment[]>([mkComment("c1", ["r1"], true), mkComment("c2", ["r2"], true)]);
    const commentsHasNext = ref(true);
    const loadMoreReplies = vi.fn(async () => 1);
    const loadComments = vi.fn(async () => {
      comments.value.push(mkComment("target", [], false));
      commentsHasNext.value = false;
    });
    const { result, dispose } = mount(() =>
      useCommentSeek({
        targetCommentId: ref("target"),
        comments,
        commentsHasNext,
        loadComments,
        loadMoreReplies,
      }),
    );

    await result.seek();

    expect(result.targetFound.value).toBe(true);
    expect(loadComments).toHaveBeenCalledTimes(1);
    expect(loadMoreReplies).not.toHaveBeenCalled();
    dispose();
  });

  it("目标是下一页评论下未内联的回复时，预算不会被前一页评论吃光", async () => {
    // c1/c2 的回复无穷多（永远 hasMore），目标在第 2 页评论 c3 的回复里。
    // 展开优先的话预算会先耗在 c1/c2 上，等翻到 c3 时已经一次都展不开，seek 静默失败。
    const comments = ref<Comment[]>([mkComment("c1", ["r1"], true), mkComment("c2", ["r2"], true)]);
    const commentsHasNext = ref(true);
    const loadMoreReplies = vi.fn(async (comment: Comment) => {
      if (comment.id === "c3") {
        comment.replies.push({ id: "target", content: "target", author: {} });
        comment.repliesHasMore = false;
        return 1;
      }
      comment.replies.push({ id: `${comment.id}-${comment.replies.length}`, content: "x", author: {} });
      comment.repliesHasMore = true;
      return 1;
    });
    const { result, dispose } = mount(() =>
      useCommentSeek({
        targetCommentId: ref("target"),
        comments,
        commentsHasNext,
        loadComments: vi.fn(async () => {
          comments.value.push(mkComment("c3", [], true));
          commentsHasNext.value = false;
        }),
        loadMoreReplies,
        maxReplyExpands: 3,
      }),
    );

    await result.seek();

    expect(result.targetFound.value).toBe(true);
    expect(loadMoreReplies).toHaveBeenCalledTimes(3);
    dispose();
  });

  it("评论翻页卡住（出错 / 空页）时仍会去展开回复", async () => {
    const comments = ref<Comment[]>([mkComment("c1", ["r1"], true)]);
    const { result, dispose } = mount(() =>
      useCommentSeek({
        targetCommentId: ref("target"),
        comments,
        // 一直说还有下一页，但 loadComments 什么也加不进来
        commentsHasNext: ref(true),
        loadComments: vi.fn(async () => {}),
        loadMoreReplies: scriptedLoader({ c1: [["target"]] }),
      }),
    );

    await result.seek();

    expect(result.targetFound.value).toBe(true);
    dispose();
  });
});
