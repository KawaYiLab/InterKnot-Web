<script setup lang="ts">
/**
 * 评论里 @ 提及的可点击芯片。
 * - 复用 UserHoverCard 拿到与项目其它 @ 行为一致的悬停预览（点击跳主页）
 * - 显示名走 token 内的 name 快照（即写入时的名字），与 CommentItem 一致
 * - 显示 `@<name>`，黄底黑字，紧凑到能在评论行内自然流式排版
 */
import UserHoverCard from "./UserHoverCard.vue";

defineProps<{
  name: string;
  authorDocumentId: string;
}>();
</script>

<template>
  <UserHoverCard :author-id="authorDocumentId" clickable>
    <span class="ik-mention" role="link" tabindex="0">@{{ name }}</span>
  </UserHoverCard>
</template>

<style scoped>
.ik-mention {
  display: inline;
  padding: 0 4px;
  /* 行内排版，避免一长串 @用户 强制换行打断阅读 */
  white-space: nowrap;
  /* 主题色：与 .ik-comment__level 一致的亮黄绿 */
  color: #BFFF09;
  font-weight: 600;
  cursor: pointer;
  border-radius: 3px;
  transition: background-color 140ms ease, color 140ms ease;
}

.ik-mention:hover,
.ik-mention:focus-visible {
  background-color: rgba(215, 255, 0, 0.16);
  outline: none;
}
</style>
