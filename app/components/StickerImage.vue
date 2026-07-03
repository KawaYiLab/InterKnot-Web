<script setup lang="ts">
/**
 * 单个内联表情：按 documentId 从全局 stickerMap 解析出图片。
 * 解析不到（如目录未加载且服务端也没下发）时降级为 [表情] 文本。
 */
import { computed } from "vue";
import { useStickers } from "~/composables/useStickers";

const props = defineProps<{
  documentId: string;
  /** 单表情消息可放大展示 */
  large?: boolean;
}>();

const { resolveSticker, ensureCatalog } = useStickers();

const entry = computed(() => resolveSticker(props.documentId));

// 解析不到时兜底拉一次目录（幂等，内部有单飞）
if (import.meta.client && !entry.value) {
  void ensureCatalog().catch(() => {});
}
</script>

<template>
  <img
    v-if="entry"
    class="ik-sticker"
    :class="{ 'is-large': large }"
    :src="entry.url"
    :alt="entry.name || '表情'"
    :title="entry.name || undefined"
    loading="lazy"
    draggable="false"
  />
  <span v-else class="ik-sticker-fallback">[表情]</span>
</template>

<style scoped>
.ik-sticker {
  display: inline-block;
  width: auto;
  height: 56px;
  max-width: 120px;
  object-fit: contain;
  vertical-align: middle;
  margin: 2px;
  user-select: none;
}

.ik-sticker.is-large {
  height: 110px;
  max-width: 220px;
}

.ik-sticker-fallback {
  opacity: 0.6;
}
</style>
