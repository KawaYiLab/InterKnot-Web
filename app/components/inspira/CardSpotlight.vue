<script setup lang="ts">
import { ref } from "vue";

/**
 * 移植自 Inspira UI「Card Spotlight」：鼠标悬停时，一圈柔光跟着指针走。
 * 改写为 scoped CSS；默认渲染成 div，可用 as 指定标签。
 */
withDefaults(
  defineProps<{
    as?: string;
    size?: number;
    color?: string;
  }>(),
  {
    as: "div",
    size: 260,
    color: "rgba(255, 255, 255, 0.07)",
  },
);

const x = ref(-9999);
const y = ref(-9999);

const onMove = (e: MouseEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  x.value = e.clientX - rect.left;
  y.value = e.clientY - rect.top;
};

const onLeave = () => {
  x.value = -9999;
  y.value = -9999;
};
</script>

<template>
  <component
    :is="as"
    class="ik-spotlight"
    :style="{ '--ik-spot-x': `${x}px`, '--ik-spot-y': `${y}px`, '--ik-spot-size': `${size}px`, '--ik-spot-color': color }"
    @mousemove="onMove"
    @mouseleave="onLeave"
  >
    <slot />
  </component>
</template>

<style scoped>
.ik-spotlight {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 16px;
  background: #151515;
  transition: border-color 0.2s ease;
}

.ik-spotlight::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: radial-gradient(
    var(--ik-spot-size) circle at var(--ik-spot-x) var(--ik-spot-y),
    var(--ik-spot-color),
    transparent 70%
  );
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.ik-spotlight:hover {
  border-color: rgba(255, 255, 255, 0.14);
}

.ik-spotlight:hover::before {
  opacity: 1;
}
</style>
