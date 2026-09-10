<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

/**
 * Fairy Mascot Big-Eye Animation Component
 *
 * 纯 SVG + CSS 复合层硬件加速 + 仿生交错呼吸 + CRT 电磁置换撕裂 + 两段式状态转场
 */

interface Props {
  /** 表情状态机：normal 待机 | thinking 思考眯眼 | comforting 温柔关怀 */
  state?: "normal" | "thinking" | "comforting";
  /** 呈现形态：hero 居中欢迎舞台 | watermark 半透明背景水印 */
  mode?: "hero" | "watermark";
  /** 是否允许鼠标悬停/点击交互触发故障微颤 */
  interactive?: boolean;
  /** 低功耗模式：关闭滤镜与高开销阴影，保证低端机流畅 */
  lowPower?: boolean;
  /** 自定义外框尺寸（CSS 尺寸字符串，如 '280px', 'min(60%, 28vh)'） */
  size?: string;
}

const props = withDefaults(defineProps<Props>(), {
  state: "normal",
  mode: "hero",
  interactive: false,
  lowPower: false,
  size: undefined,
});

const emit = defineEmits<{
  (e: "click", event: MouseEvent): void;
}>();

const rootRef = ref<HTMLElement | null>(null);

// 唯一 ID 前缀，防止同一页面多实例时 SVG defs ID 冲突
const uid = "f-" + Math.random().toString(36).slice(2, 7);

// 几何常数定义
const outerDiscRadius = 68;
const outerStrokeWidth = 1.2;
const outerHaloRadius = 79;
const scleraRadius = 48;
const scleraContactStrokeWidth = 0.8;
const scleraHaloRadius = 56;
const pupilRadius = 16;
const highlightCenter = { x: 98, y: 100.5 };
const highlightRadius = 11;
const highlightHaloRadius = 18;
const outerVisibleEdge = outerDiscRadius + outerStrokeWidth / 2;
const scleraVisibleEdge = scleraRadius + scleraContactStrokeWidth / 2;
const outerHaloPeak = (outerVisibleEdge / outerHaloRadius).toFixed(3);
const scleraHaloPeak = (scleraVisibleEdge / scleraHaloRadius).toFixed(3);
const highlightHaloPeak = (highlightRadius / highlightHaloRadius).toFixed(3);

// 预计算正弦波光晕路径（极度精简为多段线，避免成百上千 DOM 节点）
function buildHaloPaths() {
  const map = new Map<string, string[]>();
  for (let y = -34; y <= 194; y += 1) {
    const t = y + 34;
    const leftWave = (Math.sin(t * 0.082 - 1.1) + 0.55 * Math.sin(t * 0.151 + 2.4) + 1.55) / 3.1;
    const rightWave = (Math.sin(t * 0.097 + 2.2) + 0.5 * Math.sin(t * 0.137 - 1.7) + 1.5) / 3;
    const leftLength = 158 + leftWave * 56;
    const rightLength = 158 + rightWave * 56;
    const length = leftLength + rightLength;
    const brightness = 0.5 + (leftWave + rightWave) * 0.25;
    const x = 80 - leftLength;
    const bucket = Math.max(0.5, Math.min(1, Math.round(brightness * 8) / 8));
    const key = bucket.toFixed(3);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(`M${x.toFixed(2)} ${(y + 0.25).toFixed(2)}h${length.toFixed(2)}`);
  }
  return Array.from(map.entries()).map(([opacity, dList]) => ({
    opacity,
    d: dList.join(""),
  }));
}

const haloPaths = buildHaloPaths();

// ── 故障状态（Glitch）与转场（Transition）动效控制器 ──
const activeGlitch = ref<"threads" | "blocks" | null>(null);
const isTransitionGlitch = ref(false);
const transitionBurstMode = ref<"threads" | "blocks">("threads");
const isFlickering = ref(false);

const glitchStyles = ref<Record<string, string>>({});
const flickerStyles = ref<Record<string, string>>({});

// 动态 SVG 滤镜参数
const turbulenceSeed = ref(1);
const turbulenceFreq = ref("0.012 0.72");
const displacementScale = ref(5);

interface SliceRect {
  y: number;
  h: number;
}
type SliceRectsTuple = [SliceRect, SliceRect, SliceRect, SliceRect, SliceRect];

// 5 组动态 block 切片布局
const sliceRects = ref<SliceRectsTuple>([
  { y: 12, h: 25 },
  { y: 37, h: 28 },
  { y: 65, h: 26 },
  { y: 91, h: 30 },
  { y: 121, h: 27 },
]);

