<script setup lang="ts">
import { computed, type CSSProperties } from "vue";

const props = defineProps<{
  progress: number;
  show: boolean;
}>();

const CIRCUM = 2 * Math.PI * 18;

const ringStyle = computed<CSSProperties>(() => {
  const offset = CIRCUM * (1 - props.progress);
  return {
    strokeDasharray: `${CIRCUM}`,
    strokeDashoffset: `${offset}`,
  };
});
</script>

<template>
  <svg
    v-if="show"
    class="ik-triple__ring"
    :class="{ 'is-active': show }"
    viewBox="0 0 40 40"
    aria-hidden="true"
  >
    <circle
      class="ik-triple__ring-track"
      cx="20"
      cy="20"
      r="18"
    />
    <circle
      class="ik-triple__ring-fill"
      cx="20"
      cy="20"
      r="18"
      :style="ringStyle"
    />
  </svg>
</template>

<style scoped>
.ik-triple__ring {
  position: absolute;
  inset: -4px;
  width: calc(100% + 8px);
  height: calc(100% + 8px);
  pointer-events: none;
  overflow: visible;
}

.ik-triple__ring-track {
  fill: none;
  stroke: rgba(128, 128, 128, 0.18);
  stroke-width: 2.5;
  opacity: 0;
  transition: opacity 120ms ease;
}

.ik-triple__ring.is-active .ik-triple__ring-track {
  opacity: 1;
}

.ik-triple__ring-fill {
  fill: none;
  stroke: var(--ik-primary, #BFFF09);
  stroke-width: 2.5;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: center;
  transition: stroke-dashoffset 80ms linear;
}
</style>
