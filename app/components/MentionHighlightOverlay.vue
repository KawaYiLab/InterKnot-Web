<script setup lang="ts">
/**
 * Textarea 内部 @ 提及的高亮叠加层。
 *
 * 工作原理（lonekorean/highlight-within-textarea 思路的 Vue 版）：
 * 1. Teleport 到目标 textarea 的 parentElement，与 textarea 同级。
 * 2. 容器位置 / 尺寸用 absolute + inset 与 textarea 对齐；mirror 内的字体、行高、
 *    padding、box-sizing 等从 textarea 的 computed style 同步过来。
 * 3. 把 text 切成 text/mention 段渲染为 inline span：
 *    - text 段：颜色 transparent，仅占位
 *    - mention 段：颜色 transparent + 黄色半透明 background（视觉高亮）
 * 4. 监听 textarea 的 scroll，把 mirror 的 scrollTop / scrollLeft 同步过来；
 *    监听 textarea 的 resize（ResizeObserver）刷新样式快照。
 *
 * 设计取舍：
 * - 不重画文字：textarea 自己显示文字。我们只贴 background，避免双重渲染带来的字体回退漂移。
 * - 不处理 IME compositionupdate：composition 期间 mentions 表不变，背景片暂时偏移一两像素可接受。
 * - parentElement 必须有定位上下文（relative/absolute/fixed）；我们在 mounted 时主动设置一次。
 */
import { onBeforeUnmount, onMounted, ref, watch, nextTick, computed } from "vue";
import type { MentionRange } from "~/composables/useMentionInput";
import type { EmoteRange } from "~/composables/useEmoteInsert";
import { useEmotes } from "~/composables/useEmotes";

const props = defineProps<{
  /** 目标 textarea 元素；为空时不渲染 */
  target: HTMLTextAreaElement | null;
  /** 与 textarea v-model 同步的显示串 */
  text: string;
  /** 当前已确认的 mention 真值表 */
  mentions: MentionRange[];
  /** 当前已插入的表情占位区间（可选） */
  emotes?: EmoteRange[];
}>();

const { emoteMap } = useEmotes();

// 用 string-keyed Record 而非具名 interface：tabSize / wordWrap 等在 Vue 的 StyleValue
// 类型里有时不识别，会让 :style 绑定的类型推断失败。
type MirrorStyle = Record<string, string>;

const mirrorStyle = ref<MirrorStyle | null>(null);
const scrollTop = ref(0);
const scrollLeft = ref(0);

let resizeObs: ResizeObserver | null = null;
let scrollHandler: (() => void) | null = null;
let prevParentPos: string | null = null;

/**
 * 把 textarea 的 computed style 关键字段拷到 mirror。
 * 注意 textarea 的 padding 影响 inset，我们让 mirror 的 padding 与 textarea 一致；
 * border 用 *Width 而非 border 简写——border-style/color 不影响布局，省一次 reflow。
 */
function syncStyle() {
  const el = props.target;
  if (!el || typeof window === "undefined") return;
  const cs = window.getComputedStyle(el);
  mirrorStyle.value = {
    font: cs.font,
    letterSpacing: cs.letterSpacing,
    textAlign: cs.textAlign,
    lineHeight: cs.lineHeight,
    paddingTop: cs.paddingTop,
    paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom,
    paddingLeft: cs.paddingLeft,
    borderTopWidth: cs.borderTopWidth,
    borderRightWidth: cs.borderRightWidth,
    borderBottomWidth: cs.borderBottomWidth,
    borderLeftWidth: cs.borderLeftWidth,
    // 关键：textarea 默认 white-space: pre-wrap，wordWrap: break-word；
    // 浏览器实际表现可能是 pre-wrap，复制 cs 即可。
    whiteSpace: cs.whiteSpace || "pre-wrap",
    wordWrap: (cs as unknown as Record<string, string>).wordWrap || "break-word",
    wordBreak: cs.wordBreak,
    overflowWrap: cs.overflowWrap,
    tabSize: cs.tabSize,
    textIndent: cs.textIndent,
    boxSizing: cs.boxSizing,
  };
}

function syncScroll() {
  const el = props.target;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  scrollLeft.value = el.scrollLeft;
}

/**
 * 切分为 text/mention 段。与 useMentionInput 内的 splitDisplayWithMentions 同形态，
 * 但本组件作用对象是 props.text + props.mentions，独立切，避免组件间耦合 prop 形状。
 */
const segments = computed(() => {
  const text = props.text || "";
  const ranges: Array<{ start: number; end: number; type: "mention" | "emote"; code?: string }> = [
    ...(props.mentions || []).map((m) => ({ start: m.start, end: m.end, type: "mention" as const })),
    ...(props.emotes || []).map((r) => ({ start: r.start, end: r.end, type: "emote" as const, code: r.code })),
  ];
  if (!ranges.length) return [{ type: "text" as const, value: text }];
  const sorted = ranges.sort((a, b) => a.start - b.start);
  const out: Array<{ type: "text" | "mention" | "emote"; value: string; code?: string }> = [];
  let cursor = 0;
  for (const m of sorted) {
    if (m.start < cursor) continue;
    if (m.start > cursor) out.push({ type: "text", value: text.slice(cursor, m.start) });
    out.push({ type: m.type, value: text.slice(m.start, m.end), code: m.code });
    cursor = m.end;
  }
  if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
  return out;
});

