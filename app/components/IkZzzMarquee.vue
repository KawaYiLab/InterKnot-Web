<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

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

const MARQUEE_LINE = "Remielle Dan ".repeat(3);

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
    <div class="ik-zzz-marquee__band">
      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--ltr">
        <div class="ik-zzz-marquee__track">
          <span class="ik-zzz-marquee__text">{{ MARQUEE_LINE }}</span>
          <span class="ik-zzz-marquee__text">{{ MARQUEE_LINE }}</span>
        </div>
      </div>
      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--rtl">
        <div class="ik-zzz-marquee__track">
          <span class="ik-zzz-marquee__text">{{ MARQUEE_LINE }}</span>
          <span class="ik-zzz-marquee__text">{{ MARQUEE_LINE }}</span>
        </div>
      </div>
      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--ltr ik-zzz-marquee__row--offset">
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

.ik-zzz-marquee {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  contain: strict;
}

.ik-zzz-marquee__band {
  position: absolute;
  width: 220%;
  height: 220%;
  left: -60%;
  top: -60%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 0.006em;
  font-size: clamp(240px, 32vw, 400px);
  transform: translateY(5vh) rotate(-15deg);
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
  .ik-zzz-marquee__track {
    animation: none;
  }
}

/* 移动端：放大跑马灯字号与 band 尺寸（与全局背景一致），桌面端保持默认 */
@media (max-width: 1024px) {
  .ik-zzz-marquee__band {
    width: 260%;
    height: 260%;
    left: -80%;
    top: -80%;
    font-size: clamp(360px, 48vw, 640px);
  }
}
</style>
