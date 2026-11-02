<script setup lang="ts">
import { computed } from "vue";

/**
 * 多图切换器：黑色胶囊里「斜切左键 + 两位页码 + 斜切右键」，样式参照米游社绝区零百科首页轮播。
 * 只负责展示和发出翻页意图，滑动由外层轮播处理。
 */
const props = defineProps<{
  /** 当前页，从 0 开始 */
  index: number;
  total: number;
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
}>();

const label = computed(() => String(props.index + 1).padStart(2, "0"));
const atStart = computed(() => props.index <= 0);
const atEnd = computed(() => props.index >= props.total - 1);
</script>

<template>
  <div class="ik-cover-pager" @click.stop>
    <button
      type="button"
      class="ik-cover-pager__btn ik-cover-pager__btn--prev"
      aria-label="上一张"
      :disabled="atStart"
      @click="emit('prev')"
    >
      <svg viewBox="0 0 30 22" aria-hidden="true">
        <path class="ik-cover-pager__shape" d="M11 1.5H28.5L24.5 20.5H11A9.5 9.5 0 0 1 11 1.5Z" />
        <path class="ik-cover-pager__chevron" d="M15.5 7L11.5 11L15.5 15" />
      </svg>
    </button>
    <span class="ik-cover-pager__num" aria-live="polite" :aria-label="`第 ${index + 1} 张，共 ${total} 张`">{{ label }}</span>
    <button
      type="button"
      class="ik-cover-pager__btn ik-cover-pager__btn--next"
      aria-label="下一张"
      :disabled="atEnd"
      @click="emit('next')"
    >
      <svg viewBox="0 0 30 22" aria-hidden="true">
        <path class="ik-cover-pager__shape" d="M5.5 1.5H19A9.5 9.5 0 0 1 19 20.5H1.5L5.5 1.5Z" />
        <path class="ik-cover-pager__chevron" d="M14.5 7L18.5 11L14.5 15" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.ik-cover-pager {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 2;
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 3px;
  border-radius: 999px;
  background: #000;
  user-select: none;
  -webkit-user-select: none;
}

.ik-cover-pager__btn {
  position: relative;
  display: block;
  width: 30px;
  height: 22px;
  padding: 0;
  border: none;
  background: none;
  cursor: var(--ik-cursor-pointer);
  -webkit-tap-highlight-color: transparent;
}

/* 触屏上按钮只有 22px 高，往外扩一圈点击区域 */
.ik-cover-pager__btn::before {
  content: "";
  position: absolute;
  inset: -8px -4px;
}

.ik-cover-pager__btn svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.ik-cover-pager__shape {
  fill: #d9dadc;
  stroke: #d9dadc;
  stroke-width: 2;
  stroke-linejoin: round;
  transition: fill 120ms ease, stroke 120ms ease;
}

.ik-cover-pager__chevron {
  fill: none;
  stroke: #0e0e0e;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (hover: hover) {
  .ik-cover-pager__btn:not(:disabled):hover .ik-cover-pager__shape {
    fill: var(--ik-primary);
    stroke: var(--ik-primary);
  }
}

.ik-cover-pager__btn:not(:disabled):active .ik-cover-pager__shape {
  fill: var(--ik-primary);
  stroke: var(--ik-primary);
}

.ik-cover-pager__btn:disabled {
  cursor: default;
}

.ik-cover-pager__btn:disabled .ik-cover-pager__shape {
  fill: #5a5b5d;
  stroke: #5a5b5d;
}

.ik-cover-pager__num {
  min-width: 26px;
  margin: 0 2px;
  text-align: center;
  color: rgba(255, 255, 255, 0.48);
  font-family: Impact, "Arial Narrow", "Roboto Condensed", sans-serif-condensed, sans-serif;
  font-size: 20px;
  font-style: italic;
  /* Impact 只有一个字重，不让浏览器再加粗；没有 Impact 的系统退到粗体窄字 */
  font-weight: 700;
  font-synthesis: style;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
</style>
