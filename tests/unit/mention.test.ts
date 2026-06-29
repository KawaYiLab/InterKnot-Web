import { describe, expect, it } from "vitest";
import {
  buildMentionToken,
  parseMentions,
  splitContentWithMentions,
  stripMentionsToPlain,
} from "~/utils/mention";

describe("parseMentions", () => {
  it("解析单个 mention token 的字段与下标", () => {
    const content = "hi @[小明](abc123) bye";
    const tokens = parseMentions(content);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      name: "小明",
      authorDocumentId: "abc123",
    });
    expect(content.slice(tokens[0]!.start, tokens[0]!.end)).toBe(
      "@[小明](abc123)",
    );
  });

  it("解析多个 token 且保持顺序", () => {
    const tokens = parseMentions("@[a](aaaaaa) 和 @[b](bbbbbb)");
    expect(tokens.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("多次调用结果稳定（全局正则 lastIndex 已重置）", () => {
    const content = "@[a](aaaaaa)";
    expect(parseMentions(content)).toHaveLength(1);
    expect(parseMentions(content)).toHaveLength(1);
  });

  it("非字符串 / 空串返回空数组", () => {
    expect(parseMentions("")).toEqual([]);
    // @ts-expect-error 故意传入非字符串
    expect(parseMentions(null)).toEqual([]);
  });
});

describe("stripMentionsToPlain", () => {
  it("把 token 替换成 @显示名", () => {
    expect(stripMentionsToPlain("hi @[小明](abc123)!")).toBe("hi @小明!");
  });

  it("无 mention 时原样返回", () => {
    expect(stripMentionsToPlain("纯文本")).toBe("纯文本");
  });
});

describe("splitContentWithMentions", () => {
  it("切分出 text 与 mention 段", () => {
    const segments = splitContentWithMentions("前@[小明](abc123)后");
    expect(segments).toEqual([
      { type: "text", value: "前" },
      { type: "mention", name: "小明", authorDocumentId: "abc123" },
      { type: "text", value: "后" },
    ]);
  });

  it("无 mention 时返回单个 text 段", () => {
    expect(splitContentWithMentions("纯文本")).toEqual([
      { type: "text", value: "纯文本" },
    ]);
  });
});

describe("buildMentionToken", () => {
  it("拼装标准 token", () => {
    expect(buildMentionToken("小明", "abc123")).toBe("@[小明](abc123)");
  });

  it("去除显示名中的方括号与换行并截断到 40 字", () => {
    const token = buildMentionToken("a[b]\nc", "id1234");
    expect(token).toBe("@[abc](id1234)");
    const long = "x".repeat(50);
    expect(buildMentionToken(long, "id1234")).toBe(`@[${"x".repeat(40)}](id1234)`);
  });
});
