<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const MARQUEE_LINE = "ZENLESS ZONE ZERO ".repeat(12);

/** 等弹窗入场动画结束后再启动，避免与 blur/transform 争抢 GPU */
const MARQUEE_START_DELAY_MS = 250;

const running = ref(false);
let startTimer: ReturnType<typeof setTimeout> | null = null;

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
  <div class="ik-zzz-marquee" :class="{ 'is-running': running }" aria-hidden="true">
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
  from { transform: translateX(-50%); }
  to { transform: translateX(0); }
}

@keyframes ik-zzz-marquee-rtl {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

.ik-zzz-marquee {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
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
}

.ik-zzz-marquee__row--ltr .ik-zzz-marquee__track {
  animation: ik-zzz-marquee-ltr 1600s linear infinite;
}

.ik-zzz-marquee__row--rtl .ik-zzz-marquee__track {
  animation: ik-zzz-marquee-rtl 1920s linear infinite;
}

.ik-zzz-marquee__row--offset .ik-zzz-marquee__track {
  animation-delay: -560s;
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
}

@media (prefers-reduced-motion: reduce) {
  .ik-zzz-marquee__track {
    animation: none;
  }
}
</style>
