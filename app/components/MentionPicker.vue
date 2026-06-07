<script setup lang="ts">
/**
 * @ 候选下拉。纯展示组件，所有交互（搜索 / 防抖 / 键盘导航 / 选中插入）
 * 都由父组件通过 useMentionInput composable 控制，本组件只负责渲染和派发选中事件。
 *
 * 浮层定位：父级传入 `anchor` 描述（视口绝对坐标 + 编辑器行高），
 * 内部用 fixed 定位避免被外层 overflow:hidden 截断。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { XCircleIcon } from "@heroicons/vue/24/solid";
import type { MentionCandidate } from "~/composables/useMentionInput";

const props = defineProps<{
  visible: boolean;
  loading?: boolean;
  results: MentionCandidate[];
  activeIndex: number;
  /** 触发位置在视口里的坐标（CSS pixel） */
  anchor: { top: number; left: number; lineHeight: number } | null;
  /** 当 visible=true 但 results 空且非 loading 时的提示文本 */
  emptyText?: string;
}>();

const emit = defineEmits<{
  select: [candidate: MentionCandidate];
  hover: [index: number];
}>();

/**
 * 浮层位置 + 视口自适应。
 * - 默认放在光标行**下方**；底部空间不够就翻到上方
 * - 默认从 anchor.left 开始；右侧空间不够就向左收紧到贴近视口右缘
 * - 翻转时用 picker **实际渲染高度**（actualH），而不是 CSS 上限——
 *   "没有匹配"提示只占 ~40px，按 240 翻会留一大片空白。
 *
 * 宽度常量与下方 CSS 中 width 保持一致——任一边改了都要同步另一边。
 */
const PICKER_W = 280;
const PICKER_MAX_H = 240;
const SAFE_PADDING = 8;

const pickerRootRef = ref<HTMLDivElement | null>(null);
/** picker 当前实际渲染高度。默认按 max 估算；ResizeObserver 挂上后实时刷新 */
const actualH = ref(PICKER_MAX_H);
let resizeObserver: ResizeObserver | null = null;

const styleObj = computed(() => {
  if (!props.anchor) return { display: "none" } as Record<string, string>;
  const a = props.anchor;

  // SSR 安全：拿不到 window 时退化为只用 anchor 原始坐标，留给客户端再次计算覆盖
  const vh = typeof window !== "undefined" ? window.innerHeight : Number.POSITIVE_INFINITY;
  const vw = typeof window !== "undefined" ? window.innerWidth : Number.POSITIVE_INFINITY;
  const h = actualH.value;

  // 垂直：默认放下方；下方空间不够就翻到上方（贴在 anchor 上方 4px）。
  const naturalTop = a.top + a.lineHeight + 4;
  const fitsBelow = naturalTop + h + SAFE_PADDING <= vh;
  const top = fitsBelow
    ? naturalTop
    : Math.max(SAFE_PADDING, a.top - 4 - h);

  // 水平：默认从 anchor.left 开始；右溢出就右对齐到视口右内边距
  const naturalLeft = a.left;
  const fitsRight = naturalLeft + PICKER_W + SAFE_PADDING <= vw;
  const left = fitsRight
    ? Math.max(SAFE_PADDING, naturalLeft)
    : Math.max(SAFE_PADDING, vw - PICKER_W - SAFE_PADDING);

  return {
    top: `${top}px`,
    left: `${left}px`,
  };
});

/**
 * 在 visible 切换或内容变化时挂 / 拆 ResizeObserver。
 * - results / loading 变化都会改变实际高度（hint 一行 vs 满列表），
 *   ResizeObserver 会自动捕捉到，不必再单独 watch。
 * - 不可见时拆掉 observer，不浪费心跳。
 */
const teardownObserver = () => {
  resizeObserver?.disconnect();
  resizeObserver = null;
};

watch(
  () => props.visible,
  async (vis) => {
    if (!vis) {
      teardownObserver();
      // 重置回 max，下次显示时不会用上一次的小高度做翻转判断
      actualH.value = PICKER_MAX_H;
      return;
    }
    if (typeof window === "undefined") return;
    await nextTick();
    const el = pickerRootRef.value;
    if (!el) return;
    actualH.value = el.offsetHeight || PICKER_MAX_H;
    teardownObserver();
    // 直接读 offsetHeight，避免 contentRect 与 padding/border 的换算偏差
    resizeObserver = new ResizeObserver(() => {
      const node = pickerRootRef.value;
      if (!node) return;
      const next = node.offsetHeight;
      if (next > 0) actualH.value = next;
    });
    resizeObserver.observe(el);
  },
  { immediate: true },
);

onBeforeUnmount(teardownObserver);

// 监听键盘选中索引的变化，自动将超出可见范围的选中项滚动入场，保证键盘导航时可见
watch(
  () => props.activeIndex,
  async (idx) => {
    await nextTick();
    const el = pickerRootRef.value;
    if (!el) return;
    const items = el.querySelectorAll(".ik-mention-picker__item");
    const activeItem = items[idx] as HTMLElement | null;
    const container = el.querySelector(".ik-mention-picker__inner") as HTMLElement | null;
    if (!activeItem || !container) return;

    const containerTop = container.scrollTop;
    const containerBottom = containerTop + container.clientHeight;
    const elemTop = activeItem.offsetTop;
    const elemBottom = elemTop + activeItem.offsetHeight;

    if (elemTop < containerTop) {
      container.scrollTop = elemTop;
    } else if (elemBottom > containerBottom) {
      container.scrollTop = elemBottom - container.clientHeight;
    }
  }
);