const emoteUrl = (code?: string) => (code ? emoteMap.value.get(code)?.url : undefined);

const teleportTarget = computed(() => props.target?.parentElement ?? null);

onMounted(() => {
  const el = props.target;
  if (!el) return;
  // 父元素必须建立定位上下文，否则 absolute overlay 会跑到祖先级别。
  // 在 unmount 时回滚，避免污染外部样式。
  const parent = el.parentElement;
  if (parent) {
    const cs = window.getComputedStyle(parent);
    if (cs.position === "static") {
      prevParentPos = parent.style.position;
      parent.style.position = "relative";
    }
  }

  syncStyle();
  syncScroll();

  scrollHandler = () => syncScroll();
  el.addEventListener("scroll", scrollHandler, { passive: true });

  if (typeof ResizeObserver !== "undefined") {
    resizeObs = new ResizeObserver(() => {
      syncStyle();
      syncScroll();
    });
    resizeObs.observe(el);
  }
});

onBeforeUnmount(() => {
  if (scrollHandler && props.target) {
    props.target.removeEventListener("scroll", scrollHandler);
  }
  scrollHandler = null;
  if (resizeObs) {
    resizeObs.disconnect();
    resizeObs = null;
  }
  if (prevParentPos !== null && props.target?.parentElement) {
    props.target.parentElement.style.position = prevParentPos;
    prevParentPos = null;
  }
});

// 目标变更（路由切换 / 弹窗关开等）时重新同步
watch(
  () => props.target,
  () => {
    nextTick(() => {
      syncStyle();
      syncScroll();
    });
  },
);
</script>

<template>
  <Teleport v-if="teleportTarget" :to="teleportTarget">
    <!-- 整个 mirrorStyle 是从 textarea computed style 拷过来的 string map，
         直接当 :style 用；Vue 的 StyleValue 类型对 tabSize / wordWrap 不友好，
         统一过一次类型断言（mirrorStyle as any）即可。 -->
    <div
      v-if="mirrorStyle"
      class="ik-mention-overlay"
      :style="(mirrorStyle as any)"
      aria-hidden="true"
    >
      <div
        class="ik-mention-overlay__inner"
        :style="{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }"
      >
        <template v-for="(seg, i) in segments" :key="i">
          <span v-if="seg.type === 'mention'" class="ik-mention-overlay__hit">{{ seg.value }}</span>
          <!-- 表情占位区间：textarea 里是两个 EM SPACE（不可见），
               这里在同一区间上绝对定位画出表情图片 -->
          <span v-else-if="seg.type === 'emote'" class="ik-mention-overlay__emote">{{ seg.value }}<img
            v-if="emoteUrl(seg.code)"
            :src="emoteUrl(seg.code)"
            alt=""
            class="ik-mention-overlay__emote-img"
            draggable="false"
          /></span>
          <template v-else>{{ seg.value }}</template>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ik-mention-overlay {
  /* 与 textarea 同位置：absolute + inset 0；border-style 留默认透明 */
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* 隐藏自身溢出，让 inner 的 transform 模拟 textarea scroll 不会越界 */
  overflow: hidden;
  /* 文字层全透明；只让背景色生效 */
  color: transparent;
  /* 与 textarea 默认行为一致：单词换行 */
  border-style: solid;
  border-color: transparent;
  /* 关键：z-index 不指定，依赖 textarea 默认 z 序：
     textarea 自身画在 overlay 之后，文字会盖住我们的 mirror 透明文字；
     我们的 mention 背景片在文字下层显示成"高亮底色"。 */
  background: transparent;
  user-select: none;
  /* 与 textarea 一致的滚动 / 折行行为已通过 inline style 设置 */
}

.ik-mention-overlay__inner {
  /* 高度与 textarea 内容一致；transform 跟随 textarea scroll */
  width: 100%;
  /* white-space 等继承自父级 inline style；这里只控制 box */
  will-change: transform;
}

.ik-mention-overlay__emote {
  position: relative;
  display: inline;
}

.ik-mention-overlay__emote-img {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 1.9em;
  height: 1.9em;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-mention-overlay__hit {
  /* 半透明黄绿，与项目主题色 #BFFF09 一致 */
  background-color: rgba(215, 255, 0, 0.22);
  border-radius: 3px;
  /* 让背景在内联文字段两端微微外扩，更像芯片 */
  box-shadow: 0 0 0 1px rgba(215, 255, 0, 0.18);
}
</style>