let glitchTimer: ReturnType<typeof setTimeout> | null = null;
let autoGlitchInterval: ReturnType<typeof setTimeout> | null = null;
let flickerTimer: ReturnType<typeof setTimeout> | null = null;
let stateTransitionToken = 0;
let transitionTimers: ReturnType<typeof setTimeout>[] = [];

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/** 锁定眼睫旋转相位，使 5 个 blocks 切片帧完全一致 */
function lockLashFrame() {
  if (typeof window === "undefined" || !rootRef.value) return;
  const corners = rootRef.value.querySelector(".ik-fairy-image .ik-fairy-corners");
  if (!corners) return;
  const transform = window.getComputedStyle(corners).transform;
  let angle = 0;
  const match = transform && transform.match(/^matrix\(([^)]+)\)$/);
  if (match && match[1]) {
    const values = match[1].split(",");
    const a = parseFloat(values[0] || "1");
    const b = parseFloat(values[1] || "0");
    if (Number.isFinite(a) && Number.isFinite(b)) {
      angle = (Math.atan2(b, a) * 180) / Math.PI;
    }
  }
  const normalized = (angle + 360) % 360;
  glitchStyles.value["--dsh-lash-angle"] = `${normalized.toFixed(3)}deg`;
  glitchStyles.value["--dsh-lash-delay"] = `${((-normalized / 360) * 15).toFixed(4)}s`;
}

/** 构建 5 个微不规则 block 切片高度 */
function setBlockLayout() {
  const weights: number[] = [];
  let weightTotal = 0;
  for (let i = 0; i < 5; i += 1) {
    const weight = randomBetween(0.9, 1.1);
    weights.push(weight);
    weightTotal += weight;
  }
  let currentY = 12;
  for (let i = 0; i < 5; i += 1) {
    const height = i === 4 ? 148 - currentY : (136 * weights[i]!) / weightTotal;
    sliceRects.value[i] = {
      y: Number(currentY.toFixed(1)),
      h: Number(height.toFixed(1)),
    };
    currentY += height;
  }
}

/** 生成单次短脉冲电磁形变参数 */
function setGlitchPulse(mode: "threads" | "blocks", isTransition = false) {
  glitchStyles.value["--dsh-g-x"] = `${randomBetween(isTransition ? -1.6 : -0.9, isTransition ? 1.6 : 0.9).toFixed(2)}px`;
  glitchStyles.value["--dsh-g-skew"] = `${randomBetween(isTransition ? -0.32 : -0.24, isTransition ? 0.32 : 0.24).toFixed(2)}deg`;
  glitchStyles.value["--dsh-g-bright"] = randomBetween(isTransition ? 1.06 : 1.02, isTransition ? 1.18 : 1.14).toFixed(2);
  glitchStyles.value["--dsh-g-contrast"] = randomBetween(isTransition ? 1.08 : 1.02, isTransition ? 1.22 : 1.16).toFixed(2);

  if (mode === "threads") {
    // 动态生成噪波场并施加高强度水平电磁位移
    turbulenceSeed.value = Math.floor(randomBetween(1, 999));
    turbulenceFreq.value = `${randomBetween(0.004, 0.011).toFixed(3)} ${randomBetween(isTransition ? 0.78 : 0.65, isTransition ? 1.18 : 1.0).toFixed(2)}`;
    displacementScale.value = Number(randomBetween(isTransition ? 30 : 17, isTransition ? 46 : 29).toFixed(1));
  } else {
    lockLashFrame();
    const slicePolarity = Math.random() < 0.5 ? -1 : 1;
    const sliceStrength = randomBetween(isTransition ? 4.2 : 1.4, isTransition ? 6.8 : 3.0);
    for (let i = 1; i <= 5; i += 1) {
      const direction = i % 2 === 0 ? slicePolarity : -slicePolarity;
      const offset = direction * (sliceStrength + randomBetween(-0.35, 0.35));
      glitchStyles.value[`--dsh-g-s${i}-x`] = `${offset.toFixed(2)}px`;
    }
  }

  activeGlitch.value = mode;
  transitionBurstMode.value = mode;
}

/** 清除故障视觉效果，恢复纯净状态 */
function clearGlitchVisual() {
  activeGlitch.value = null;
  glitchStyles.value = {};
  displacementScale.value = 5;
  turbulenceFreq.value = "0.012 0.72";
}

function clearTransitionTimers() {
  transitionTimers.forEach((t) => clearTimeout(t));
  transitionTimers = [];
}

function stopGlitch() {
  if (glitchTimer) clearTimeout(glitchTimer);
  glitchTimer = null;
  clearTransitionTimers();
  isTransitionGlitch.value = false;
  clearGlitchVisual();
}

/** 
 * Two-Burst 状态转换微故障
 * Burst 1: 2 脉冲 threads 水平置换撕裂 (80ms)
 * 间隔 28ms
 * Burst 2: 2 脉冲 blocks 切片错位 (80ms) + 4 脉冲 threads 强置换 (160ms)
 */
