<script setup lang="ts">
import type { DialogTitleProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { computed } from "vue";
import { DialogTitle } from "reka-ui";

const props = defineProps<DialogTitleProps & { class?: HTMLAttributes["class"] }>();
const delegated = computed(() => {
  const { class: _class, ...rest } = props;
  return rest;
});
</script>

<template>
  <DialogTitle data-slot="sheet-title" :class="['ik-sheet-title', props.class]" v-bind="delegated">
    <slot />
  </DialogTitle>
</template>

<style scoped>
.ik-sheet-title {
  margin: 0;
  font-size: 18px;
  font-weight: 900;
  color: #fff;
}
</style>
