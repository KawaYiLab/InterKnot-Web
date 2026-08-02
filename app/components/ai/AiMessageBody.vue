<script setup lang="ts">
import { computed, ref } from "vue";
import { formatChatMarkdown } from "~/utils/format-chat";

/**
 * AI 会话气泡的富文本正文：markdown 渲染 + 代码高亮 + 代码块复制 +
 * 站内链接拦截（/post/xxx → postModal）。
 *
 * 仅用于 AI 会话中对方（assistant）的 text 消息；普通用户 DM 保持纯文本，
 * 防止用户消息伪装成富文本钓鱼。
 */
const props = defineProps<{
  /** 原始 markdown 文本（流式时为当前累计的半截文本） */
  text: string;
  /** 流式接收中：跳过代码高亮 + 尾部渲染闪烁光标 */
  streaming?: boolean;
}>();

const emit = defineEmits<{
  /** 点击站内帖子链接（/post/<documentId>） */
  (e: "open-post", documentId: string): void;
}>();

/**
 * 在 DOMPurify 白名单清洗之后注入代码块工具条（语言标签 + 复制按钮）。
 * 注入的是我们自己的可信静态标记；<pre> 内容已被 markdown-it 转义，
 * 不可能出现字面 </pre> 提前闭合。
 */
const decorateCodeBlocks = (html: string): string =>
  html.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/g, (block, attrs: string) => {
    const langMatch = /data-lang="([^"]*)"/.exec(attrs);
    const lang = langMatch?.[1] ?? "";
    return (
      '<div class="ik-ai-md__codebox">' +
      '<div class="ik-ai-md__codebar">' +
      `<span class="ik-ai-md__codelang">${lang}</span>` +
      '<button type="button" class="ik-ai-md__copy" data-copy-code aria-label="复制代码">复制</button>' +
      "</div>" +
      block +
      "</div>"
    );
  });

const html = computed(() =>
  decorateCodeBlocks(
    formatChatMarkdown(props.text, { highlight: !props.streaming }),
  ),
);

const rootRef = ref<HTMLElement | null>(null);

/** 代码块复制成功的临时反馈（按钮文案 2s 内变「已复制」） */
const flashCopied = (btn: HTMLButtonElement) => {
  btn.textContent = "已复制";
  btn.classList.add("is-copied");
  setTimeout(() => {
    btn.textContent = "复制";
    btn.classList.remove("is-copied");
  }, 2000);
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * 事件委托：v-html 内容无法绑定 Vue 事件，统一在根节点分发。
 * - 复制按钮 → 复制相邻 <pre> 的纯文本
 * - /post/xxx 链接 → postModal（emit）
 * - 其它站内链接 → SPA 导航
 * - 外链 → 默认行为（markdown 渲染时已加 target=_blank）
 */
const onClick = async (e: MouseEvent) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;

  const copyBtn = target.closest<HTMLButtonElement>("[data-copy-code]");
  if (copyBtn) {
    e.preventDefault();
    const pre = copyBtn.closest(".ik-ai-md__codebox")?.querySelector("pre");
    const code = pre?.textContent ?? "";
    if (code && (await copyText(code))) flashCopied(copyBtn);
    return;
  }

  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link || !rootRef.value?.contains(link)) return;
  const href = link.getAttribute("href") ?? "";
  if (!href.startsWith("/") || href.startsWith("//")) return; // 外链走默认
  e.preventDefault();
  const postMatch = href.match(/^\/post\/([a-zA-Z0-9_-]+)/);
  if (postMatch) {
    emit("open-post", postMatch[1]!);
    return;
  }
  void navigateTo(href);
};
</script>

<template>
  <div
    ref="rootRef"
    class="ik-ai-md"
    :class="{ 'is-streaming': streaming }"
    @click="onClick"
  >
    <!-- eslint-disable-next-line vue/no-v-html -- 已经 DOMPurify 白名单清洗 -->
    <div class="ik-ai-md__content" v-html="html" />
  </div>
</template>

<style scoped>
/* 气泡容器是 white-space: pre-wrap（纯文本语义）；markdown HTML 中标签间
   换行不能显形，必须还原为 normal，代码块内部再单独恢复 pre */
.ik-ai-md {
  white-space: normal;
  font-weight: 500;
  line-height: 1.55;
  /* 富文本正文最小宽度保障：短句仍随内容收缩，由外层气泡 w-fit 决定 */
  max-width: 100%;
}

.ik-ai-md__content > :deep(*:first-child) {
  margin-top: 0;
}

.ik-ai-md__content > :deep(*:last-child) {
  margin-bottom: 0;
}

/* ── 排版 ─────────────────────────────── */
.ik-ai-md :deep(p) {
  margin: 0.45em 0;
}

.ik-ai-md :deep(h1),
.ik-ai-md :deep(h2),
.ik-ai-md :deep(h3),
.ik-ai-md :deep(h4),
.ik-ai-md :deep(h5),
.ik-ai-md :deep(h6) {
  margin: 0.8em 0 0.4em;
  font-weight: 700;
  line-height: 1.3;
}

.ik-ai-md :deep(h1) {
  font-size: 1.25em;
}

.ik-ai-md :deep(h2) {
  font-size: 1.15em;
}

.ik-ai-md :deep(h3) {
  font-size: 1.05em;
}

.ik-ai-md :deep(h4),
.ik-ai-md :deep(h5),
.ik-ai-md :deep(h6) {
  font-size: 1em;
}

