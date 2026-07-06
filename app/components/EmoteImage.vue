<script setup lang="ts">
/**
 * 行内小表情渲染组件。
 *
 * 从 useEmotes() 拿到 manifest map，把 code 解析为图片 URL。
 * 查不到时降级为原文 :ik-xxx: 文本，不破版、不报错。
 *
 * 行内 2.5em <img>（约两个半字高，B 站同比例），垂直居中对齐。
 * 固定宽高 + lazy-load，避免评论列表回流抖动。
 */
import { computed } from "vue";
import { useEmotes } from "~/composables/useEmotes";

const props = defineProps<{
  code: string;
}>();

const { emoteMap } = useEmotes();

const resolved = computed(() => emoteMap.value.get(props.code));

const fallbackText = computed(() => `:${props.code}:`);
</script>

<template>
  <img
    v-if="resolved"
    :src="resolved.url"
    :alt="resolved.name"
    :title="resolved.name"
    class="ik-emote-image"
    loading="lazy"
    decoding="async"
    draggable="false"
  />
  <template v-else>{{ fallbackText }}</template>
</template>

<style scoped>
.ik-emote-image {
  display: inline-block;
  width: 2.5em;
  height: 2.5em;
  vertical-align: middle;
  object-fit: contain;
  margin: 0 1px;
  user-select: none;
  -webkit-user-drag: none;
}
</style>
