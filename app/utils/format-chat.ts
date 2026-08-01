import DOMPurify from "isomorphic-dompurify";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import yaml from "highlight.js/lib/languages/yaml";
import cpp from "highlight.js/lib/languages/cpp";

// 按需注册常用语言（core 版 ~8KB gzip + 每门语言 1-3KB，全量包 ~300KB 不可取）
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("java", java);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("cpp", cpp);
// 常见别名：html → xml、shell → bash、vue → xml
hljs.registerAliases(["html", "vue"], { languageName: "xml" });
hljs.registerAliases(["shell", "sh", "zsh"], { languageName: "bash" });
hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });

// AI 聊天消息（assistant 角色）的 markdown 渲染。
//
// 与 utils/format-body.ts 的区别：
// - html: false        AI 模型可能在 prompt injection 下被诱导输出原生 HTML，
//                      关闭 raw HTML 渲染最安全；只让 markdown 语法本身产
//                      出 HTML。
// - 白名单更窄         不放行 details/kbd/ruby/abbr 等富文本展示标签——
//                      AI 输出场景用不到；越窄越难被注入 payload 利用。
// - linkify: true      自动把裸 URL 变成可点链接，对话里很常见。
// - breaks: true       单换行 → <br>，与流式 token 逐字到达的体验一致。
//
// 流式渲染：上层每收到一个 delta 都调用一次本函数重渲染整个 content。
// markdown-it 单次 render <5ms（10KB 输入级别），不会成为瓶颈。未闭合 fence
// 在 markdown-it 里会被当作普通段落，等闭合 ``` 到达后自动切换为代码块——
// 与 ChatGPT/AstrBot ChatUI 行为一致。
//
// 代码高亮：流式期间跳过（每个 delta 重渲染整段，hljs 会成为热点），
// 定稿（streamingDone）后一次性高亮——由调用方通过 opts.highlight 控制。
const highlightCode = (code: string, lang: string): string => {
  if (!lang || !hljs.getLanguage(lang)) return "";
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return "";
  }
};

const createRenderer = (withHighlight: boolean): MarkdownIt => {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false, // 关闭"花体引号"等替换，避免破坏代码示例
    ...(withHighlight ? { highlight: highlightCode } : {}),
  });

  // 链接：外链自动 target=_blank + rel=noopener nofollow noreferrer；
  // 站内相对链接（/post/xxx 等）不加 target——由 AiMessageBody 事件委托
  // 拦截后走 postModal，保持 SPA 体验。
  // 在 markdown-it 渲染钩子里处理而非 DOMPurify hook，避免与 format-body.ts
  // 注册的全局 hook 顺序耦合。
  md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx]!;
    const hrefIdx = token.attrIndex("href");
    const href = hrefIdx >= 0 ? (token.attrs![hrefIdx]![1] ?? "") : "";
    const isInternal = href.startsWith("/") && !href.startsWith("//");
    if (!isInternal) {
      const targetIdx = token.attrIndex("target");
      const relIdx = token.attrIndex("rel");
      if (targetIdx < 0) token.attrPush(["target", "_blank"]);
      else token.attrs![targetIdx]![1] = "_blank";
      const rel = "noopener nofollow noreferrer";
      if (relIdx < 0) token.attrPush(["rel", rel]);
      else token.attrs![relIdx]![1] = rel;
    }
    return self.renderToken(tokens, idx, options);
  };

  // fence 代码块：在 <pre> 上挂 data-lang，CSS 用它在角上标语言名（PR2 视觉），
  // 也是代码块复制按钮 / 语法高亮按语言分流的锚点。
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const lang = (token.info || "").trim().split(/\s+/)[0] || "";
    const html = defaultFence
      ? defaultFence(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
    if (!lang) return html;
    // 仅在能确认是 <pre> 起始时插入 data-lang，避免误改无关 HTML
    return html.replace(/^<pre(\s|>)/, `<pre data-lang="${md.utils.escapeHtml(lang)}"$1`);
  };

  return md;
};

const mdPlain = createRenderer(false);
const mdHighlight = createRenderer(true);

// 聊天 AI 输出严格白名单：仅放行 markdown 自身产出的标签 + 链接/图片必备属性。
// 显式禁止：script / style / iframe / form / input / object / embed / svg / details
// 任何 on* 内联事件、javascript: / data: 协议（DOMPurify 默认拒绝）。
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    // 段落 / 分隔
    "p",
    "br",
    "hr",
    // 行内强调
    "strong",
    "em",
    "del",
    "s",
    "u",
    // 标题
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    // 列表
    "ul",
    "ol",
    "li",
    // 引用
    "blockquote",
    // 代码
    "code",
    "pre",
    // 链接 / 图片
    "a",
    "img",
    // 表格
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    // 通用容器（markdown-it 在某些场景输出）
    "span",
  ],
  ALLOWED_ATTR: [
    "href",
    "target",
    "rel",
    "src",
    "alt",
    "title",
    "class",
    "data-lang",
    "colspan",
    "rowspan",
    "align",
  ],
  // 注意：DOMPurify 会用该正则校验所有非 URI-safe 属性的值（不只 href/src），
  // 因此除了放行 https/mailto 协议与站内绝对路径（/xxx，拒绝 //host 协议相对
  // 形式），还必须放行"不含冒号"的普通属性值（_blank / noopener / 数字等），
  // 否则 target、rel、colspan 会被一并剥除。含冒号的值仍必须是 https/mailto，
  // javascript: 与 data: 一律拦截。
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):|^\/(?!\/)|^(?!\/\/)[^:]*$/i,
};

/**
 * AI 回复里的帖子引用常见写法：
 * - 标题 (/post/documentId)   ← 纯文本模型最爱
 * - [标题](/post/documentId)  ← 标准 markdown
 * - 裸 /post/documentId       ← 兜底
 * 在进 markdown-it 之前统一转成 [标题](/post/documentId)，
 * 避免消息里直接裸露 URL。
 */
const POST_LINK_BARE_RE = /([^\n()\[\]]{1,40}?)\s*\(\s*(\/post\/[A-Za-z0-9_-]+)\s*\)/g;
const POST_BARE_RE = /(?<!\]\()(\/post\/[A-Za-z0-9_-]+)(?!\))/g;

function normalizePostLinks(text: string): string {
  if (!text) return text;
  // 代码块内原样保留，避免误改示例代码里的路径字符串
  return text
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(POST_LINK_BARE_RE, "[$1]($2)")
        .replace(POST_BARE_RE, "[查看委托]($1)");
    })
    .join("");
}

/**
 * 把 AI 模型输出的（可能不完整的）markdown 渲染为安全 HTML。
 * 流式期间会被反复调用，纯函数无副作用。
 *
 * @param opts.highlight 是否做代码语法高亮。流式中传 false（每 delta 全量
 *   重渲染，高亮开销大且半截代码高亮结果抖动）；定稿后传 true。
 */
export function formatChatMarkdown(
  text: string,
  opts?: { highlight?: boolean },
): string {
  if (!text) return "";
  const md = opts?.highlight ? mdHighlight : mdPlain;
  const rendered = md.render(normalizePostLinks(text));
  return DOMPurify.sanitize(rendered, SANITIZE_CONFIG);
}
