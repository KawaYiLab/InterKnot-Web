<script setup lang="ts">
import { computed, ref } from "vue";
import type { WorkflowStepView } from "~/utils/workflow";

/**
 * 单条工作流步骤（3.3）：四色状态 + 可交互执行记录。
 * - 等待灰 ○ / 运行蓝 ◉（旋转圈）/ 完成绿 ✓（放大动画）/ 失败红 ✕
 * - 「搜索论坛」显示关键词与命中数，点击展开命中帖子列表；
 *   「阅读帖子」显示《标题》，点击展开已读帖子列表（可打开 postModal）。
 */
const props = defineProps<{
  step: WorkflowStepView;
}>();

const emit = defineEmits<{
  (e: "open-post", documentId: string): void;
}>();

const expanded = ref(false);

const hasPosts = computed(() => (props.step.posts?.length ?? 0) > 0);

const detailLabel = computed(() => {
  if (!hasPosts.value) return "";
  if (props.step.kind === "search") return `命中 ${props.step.hits ?? props.step.posts!.length} 篇`;
  return `${props.step.posts!.length} 篇`;
});
</script>

<template>
  <li class="ik-aiwf-step" :data-status="step.status">
    <component
      :is="hasPosts ? 'button' : 'div'"
      :type="hasPosts ? 'button' : undefined"
      class="ik-aiwf-step__row"
      :class="{ 'is-clickable': hasPosts }"
      @click="hasPosts && (expanded = !expanded)"
    >
      <span class="ik-aiwf-step__dot" aria-hidden="true">
        <span v-if="step.status === 'running'" class="ik-aiwf-step__spinner" />
        <svg
          v-else-if="step.status === 'done'"
          class="ik-aiwf-step__check"
          viewBox="0 0 20 20"
          fill="none"
        >
          <path
            d="M5 10.5l3.2 3.2L15 7"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span v-else-if="step.status === 'error'" class="ik-aiwf-step__cross">✕</span>
        <span v-else class="ik-aiwf-step__idle">○</span>
      </span>
      <span class="ik-aiwf-step__label">
        <span class="ik-aiwf-step__title">{{ step.title }}</span>
        <span v-if="step.subtitle" class="ik-aiwf-step__sub">{{ step.subtitle }}</span>
      </span>
      <span v-if="hasPosts" class="ik-aiwf-step__count">{{ detailLabel }}</span>
      <svg
        v-if="hasPosts"
        class="ik-aiwf-step__chevron"
        :class="{ 'is-open': expanded }"
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
    </component>

    <ul v-if="hasPosts && expanded" class="ik-aiwf-step__posts">
      <li v-for="post in step.posts" :key="post.documentId">
        <button
          type="button"
          class="ik-aiwf-step__post"
          @click="emit('open-post', post.documentId)"
        >
          {{ post.title || "（无标题）" }}
        </button>
      </li>
    </ul>
  </li>
</template>

<style scoped>
.ik-aiwf-step {
  margin: 0;
}

.ik-aiwf-step__row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 2px;
  border: 0;
  background: transparent;
  font: inherit;
  color: rgba(0, 0, 0, 0.7);
  text-align: left;
}

.ik-aiwf-step__row.is-clickable {
  cursor: pointer;
  border-radius: 8px;
}

.ik-aiwf-step__row.is-clickable:hover {
  background: rgba(0, 0, 0, 0.045);
}

/* ── 状态四色 ─────────────────────────── */
.ik-aiwf-step__dot {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}

.ik-aiwf-step__idle {
  color: rgba(0, 0, 0, 0.3);
  font-size: 11px;
}

.ik-aiwf-step__spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid rgba(44, 88, 226, 0.25);
  border-top-color: #2c58e2;
  animation: ik-aiwf-spin 0.8s linear infinite;
}

.ik-aiwf-step__check {
  width: 14px;
  height: 14px;
  color: #2fa552;
  animation: ik-aiwf-pop 220ms ease-out;
}

.ik-aiwf-step__cross {
  color: #ff5a5a;
  font-size: 12px;
  font-weight: 700;
}

.ik-aiwf-step__label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  overflow: hidden;
}

.ik-aiwf-step__title {
  flex: none;
  font-weight: 600;
}

.ik-aiwf-step__sub {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(0, 0, 0, 0.48);
  font-size: 12px;
}

.ik-aiwf-step__count {
  flex: none;
  color: rgba(0, 0, 0, 0.42);
  font-size: 12px;
}

.ik-aiwf-step__chevron {
  flex: none;
  width: 14px;
  height: 14px;
  color: rgba(0, 0, 0, 0.4);
  transition: transform 160ms ease;
}

.ik-aiwf-step__chevron.is-open {
  transform: rotate(180deg);
}

/* ── 展开的帖子列表（可点开 postModal） ── */
.ik-aiwf-step__posts {
  margin: 0 0 4px;
  padding: 0 0 0 24px;
  list-style: none;
}

.ik-aiwf-step__post {
  display: block;
  width: 100%;
  padding: 3px 8px;
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

.ik-aiwf-step__post:hover {
  background: rgba(44, 88, 226, 0.08);
  text-decoration: underline;
  text-underline-offset: 2px;
}

@keyframes ik-aiwf-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes ik-aiwf-pop {
  0% {
    transform: scale(0.4);
    opacity: 0;
  }
  70% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
