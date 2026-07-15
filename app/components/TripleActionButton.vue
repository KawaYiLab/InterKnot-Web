<script setup lang="ts">
import { HandThumbUpIcon } from "@heroicons/vue/24/outline";
import { HandThumbUpIcon as HandThumbUpIconSolid, StarIcon as StarIconSolid } from "@heroicons/vue/24/solid";

/**
 * B 站风格「长按点赞 → 一键三连」触发器。
 *
 * 职责：仅做手势识别 + 蓄力/迸发动画，不发请求。
 * - 短按（松手时未达 HOLD_MS 且未越过 SLOP）→ emit('like')：父级走原 toggleLike。
 * - 长按（按住 HOLD_MS，圆环填满）→ emit('triple') + 迸发动画：父级走 tripleAction。
 * - canTriple=false（本人委托 / 未登录）时禁用长按，短按照常（父级内部再判登录）。
 *
 * 指针 / suppressNextClick / prefers-reduced-motion 的处理与 KnockDragBadge 同范式。
 */

const props = defineProps<{
  liked?: boolean;
  likesCount: number;
  canTriple: boolean; // = 已登录 && !isOwner
  busy?: boolean; // 三连请求进行中，禁重复
  /** 计数兜底文案，与同栏其它按钮风格一致 */
  fallback?: string;
}>();

const emit = defineEmits<{
  (e: "like"): void;
  (e: "triple"): void;
  (e: "charge", payload: { progress: number; active: boolean }): void;
}>();

/** 按下后延迟多久才开始显示三连蓄力动画（ms）。避免短按误出圆环 */
const WARMUP_MS = 400;
/** 蓄力圆环从出现到充满的时长（ms）。圆环填满时触发三连 */
const CHARGE_MS = 1300;
/** 从按下到三连触发的总时长 = WARMUP_MS + CHARGE_MS */
const TRIGGER_MS = WARMUP_MS + CHARGE_MS;
/** 开始判定为拖动/滚动的位移阈值（px），超过即取消长按 */
const SLOP = 8;
/** 迸发动画时长（ms），需与 CSS keyframes 对齐 */
const BURST_MS = 620;

const prefersReducedMotion =
  import.meta.client &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const btnEl = ref<HTMLElement | null>(null);

const holding = ref(false); // 正在长按蓄力
const progress = ref(0); // 0..1 圆环填充进度
const bursting = ref(false); // 迸发动画播放中

let pointerId: number | null = null;
let startX = 0;
let startY = 0;
let warmupTimer: ReturnType<typeof setTimeout> | null = null;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let rafId: number | null = null;
let burstTimer: ReturnType<typeof setTimeout> | null = null;
let moved = false; // pointermove 是否越过 SLOP（视为滚动）
let triggered = false;
let burstOriginX = 0; // 迸发起点 X（按钮中心）
let burstOriginY = 0; // 迸发起点 Y（按钮中心）

const emitCharge = () => {
  emit("charge", {
    progress: holding.value ? progress.value : 0,
    active: holding.value,
  });
};

watch([progress, holding], emitCharge, { flush: "sync" });

function clearHold() {
  if (warmupTimer !== null) {
    clearTimeout(warmupTimer);
    warmupTimer = null;
  }
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function startWarmup() {
  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    if (moved || pointerId === null) return;
    if (prefersReducedMotion) {
      triggerTriple();
    } else {
      startCharge();
    }
  }, WARMUP_MS);
}

function startCharge() {
  holding.value = true;
  progress.value = 0;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / CHARGE_MS);
    progress.value = t;
    if (t < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      rafId = null;
      triggerTriple();
    }
  };
  rafId = requestAnimationFrame(step);
}

function triggerTriple() {
  triggered = true;
  clearHold();
  progress.value = 1;
  holding.value = false;
  // 抑制松手后紧随的 click，避免短按逻辑误触发
  suppressNextClick(BURST_MS + 60);
  if (import.meta.client && navigator.vibrate) {
    try {
      navigator.vibrate(15);
    } catch {
      /* ignore */
    }
  }
  // 计算迸发起点（按钮中心），供 burst 图标定位
  const rect = btnEl.value?.getBoundingClientRect();
  if (rect) {
    burstOriginX = rect.left + rect.width / 2;
    burstOriginY = rect.top + rect.height / 2;
  }
  emit("triple");
  if (prefersReducedMotion) {
    progress.value = 0;
    return;
  }
  bursting.value = true;
  burstTimer = setTimeout(finishBurst, BURST_MS + 60);
}

function finishBurst() {
  bursting.value = false;
  progress.value = 0;
  if (burstTimer !== null) {
    clearTimeout(burstTimer);
    burstTimer = null;
  }
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== undefined && e.button !== 0) return;
  if (props.busy) return;
  triggered = false;
  startX = e.clientX;
  startY = e.clientY;
  moved = false;
  pointerId = e.pointerId;

  if (props.canTriple) {
    // 先进入预热：预热期间不显示圆环，避免短按误出三连动画
    startWarmup();
  }

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(e: PointerEvent) {
  if (pointerId !== null && e.pointerId !== pointerId) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  if (Math.hypot(dx, dy) >= SLOP) {
    moved = true;
    cancelHold();
  }
}

