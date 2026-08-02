<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AiWorkflowEvent } from "~/types/entities";
import { buildWorkflowSteps, extractCitations, isWorkflowSettled } from "~/utils/workflow";

/**
 * AI 工作流时间线卡（3.3）：对齐 ChatGPT / Claude 的 Reasoning / Thinking 面板。
 * - 运行中 header 显示当前步骤并自动展开。
 * - 完成后 header 折叠为「已分析完成 · N 步 · 引用 M 篇帖子」，带总耗时。
 * - 展开后是纵向时间轴：状态点 + 步骤标题/副文案 + 展开帖子列表。
 */
const props = defineProps<{
  /** 该消息聚合的 WorkflowEvent 序列（实时推送或落库回放） */
  events: AiWorkflowEvent[];
}>();

const emit = defineEmits<{
  (e: "open-post", documentId: string): void;
  (e: "follow-up", text: string): void;
}>();

const steps = computed(() => buildWorkflowSteps(props.events));
const settled = computed(() => isWorkflowSettled(props.events));

/** 历史回放（已收束）默认折叠；实时进行中默认展开 */
const collapsed = ref(settled.value);

/** 实时流：收束瞬间自动折叠 */
watch(settled, (done, was) => {
  if (done && !was) collapsed.value = true;
});

const hasError = computed(() => steps.value.some((s) => s.status === "error"));
const allDone = computed(() => settled.value && !hasError.value);
const citations = computed(() => extractCitations(props.events));

const runningStep = computed(() => steps.value.find((s) => s.status === "running"));

function formatDuration(ms: number): string {
  if (ms < 100) return "<0.1s";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

const totalDurationMs = computed(() => {
  if (!props.events.length) return 0;
  const first = props.events[0]?.at;
  const last = props.events[props.events.length - 1]?.at;
  if (!first || !last) return 0;
  return new Date(last).getTime() - new Date(first).getTime();
});

const headerTitle = computed(() => {
  if (hasError.value) return "执行出错";
  if (!settled.value) {
    if (runningStep.value?.subtitle) return `正在${runningStep.value.title} · ${runningStep.value.subtitle}`;
    return runningStep.value ? `正在${runningStep.value.title}…` : "正在分析…";
  }
  const stepCount = steps.value.filter((s) => s.kind !== "error").length;
  const citeCount = citations.value.length;
  const parts = [`已分析完成`, `${stepCount} 个步骤`];
  if (citeCount) parts.push(`引用 ${citeCount} 篇帖子`);
  return parts.join(" · ");
});

const headerMeta = computed(() => {
  if (!settled.value) return "";
  return totalDurationMs.value > 0 ? `用时 ${formatDuration(totalDurationMs.value)}` : "";
});
</script>

<template>
  <div
    class="ik-aiwf"
    :class="{
      'is-collapsed': collapsed,
      'is-running': !settled,
      'is-error': hasError,
      'is-done': allDone,
    }"
  >
    <button
      type="button"
      class="ik-aiwf__head"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <span class="ik-aiwf__status" aria-hidden="true">
        <span v-if="!settled" class="ik-aiwf__spinner" />
        <svg
          v-else-if="hasError"
          class="ik-aiwf__icon ik-aiwf__icon--error"
          viewBox="0 0 20 20"
          fill="none"
        >
          <path
            d="M6 6l8 8M14 6l-8 8"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
          />
        </svg>
        <svg
          v-else
          class="ik-aiwf__icon ik-aiwf__icon--ok"
          viewBox="0 0 20 20"
          fill="none"
        >
          <path
            d="M4 10l4 4 8-8"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>

      <span class="ik-aiwf__summary">
        <span class="ik-aiwf__title">{{ headerTitle }}</span>
        <span v-if="headerMeta" class="ik-aiwf__meta">{{ headerMeta }}</span>
      </span>

      <svg
        class="ik-aiwf__chevron"
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

    <div class="ik-aiwf__body-wrap">
      <div class="ik-aiwf__body">
        <ol class="ik-aiwf__steps">
          <AiWorkflowStep
            v-for="step in steps"
            :key="step.stepId"
            :step="step"
            @open-post="emit('open-post', $event)"
            @follow-up="emit('follow-up', $event)"
          />
        </ol>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ik-aiwf {
  align-self: stretch;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.75);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.ik-aiwf.is-running {
  border-color: rgba(44, 88, 226, 0.25);
}

.ik-aiwf.is-error {
  border-color: rgba(255, 90, 90, 0.35);
}

.ik-aiwf__head {
  display: flex;
  align-items: center;
  gap: 10px;
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

.ik-aiwf__head:hover {
  background: rgba(0, 0, 0, 0.025);
}

.ik-aiwf__status {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.ik-aiwf__spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(44, 88, 226, 0.2);
  border-top-color: #2c58e2;
  animation: ik-aiwf-spin 0.9s linear infinite;
}

.ik-aiwf__icon {
  width: 15px;
  height: 15px;
}

.ik-aiwf__icon--ok {
  color: #2fa552;
}

.ik-aiwf__icon--error {
  color: #ff5a5a;
}

.ik-aiwf__summary {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
}

.ik-aiwf__title {
  font-weight: 600;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-aiwf__meta {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.45);
}

.ik-aiwf__chevron {
  flex: none;
  width: 16px;
  height: 16px;
  color: rgba(0, 0, 0, 0.45);
  transition: transform 180ms ease;
}

.ik-aiwf:not(.is-collapsed) .ik-aiwf__chevron {
  transform: rotate(180deg);
}

.ik-aiwf__body-wrap {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 220ms ease;
}

.ik-aiwf.is-collapsed .ik-aiwf__body-wrap {
  grid-template-rows: 0fr;
}

.ik-aiwf__body {
  min-height: 0;
  overflow: hidden;
}

.ik-aiwf__steps {
  margin: 0;
  padding: 4px 12px 12px;
  list-style: none;
}

@keyframes ik-aiwf-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
