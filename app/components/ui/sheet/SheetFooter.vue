<script setup lang="ts">
import type { HTMLAttributes } from "vue";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div data-slot="sheet-footer" :class="['ik-sheet-footer', props.class]">
    <slot />
  </div>
</template>

<style scoped>
.ik-sheet-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: auto;
  padding: 0 20px 20px;
}
</style>
