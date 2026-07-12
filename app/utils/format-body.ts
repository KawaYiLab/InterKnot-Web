import DOMPurify from "isomorphic-dompurify";
import MarkdownIt from "markdown-it";
import { toCanonicalUrl } from "~/utils/image";

// 委托正文的安全渲染。
// - bodyText 路径：用户敲的 markdown 会被解析渲染（CommonMark + 自动链接化 + 单换行=<br>）；
//   纯文本输入也会被等价地转成段落 + <br>。最终输出统一过 DOMPurify。
// - body 路径：保留给将来的结构化富文本输出，同样走 DOMPurify 兜底。

// html: true   → 允许委托内嵌入 HTML 标签（加粗/上下标/details/abbr/kbd/ruby 等），
//                 由下面的 DOMPurify 白名单兜底过滤危险标签与属性。
// linkify: true → 自动把裸 URL 变成可点链接。
// breaks: true  → 单个换行渲染为 <br>，符合论坛输入习惯。
const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  typographer: false,
});

// 让所有 markdown 链接默认在新标签页打开，并加 rel 三件套防钓鱼/SEO 滥用。
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener nofollow noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// 富文本/markdown 输出的白名单。涵盖：
// - markdown-it 默认输出的所有标签（段落、列表、标题、表格、代码块……）
// - 论坛常用的展示型 HTML（加粗/斜体/下划线/上下标/高亮/缩写/键盘/折叠/引用/Ruby 注音）
// 显式禁止：script / iframe / form / input / style / link / object / embed / svg
//        以及一切 on* 内联事件、javascript: 协议（DOMPurify 默认已拒）。
// font 标签已过时且属性可被滥用，统一改用 <span style="color:..."> 表达。
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    // 文档结构
    "p", "br", "hr", "div", "span",
    // 标题
    "h1", "h2", "h3", "h4", "h5", "h6",
    // 文本强调
    "strong", "em", "b", "i", "u", "s", "del", "strike", "mark", "small",
    // 上下标 / 键盘 / 缩写 / 引用
    "sub", "sup", "kbd", "abbr", "cite",
    // Ruby 注音
    "ruby", "rb", "rp", "rt", "rtc",
    // 链接 / 媒体
    "a", "img",
    // 列表
    "ul", "ol", "li",
    // 引用 / 代码
    "blockquote", "pre", "code", "samp", "var",
    // 折叠
    "details", "summary",
    // 表格
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  ],
  ALLOWED_ATTR: [
    "href", "target", "rel",
    "src", "alt", "title",
    "width", "height",
    "class", "id",
    "colspan", "rowspan",
    "open", // <details open>
    "style", // 内联样式：危险值由下面的 uponSanitizeAttribute 钩子兜底过滤。
    "loading",
    "decoding",
  ],
};

// DOMPurify 默认 CSS 过滤在不同环境下行为不一致，可能放行 url(javascript:)、expression() 等。
// 这里显式扫描 style 值，命中危险关键字直接丢弃整个 style 属性（保守但安全）。
//
// 同时禁止 position: fixed/sticky/absolute —— 论坛委托没有合法理由用绝对/固定定位，
// 而它们能让恶意用户在委托里制造全屏遮罩、隐形点击劫持等视觉骗术。
const DANGEROUS_CSS_RE =
  /javascript:|vbscript:|data:|expression\s*\(|behavior\s*:|@import\b|<\s*\/?[a-z]|position\s*:\s*(fixed|sticky|absolute)/i;

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "style" && DANGEROUS_CSS_RE.test(data.attrValue)) {
    data.keepAttr = false;
  }
});

// 给所有 target=_blank 的链接强制补 rel="noopener nofollow noreferrer"，防止反向 tabnabbing。
// markdown 语法的链接已经在上面的 link_open 钩子里加过；这里覆盖用户写的裸 <a> 标签。
// 同时把正文里的 <img> 地址迁移到新图床，并默认开启懒加载/异步解码。
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeType !== 1 /* Element */) return;
  const el = node as Element;
  if (el.tagName === "A" && el.getAttribute("target") === "_blank") {
    el.setAttribute("rel", "noopener nofollow noreferrer");
  }
  if (el.tagName === "IMG") {
    const src = el.getAttribute("src");
    if (src) {
      el.setAttribute("src", toCanonicalUrl(src));
    }
    el.setAttribute("loading", "lazy");
    el.setAttribute("decoding", "async");
  }
});

/**
 * 把用户输入的"纯文本/markdown 混合"内容渲染为安全 HTML。
 * 配合容器的 `white-space: normal`（不要 pre-wrap，否则 markdown-it 输出
 * 中保留的字面换行会被重复渲染成额外空行）。
 */
export function formatBodyText(text: string): string {
  if (!text) return "";
  const rendered = md.render(text);
  return DOMPurify.sanitize(rendered, SANITIZE_CONFIG);
}

/**
 * 富文本（已经是 HTML）路径的净化。例如未来上 WYSIWYG 后写入的 `body` 字段，
 * 渲染前在前端再过一遍白名单做深度防御。
 */
export function sanitizeBodyHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
