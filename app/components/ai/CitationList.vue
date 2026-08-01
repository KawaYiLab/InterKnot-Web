<script setup lang="ts">
import type { WorkflowPostRef } from "~/utils/workflow";

/**
 * 引用资料列表（3.5 降级版）：头部显示「本次回答引用了 N 篇论坛帖子」，
 * 不做百分比占比；列表项点击打开 postModal。渲染在工作流卡展开区底部。
 */
const props = defineProps<{
  citations: WorkflowPostRef[];
}>();

const emit = defineEmits<{
  (e: "open-post", documentId: string): void;
}>();
</script>

<template>
  <div class="ik-aiwf-cite">
    <div class="ik-aiwf-cite__head">
      <svg class="ik-aiwf-cite__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M7.5 4.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-3"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
        <path
          d="M7 2.8h6v3.4H7z"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
      </svg>
      本次回答引用了 {{ props.citations.length }} 篇论坛帖子
    </div>
    <ul class="ik-aiwf-cite__list">
      <li v-for="(post, idx) in props.citations" :key="post.documentId">
        <button
          type="button"
          class="ik-aiwf-cite__item"
          @click="emit('open-post', post.documentId)"
        >
          <span class="ik-aiwf-cite__num">{{ idx + 1 }}</span>
          <span class="ik-aiwf-cite__title">{{ post.title || "（无标题）" }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ik-aiwf-cite {
  margin: 2px 10px 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(0, 0, 0, 0.12);
}

.ik-aiwf-cite__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 4px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.55);
}

.ik-aiwf-cite__icon {
  flex: none;
  width: 13px;
  height: 13px;
  color: rgba(0, 0, 0, 0.42);
}

.ik-aiwf-cite__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ik-aiwf-cite__item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 3px 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}

.ik-aiwf-cite__item:hover {
  background: rgba(44, 88, 226, 0.08);
}

.ik-aiwf-cite__num {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 5px;
  background: rgba(44, 88, 226, 0.12);
  color: #2c58e2;
  font-size: 11px;
  font-weight: 700;
}

.ik-aiwf-cite__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #2c58e2;
}

.ik-aiwf-cite__item:hover .ik-aiwf-cite__title {
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
