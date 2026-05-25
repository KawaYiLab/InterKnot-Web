import DOMPurify from "isomorphic-dompurify";
import MarkdownIt from "markdown-it";

// KkCall 聊天消息（assistant 角色）的 markdown 渲染。
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
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false, // 关闭"花体引号"等替换，避免破坏代码示例
});

// 链接：自动 target=_blank + rel=noopener nofollow noreferrer。
// 在 markdown-it 渲染钩子里处理而非 DOMPurify hook，避免与 format-body.ts
// 注册的全局 hook 顺序耦合。
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]!;
  const targetIdx = token.attrIndex("target");
  const relIdx = token.attrIndex("rel");
  if (targetIdx < 0) token.attrPush(["target", "_blank"]);
  else token.attrs![targetIdx]![1] = "_blank";
  const rel = "noopener nofollow noreferrer";
  if (relIdx < 0) token.attrPush(["rel", rel]);
  else token.attrs![relIdx]![1] = rel;
  return self.renderToken(tokens, idx, options);
};

// fence 代码块：在 <pre> 上挂 data-lang，CSS 用它在角上标语言名（PR2 视觉），
// 也方便后续 PR 给代码块加复制按钮 / 语法高亮时按语言分流。
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
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
};

/**
 * 把 AI 模型输出的（可能不完整的）markdown 渲染为安全 HTML。
 * 流式期间会被反复调用，纯函数无副作用。
 */
export function formatChatMarkdown(text: string): string {
  if (!text) return "";
  const rendered = md.render(text);
  return DOMPurify.sanitize(rendered, SANITIZE_CONFIG);
}