function cancelHold() {
  clearHold();
  holding.value = false;
  // 回弹：让进度归零（CSS transition 抚平）
  progress.value = 0;
}

function onPointerUp(e: PointerEvent) {
  if (pointerId !== null && e.pointerId !== pointerId) return;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  const wasCancel = e.type === "pointercancel";
  clearHold();
  holding.value = false;
  progress.value = 0;
  pointerId = null;

  // 未触发三连、且未拖动 → 视为短按点赞
  if (!triggered && !moved && !wasCancel) {
    emit("like");
  }
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

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  clearHold();
  if (burstTimer !== null) {
    clearTimeout(burstTimer);
    burstTimer = null;
  }
});
</script>

<template>
  <button
    ref="btnEl"
    type="button"
    class="ik-triple"
    :class="{
      'ik-engage-bar__action': true,
      'ik-engage-bar__action--active': liked,
      'is-holding': holding,
      'is-bursting': bursting,
    }"
    :disabled="busy"
    :title="canTriple ? '长按一键三连' : '点赞'"
    @pointerdown="onPointerDown"
    @contextmenu.prevent
  >
    <span class="ik-triple__inner">
      <span class="ik-triple__icon-shell">
        <HandThumbUpIconSolid v-if="liked" class="ik-engage-icon" aria-hidden="true" />
        <HandThumbUpIcon v-else class="ik-engage-icon" aria-hidden="true" />
        <TripleChargeRing :progress="progress" :show="holding" />
      </span>
      <IkRollingDigit :value="likesCount" :fallback="fallback" />
    </span>

    <!-- 三连迸发：👍 / 丁尼 / ⭐ -->
    <Teleport v-if="bursting" to="body">
      <div class="ik-triple__burst-layer" aria-hidden="true">
        <span
          class="ik-triple__burst ik-triple__burst--like"
          :style="{ '--tx': burstOriginX + 'px', '--ty': burstOriginY + 'px' }"
        >
          <HandThumbUpIconSolid class="ik-triple__burst-icon" />
        </span>
        <span
          class="ik-triple__burst ik-triple__burst--coin"
          :style="{ '--tx': burstOriginX + 'px', '--ty': burstOriginY + 'px' }"
        >
          <img src="/images/materials/dennies_v2.webp" alt="" />
        </span>
        <span
          class="ik-triple__burst ik-triple__burst--star"
          :style="{ '--tx': burstOriginX + 'px', '--ty': burstOriginY + 'px' }"
        >
          <StarIconSolid class="ik-triple__burst-icon" />
        </span>
      </div>
    </Teleport>
  </button>
</template>

<style scoped>
/* 图标尺寸在父页面的 scoped CSS 里定义，无法穿透进本子组件，需在此重申 */
.ik-engage-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.ik-triple {
  position: relative;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

.ik-triple__inner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ik-triple__icon-shell {
  position: relative;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
}

/* 蓄力时按钮轻微缩放反馈 */
.ik-triple.is-holding {
  transform: scale(0.94);
  transition: transform 80ms ease;
}

.ik-triple:not(.is-holding) {
  transition: transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 迸发层：挂在 body，相对按钮定位 */
.ik-triple__burst-layer {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
}

.ik-triple__burst {
  position: fixed;
  top: 0;
  left: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ik-primary, #BFFF09);
  will-change: transform, opacity;
}

.ik-triple__burst-icon {
  width: 100%;
  height: 100%;
}

.ik-triple__burst img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* 三枚图标各自抛物线轨迹；起始位置由 JS 在触发时设置（这里用 CSS 变量兜底） */
.ik-triple__burst--like {
  --bx: -28px;
  --by: -42px;
  animation: ik-triple-burst 620ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.ik-triple__burst--coin {
  --bx: 0px;
  --by: -52px;
  animation: ik-triple-burst 620ms cubic-bezier(0.22, 1, 0.36, 1) 40ms forwards;
}

.ik-triple__burst--star {
  --bx: 28px;
  --by: -42px;
  animation: ik-triple-burst 620ms cubic-bezier(0.22, 1, 0.36, 1) 80ms forwards;
}

@keyframes ik-triple-burst {
  0% {
    transform: translate(var(--tx), var(--ty)) translate(-50%, -50%) scale(0.6);
    opacity: 0;
  }
  25% {
    opacity: 1;
    transform: translate(calc(var(--tx) + var(--bx) * 0.5), calc(var(--ty) + var(--by) * 0.5)) translate(-50%, -50%) scale(1.2);
  }
  100% {
    transform: translate(calc(var(--tx) + var(--bx)), calc(var(--ty) + var(--by))) translate(-50%, -50%) scale(0.6);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-triple__ring,
  .ik-triple__burst-layer {
    display: none;
  }
  .ik-triple.is-holding {
    transform: none;
  }
}
</style>
