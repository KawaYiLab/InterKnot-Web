<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AiWorkflowEvent } from "~/types/entities";
import {
  buildWorkflowSteps,
  extractCitations,
  isWorkflowSettled,
} from "~/utils/workflow";

/**
 * AI 工作流时间线卡（3.3）：渲染在 AI 回答气泡上方（工作流永远在回答上方）。
 * 进行中展开显示步骤流；answer.finish / error 后自动折叠为
 * 「⚡ AI 工作流（N）」，点击可重新展开查看执行记录与引用资料。
 */
const props = defineProps<{
  /** 该消息聚合的 WorkflowEvent 序列（实时推送或落库回放） */
  events: AiWorkflowEvent[];
}>();

const emit = defineEmits<{
  (e: "open-post", documentId: string): void;
}>();

const steps = computed(() => buildWorkflowSteps(props.events));
const citations = computed(() => extractCitations(props.events));
const settled = computed(() => isWorkflowSettled(props.events));

/** 历史回放（已收束）默认折叠；实时进行中默认展开 */
const collapsed = ref(settled.value);

/** 实时流：收束瞬间自动折叠（ai.md 五「结束后自动折叠」） */
watch(settled, (done, was) => {
  if (done && !was) collapsed.value = true;
});

const runningStep = computed(() =>
  steps.value.find((s) => s.status === "running"),
);

const summaryText = computed(() => {
  if (!settled.value) {
    return runningStep.value
      ? `${runningStep.value.title}${runningStep.value.subtitle ? ` ${runningStep.value.subtitle}` : ""}`
      : "正在工作…";
  }
  return `AI 工作流（${steps.value.length}）`;
});

const hasError = computed(() => steps.value.some((s) => s.status === "error"));
</script>

<template>
  <div
    class="ik-aiwf"
    :class="{ 'is-collapsed': collapsed, 'is-running': !settled, 'is-error': hasError }"
  >
    <button
      type="button"
      class="ik-aiwf__head"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <span class="ik-aiwf__bolt" aria-hidden="true">⚡</span>
      <span class="ik-aiwf__summary">{{ summaryText }}</span>
      <span v-if="!settled" class="ik-aiwf__pulse" aria-hidden="true" />
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

    <!-- 高度展开动画：grid 0fr/1fr 过渡，轻量无 JS 测量 -->
    <div class="ik-aiwf__body-wrap">
      <div class="ik-aiwf__body">
        <ol class="ik-aiwf__steps">
          <AiWorkflowStep
            v-for="step in steps"
            :key="step.stepId"
            :step="step"
            @open-post="emit('open-post', $event)"
          />
        </ol>
        <AiCitationList
          v-if="citations.length > 0"
          :citations="citations"
          @open-post="emit('open-post', $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ik-aiwf {
  align-self: stretch;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 12px;
  background: #fffdf2;
  overflow: hidden;
  font-size: 13px;
}

.ik-aiwf.is-running {
  border-color: rgba(44, 88, 226, 0.35);
}

.ik-aiwf.is-error {
  border-color: rgba(255, 90, 90, 0.45);
}

.ik-aiwf__head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: rgba(0, 0, 0, 0.72);
  text-align: left;
}

.ik-aiwf__head:hover {
  background: rgba(0, 0, 0, 0.04);
}

.ik-aiwf__bolt {
  flex: none;
  font-size: 13px;
}

.ik-aiwf__summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

/* 进行中的呼吸点 */
.ik-aiwf__pulse {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2c58e2;
  animation: ik-aiwf-pulse 1.1s ease-in-out infinite;
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
  padding: 2px 10px 8px;
  list-style: none;
}

@keyframes ik-aiwf-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.72);
  }
}
</style>
