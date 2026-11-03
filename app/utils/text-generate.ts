/**
 * 仿 Inspira UI「Text Generate Effect」：给 HTML 末尾最后几个可见字各包一层
 * `<span class="ik-tg ik-tg-N">`（N=1 是末字），由样式做成越往后越淡越模糊。
 * 末字另有外层锚点，供不受文字淡化与模糊影响的装饰定位。
 * 打字机 / 流式每推进一次就重算一遍，看起来就是字从模糊里浮现出来。
 *
 * 只对安全的渲染结果调用：标签整体跳过，`&amp;` 这类实体算一个字，
 * 空白不计数也不包。
 */
export const TEXT_GENERATE_TAIL = 8;

const ENTITY_RE = /^&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i;
const TAG_RE = /<!--[\s\S]*?(?:-->|$)|<(?:[^"'<>]|"[^"]*"|'[^']*')*>/y;

type Token = { text: string; visible: boolean; boundary?: true };

const mathEnd = (html: string, start: number): number => {
  let depth = 0;
  let pos = start;
  while (pos >= 0 && pos < html.length) {
    TAG_RE.lastIndex = pos;
    const tag = TAG_RE.exec(html)?.[0];
    if (!tag) break;
    if (/^<span(?:\s|>)/.test(tag)) depth++;
    else if (/^<\/span\s*>/.test(tag) && --depth === 0) return TAG_RE.lastIndex;
    pos = html.indexOf("<", TAG_RE.lastIndex);
  }
  return start;
};

const tokenize = (html: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < html.length) {
    const ch = html[i]!;
    if (ch === "<") {
      TAG_RE.lastIndex = i;
      const stop = TAG_RE.exec(html) ? TAG_RE.lastIndex : html.length;
      const tag = html.slice(i, stop);
      if (/^<span class="katex(?:-display)?">$/.test(tag)) {
        const end = mathEnd(html, i);
        if (end > stop) {
          tokens.push({ text: html.slice(i, end), visible: false, boundary: true });
          i = end;
          continue;
        }
      }
      tokens.push({ text: tag, visible: false });
      i = stop;
      continue;
    }
    if (ch === "&") {
      const entity = ENTITY_RE.exec(html.slice(i, i + 12));
      if (entity) {
        tokens.push({ text: entity[0], visible: true });
        i += entity[0].length;
        continue;
      }
    }
    const cp = html.codePointAt(i)!;
    const text = String.fromCodePoint(cp);
    tokens.push({ text, visible: !/\s/.test(text) });
    i += text.length;
  }
  return tokens;
};

export function wrapGeneratingTail(html: string, count = TEXT_GENERATE_TAIL): string {
  if (count <= 0 || !html) return html;
  const tokens = tokenize(html);
  let rank = 0;
  for (let i = tokens.length - 1; i >= 0 && rank < count; i--) {
    const token = tokens[i]!;
    // MathML 和公式的定位 span 必须保持完整，动画止于公式边界。
    if (token.boundary) break;
    if (!token.visible) continue;
    rank++;
    const generated = `<span class="ik-tg ik-tg-${rank}">${token.text}</span>`;
    token.text = rank === 1 ? `<span class="ik-tg-end">${generated}</span>` : generated;
  }
  return tokens.map((t) => t.text).join("");
}