function playStateTransition(_nextState: string) {
  if (props.lowPower) return;
  stopGlitch();
  const token = ++stateTransitionToken;
  isTransitionGlitch.value = true;

  function runBurst(
    pulseCount: number,
    blockPulseCount: number,
    keepVisual: boolean,
    onComplete: () => void
  ) {
    let pulseIndex = 0;
    function pulse() {
      if (token !== stateTransitionToken) return;
      if (pulseIndex < blockPulseCount) {
        if (pulseIndex === 0) setBlockLayout();
        setGlitchPulse("blocks", true);
      } else {
        setGlitchPulse("threads", true);
      }
      pulseIndex += 1;
      if (pulseIndex < pulseCount) {
        const timer = setTimeout(pulse, 40);
        transitionTimers.push(timer);
        return;
      }
      const finishTimer = setTimeout(() => {
        if (token !== stateTransitionToken) return;
        if (!keepVisual) {
          isTransitionGlitch.value = false;
          clearGlitchVisual();
        }
        onComplete();
      }, 28);
      transitionTimers.push(finishTimer);
    }
    pulse();
  }

  // 第一阶段：2 脉冲 threads
  runBurst(2, 0, true, () => {
    if (token !== stateTransitionToken) return;
    // 第二阶段：2 脉冲 blocks + 4 脉冲 threads
    runBurst(6, 2, false, () => {
      if (token !== stateTransitionToken) return;
      isTransitionGlitch.value = false;
      clearGlitchVisual();
      scheduleAutoGlitch();
      scheduleEyeFlicker();
    });
  });
}

/** 触发单次故障微颤（交互或自定义触发） */
function triggerGlitch(type?: "threads" | "blocks", duration?: number) {
  if (props.lowPower || isTransitionGlitch.value) return;
  stopGlitch();

  const selectedType = type || (Math.random() > 0.4 ? "threads" : "blocks");
  const actualDuration = duration || Math.round(randomBetween(140, 240));

  if (selectedType === "blocks") {
    setBlockLayout();
  }
  setGlitchPulse(selectedType, false);

  glitchTimer = setTimeout(() => {
    clearGlitchVisual();
    glitchTimer = null;
  }, actualDuration);
}

/** 周期性自发微故障调度器（待机时每隔 3.5~7.5 秒呼吸式颤动） */
function scheduleAutoGlitch() {
  if (props.lowPower || isTransitionGlitch.value) return;
  const nextDelay = randomBetween(3500, 7500);
  autoGlitchInterval = setTimeout(() => {
    if (document.visibilityState === "visible" && !isTransitionGlitch.value) {
      triggerGlitch(undefined, randomBetween(120, 200));
    }
    scheduleAutoGlitch();
  }, nextDelay);
}

/** 周期性微闪烁调度器（屏幕高光微明暗呼吸） */
function scheduleEyeFlicker() {
  if (props.lowPower || props.state !== "normal" || isTransitionGlitch.value) return;
  const nextDelay = randomBetween(2000, 4500);
  flickerTimer = setTimeout(() => {
    if (document.visibilityState === "visible" && !activeGlitch.value && !isTransitionGlitch.value && props.state === "normal") {
      const duration = Math.round(randomBetween(155, 255));
      flickerStyles.value = {
        "--dsh-fairy-flicker-duration": `${duration}ms`,
        "--dsh-fairy-flicker-opacity-1": randomBetween(0.026, 0.048).toFixed(3),
        "--dsh-fairy-flicker-opacity-mid": randomBetween(0.006, 0.016).toFixed(3),
        "--dsh-fairy-flicker-opacity-2": randomBetween(0.018, 0.04).toFixed(3),
      };
      isFlickering.value = true;
      setTimeout(() => {
        isFlickering.value = false;
        flickerStyles.value = {};
        scheduleEyeFlicker();
      }, duration);
      return;
    }
    scheduleEyeFlicker();
  }, nextDelay);
}

function clearAllTimers() {
  if (glitchTimer) clearTimeout(glitchTimer);
  if (autoGlitchInterval) clearTimeout(autoGlitchInterval);
  if (flickerTimer) clearTimeout(flickerTimer);
  clearTransitionTimers();
  glitchTimer = null;
  autoGlitchInterval = null;
  flickerTimer = null;
}

// 监听状态变迁，触发状态转场动效
watch(
  () => props.state,
  (next, prev) => {
    if (next !== prev) {
      playStateTransition(next);
    }
  }
);

// 页面可见性监听：后台时彻底停止计时器，节约电量与 CPU
function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    clearAllTimers();
  } else {
    scheduleAutoGlitch();
    scheduleEyeFlicker();
  }
}

