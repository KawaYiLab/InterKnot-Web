<script setup lang="ts">
/**
 * 评论 / 通知气泡的正文渲染。
 * 把 `@[name](authorDocumentId)` token 渲染成 MentionChip，
 * `::sticker[documentId]::` token 渲染成内联表情，普通文本原样渲染。
 *
 * 不做 markdown：项目现有 CommentItem.vue 一直把 comment.content 当纯文本展示
 * （`white-space: pre-wrap` 保留换行），这里维持同样语义。
 */
import { computed } from "vue";
import { splitContentWithTokens, isStickerOnlyContent } from "~/utils/sticker";
import MentionChip from "./MentionChip.vue";
import StickerImage from "./StickerImage.vue";

const props = defineProps<{
  content?: string | null;
}>();

const segments = computed(() => splitContentWithTokens(props.content ?? ""));
const stickerOnly = computed(() => isStickerOnlyContent(props.content ?? ""));
</script>

<template>
  <span class="ik-comment-body-text">
    <template v-for="(seg, i) in segments" :key="i">
      <MentionChip
        v-if="seg.type === 'mention'"
        :name="seg.name"
        :author-document-id="seg.authorDocumentId"
      />
      <StickerImage
        v-else-if="seg.type === 'sticker'"
        :document-id="seg.documentId"
        :large="stickerOnly"
      />
      <template v-else>{{ seg.value }}</template>
    </template>
  </span>
</template>

<style scoped>
.ik-comment-body-text {
  /* 父级容器（如 .ik-comment__body）已经设置了 white-space / 字号 / 颜色，
     这里仅作 inline 容器，不引入额外断行规则。 */
  display: inline;
}
</style>