.ik-ai-md :deep(ul),
.ik-ai-md :deep(ol) {
  margin: 0.45em 0;
  padding-left: 1.4em;
}

.ik-ai-md :deep(li) {
  margin: 0.2em 0;
}

.ik-ai-md :deep(li > p) {
  margin: 0;
}

.ik-ai-md :deep(blockquote) {
  margin: 0.6em 0;
  padding: 0.2em 0.9em;
  border-left: 3px solid #fbfe00;
  background: rgba(0, 0, 0, 0.045);
  border-radius: 0 8px 8px 0;
  color: rgba(0, 0, 0, 0.55);
}

.ik-ai-md :deep(hr) {
  margin: 0.9em 0;
  border: 0;
  border-top: 1px solid rgba(0, 0, 0, 0.12);
}

.ik-ai-md :deep(a) {
  color: #2c58e2;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  transition: color 120ms ease;
  word-break: break-all;
}

.ik-ai-md :deep(a:hover) {
  color: #1a3fad;
}

.ik-ai-md :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}

/* ── 表格 ─────────────────────────────── */
.ik-ai-md :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  margin: 0.6em 0;
  border-collapse: collapse;
  font-size: 0.92em;
}

.ik-ai-md :deep(th),
.ik-ai-md :deep(td) {
  padding: 5px 10px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  text-align: left;
}

.ik-ai-md :deep(th) {
  background: rgba(0, 0, 0, 0.06);
  font-weight: 700;
}

/* ── 行内代码 ─────────────────────────── */
.ik-ai-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, Menlo,
    monospace;
  font-size: 0.88em;
}

.ik-ai-md :deep(:not(pre) > code) {
  padding: 1px 6px;
  background: rgba(0, 0, 0, 0.07);
  border-radius: 5px;
  word-break: break-all;
}

/* ── 代码块（深底浅字，ZZZ 黑黄框语言） ── */
.ik-ai-md :deep(.ik-ai-md__codebox) {
  margin: 0.6em 0;
  border-radius: 10px;
  overflow: hidden;
  background: #17171a;
}

.ik-ai-md :deep(.ik-ai-md__codebar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 6px 5px 12px;
  background: #232326;
}

.ik-ai-md :deep(.ik-ai-md__codelang) {
  font-size: 11px;
  letter-spacing: 0.4px;
  text-transform: lowercase;
  color: rgba(255, 255, 255, 0.55);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.ik-ai-md :deep(.ik-ai-md__copy) {
  padding: 2px 10px;
  border: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.ik-ai-md :deep(.ik-ai-md__copy:hover) {
  background: #fbfe00;
  color: #000;
}

.ik-ai-md :deep(.ik-ai-md__copy.is-copied) {
  background: #52d273;
  color: #000;
}

.ik-ai-md :deep(pre) {
  margin: 0;
  padding: 12px 14px;
  overflow-x: auto;
  white-space: pre;
  background: transparent;
  color: #e6e6e6;
  font-size: 13px;
  line-height: 1.55;
}

.ik-ai-md :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 1em;
  word-break: normal;
}

/* ── hljs 精简主题（github-dark 系配色） ── */
.ik-ai-md :deep(.hljs-comment),
.ik-ai-md :deep(.hljs-quote) {
  color: #8b949e;
  font-style: italic;
}

.ik-ai-md :deep(.hljs-keyword),
.ik-ai-md :deep(.hljs-selector-tag),
.ik-ai-md :deep(.hljs-meta) {
  color: #ff7b72;
}

.ik-ai-md :deep(.hljs-string),
.ik-ai-md :deep(.hljs-regexp),
.ik-ai-md :deep(.hljs-addition) {
  color: #a5d6ff;
}

.ik-ai-md :deep(.hljs-number),
.ik-ai-md :deep(.hljs-literal),
.ik-ai-md :deep(.hljs-symbol),
.ik-ai-md :deep(.hljs-bullet) {
  color: #79c0ff;
}

.ik-ai-md :deep(.hljs-title),
.ik-ai-md :deep(.hljs-title.function_),
.ik-ai-md :deep(.hljs-section) {
  color: #d2a8ff;
}

.ik-ai-md :deep(.hljs-attr),
.ik-ai-md :deep(.hljs-attribute),
.ik-ai-md :deep(.hljs-variable),
.ik-ai-md :deep(.hljs-template-variable),
.ik-ai-md :deep(.hljs-type),
.ik-ai-md :deep(.hljs-selector-class),
.ik-ai-md :deep(.hljs-selector-id) {
  color: #7ee787;
}

.ik-ai-md :deep(.hljs-built_in),
.ik-ai-md :deep(.hljs-name),
.ik-ai-md :deep(.hljs-tag) {
  color: #ffa657;
}

.ik-ai-md :deep(.hljs-emphasis) {
  font-style: italic;
}

.ik-ai-md :deep(.hljs-strong) {
  font-weight: 700;
}

.ik-ai-md :deep(.hljs-deletion) {
  color: #ffa198;
}

/* ── 流式光标：最后一个块级元素尾部闪烁 ▍ ── */
.ik-ai-md.is-streaming .ik-ai-md__content > :deep(*:last-child)::after {
  content: "▍";
  display: inline-block;
  margin-left: 1px;
  color: rgba(0, 0, 0, 0.65);
  animation: ik-ai-cursor-blink 0.9s steps(2, start) infinite;
}

@keyframes ik-ai-cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
</style>
