<script setup lang="ts">
// Local shadcn-vue components (MIT); see LICENSE in this directory.
// https://github.com/unovue/shadcn-vue/tree/dev/apps/v4/registry/new-york-v4/ui/sheet
import type { DialogRootEmits, DialogRootProps } from "reka-ui";
import { DialogRoot, useForwardPropsEmits } from "reka-ui";

const props = defineProps<DialogRootProps>();
const emits = defineEmits<DialogRootEmits>();
const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <DialogRoot v-slot="slotProps" data-slot="sheet" v-bind="forwarded">
    <slot v-bind="slotProps" />
  </DialogRoot>
</template>
