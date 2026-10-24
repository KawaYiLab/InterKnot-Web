<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { brandFontsReady } from "~/utils/brand-fonts";

const props = withDefaults(
  defineProps<{
    /**
     * 暂停动画。用于全屏弹窗打开时暂停「被遮住的」全局跑马灯：它此刻完全
     * 不可见，却仍在动，且位于弹窗 backdrop-filter 模糊之后 —— 动画会迫使
     * 模糊每帧重算，纯属浪费。暂停后弹窗自己的那份跑马灯照常显示。
     */
    paused?: boolean;
  }>(),
  { paused: false },
);

/**
 * 渲染策略：真实 DOM 文字 + 合成器平移。
 *
 * 安卓端（`IkZzzMarquee.kt`）每帧都要自己 drawRect，所以必须先把文字烘焙成
 * 位图。浏览器不需要：带 `will-change: transform` 的轨道会被提升为独立合成层，
 * 文字只在入场时栅格化一次（按真实 DPR、原生字形与 hinting），之后每帧只是
 * GPU 平移这张层纹理 —— 0 次重排、0 次重绘、0 次字形栅格化，且清晰度不打折。
 *
 * 每行一个轨道 = 2 段相同文字，平移 -50% 恰好一个周期，无缝循环。
 * 段内词间距是空格、段尾是 padding，所以视觉周期是 3 个词而不是 1 个。
 */
const MARQUEE_LINE = "INTERKNOT ".repeat(3);

/** 三行：方向 + 是否错相（对应下方 `--ltr` / `--rtl` / `--offset`）。 */
const ROWS = [
  { direction: "ltr", offset: false },
  { direction: "rtl", offset: false },
  { direction: "ltr", offset: true },
] as const;

/** 等弹窗入场动画结束后再启动，避免与 blur/transform 争抢 GPU */
const MARQUEE_START_DELAY_MS = 250;

const running = ref(false);
let startTimer: ReturnType<typeof setTimeout> | null = null;

const isRunning = computed(() => running.value && !props.paused);

onMounted(() => {
  startTimer = setTimeout(() => {
    running.value = true;
    startTimer = null;
  }, MARQUEE_START_DELAY_MS);
});

onBeforeUnmount(() => {
  if (startTimer !== null) {
    clearTimeout(startTimer);
    startTimer = null;
  }
});
</script>

<template>
  <div class="ik-zzz-marquee" :class="{ 'is-running': isRunning }" aria-hidden="true">
    <!-- 等品牌字体就绪再渲染：字宽一变整片文字都会位移，计入 CLS（见 utils/brand-fonts.ts） -->
    <div v-if="brandFontsReady" class="ik-zzz-marquee__band">
      <div
        v-for="(row, index) in ROWS"
        :key="index"
        class="ik-zzz-marquee__row"
        :class="[`ik-zzz-marquee__row--${row.direction}`, { 'ik-zzz-marquee__row--offset': row.offset }]"
      >
        <div class="ik-zzz-marquee__track">
          <span class="ik-zzz-marquee__text">{{ MARQUEE_LINE }}</span>
          <span class="ik-zzz-marquee__text">{{ MARQUEE_LINE }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes ik-zzz-marquee-ltr {
  from { transform: translate3d(-50%, 0, 0); }
  to { transform: translate3d(0, 0, 0); }
}

@keyframes ik-zzz-marquee-rtl {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(-50%, 0, 0); }
}

@keyframes ik-zzz-marquee-fade-in {
  from { opacity: 0; }
}

/*
 * 尺寸预设只有两个旋钮，外部（如 app.vue 的全局实例）覆盖变量即可，
 * 不必再复制整套 band 几何：
 *   --ik-marquee-band  band 相对容器的边长（band 居中，偏移由它推导）
 *   --ik-marquee-font  字号
 */
.ik-zzz-marquee {
  --ik-marquee-band: 220%;
  --ik-marquee-font: clamp(240px, 32vw, 400px);

  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  contain: strict;
}

/* 移动端弹窗：与全局背景同一档（大号） */
@media (max-width: 1024px) {
  .ik-zzz-marquee {
    --ik-marquee-band: 260%;
    --ik-marquee-font: clamp(360px, 48vw, 640px);
  }
}

.ik-zzz-marquee__band {
  position: absolute;
  width: var(--ik-marquee-band);
  height: var(--ik-marquee-band);
  left: calc((100% - var(--ik-marquee-band)) / 2);
  top: calc((100% - var(--ik-marquee-band)) / 2);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 0.006em;
  font-size: var(--ik-marquee-font);
  transform: translateY(5vh) rotate(-15deg);
  animation: ik-zzz-marquee-fade-in 0.8s ease-out;
}

.ik-zzz-marquee__row {
  flex: 0 0 auto;
  overflow: hidden;
  white-space: nowrap;
  font-size: inherit;
  line-height: 0.74;
}

.ik-zzz-marquee__track {
  display: inline-flex;
  flex-shrink: 0;
  animation-play-state: paused;
  /* 常驻合成层：暂停/恢复时不必重新栅格化巨型文字 */
  will-change: transform;
  backface-visibility: hidden;
}

.ik-zzz-marquee__row--ltr .ik-zzz-marquee__track {
  animation: ik-zzz-marquee-ltr 400s linear infinite;
}

.ik-zzz-marquee__row--rtl .ik-zzz-marquee__track {
  animation: ik-zzz-marquee-rtl 480s linear infinite;
}

.ik-zzz-marquee__row--offset .ik-zzz-marquee__track {
  animation-delay: -140s;
}

.ik-zzz-marquee.is-running .ik-zzz-marquee__track {
  animation-play-state: running;
}

.ik-zzz-marquee__text {
  display: inline-block;
  padding-right: 0.15em;
  font-size: inherit;
  line-height: inherit;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.07);
  white-space: nowrap;
  user-select: none;
  text-rendering: optimizeSpeed;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

@media (prefers-reduced-motion: reduce) {
  .ik-zzz-marquee__band,
  .ik-zzz-marquee__track {
    animation: none;
  }
}
</style>
