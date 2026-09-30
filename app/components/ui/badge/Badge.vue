<script setup lang="ts">
import type { HTMLAttributes } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "default" | "secondary" | "destructive" | "outline" | "zzz";
    class?: HTMLAttributes["class"];
  }>(),
  { variant: "default" },
);
</script>

<template>
  <span
    data-slot="badge"
    :class="[
      'ik-badge',
      `ik-badge--${props.variant}`,
      props.class,
    ]"
  >
    <slot />
  </span>
</template>

<style scoped>
.ik-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  border: 1px solid transparent;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  transition: all 0.2s ease;
  white-space: nowrap;
  user-select: none;
}

.ik-badge--default {
  background-color: #262626;
  color: #fff;
  border-color: #404040;
}

.ik-badge--secondary {
  background-color: #1a1a1a;
  color: #a3a3a3;
  border-color: #2e2e2e;
}

.ik-badge--outline {
  background-color: transparent;
  color: #d4d4d4;
  border-color: #404040;
}

.ik-badge--destructive {
  background-color: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.4);
}

/* ZZZ 特色赛博高亮黄 */
.ik-badge--zzz {
  background-color: #fbfe00;
  color: #000;
  border-color: #fbfe00;
  box-shadow: 0 0 6px rgba(251, 254, 0, 0.35);
}
</style>
