import { describe, expect, it } from "vitest";
import { formatChatMarkdown } from "~/utils/format-chat";

describe("formatChatMarkdown 基础渲染", () => {
  it("渲染标题 / 列表 / 强调", () => {
    const html = formatChatMarkdown("# 标题\n\n- 项目一\n- **加粗**");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<li>项目一</li>");
    expect(html).toContain("<strong>加粗</strong>");
  });

  it("空输入返回空字符串", () => {
    expect(formatChatMarkdown("")).toBe("");
  });

  it("单换行渲染为 <br>（breaks: true）", () => {
    const html = formatChatMarkdown("第一行\n第二行");
    expect(html).toContain("<br>");
  });
});

describe("链接处理", () => {
  it("外链自动加 target=_blank + rel", () => {
    const html = formatChatMarkdown("[官网](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
  });

  it("站内 /post/ 相对链接保留 href 且不加 target", () => {
    const html = formatChatMarkdown("[帖子](/post/abc123)");
    expect(html).toContain('href="/post/abc123"');
    expect(html).not.toContain('target="_blank"');
  });

  it("协议相对 // 链接不按站内链接放行", () => {
    const html = formatChatMarkdown("[x](//evil.com)");
    expect(html).not.toContain('href="//evil.com"');
  });

  it("javascript: 协议不产出链接", () => {
    const html = formatChatMarkdown("[x](javascript:alert(1))");
    // markdown-it validateLink 拒绝危险协议 → 整段按纯文本转义输出
    expect(html).not.toContain("<a");
    expect(html).not.toMatch(/href="javascript:/);
  });
});

describe("代码块与高亮", () => {
  it("fence 挂 data-lang", () => {
    const html = formatChatMarkdown("```ts\nconst a: number = 1;\n```");
    expect(html).toContain('data-lang="ts"');
  });

  it("highlight: true 时输出 hljs token span", () => {
    const html = formatChatMarkdown("```js\nconst a = 1;\n```", {
      highlight: true,
    });
    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });

  it("highlight 缺省（流式）不输出 hljs span", () => {
    const html = formatChatMarkdown("```js\nconst a = 1;\n```");
    expect(html).not.toContain("hljs-keyword");
  });

  it("未知语言不报错、不产出高亮", () => {
    const html = formatChatMarkdown("```notalang\nfoo bar\n```", {
      highlight: true,
    });
    expect(html).toContain("foo bar");
    expect(html).not.toContain("hljs-");
  });

  it("代码内 HTML 被转义（不逃逸出 pre）", () => {
    const html = formatChatMarkdown('```html\n<script>alert(1)</script>\n```', {
      highlight: true,
    });
    expect(html).not.toContain("<script>");
  });
});

describe("XSS 白名单", () => {
  it("原生 HTML 不被渲染（html: false，标签转义为文本）", () => {
    const html = formatChatMarkdown('<img src=x onerror="alert(1)">');
    // markdown-it html:false → 原文转义为 &lt;img ...&gt;，不产出真实 img 标签
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("markdown 图片仅允许 https 源", () => {
    const ok = formatChatMarkdown("![a](https://example.com/a.png)");
    expect(ok).toContain('src="https://example.com/a.png"');
    const bad = formatChatMarkdown("![a](data:text/html;base64,xxx)");
    // data: 协议被 validateLink 拒绝 → 不产出 img 标签
    expect(bad).not.toContain("<img");
    expect(bad).not.toMatch(/src="data:/);
  });

  it("流式半截 fence 不破坏输出（渲染为普通段落）", () => {
    const html = formatChatMarkdown("看代码：\n```js\nconst a =");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });
});
