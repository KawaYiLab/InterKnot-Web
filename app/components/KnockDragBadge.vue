<script setup lang="ts">
import type { CSSProperties } from "vue";
/**
 * QQ 风格「可拖拽未读红点」。
 *
 * 交互：
 * - 轻点（未超过滑动阈值）：不拦截，交给父级按钮的原生 click（打开敲敲）。
 * - 拖动：红点脱离原位跟随手指，与原点之间保持一条弹性「拖尾」（metaball 带）。
 *   - 拖动距离未超过断裂阈值即松手 → 丝滑吸附弹回原位，不清除。
 *   - 拖动距离超过断裂阈值（拖尾断开）后松手 → 红点炸裂消失并触发 `clear`。
 *
 * 组件根节点即原位红点本体，父级通过传入 class 控制其定位（沿用现有 badge 定位样式）。
 * 拖拽层通过 Teleport 挂到 body，覆盖全屏，避免被 header/tab 的 overflow 裁剪。
 */
const props = defineProps<{
  /** 红点文案（空串表示无未读，父级应以 v-if 决定是否渲染本组件） */
  label: string;
}>();

const emit = defineEmits<{
  /** 拖拽脱离并松手后触发：父级应执行「全部已读」清零 */
  (e: "clear"): void;
}>();

/** 开始判定为拖拽的位移阈值（px） */
const SLOP = 6;
/** 拖尾断裂距离（px）：超过即视为「已脱离」，松手将清除 */
const BREAK = 82;
/** 吸附弹回动画时长（ms） */
const SPRING_MS = 380;
/** 炸裂动画时长（ms），需与 CSS keyframes 对齐 */
const BURST_MS = 420;

const prefersReducedMotion =
  import.meta.client &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const anchorEl = ref<HTMLElement | null>(null);

const active = ref(false); // 拖拽层是否挂载
const dragging = ref(false); // 已越过 SLOP，进入拖拽
const hidden = ref(false); // 隐藏原位红点（拖拽层接管显示）
const broken = ref(false); // 拖尾是否已断裂（粘滞：一旦断裂不再复原）
const bursting = ref(false); // 播放炸裂动画

const origin = reactive({ x: 0, y: 0 });
const pos = reactive({ x: 0, y: 0 });
const vw = ref(0);
const vh = ref(0);
const bubbleR = ref(9);

let pointerId: number | null = null;
let startX = 0;
let startY = 0;
let springRAF: number | null = null;

const distance = computed(() =>
  Math.hypot(pos.x - origin.x, pos.y - origin.y),
);

/** 原点圆半径：随拉伸线性收缩，断裂后为 0 */
const originR = computed(() => {
  if (broken.value) return 0;
  const t = Math.min(1, distance.value / BREAK);
  return Math.max(0, bubbleR.value * (1 - t * 0.85));
});

const showTether = computed(
  () => active.value && !broken.value && !bursting.value && distance.value > 1,
);

/** metaball 弹性带路径：连接原点圆与跟随气泡 */
const tetherPath = computed(() => {
  const dx = pos.x - origin.x;
  const dy = pos.y - origin.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return "";
  const nx = -dy / d;
  const ny = dx / d;
  const ra = originR.value;
  const rb = bubbleR.value;
  const cx = (origin.x + pos.x) / 2;
  const cy = (origin.y + pos.y) / 2;
  const a1x = origin.x + nx * ra;
  const a1y = origin.y + ny * ra;
  const a2x = origin.x - nx * ra;
  const a2y = origin.y - ny * ra;
  const b1x = pos.x + nx * rb;
  const b1y = pos.y + ny * rb;
  const b2x = pos.x - nx * rb;
  const b2y = pos.y - ny * rb;
  return `M${a1x},${a1y} Q${cx},${cy} ${b1x},${b1y} L${b2x},${b2y} Q${cx},${cy} ${a2x},${a2y} Z`;
});

const bubbleStyle = computed<CSSProperties>(() => ({
  "--x": `${pos.x}px`,
  "--y": `${pos.y}px`,
}));

