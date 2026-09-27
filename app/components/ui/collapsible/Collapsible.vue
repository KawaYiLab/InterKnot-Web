<script setup lang="ts">
// Local shadcn-vue components (MIT); see LICENSE in this directory.
// https://github.com/unovue/shadcn-vue/tree/dev/apps/v4/registry/new-york-v4/ui/collapsible
import type { CollapsibleRootEmits, CollapsibleRootProps } from "reka-ui";
import { CollapsibleRoot, useForwardPropsEmits } from "reka-ui";

const props = defineProps<CollapsibleRootProps>();
const emits = defineEmits<CollapsibleRootEmits>();
const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <CollapsibleRoot v-slot="slotProps" data-slot="collapsible" v-bind="forwarded">
    <slot v-bind="slotProps" />
  </CollapsibleRoot>
</template>
