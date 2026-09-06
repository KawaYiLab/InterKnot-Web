import { describe, expect, it, vi } from "vitest";
import { useApi } from "~/composables/useApi";

/**
 * 草稿的匿名开关在前后端之间必须**双向**通。
 *
 * 读路径漏一个字段就是真名泄露：toDraftArticle 不映射 isAnonymous →
 * applyDraftToEditor 里 `isAnonymous.value = !!draft.isAnonymous` 一律得 false →
 * 自动保存把 false 写回后端（payload 里这个字段是无条件发的）→ 用户勾过的匿名被静默
 * 清掉、anonymousSeed 一并置 null → 点发布，真名出面。UI 上全程没有任何异常。
 *
 * 写路径则相反：false 必须真的发出去，否则匿名开关只能开不能关。
 */
type Options = { query?: Record<string, unknown>; method?: string; body?: unknown };

function stubNuxt(respond: (url: string, options: Options) => unknown) {
  const calls: { url: string; options: Options }[] = [];
  const $api = vi.fn(async (url: string, options?: Options) => {
    calls.push({ url, options: options ?? {} });
    return respond(url, options ?? {});
  });
  const g = globalThis as unknown as Record<string, unknown>;
  g.useNuxtApp = () => ({ $api, $queryClient: undefined });
  g.useRuntimeConfig = () => ({ public: { apiBaseUrl: "" } });
  return { calls, lastCall: () => calls[calls.length - 1]! };
}

const draftRow = (extra: Record<string, unknown> = {}) => ({
  documentId: "d1",
  title: "标题",
  text: "正文",
  hasPublishedVersion: false,
  ...extra,
});

describe("toDraftArticle 映射 isAnonymous（读路径）", () => {
  it("详情接口给 true 就读回 true", async () => {
    stubNuxt(() => ({ data: draftRow({ isAnonymous: true }) }));
    const draft = await useApi().getMyDraftDetail("d1");

    expect(draft.isAnonymous).toBe(true);
  });

  it("给 false 读回 false", async () => {
    stubNuxt(() => ({ data: draftRow({ isAnonymous: false, documentId: "d2" }) }));
    const draft = await useApi().getMyDraftDetail("d2");

    expect(draft.isAnonymous).toBe(false);
  });

  it("后端没下发这个字段时按 false 兜底，而不是 undefined", async () => {
    stubNuxt(() => ({ data: draftRow({ documentId: "d3" }) }));
    const draft = await useApi().getMyDraftDetail("d3");

    expect(draft.isAnonymous).toBe(false);
  });

  it("草稿列表也要映射：左侧点开一篇匿名草稿同样走这条路", async () => {
    stubNuxt(() => ({
      data: [draftRow({ isAnonymous: true }), draftRow({ documentId: "d4" })],
      meta: { pagination: { start: 0, limit: 20, total: 2, pageCount: 1 } },
    }));
    const page = await useApi().getMyDrafts();

    expect(page.nodes.map((d) => d.isAnonymous)).toEqual([true, false]);
  });
});

describe("updateArticleDraft 送出 isAnonymous（写路径）", () => {
  it("false 必须进 body：漏掉它 Strapi 就部分更新不动这个字段，开关只能开不能关", async () => {
    const stub = stubNuxt(() => ({ data: draftRow() }));
    await useApi().updateArticleDraft("d1", {
      title: "标题",
      text: "正文",
      isAnonymous: false,
    });

    const body = stub.lastCall().options.body as { data: Record<string, unknown> };
    expect(body.data.isAnonymous).toBe(false);
  });

  it("true 同样进 body", async () => {
    const stub = stubNuxt(() => ({ data: draftRow({ isAnonymous: true }) }));
    await useApi().updateArticleDraft("d1", {
      title: "标题",
      text: "正文",
      isAnonymous: true,
    });

    const body = stub.lastCall().options.body as { data: Record<string, unknown> };
    expect(body.data.isAnonymous).toBe(true);
  });
});