function onPointerDown(e: PointerEvent) {
  if (!props.label || bursting.value) return;
  if (e.button !== undefined && e.button !== 0) return;
  const el = anchorEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  origin.x = rect.left + rect.width / 2;
  origin.y = rect.top + rect.height / 2;
  pos.x = origin.x;
  pos.y = origin.y;
  bubbleR.value = Math.max(8, rect.height / 2);
  vw.value = window.innerWidth;
  vh.value = window.innerHeight;
  startX = e.clientX;
  startY = e.clientY;
  pointerId = e.pointerId;
  broken.value = false;
  if (springRAF !== null) {
    cancelAnimationFrame(springRAF);
    springRAF = null;
  }
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(e: PointerEvent) {
  if (pointerId !== null && e.pointerId !== pointerId) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  if (!dragging.value) {
    if (Math.hypot(dx, dy) < SLOP) return;
    dragging.value = true;
    active.value = true;
    hidden.value = true;
  }
  e.preventDefault();
  pos.x = e.clientX;
  pos.y = e.clientY;
  if (!broken.value && distance.value >= BREAK) broken.value = true;
}

function onPointerUp(e: PointerEvent) {
  if (pointerId !== null && e.pointerId !== pointerId) return;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  pointerId = null;

  if (!dragging.value) {
    reset();
    return;
  }
  dragging.value = false;
  // 拖拽结束：抑制紧随其后的 click，避免误触打开敲敲
  suppressNextClick();

  if (broken.value) burst();
  else springBack();
}

function suppressNextClick() {
  const handler = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    window.removeEventListener("click", handler, true);
  };
  window.addEventListener("click", handler, true);
  window.setTimeout(() => window.removeEventListener("click", handler, true), 400);
}

function springBack() {
  if (prefersReducedMotion) {
    reset();
    return;
  }
  const fromX = pos.x;
  const fromY = pos.y;
  const toX = origin.x;
  const toY = origin.y;
  const start = performance.now();
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const easeOutBack = (t: number) =>
    1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / SPRING_MS);
    const k = easeOutBack(t);
    pos.x = fromX + (toX - fromX) * k;
    pos.y = fromY + (toY - fromY) * k;
    if (t < 1) {
      springRAF = requestAnimationFrame(step);
    } else {
      springRAF = null;
      reset();
    }
  };
  springRAF = requestAnimationFrame(step);
}

function burst() {
  if (prefersReducedMotion) {
    emit("clear");
    reset();
    return;
  }
  bursting.value = true;
  window.setTimeout(() => {
    emit("clear");
    reset();
  }, BURST_MS);
}

function reset() {
  active.value = false;
  dragging.value = false;
  hidden.value = false;
  broken.value = false;
  bursting.value = false;
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  if (springRAF !== null) cancelAnimationFrame(springRAF);
});
</script>

<template>
  <span
    ref="anchorEl"
    class="knock-drag-badge"
    :class="{ 'is-hidden': hidden }"
    @pointerdown="onPointerDown"
    >{{ label }}</span
  >

  <Teleport v-if="active" to="body">
    <div class="knock-drag-layer" aria-hidden="true">
      <svg
        v-if="showTether"
        class="knock-drag-svg"
        :width="vw"
        :height="vh"
        :viewBox="`0 0 ${vw} ${vh}`"
      >
        <path :d="tetherPath" fill="#ff3838" />
        <circle
          v-if="originR > 0.5"
          :cx="origin.x"
          :cy="origin.y"
          :r="originR"
          fill="#ff3838"
        />
      </svg>
      <span
        class="knock-drag-bubble"
        :class="{ 'is-burst': bursting }"
        :style="bubbleStyle"
        >{{ label }}</span
      >
    </div>
  </Teleport>
</template>

<style scoped>
.knock-drag-badge {
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.knock-drag-badge.is-hidden {
  visibility: hidden;
}

.knock-drag-layer {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
}

.knock-drag-svg {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
}

.knock-drag-bubble {
  position: fixed;
  top: 0;
  left: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #ff3838;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  will-change: transform;
  transform: translate(var(--x, 0), var(--y, 0)) translate(-50%, -50%);
}

.knock-drag-bubble.is-burst {
  animation: knock-burst 420ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes knock-burst {
  0% {
    transform: translate(var(--x, 0), var(--y, 0)) translate(-50%, -50%)
      scale(1);
    opacity: 1;
    filter: brightness(1);
  }
  35% {
    transform: translate(var(--x, 0), var(--y, 0)) translate(-50%, -50%)
      scale(1.35);
    opacity: 1;
    filter: brightness(1.4);
  }
  100% {
    transform: translate(var(--x, 0), var(--y, 0)) translate(-50%, -50%)
      scale(0.2);
    opacity: 0;
    filter: brightness(1.7);
  }
}

@media (prefers-reduced-motion: reduce) {
  .knock-drag-bubble.is-burst {
    animation: none;
  }
}
</style>