onMounted(() => {
  scheduleAutoGlitch();
  scheduleEyeFlicker();
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onUnmounted(() => {
  clearAllTimers();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});

// 鼠标交互
function handleClick(e: MouseEvent) {
  if (props.interactive) {
    triggerGlitch(undefined, 260);
  }
  emit("click", e);
}

function handleMouseEnter() {
  if (props.interactive && !activeGlitch.value && !isTransitionGlitch.value) {
    triggerGlitch("threads", 160);
  }
}

// 判定当前是否需要挂载 SVG 电磁置换撕裂滤镜
const hasInterferenceFilter = computed(() => {
  if (props.lowPower) return false;
  if (activeGlitch.value === "threads") return true;
  if (isTransitionGlitch.value && transitionBurstMode.value === "threads") return true;
  return false;
});

defineExpose({
  triggerGlitch,
  playStateTransition,
});
</script>

<template>
  <div
    ref="rootRef"
    class="ik-fairy-mascot"
    :class="[
      `ik-fairy-mascot--${mode}`,
      {
        'is-interactive': interactive,
        'is-low-power': lowPower,
      },
    ]"
    :data-state="state"
    :data-transition-glitch="isTransitionGlitch ? 'true' : undefined"
    :data-burst="transitionBurstMode"
    :style="size ? { width: size, height: size } : undefined"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
  >
    <!-- 外层扩展脉冲光环层（3x 视口 + 浑圆扩散衰减，永不触碰弹窗边缘截断） -->
    <svg
      v-if="!lowPower"
      class="ik-fairy-pulse-layer"
      viewBox="-160 -160 480 480"
      xmlns="http://www.w3.org/2000/svg"
      role="presentation"
      aria-hidden="true"
    >
      <g class="ik-fairy-lash-pulse" fill="none" stroke="#f4fdff">
        <g class="ik-fairy-lash-pulse-wave">
          <circle cx="80" cy="80" r="52" stroke-width="20" stroke-opacity="0.05" />
          <circle cx="80" cy="80" r="52" stroke-width="16" stroke-opacity="0.06" />
          <circle cx="80" cy="80" r="52" stroke-width="12" stroke-opacity="0.08" />
          <circle cx="80" cy="80" r="52" stroke-width="8" stroke-opacity="0.10" />
          <circle cx="80" cy="80" r="4.5" stroke-width="4.5" stroke-opacity="0.09" />
        </g>
      </g>
    </svg>

    <!-- 正弦波阴极辐射光晕层（包含双重径向渐变蒙版，柔和环形辉光） -->
    <svg
      v-if="!lowPower"
      class="ik-fairy-halo-layer"
      viewBox="-180 -70 520 320"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      role="presentation"
      aria-hidden="true"
    >
      <defs>
        <radialGradient
          :id="`${uid}-halo-fade`"
          gradientUnits="userSpaceOnUse"
          color-interpolation="linearRGB"
          cx="80"
          cy="80"
          r="124"
        >
          <stop offset="0" stop-color="#000000" />
          <stop offset="0.44" stop-color="#000000" />
          <stop offset="0.45" stop-color="#ffffff" stop-opacity="0.08" />
          <stop offset="0.46" stop-color="#ffffff" stop-opacity="0.30" />
          <stop offset="0.47" stop-color="#ffffff" stop-opacity="0.65" />
          <stop offset="0.48" stop-color="#ffffff" />
          <stop offset="0.52" stop-color="#ffffff" stop-opacity="0.72" />
          <stop offset="0.56" stop-color="#ffffff" stop-opacity="0.56" />
          <stop offset="0.60" stop-color="#ffffff" stop-opacity="0.44" />
          <stop offset="0.65" stop-color="#ffffff" stop-opacity="0.30" />
          <stop offset="0.71" stop-color="#ffffff" stop-opacity="0.19" />
          <stop offset="0.77" stop-color="#ffffff" stop-opacity="0.135" />
          <stop offset="0.83" stop-color="#ffffff" stop-opacity="0.09" />
          <stop offset="0.89" stop-color="#ffffff" stop-opacity="0.058" />
          <stop offset="0.94" stop-color="#000000" stop-opacity="0.02" />
          <stop offset="1" stop-color="#000000" />
        </radialGradient>
        <mask
          :id="`${uid}-halo-mask`"
          mask-type="luminance"
          maskUnits="userSpaceOnUse"
          maskContentUnits="userSpaceOnUse"
          x="-260"
          y="-120"
          width="680"
          height="440"
        >
          <rect
            x="-260"
            y="-120"
            width="680"
            height="440"
            :fill="`url(#${uid}-halo-fade)`"
          />
        </mask>
      </defs>
      <g class="ik-fairy-halo" :mask="`url(#${uid}-halo-mask)`">
        <path
          v-for="(p, idx) in haloPaths"
          :key="idx"
          :d="p.d"
          fill="none"
          stroke="#c9f8ff"
          stroke-width="0.62"
          stroke-linecap="butt"
          :opacity="Number(p.opacity) * 0.75"
        />
      </g>
    </svg>

    <!-- Fairy 核心眼部矢量主体 -->
    <svg
      class="ik-fairy-main"
      viewBox="0 0 160 160"
      xmlns="http://www.w3.org/2000/svg"
      role="presentation"
    >
      <defs>
        <!-- 外轮廓经典科技蓝渐变 -->
        <linearGradient :id="`${uid}-outer-gradient`" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop stop-color="#4053f0" />
          <stop offset="0.54" stop-color="#3045dc" />
          <stop offset="1" stop-color="#3d50c8" />
        </linearGradient>

        <!-- 巩膜白光晕 -->
        <radialGradient
          :id="`${uid}-sclera-halo`"
          gradientUnits="userSpaceOnUse"
          cx="80"
          cy="80"
          :r="scleraHaloRadius"
        >
          <stop offset="0.82" stop-color="#ffffff" stop-opacity="0" />
          <stop :offset="scleraHaloPeak" stop-color="#ffffff" stop-opacity="0.22" />
          <stop offset="0.875" stop-color="#ffffff" stop-opacity="0.28" />
          <stop offset="0.89" stop-color="#ffffff" stop-opacity="0.19" />
          <stop offset="0.91" stop-color="#ffffff" stop-opacity="0.11" />
          <stop offset="0.94" stop-color="#ffffff" stop-opacity="0.07" />
          <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
        </radialGradient>

        <!-- 最外圈高光微晕 -->
        <radialGradient
          :id="`${uid}-outer-halo`"
          gradientUnits="userSpaceOnUse"
          cx="80"
          cy="80"
          :r="outerHaloRadius"
        >
          <stop offset="0.80" stop-color="#c9f8ff" stop-opacity="0" />
          <stop offset="0.84" stop-color="#c9f8ff" stop-opacity="0.10" />
          <stop :offset="outerHaloPeak" stop-color="#c9f8ff" stop-opacity="0.28" />
          <stop offset="0.90" stop-color="#c9f8ff" stop-opacity="0.18" />
          <stop offset="0.95" stop-color="#c9f8ff" stop-opacity="0.06" />
          <stop offset="1" stop-color="#c9f8ff" stop-opacity="0" />
        </radialGradient>

        <!-- 瞳孔反光点微晕 -->
        <radialGradient
          :id="`${uid}-highlight-halo`"
          gradientUnits="userSpaceOnUse"
          :cx="highlightCenter.x"
          :cy="highlightCenter.y"
          :r="highlightHaloRadius"
        >
          <stop offset="0.53" stop-color="#f5f8fd" stop-opacity="0" />
          <stop :offset="highlightHaloPeak" stop-color="#f5f8fd" stop-opacity="0.43" />
          <stop offset="0.77" stop-color="#f5f8fd" stop-opacity="0.12" />
          <stop offset="1" stop-color="#f5f8fd" stop-opacity="0" />
        </radialGradient>

        <!-- 4x4 扫描线纹理 -->
        <pattern :id="`${uid}-lines`" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill="#c9f8ff" opacity="0.055" />
        </pattern>

        <!-- 显像管横向电磁置换撕裂滤镜（纯横向高强度 displacement） -->
        <filter
          :id="`${uid}-interference`"
          x="-30%"
          y="0%"
          width="160%"
          height="100%"
          filterRes="96 72"
          color-interpolation-filters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            :baseFrequency="turbulenceFreq"
            numOctaves="1"
            :seed="turbulenceSeed"
            result="noise"
          />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 0 0 .5  0 0 0 1 0"
            result="horizontal-noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="horizontal-noise"
            :scale="displacementScale"
            xChannelSelector="R"
            yChannelSelector="B"
          />
        </filter>

        <!-- 圆盘裁切 -->
        <clipPath :id="`${uid}-disc-clip`">
          <circle cx="80" cy="80" :r="outerDiscRadius - 1" />
        </clipPath>

        <!-- 思考状态微眯眼裁切（向下弯曲，平滑下压过渡） -->
        <clipPath :id="`${uid}-thinking-clip`">
          <path class="ik-fairy-thinking-clip-shape" d="M20 60 Q80 90 140 60 V160 H20 Z" />
          <rect x="0" y="108" width="160" height="52" />
        </clipPath>

        <!-- 安慰状态温柔眉眼裁切（柔和弧形） -->
        <clipPath :id="`${uid}-comforting-clip`">
          <path class="ik-fairy-comforting-clip-shape" d="M20 60 Q80 30 140 60 V160 H20 Z" />
          <rect x="0" y="108" width="160" height="52" />
        </clipPath>

        <!-- 动态数码切片切条 1~5 -->
        <clipPath :id="`${uid}-slice-1`"><rect x="4" :y="sliceRects[0]?.y ?? 12" width="152" :height="sliceRects[0]?.h ?? 25" /></clipPath>
        <clipPath :id="`${uid}-slice-2`"><rect x="4" :y="sliceRects[1]?.y ?? 37" width="152" :height="sliceRects[1]?.h ?? 28" /></clipPath>
        <clipPath :id="`${uid}-slice-3`"><rect x="4" :y="sliceRects[2]?.y ?? 65" width="152" :height="sliceRects[2]?.h ?? 26" /></clipPath>
        <clipPath :id="`${uid}-slice-4`"><rect x="4" :y="sliceRects[3]?.y ?? 91" width="152" :height="sliceRects[3]?.h ?? 30" /></clipPath>
        <clipPath :id="`${uid}-slice-5`"><rect x="4" :y="sliceRects[4]?.y ?? 121" width="152" :height="sliceRects[4]?.h ?? 27" /></clipPath>
      </defs>

      <g class="ik-fairy-body">
        <!-- 静态最外层光晕 -->
        <circle
          v-if="!lowPower"
          class="ik-fairy-outer-halo"
          cx="80"
          cy="80"
          :r="outerHaloRadius"
          :fill="`url(#${uid}-outer-halo)`"
        />

        <g
          class="ik-fairy-signal"
          :data-glitch="activeGlitch"
          :style="glitchStyles"
        >
          <!-- 完整画面组：挂载电磁置换滤镜与微闪烁 -->
          <g
            :id="`${uid}-image`"
            class="ik-fairy-image"
            :data-flicker="isFlickering"
            :style="hasInterferenceFilter ? { filter: `url(#${uid}-interference)` } : undefined"
          >
            <!-- 外圆盘 -->
            <circle
              class="ik-fairy-outer-disc"
              cx="80"
              cy="80"
              :r="outerDiscRadius"
              :fill="`url(#${uid}-outer-gradient)`"
              stroke="#f2fbff"
              :stroke-width="outerStrokeWidth"
            />

            <!-- 四枚旋转眼睫 / 旋转眼角 -->
            <g
              class="ik-fairy-corners"
              :clip-path="`url(#${uid}-disc-clip)`"
              fill="#2b3388"
            >
              <circle cx="80" cy="80" r="51.75" />
              <rect x="37" y="37" width="86" height="86" rx="2" transform="rotate(3 80 80)" />
            </g>

            <!-- 核心眼球系统（含表情形态裁剪） -->
            <g
              class="ik-fairy-eye"
              :clip-path="
                state === 'thinking'
                  ? `url(#${uid}-thinking-clip)`
                  : state === 'comforting'
                  ? `url(#${uid}-comforting-clip)`
                  : undefined
              "
            >
              <!-- 巩膜层 -->
              <g class="ik-fairy-sclera">
                <circle cx="80" cy="80" :r="scleraRadius" fill="#eef0f5" />
                <circle
                  v-if="!lowPower"
                  class="ik-fairy-sclera-halo"
                  cx="80"
                  cy="80"
                  :r="scleraHaloRadius"
                  :fill="`url(#${uid}-sclera-halo)`"
                />
                <circle
                  class="ik-fairy-sclera-contact"
                  cx="80"
                  cy="80"
                  :r="scleraRadius"
                  fill="none"
                  stroke="#ffffff"
                  :stroke-width="scleraContactStrokeWidth"
                  stroke-opacity="0.16"
                />
              </g>

              <!-- 三层交错律动眼球 -->
              <g class="ik-fairy-eyeball">
                <circle class="ik-fairy-layer-three" cx="80" cy="80" r="33" fill="#9daee0" />
                <circle class="ik-fairy-layer-two" cx="80" cy="80" r="24.15" fill="#eef0f5" />
                <circle class="ik-fairy-layer-two" cx="80" cy="80" r="23.5" fill="#317bcf" />
                <circle class="ik-fairy-layer-one" cx="80" cy="80" r="16.6" fill="none" stroke="#f5f8fd" stroke-width="0.1" />
                <circle class="ik-fairy-layer-one" cx="80" cy="80" :r="pupilRadius" fill="#3b3d8a" />
                <!-- 瞳孔高光点 -->
                <g class="ik-fairy-highlight ik-fairy-layer-two">
                  <circle
                    v-if="!lowPower"
                    class="ik-fairy-highlight-halo"
                    :cx="highlightCenter.x"
                    :cy="highlightCenter.y"
                    :r="highlightHaloRadius"
                    :fill="`url(#${uid}-highlight-halo)`"
                  />
                  <circle
                    class="ik-fairy-highlight-glow"
                    :cx="highlightCenter.x"
                    :cy="highlightCenter.y"
                    :r="highlightRadius"
                    fill="#f5f8fd"
                  />
                </g>
              </g>
            </g>

            <!-- 瞬态白屏微闪烁覆层 -->
            <circle
              class="ik-fairy-eye-flicker"
              cx="80"
              cy="80"
              :r="outerVisibleEdge"
              fill="#ffffff"
              :style="flickerStyles"
              pointer-events="none"
            />

            <!-- 扫描线滤网 -->
            <g :clip-path="`url(#${uid}-disc-clip)`" opacity="0.42">
              <rect class="ik-fairy-scanlines" x="12" y="10" width="136" height="146" :fill="`url(#${uid}-lines)`" />
            </g>
          </g>

          <!-- 5 层错位切片（blocks 故障模式或转场时激活） -->
          <g
            v-if="!lowPower && (activeGlitch === 'blocks' || (isTransitionGlitch && transitionBurstMode === 'blocks'))"
            class="ik-fairy-glitch-blocks"
          >
            <use :href="`#${uid}-image`" class="ik-fairy-glitch-1" :clip-path="`url(#${uid}-slice-1)`" />
            <use :href="`#${uid}-image`" class="ik-fairy-glitch-2" :clip-path="`url(#${uid}-slice-2)`" />
            <use :href="`#${uid}-image`" class="ik-fairy-glitch-3" :clip-path="`url(#${uid}-slice-3)`" />
            <use :href="`#${uid}-image`" class="ik-fairy-glitch-4" :clip-path="`url(#${uid}-slice-4)`" />
            <use :href="`#${uid}-image`" class="ik-fairy-glitch-5" :clip-path="`url(#${uid}-slice-5)`" />
          </g>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
/* ── 容器骨骼与模式 ── */
.ik-fairy-mascot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  user-select: none;
  overflow: visible;
  --dsh-fairy-outer-halo-color: #c9f8ff;
  --dsh-fairy-steady-rate: 1;
}

