<script setup lang="ts">
// Local shadcn-vue components (MIT); see LICENSE in this directory.
// https://github.com/unovue/shadcn-vue/tree/dev/apps/v4/registry/new-york-v4/ui/select
// 项目未引入 Tailwind：各组件去掉了上游的 Tailwind 类名，保留结构与 data-slot，
// 外观由使用方自行编写样式；上游的 @lucide/vue 图标换成等价的内联 SVG。
import type { SelectRootEmits, SelectRootProps } from "reka-ui";
import { SelectRoot, useForwardPropsEmits } from "reka-ui";

const props = defineProps<SelectRootProps>();
const emits = defineEmits<SelectRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <SelectRoot v-slot="slotProps" data-slot="select" v-bind="forwarded">
    <slot v-bind="slotProps" />
  </SelectRoot>
</template>
