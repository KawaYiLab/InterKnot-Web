<script setup lang="ts">
import type { DialogDescriptionProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { computed } from "vue";
import { DialogDescription } from "reka-ui";

const props = defineProps<DialogDescriptionProps & { class?: HTMLAttributes["class"] }>();
const delegated = computed(() => {
  const { class: _class, ...rest } = props;
  return rest;
});
</script>

<template>
  <DialogDescription data-slot="sheet-description" :class="['ik-sheet-description', props.class]" v-bind="delegated">
    <slot />
  </DialogDescription>
</template>

<style scoped>
.ik-sheet-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.55);
}
</style>
