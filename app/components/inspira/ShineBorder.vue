<script setup lang="ts">
/**
 * 移植自 Inspira UI「Shine Border」：边框上缓慢流动的一圈光泽。
 * 叠在父元素上（父元素需要 position 定位），圆角从父元素继承。
 */
withDefaults(
  defineProps<{
    borderWidth?: number;
    /** 流动一个来回的秒数 */
    duration?: number;
    colors?: string[];
  }>(),
  {
    borderWidth: 2,
    duration: 14,
    colors: () => ["#fbfe00", "#ffffff"],
  },
);
</script>

<template>
  <div
    class="ik-shine-border"
    aria-hidden="true"
    :style="{
      '--ik-shine-width': `${borderWidth}px`,
      '--ik-shine-duration': `${duration}s`,
      '--ik-shine-colors': colors.join(','),
    }"
  />
</template>

<style scoped>
.ik-shine-border {
  position: absolute;
  inset: calc(var(--ik-shine-width) * -1);
  z-index: 1;
  pointer-events: none;
  border-radius: inherit;
  padding: var(--ik-shine-width);
  background-image: radial-gradient(transparent, transparent, var(--ik-shine-colors), transparent, transparent);
  background-size: 300% 300%;
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  animation: ik-shine var(--ik-shine-duration) linear infinite;
}

@keyframes ik-shine {
  0% {
    background-position: 0% 0%;
  }
  50% {
    background-position: 100% 100%;
  }
  100% {
    background-position: 0% 0%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-shine-border {
    animation: none;
  }
}
</style>