.ik-fairy-mascot.is-interactive {
  cursor: pointer;
}

/* Hero 与 Watermark 统一基准尺寸：300px，确保有无对话时大眼大小 100% 绝对一致无跳变 */
.ik-fairy-mascot--hero,
.ik-fairy-mascot--watermark {
  width: 300px;
  height: 300px;
  max-width: 80%;
  max-height: 80%;
}

/* Hero 大舞台模式：饱满、鲜艳、居中 */
.ik-fairy-mascot--hero {
  margin: 0 auto;
  opacity: 1;
  transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.ik-fairy-mascot--hero:hover {
  transform: scale(1.02);
}

/* Watermark 水印背景模式：幽暗、半透明、严格居中衬底于消息列表后方 */
.ik-fairy-mascot--watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  opacity: 0.16;
  pointer-events: none;
  z-index: 0;
  transition: opacity 0.5s ease;
}

/* ── 内部图层叠加关系 ── */
/* 脉冲激波层：3x 独立视口，配合精准淡出，绝无上下切口 */
.ik-fairy-pulse-layer {
  position: absolute;
  left: -100%;
  top: -100%;
  width: 300%;
  height: 300%;
  z-index: 0;
  opacity: 0.92;
  display: block;
  visibility: visible;
  pointer-events: none;
  overflow: visible;
}

