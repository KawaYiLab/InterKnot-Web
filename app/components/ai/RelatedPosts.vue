<script setup lang="ts">
import { computed } from "vue";
import type { WorkflowPostRef } from "~/utils/workflow";

/**
 * 推荐阅读（3.4）：回答定稿后展示工具循环中搜索命中但未被引用的帖子
 * （数据来自 workflow 事件，零额外 LLM 成本）。渲染在 AI 回答气泡下方，
 * 点击走 postModal。父级负责在定稿后才显示。
 */
const props = defineProps<{
  posts: WorkflowPostRef[];
}>();

const emit = defineEmits<{
  (e: "open-post", documentId: string): void;
  (e: "follow-up", text: string): void;
}>();

const followUpText = (title: string) => `关于推荐阅读《${title || "无标题"}》再讲讲：`;

/** 最多展示 5 篇，避免长列表挤占聊天区 */
const shown = computed(() => props.posts.slice(0, 5));
</script>

<template>
  <div class="ik-aiwf-related">
    <div class="ik-aiwf-related__head">
      <svg class="ik-aiwf-related__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M4 4.5h12M4 10h12M4 15.5h7"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </svg>
      推荐阅读
    </div>
    <ul class="ik-aiwf-related__list">
      <li
        v-for="post in shown"
        :key="post.documentId"
        class="ik-aiwf-related__post-item"
      >
        <button
          type="button"
          class="ik-aiwf-related__item"
          @click="emit('open-post', post.documentId)"
        >
          {{ post.title || "（无标题）" }}
        </button>
        <button
          type="button"
          class="ik-aiwf-related__follow"
          :aria-label="`追问《${post.title || '无标题'}》`"
          @click.stop="emit('follow-up', followUpText(post.title ?? ''))"
        >
          追问
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ik-aiwf-related {
  align-self: stretch;
  padding: 7px 10px 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 12px;
  background: #fffdf2;
  font-size: 13px;
}

.ik-aiwf-related__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 3px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.55);
}

.ik-aiwf-related__icon {
  flex: none;
  width: 13px;
  height: 13px;
  color: rgba(0, 0, 0, 0.42);
}

.ik-aiwf-related__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ik-aiwf-related__post-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ik-aiwf-related__item {
  flex: 1;
  min-width: 0;
  padding: 3px 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  color: #2c58e2;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-aiwf-related__item:hover {
  background: rgba(44, 88, 226, 0.08);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.ik-aiwf-related__follow {
  flex-shrink: 0;
  padding: 1px 7px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(44, 88, 226, 0.6);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}

.ik-aiwf-related__post-item:hover .ik-aiwf-related__follow,
.ik-aiwf-related__follow:focus-visible {
  opacity: 1;
  visibility: visible;
}

.ik-aiwf-related__follow:hover {
  background: rgba(44, 88, 226, 0.1);
  color: #2c58e2;
}
</style>
