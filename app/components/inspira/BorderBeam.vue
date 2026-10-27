<script setup lang="ts">
/**
 * 移植自 Inspira UI「Border Beam」：一束光沿父元素边框绕行。
 * 项目没有 Tailwind，原版的工具类改写成下面的 scoped CSS；父元素需要 position 定位，
 * 圆角从父元素继承。不支持 offset-path rect() 的浏览器直接不显示。
 */
withDefaults(
  defineProps<{
    /** 光束长度（px） */
    size?: number;
    /** 绕一圈的秒数 */
    duration?: number;
    borderWidth?: number;
    colorFrom?: string;
    colorTo?: string;
    /** 起步延迟（秒），多个光束错开用 */
    delay?: number;
  }>(),
  {
    size: 120,
    duration: 4,
    borderWidth: 2,
    colorFrom: "#fbfe00",
    colorTo: "#ffffff",
    delay: 0,
  },
);
</script>

<template>
  <div
    class="ik-border-beam"
    aria-hidden="true"
    :style="{
      '--ik-beam-size': `${size}px`,
      '--ik-beam-duration': `${duration}s`,
      '--ik-beam-width': `${borderWidth}px`,
      '--ik-beam-from': colorFrom,
      '--ik-beam-to': colorTo,
      '--ik-beam-delay': `-${delay}s`,
    }"
  >
    <div class="ik-border-beam__light" />
  </div>
</template>

<style scoped>
.ik-border-beam {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  border-radius: inherit;
  border: var(--ik-beam-width) solid transparent;
  /* 只保留边框那一圈：padding-box 透明，与 border-box 求交 */
  -webkit-mask:
    linear-gradient(transparent, transparent) padding-box,
    linear-gradient(#fff, #fff) border-box;
  -webkit-mask-composite: source-in;
  mask:
    linear-gradient(transparent, transparent) padding-box,
    linear-gradient(#fff, #fff) border-box;
  mask-composite: intersect;
}

.ik-border-beam__light {
  position: absolute;
  aspect-ratio: 1;
  width: var(--ik-beam-size);
  background: linear-gradient(to left, var(--ik-beam-from), var(--ik-beam-to), transparent);
  offset-anchor: 90% 50%;
  offset-path: rect(0 auto auto 0 round var(--ik-beam-size));
  animation: ik-border-beam var(--ik-beam-duration) linear infinite;
  animation-delay: var(--ik-beam-delay);
}

@keyframes ik-border-beam {
  to {
    offset-distance: 100%;
  }
}

@supports not (offset-path: rect(0 auto auto 0)) {
  .ik-border-beam {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-border-beam {
    display: none;
  }
}
</style>
