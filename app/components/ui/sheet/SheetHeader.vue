<script setup lang="ts">
import type { HTMLAttributes } from "vue";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div data-slot="sheet-header" :class="['ik-sheet-header', props.class]">
    <slot />
  </div>
</template>

<style scoped>
.ik-sheet-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px 60px 0 20px;
}
</style>