/**
 * mousedown 而不是 click：避免 textarea 在芯片被点击的瞬间因失焦关闭 picker。
 * preventDefault 阻止 textarea 失焦，焦点继续留在输入框里。
 */
const onItemMouseDown = (e: MouseEvent, candidate: MentionCandidate) => {
  e.preventDefault();
  emit("select", candidate);
};
</script>

<template>
  <Teleport to="body">
    <!--
      双层框：外层灰描边（.ik-mention-picker），内层黑底（.ik-mention-picker__inner）。
      与 KnockKnockModal 的 .ik-dialog__outer / .ik-dialog__inner 同语言，
      但 padding / radius 收得更紧，符合「轻量浮层」尺度。
    -->
    <div
      v-if="visible"
      ref="pickerRootRef"
      class="ik-mention-picker"
      :style="styleObj"
      role="listbox"
      aria-label="提及用户"
    >
      <div class="ik-mention-picker__inner">
        <div v-if="loading && !results.length" class="ik-mention-picker__hint">
          搜索中…
        </div>
        <div
          v-else-if="!results.length"
          class="ik-mention-picker__hint"
        >
          {{ emptyText || "没有匹配的用户" }}
        </div>
        <button
          v-for="(item, idx) in results"
          :key="item.documentId"
          type="button"
          role="option"
          class="ik-mention-picker__item"
          :class="{ 'is-active': idx === activeIndex }"
          :aria-selected="idx === activeIndex"
          @mousedown="onItemMouseDown($event, item)"
          @mouseenter="emit('hover', idx)"
        >
          <span class="ik-mention-picker__avatar">
            <img
              v-if="item.avatar"
              :src="item.avatar"
              :alt="item.name"
              class="ik-mention-picker__avatar-img"
              draggable="false"
            />
            <XCircleIcon v-else class="ik-mention-picker__avatar-icon" />
          </span>
          <span class="ik-mention-picker__text">
            <span class="ik-mention-picker__name">{{ item.name || "匿名用户" }}</span>
            <span v-if="item.username" class="ik-mention-picker__username">
              @{{ item.username }}
            </span>
          </span>
          <span v-if="item.level != null" class="ik-mention-picker__level">
            Lv.{{ item.level }}
          </span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/*
 * 外层：灰描边圈，与帖子弹窗 .ik-dialog__outer 同语言。
 * 自身只承担「定位 + 阴影 + 灰色边框背景」，内容滚动放到 __inner，
 * 这样滚动条不会糊到外圈边框上。
 */
.ik-mention-picker {
  position: fixed;
  z-index: 9999;
  width: 280px;
  padding: 3px;
  background: #2d2c2d;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
}

/* 内层：黑底 + 项目通用的小点纹理（与 .ik-knock__list 一致），形成"黑框灰框"双层观感 */
.ik-mention-picker__inner {
  position: relative;
  background: #050505 url("/images/tab-bg-point.webp") repeat;
  border-radius: 10px;
  padding: 4px;
  max-height: 234px; /* = 外层 max-height(240) - 2*padding(3) */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 自定义滚动条：与 .ik-knock__list / .ik-knock__messages 统一 */
.ik-mention-picker__inner::-webkit-scrollbar {
  width: 4px;
}
.ik-mention-picker__inner::-webkit-scrollbar-track {
  background: transparent;
}
.ik-mention-picker__inner::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}
/* Firefox：narrow 滚动条 + 灰色 thumb */
.ik-mention-picker__inner {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.ik-mention-picker__hint {
  padding: 12px 8px;
  text-align: center;
  font-size: 13px;
  color: #888;
}

.ik-mention-picker__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  width: 100%;
  /* 与 .ik-knock__list-item 同款过渡曲线，hover 时整体颜色一起切换 */
  transition: background-color 140ms ease, color 140ms ease;
}

/*
 * hover / 键盘高亮态：与敲敲弹窗 .ik-knock__list-item.is-active 视觉一致——
 * 整块实底主题色 + 黑字。MentionPicker 里 hover 与 activeIndex 同步，
 * 所以两者用同一组样式即可。
 */
.ik-mention-picker__item:hover,
.ik-mention-picker__item.is-active {
  background-color: #fbfe00;
  color: #000;
}

/* 子元素在选中态下需要单独压成黑系，否则原灰/黄绿色在黄底上不可读 */
.ik-mention-picker__item:hover .ik-mention-picker__name,
.ik-mention-picker__item.is-active .ik-mention-picker__name {
  color: #000;
}

.ik-mention-picker__item:hover .ik-mention-picker__username,
.ik-mention-picker__item.is-active .ik-mention-picker__username {
  color: rgba(0, 0, 0, 0.55);
}

.ik-mention-picker__item:hover .ik-mention-picker__level,
.ik-mention-picker__item.is-active .ik-mention-picker__level {
  color: #000;
}

.ik-mention-picker__avatar {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  overflow: hidden;
  background: #2a2a2a;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ik-mention-picker__avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ik-mention-picker__avatar-icon {
  width: 18px;
  height: 18px;
  color: #555;
}

.ik-mention-picker__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
}

.ik-mention-picker__name {
  font-size: 13px;
  font-weight: 600;
  color: #f0f0f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-mention-picker__username {
  font-size: 11px;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-mention-picker__level {
  font-size: 11px;
  font-weight: 700;
  font-style: italic;
  color: #BFFF09;
  flex-shrink: 0;
}
</style>