.ik-fairy-halo-layer {
  position: absolute;
  left: -112.5%;
  top: -43.75%;
  width: 325%;
  height: 200%;
  z-index: 0;
  pointer-events: none;
  opacity: 0.85;
  color: #c9efff;
  overflow: visible;
  /* 双重蒙版保险：裁剪掉所有溢出直线，只保留柔和的正弦辐射辉光 */
  -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent 18%, black 24%, black 32%, transparent 48%);
  mask-image: radial-gradient(circle at 50% 50%, transparent 18%, black 24%, black 32%, transparent 48%);
}

.ik-fairy-main {
  position: relative;
  width: 100%;
  height: 100%;
  z-index: 1;
  overflow: visible;
}

/* ── 核心动效：眼睫旋转 (15s 一周) ── */
.ik-fairy-corners {
  animation: dsh-lashes 15s linear infinite;
  transform-origin: 80px 80px;
  will-change: transform;
}

@keyframes dsh-lashes {
  to {
    transform: rotate(360deg);
  }
}

/* ── 核心动效：仿生交错多层眼球呼吸律动 (Staggered Breathing) ── */
/* 从外向内依次存在 -0.045s、-0.09s、-0.18s 负延迟交错动效 */
.ik-fairy-sclera {
  animation: dsh-pulse-outer 0.72s cubic-bezier(0.72, 0, 0.28, 1) infinite alternate;
  transform-origin: 80px 80px;
  will-change: transform;
}

