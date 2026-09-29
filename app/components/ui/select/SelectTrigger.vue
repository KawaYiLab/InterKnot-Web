<script setup lang="ts">
import type { SelectTriggerProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { SelectIcon, SelectTrigger, useForwardProps } from "reka-ui";

const props = withDefaults(
  defineProps<SelectTriggerProps & { class?: HTMLAttributes["class"]; size?: "sm" | "default" }>(),
  { size: "default" },
);

const delegatedProps = reactiveOmit(props, "class", "size");
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectTrigger
    data-slot="select-trigger"
    :data-size="size"
    v-bind="forwardedProps"
    :class="props.class"
  >
    <slot />
    <SelectIcon as-child>
      <!-- data-slot 为本地补充：便于使用方单独控制箭头（如展开时旋转） -->
      <svg
        data-slot="select-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </SelectIcon>
  </SelectTrigger>
</template>
