import { describe, expect, it } from "vitest";
import {
  EMOTE_REGEX,
  parseEmotes,
  stripEmotesToPlain,
  buildEmoteToken,
  splitContent,
} from "~/utils/emote";

describe("parseEmotes", () => {
  it("解析单个 emote token 的 code 与下标", () => {
    const content = "hi :ik-smile: bye";
    const tokens = parseEmotes(content);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ code: "ik-smile" });
    expect(content.slice(tokens[0]!.start, tokens[0]!.end)).toBe(":ik-smile:");
  });

  it("解析多个 token 且保持顺序", () => {
    const tokens = parseEmotes(":ik-a: 和 :ik-bbb:");
    expect(tokens.map((t) => t.code)).toEqual(["ik-a", "ik-bbb"]);
  });

  it("支持带连字符的 code", () => {
    const tokens = parseEmotes(":ik-zzz-happy:");
    expect(tokens[0]?.code).toBe("ik-zzz-happy");
  });

  it("多次调用结果稳定（全局正则 lastIndex 已重置）", () => {
    const content = ":ik-smile:";
    expect(parseEmotes(content)).toHaveLength(1);
    expect(parseEmotes(content)).toHaveLength(1);
  });

  it("非字符串 / 空串返回空数组", () => {
    expect(parseEmotes("")).toEqual([]);
  });

  it("不匹配无 ik- 前缀的 shortcode", () => {
    expect(parseEmotes(":smile: :cry:")).toEqual([]);
  });

  it("不匹配超长 code（>32 字符）", () => {
    const long = "a".repeat(33);
    expect(parseEmotes(`:ik-${long}:`)).toEqual([]);
  });
});

describe("stripEmotesToPlain", () => {
  it("无 lookup 时降级为 [表情]", () => {
    expect(stripEmotesToPlain("hi :ik-smile: bye")).toBe("hi [表情] bye");
  });

  it("有 lookup 时降级为 [表情:name]", () => {
    const lookup = (code: string) =>
      code === "ik-smile" ? "微笑" : undefined;
    expect(stripEmotesToPlain("hi :ik-smile: bye", lookup)).toBe(
      "hi [表情:微笑] bye",
    );
  });

  it("多个 emote 同时降级", () => {
    const lookup = (code: string) =>
      code === "ik-smile" ? "微笑" : code === "ik-cry" ? "哭泣" : undefined;
    expect(stripEmotesToPlain(":ik-smile::ik-cry:", lookup)).toBe(
      "[表情:微笑][表情:哭泣]",
    );
  });

  it("无 emote 时原样返回", () => {
    expect(stripEmotesToPlain("纯文本")).toBe("纯文本");
  });
});

describe("buildEmoteToken", () => {
  it("拼装标准 token", () => {
    expect(buildEmoteToken("ik-smile")).toBe(":ik-smile:");
  });
});

describe("splitContent", () => {
  it("切分出 text / mention / emote 段", () => {
    const segments = splitContent("前@[小明](abc123)中:ik-smile:后");
    expect(segments).toEqual([
      { type: "text", value: "前" },
      { type: "mention", name: "小明", authorDocumentId: "abc123" },
      { type: "text", value: "中" },
      { type: "emote", code: "ik-smile" },
      { type: "text", value: "后" },
    ]);
  });

  it("仅 emote 无 mention", () => {
    const segments = splitContent("前:ik-smile:后");
    expect(segments).toEqual([
      { type: "text", value: "前" },
      { type: "emote", code: "ik-smile" },
      { type: "text", value: "后" },
    ]);
  });

  it("连续 emote", () => {
    const segments = splitContent(":ik-a::ik-b:");
    expect(segments).toEqual([
      { type: "emote", code: "ik-a" },
      { type: "emote", code: "ik-b" },
    ]);
  });

  it("无 token 时返回单个 text 段", () => {
    expect(splitContent("纯文本")).toEqual([
      { type: "text", value: "纯文本" },
    ]);
  });

  it("空串返回空数组", () => {
    expect(splitContent("")).toEqual([]);
  });

  it("mention 在 emote 之后", () => {
    const segments = splitContent(":ik-smile:@[小明](abc123)");
    expect(segments).toEqual([
      { type: "emote", code: "ik-smile" },
      { type: "mention", name: "小明", authorDocumentId: "abc123" },
    ]);
  });
});

describe("EMOTE_REGEX 同步校验", () => {
  // 确保前端正则与后端一致
  it("匹配 ik- 前缀的 shortcode", () => {
    const re = new RegExp(EMOTE_REGEX.source, EMOTE_REGEX.flags);
    expect(re.test(":ik-smile:")).toBe(true);
  });

  it("不匹配无前缀的 shortcode", () => {
    const re = new RegExp(EMOTE_REGEX.source, EMOTE_REGEX.flags);
    expect(re.test(":smile:")).toBe(false);
  });
});
