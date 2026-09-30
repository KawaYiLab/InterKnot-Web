<script setup lang="ts">
import type { TooltipContentEmits, TooltipContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { TooltipContent, TooltipPortal, useForwardPropsEmits } from "reka-ui";

const props = withDefaults(
  defineProps<TooltipContentProps & { class?: HTMLAttributes["class"] }>(),
  {
    sideOffset: 6,
  },
);
const emits = defineEmits<TooltipContentEmits>();
const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      v-bind="forwarded"
      :class="['ik-tooltip-content', props.class]"
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>

<style scoped>
.ik-tooltip-content {
  z-index: 10000;
  overflow: hidden;
  border-radius: 6px;
  border: 1px solid #383838;
  background-color: rgba(20, 20, 20, 0.96);
  padding: 6px 10px;
  font-size: 12px;
  color: #ededed;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  pointer-events: none;
  animation: ik-tooltip-in 150ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes ik-tooltip-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
