/**
 * 仿 Inspira UI「Text Generate Effect」：给 HTML 末尾最后几个可见字各包一层
 * `<span class="ik-tg ik-tg-N">`（N 从 1 数起，越靠后越大），由样式做成越往后越淡越模糊。
 * 打字机 / 流式每推进一次就重算一遍，看起来就是字从模糊里浮现出来。
 *
 * 只对已经 DOMPurify 清洗过的 HTML 调用：标签整体跳过，`&amp;` 这类实体算一个字，
 * 空白不计数也不包。
 */
export const TEXT_GENERATE_TAIL = 8;

const ENTITY_RE = /^&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i;

type Token = { text: string; visible: boolean };

const tokenize = (html: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < html.length) {
    const ch = html[i]!;
    if (ch === "<") {
      const end = html.indexOf(">", i);
      const stop = end === -1 ? html.length : end + 1;
      tokens.push({ text: html.slice(i, stop), visible: false });
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
    if (!token.visible) continue;
    rank++;
    token.text = `<span class="ik-tg ik-tg-${rank}">${token.text}</span>`;
  }
  return tokens.map((t) => t.text).join("");
}
