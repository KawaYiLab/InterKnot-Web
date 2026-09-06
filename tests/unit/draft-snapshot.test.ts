import { describe, expect, it } from "vitest";
import {
  buildDraftPayload,
  buildDraftSnapshot,
  type DraftEditorContent,
} from "~/utils/draft-snapshot";

/**
 * 草稿指纹的唯一职责：内容变了就得算出不同的字符串。
 *
 * 发布页拿它当自动保存的闸门（指纹与上次相同就不发 PUT）和「未保存」标志的依据，
 * 所以**漏收一个字段 = 那个字段的单独改动被静默丢弃**，而且没有任何报错。
 * `isAnonymous` 就是这么丢过的：模板上的开关调了 markDirty，指纹却没变，闸门直接 return。
 */

const base: DraftEditorContent = {
  title: "标题",
  text: "正文",
  externalVideos: [],
  cover: [],
  category: "general",
  isAnonymous: false,
};

/**
 * 字段清单 —— 编辑器里每一个「用户可改且要存下来」的字段各一条。
 * **往 DraftEditorContent 里新增字段时，这里必须同时加一条**，否则新字段会重演
 * isAnonymous 那次；下方 buildDraftPayload 的同源用例也复用这份清单。
 */
const mutations: Array<[string, Partial<DraftEditorContent>]> = [
  ["title", { title: "换个标题" }],
  ["text", { text: "换个正文" }],
  ["category", { category: "tech" }],
  ["isAnonymous", { isAnonymous: true }],
  ["cover：从无到一张", { cover: "img-1" }],
  ["cover：从一张到多张", { cover: ["img-1", "img-2"] }],
  ["externalVideos", { externalVideos: [{ provider: "bilibili", bvid: "BV1xx411c7mD" }] }],
];

describe("buildDraftSnapshot", () => {
  it("同样的内容算出同样的指纹（换对象引用不算变化）", () => {
    expect(buildDraftSnapshot(base)).toBe(
      buildDraftSnapshot({ ...base, externalVideos: [], cover: [] }),
    );
  });

  it.each(mutations)("改动 %s 必须改变指纹", (_label, patch) => {
    expect(buildDraftSnapshot({ ...base, ...patch })).not.toBe(buildDraftSnapshot(base));
  });

  it("cover 的三种形态互不相同（[] / 单个 id / id 数组）", () => {
    const none = buildDraftSnapshot({ ...base, cover: [] });
    const one = buildDraftSnapshot({ ...base, cover: "img-1" });
    const many = buildDraftSnapshot({ ...base, cover: ["img-1"] });
    expect(new Set([none, one, many]).size).toBe(3);
  });

  it("标题与正文的首尾空白不算改动（多敲一个空格再删掉不该触发保存）", () => {
    expect(buildDraftSnapshot({ ...base, title: "  标题 ", text: "\n正文\t" })).toBe(
      buildDraftSnapshot(base),
    );
  });

  it("但正文内部的空白算改动", () => {
    expect(buildDraftSnapshot({ ...base, text: "正 文" })).not.toBe(
      buildDraftSnapshot(base),
    );
  });

  it("站外视频的顺序变化算改动（排序也要能存下来）", () => {
    const a = { provider: "bilibili", bvid: "BV1aa411c7mD" };
    const b = { provider: "bilibili", bvid: "BV1bb411c7mD" };
    expect(buildDraftSnapshot({ ...base, externalVideos: [a, b] })).not.toBe(
      buildDraftSnapshot({ ...base, externalVideos: [b, a] }),
    );
  });
});

/**
 * 指纹与 payload 必须描述同一份内容，且错位的后果是不对称的：
 * - payload 有、指纹没有 → 该字段的单独改动算出相同指纹，**保存被直接跳过**（isAnonymous 原案）
 * - 指纹有、payload 没有 → 白发一次零变更 PUT（category 的默认值兜底曾只做在 payload 侧）
 * 共用 DraftEditorContent 已经在类型层面挡住「加了字段只更新一边」，这里补上类型管不到的
 * 部分：键名映射、trim 是否同步、以及 false 会不会掉成 undefined。
 */
describe("buildDraftPayload 与 buildDraftSnapshot 同源", () => {
  it("覆盖同一批字段（cover 在 payload 里叫 coverId；authorId 不是编辑器内容）", () => {
    const snapshotKeys = new Set(Object.keys(JSON.parse(buildDraftSnapshot(base))));
    const payloadKeys = new Set(
      Object.keys(buildDraftPayload(base))
        .filter((k) => k !== "authorId")
        .map((k) => (k === "coverId" ? "cover" : k)),
    );
    expect(payloadKeys).toEqual(snapshotKeys);
  });

  it.each(mutations)("改动 %s 同时改变指纹与 payload", (_label, patch) => {
    const next = { ...base, ...patch };
    expect(buildDraftSnapshot(next)).not.toBe(buildDraftSnapshot(base));
    expect(buildDraftPayload(next)).not.toEqual(buildDraftPayload(base));
  });

  it("两边按同一套规则 trim：指纹说「没变」时，payload 里也不该真带着那个空格", () => {
    const padded = { ...base, title: "  标题 ", text: "\n正文\t" };
    expect(buildDraftSnapshot(padded)).toBe(buildDraftSnapshot(base));
    expect(buildDraftPayload(padded)).toEqual(buildDraftPayload(base));
  });

  it("isAnonymous: false 必须实打实出现在 payload 里", () => {
    // updateArticleDraft 按 `!== undefined` 决定是否写进 data，掉成 undefined 就是
    // 「匿名开关只能开不能关」。
    const payload = buildDraftPayload(base);
    expect("isAnonymous" in payload).toBe(true);
    expect(payload.isAnonymous).toBe(false);
  });

  it("authorId 只是随行参数，不参与内容比较", () => {
    const withAuthor = buildDraftPayload(base, "author-1");
    expect(withAuthor.authorId).toBe("author-1");
    expect(buildDraftPayload(base).authorId).toBeUndefined();
    expect({ ...withAuthor, authorId: undefined }).toEqual(buildDraftPayload(base));
  });
});