.ik-fairy-layer-three {
  animation: dsh-pulse-three 0.72s cubic-bezier(0.72, 0, 0.28, 1) -0.045s infinite alternate;
  transform-origin: 80px 80px;
  will-change: transform;
}

.ik-fairy-layer-two {
  animation: dsh-pulse-two 0.72s cubic-bezier(0.72, 0, 0.28, 1) -0.09s infinite alternate;
  transform-origin: 80px 80px;
  will-change: transform;
}

.ik-fairy-layer-one {
  animation: dsh-pulse-inner 0.72s cubic-bezier(0.72, 0, 0.28, 1) -0.18s infinite alternate;
  transform-origin: 80px 80px;
  will-change: transform;
}

@keyframes dsh-pulse-outer {
  from { transform: scale(0.985); }
  to { transform: scale(0.91); }
}

@keyframes dsh-pulse-three {
  from { transform: scale(1); }
  to { transform: scale(0.90); }
}

@keyframes dsh-pulse-two {
  from { transform: scale(1); }
  to { transform: scale(0.87); }
}

@keyframes dsh-pulse-inner {
  from { transform: scale(1); }
  to { transform: scale(0.85); }
}

/* ── 外围脉冲光环激波扩散（360° 浑圆无裁切） ── */
.ik-fairy-lash-pulse-wave {
  animation: dsh-lash-pulse 4s cubic-bezier(0.42, 0, 0.22, 1) infinite;
  display: block;
  visibility: visible;
  opacity: 1;
  transform-box: view-box;
  transform-origin: 80px 80px;
  will-change: opacity, transform;
}

/* 严格校准的淡出步进：在 27% 时平滑归零，扩散未触碰容器边缘即已完全透明 */
@keyframes dsh-lash-pulse {
  0% { opacity: 0; transform: scale(0.98); }
  5% { opacity: 0.72; }
  12% { opacity: 0.52; }
  19% { opacity: 0.19; }
  25% { opacity: 0.04; }
  27%, 100% { opacity: 0; transform: scale(2.0); }
}

