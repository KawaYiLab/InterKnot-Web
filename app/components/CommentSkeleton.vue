<script setup lang="ts">
import Skeleton from "boneyard-js/vue";
import { SAMPLE_COMMENT } from "~/utils/boneyard";

/** 评论列表加载占位：骨架形状由 `npm run bones` 从 CommentItem 截取（app/bones/comment.bones.json）。 */
withDefaults(defineProps<{ count?: number }>(), { count: 4 });
</script>

<template>
  <div class="ik-comment-skeleton" aria-hidden="true">
    <Skeleton v-for="n in count" :key="n" name="comment" :loading="true">
      <template #fixture>
        <CommentItem :comment="SAMPLE_COMMENT" />
      </template>
    </Skeleton>
  </div>
</template>
