<script setup lang="ts">
import { ref } from "vue";
import type { WorkflowPostRef } from "~/utils/workflow";

/**
 * 引用资料列表（3.5）：对齐 ChatGPT / Claude 的 Sources 区域。
 * - 默认折叠，header 显示「来源（N）」+ 展开 chevron。
 * - 展开后展示横向 source chips，带编号，hover 高亮。
 * - 展开/收起使用 grid 动画。
 */
const props = defineProps<{
  citations: WorkflowPostRef[];
}>();

const emit = defineEmits<{
  (e: "open-post", documentId: string): void;
  (e: "follow-up", text: string): void;
}>();

const followUpText = (title: string) => `关于来源《${title || "无标题"}》再讲讲：`;

const collapsed = ref(props.citations.length > 3);

const toggle = () => {
  collapsed.value = !collapsed.value;
};
</script>

<template>
  <div
    class="ik-aiwf-cite"
    :class="{ 'is-collapsed': collapsed }"
  >
    <button
      type="button"
      class="ik-aiwf-cite__head"
      :aria-expanded="!collapsed"
      @click="toggle"
    >
      <svg
        class="ik-aiwf-cite__icon"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
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
      <span class="ik-aiwf-cite__title">来源（{{ citations.length }}）</span>
      <svg
        class="ik-aiwf-cite__chevron"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 8l4 4 4-4"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <div class="ik-aiwf-cite__body-wrap">
      <div class="ik-aiwf-cite__body">
        <ul class="ik-aiwf-cite__list">
          <li
            v-for="(post, idx) in citations"
            :key="post.documentId"
            class="ik-aiwf-cite__item"
          >
            <button
              type="button"
              class="ik-aiwf-cite__chip"
              @click="emit('open-post', post.documentId)"
            >
              <span class="ik-aiwf-cite__num">{{ idx + 1 }}</span>
              <span class="ik-aiwf-cite__name">{{ post.title || "（无标题）" }}</span>
            </button>
            <button
              type="button"
              class="ik-aiwf-cite__follow"
              :aria-label="`追问来源《${post.title || '无标题'}》`"
              @click.stop="emit('follow-up', followUpText(post.title ?? ''))"
            >
              追问
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ik-aiwf-cite {
  align-self: stretch;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.75);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.ik-aiwf-cite__head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
  transition: background-color 120ms ease;
}

.ik-aiwf-cite__head:hover {
  background: rgba(0, 0, 0, 0.025);
}

.ik-aiwf-cite__icon {
  flex: none;
  width: 14px;
  height: 14px;
  color: rgba(0, 0, 0, 0.5);
}

.ik-aiwf-cite__title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-aiwf-cite__chevron {
  flex: none;
  width: 16px;
  height: 16px;
  color: rgba(0, 0, 0, 0.45);
  transition: transform 180ms ease;
}

.ik-aiwf-cite.is-collapsed .ik-aiwf-cite__chevron {
  transform: rotate(-90deg);
}

.ik-aiwf-cite__body-wrap {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 220ms ease;
}

.ik-aiwf-cite.is-collapsed .ik-aiwf-cite__body-wrap {
  grid-template-rows: 0fr;
}

.ik-aiwf-cite__body {
  min-height: 0;
  overflow: hidden;
}

.ik-aiwf-cite__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0 12px 12px;
  list-style: none;
}

.ik-aiwf-cite__item {
  flex: 0 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.ik-aiwf-cite__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 10px 5px 6px;
  border: 1px solid rgba(44, 88, 226, 0.15);
  border-radius: 999px;
  background: rgba(44, 88, 226, 0.04);
  color: #2c58e2;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
  overflow: hidden;
}

.ik-aiwf-cite__chip:hover {
  background: rgba(44, 88, 226, 0.1);
  border-color: rgba(44, 88, 226, 0.3);
}

.ik-aiwf-cite__follow {
  padding: 2px 7px;
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

.ik-aiwf-cite__item:hover .ik-aiwf-cite__follow,
.ik-aiwf-cite__follow:focus-visible {
  opacity: 1;
  visibility: visible;
}

.ik-aiwf-cite__follow:hover {
  background: rgba(44, 88, 226, 0.1);
  color: #2c58e2;
}

.ik-aiwf-cite__num {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgba(44, 88, 226, 0.12);
  color: #2c58e2;
  font-size: 11px;
  font-weight: 700;
}

.ik-aiwf-cite__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