/* ── 表情形变：思考态 (Thinking) 与 安慰态 (Comforting) ── */
/* 进入 thinking 时由进入关键帧平滑下压过渡，紧接着无缝融入交错呼吸律动 */
.ik-fairy-mascot[data-state="thinking"] .ik-fairy-thinking-clip-shape {
  animation:
    dsh-thinking-enter 0.36s cubic-bezier(0.16, 1, 0.3, 1) forwards,
    dsh-thinking-clip 0.72s cubic-bezier(0.72, 0, 0.28, 1) 0.36s infinite alternate;
  transform-origin: 80px 60px;
}

.ik-fairy-mascot[data-state="comforting"] .ik-fairy-comforting-clip-shape {
  animation:
    dsh-comforting-enter 0.36s cubic-bezier(0.16, 1, 0.3, 1) forwards,
    dsh-comforting-clip 0.72s cubic-bezier(0.72, 0, 0.28, 1) 0.36s infinite alternate;
  transform-origin: 80px 60px;
}

@keyframes dsh-thinking-enter {
  0% { transform: translateY(-24px) scaleY(0.3); }
  100% { transform: translateY(14.5px) scaleY(0.55); }
}

@keyframes dsh-thinking-clip {
  from { transform: translateY(14.5px) scaleY(0.55); }
  to { transform: translateY(15.5px); }
}

@keyframes dsh-comforting-enter {
  0% { transform: translateY(-20px); }
  100% { transform: translateY(-3px); }
}

@keyframes dsh-comforting-clip {
  from { transform: translateY(-3px); }
  to { transform: translateY(3px); }
}

/* ── Glitch 电磁故障与转场撕裂 ── */
.ik-fairy-signal {
  transform-origin: 80px 80px;
}

.ik-fairy-signal[data-glitch],
.ik-fairy-mascot[data-transition-glitch="true"] .ik-fairy-signal {
  will-change: transform, filter;
  filter: brightness(var(--dsh-g-bright, 1.12)) contrast(var(--dsh-g-contrast, 1.18));
  transform: translateX(var(--dsh-g-x, 0)) skewX(var(--dsh-g-skew, 0deg));
}

/* blocks 模式：切片水平分离 */
.ik-fairy-glitch-blocks {
  display: block;
  opacity: 1;
}

/* blocks 激活时冻结眼睫自旋，保持切片完全吻合 */
.ik-fairy-signal[data-glitch="blocks"] .ik-fairy-corners,
.ik-fairy-mascot[data-transition-glitch="true"][data-burst="blocks"] .ik-fairy-corners {
  animation: none !important;
  transform: rotate(var(--dsh-lash-angle, 0deg));
}

.ik-fairy-glitch-blocks .ik-fairy-sclera,
.ik-fairy-glitch-blocks .ik-fairy-layer-three,
.ik-fairy-glitch-blocks .ik-fairy-layer-two,
.ik-fairy-glitch-blocks .ik-fairy-layer-one {
  animation-play-state: paused !important;
}

.ik-fairy-glitch-1 { transform: translateX(var(--dsh-g-s1-x, 0)); }
.ik-fairy-glitch-2 { transform: translateX(var(--dsh-g-s2-x, 0)); }
.ik-fairy-glitch-3 { transform: translateX(var(--dsh-g-s3-x, 0)); }
.ik-fairy-glitch-4 { transform: translateX(var(--dsh-g-s4-x, 0)); }
.ik-fairy-glitch-5 { transform: translateX(var(--dsh-g-s5-x, 0)); }

/* ── 随机白光微闪烁 ── */
.ik-fairy-eye-flicker {
  opacity: 0;
  pointer-events: none;
}

.ik-fairy-image[data-flicker="true"] .ik-fairy-eye-flicker {
  animation: dsh-fairy-eye-flicker-overlay var(--dsh-fairy-flicker-duration, 210ms) cubic-bezier(0.32, 0, 0.68, 1) both;
  will-change: opacity;
}

@keyframes dsh-fairy-eye-flicker-overlay {
  0%, 100% { opacity: 0; }
  22% { opacity: var(--dsh-fairy-flicker-opacity-1, 0.04); }
  48% { opacity: var(--dsh-fairy-flicker-opacity-mid, 0.012); }
  72% { opacity: var(--dsh-fairy-flicker-opacity-2, 0.03); }
}

/* ── 移动端与性能降级适配 ── */
@media (max-width: 640px) {
  .ik-fairy-mascot--hero,
  .ik-fairy-mascot--watermark {
    width: min(76%, 26vh, 220px);
    height: min(76%, 26vh, 220px);
  }
  .ik-fairy-mascot--watermark {
    opacity: 0.12;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-fairy-corners,
  .ik-fairy-sclera,
  .ik-fairy-layer-three,
  .ik-fairy-layer-two,
  .ik-fairy-layer-one,
  .ik-fairy-lash-pulse-wave,
  .ik-fairy-thinking-clip-shape,
  .ik-fairy-comforting-clip-shape {
    animation: none !important;
  }
}
</style>
