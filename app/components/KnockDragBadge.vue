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
const BREAK = 56;
/** 吸附弹回动画时长（ms） */
const SPRING_MS = 380;
/** 炸裂动画时长（ms），需与 CSS keyframes 对齐 */
const BURST_MS = 420;

const prefersReducedMotion =
  import.meta.client &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const anchorEl = ref<HTMLElement | null>(null);
const bubbleEl = ref<HTMLElement | null>(null);

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

/** burst 期间的文案快照：防止动画播放中 WS 推送新消息导致数字跳变 */
const burstSnapshot = ref("");
/** 实际渲染文案：burst 时冻结，其余时刻跟随 props.label */
const displayLabel = computed(() =>
  bursting.value ? burstSnapshot.value : props.label,
);

let pointerId: number | null = null;
let startX = 0;
let startY = 0;
let springRAF: number | null = null;
let burstTimer: ReturnType<typeof setTimeout> | null = null;

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
  // 拖拽结束：抑制紧随其后的 click，避免误触打开敲敲。
  // 时长按动画路径分别覆盖：burst（炸裂）需覆盖 BURST_MS，springBack（吸附）需覆盖 SPRING_MS，
  // 否则动画收尾的窗口期内点击会穿透打开敲敲弹窗，与红点消失视觉冲突。
  suppressNextClick(broken.value ? BURST_MS + 60 : SPRING_MS + 30);

  if (broken.value) burst();
  else springBack();
}

function suppressNextClick(duration: number) {
  const handler = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    window.removeEventListener("click", handler, true);
  };
  window.addEventListener("click", handler, true);
  window.setTimeout(
    () => window.removeEventListener("click", handler, true),
    duration,
  );
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
  // 冻结文案：炸裂期间 WS 推送新消息不应让气泡数字跳变
  burstSnapshot.value = props.label;
  bursting.value = true;

  // 动画真正结束才清零数据：用 animationend 驱动而非 setTimeout 估算，
  // 消除「setTimeout 先于 CSS animation 结束 → 组件被父级 v-if 卸载 →
  // 动画被腰斩、红点瞬间消失」的时序漂移。
  // finished 标志防止兜底定时器与 animationend 竞态下重复 emit("clear")。
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (burstTimer !== null) {
      clearTimeout(burstTimer);
      burstTimer = null;
    }
    // 先 emit clear：父级 markAllAsRead 同步清零 totalUnread → label 变空 →
    // 组件将在下一 tick 卸载。此时动画已播完，卸载不会切断视觉。
    emit("clear");
    // 兜底：若父级未因 clear 卸载本组件（label 仍有效，例如 totalUnread
    // 已被多端同步清零导致 markAllAsRead 早退），恢复原位红点显示。
    // 不立即 reset 是为了让 bursting 保持 true，bubble 维持 forwards 终态
    // （opacity:0），避免在卸载/恢复之间出现原位红点闪现。
    nextTick(() => {
      if (props.label && bursting.value) reset();
    });
  };

  const el = bubbleEl.value;
  if (el) {
    const onEnd = () => {
      el.removeEventListener("animationend", onEnd);
      finish();
    };
    el.addEventListener("animationend", onEnd);
  }
  // 兜底：animationend 异常未触发时（如动画被取消）强制收尾，+120ms 容差
  burstTimer = setTimeout(finish, BURST_MS + 120);
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
  if (burstTimer !== null) {
    clearTimeout(burstTimer);
    burstTimer = null;
  }
});
</script>

<template>
  <span
    ref="anchorEl"
    class="knock-drag-badge"
    :class="{ 'is-hidden': hidden }"
    @pointerdown="onPointerDown"
    >{{ displayLabel
    }}<Teleport v-if="active" to="body">
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
          ref="bubbleEl"
          class="knock-drag-bubble"
          :class="{ 'is-burst': bursting }"
          :style="bubbleStyle"
          >{{ displayLabel }}</span
        >
      </div>
    </Teleport></span
  >
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
