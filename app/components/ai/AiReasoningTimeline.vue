<script setup lang="ts">
import { WrenchIcon, MagnifyingGlassIcon, BookOpenIcon, SparklesIcon, CodeBracketIcon } from "@heroicons/vue/24/outline";
import type { WorkflowStepView } from "~/utils/workflow";

const props = defineProps<{
  steps: WorkflowStepView[];
}>();

function formatMs(ms?: number): string {
  if (!ms || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function toolIcon(step: WorkflowStepView) {
  if (step.status === "running") return "spinner";
  const name = toolName(step).toLowerCase();
  if (name.includes("search") || name.includes("搜索") || name.includes("检索")) return MagnifyingGlassIcon;
  if (name.includes("read") || name.includes("阅读") || name.includes("读取") || name.includes("浏览")) return BookOpenIcon;
  if (name.includes("python") || name.includes("ipython")) return CodeBracketIcon;
  if (step.kind === "thinking") return SparklesIcon;
  return WrenchIcon;
}

function toolName(step: WorkflowStepView): string {
  // 新的 title 已经是沉浸式文案；兜底去掉旧"使用 x 工具"模板
  return step.title.replace(/^使用\s*/, "").replace(/\s*工具$/, "");
}

</script>

<template>
  <div v-if="steps.length" class="ai-timeline">
    <div
      v-for="(step, idx) in steps"
      :key="step.stepId"
      class="ai-timeline__item"
    >
      <div class="ai-timeline__rail" aria-hidden="true">
        <span class="ai-timeline__dot" :class="[`is-${step.status}`]" />
        <span v-if="idx < steps.length - 1" class="ai-timeline__line" />
      </div>

      <div class="ai-timeline__content">
        <div class="ai-timeline__meta">
          <span class="ai-timeline__title">{{ step.title }}</span>
          <span v-if="step.subtitle" class="ai-timeline__subtitle">{{ step.subtitle }}</span>
          <span v-if="step.durationMs || step.hits" class="ai-timeline__badge">
            <template v-if="step.hits">{{ step.hits }} 条命中</template>
            <template v-else>{{ formatMs(step.durationMs) }}</template>
          </span>
        </div>

        <div
          v-if="step.kind === 'tool' || step.kind === 'search' || step.kind === 'read'"
          class="ai-timeline__tool-head"
        >
          <span v-if="toolIcon(step) === 'spinner'" class="ai-timeline__tool-spinner" />
          <component v-else :is="toolIcon(step)" class="ai-timeline__tool-icon" />
          <span v-if="step.durationMs" class="ai-timeline__tool-time">{{ formatMs(step.durationMs) }}</span>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="ai-timeline__empty">暂无推理过程</div>
</template>

<style scoped>
.ai-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-top: 4px;
}

.ai-timeline__item {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  column-gap: 10px;
  align-items: flex-start;
  padding-bottom: 14px;
}

.ai-timeline__item:last-child {
  padding-bottom: 0;
}

.ai-timeline__rail {
  position: relative;
  display: flex;
  justify-content: center;
  min-height: 100%;
  padding-top: 6px;
}

.ai-timeline__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #6a6a6a;
  flex-shrink: 0;
}

.ai-timeline__dot.is-running {
  background: #bfff09;
  box-shadow: 0 0 0 4px rgba(191, 255, 9, 0.12);
}

.ai-timeline__dot.is-done {
  background: #2fa552;
}

.ai-timeline__dot.is-error {
  background: #ff4d4f;
}

.ai-timeline__line {
  position: absolute;
  top: 15px;
  bottom: -14px;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.1);
}

.ai-timeline__content {
  min-width: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: #c0c0c0;
}

.ai-timeline__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.ai-timeline__title {
  font-weight: 600;
  color: #e8e8e8;
}

.ai-timeline__subtitle {
  color: #9a9a9a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-timeline__badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: #9a9a9a;
}

.ai-timeline__text {
  margin-top: 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: #b0b0b0;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.55;
}

.ai-timeline__text :deep(p) {
  margin: 0 0 0.5em;
}

.ai-timeline__text :deep(p:last-child) {
  margin-bottom: 0;
}

.ai-timeline__text :deep(code) {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 4px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

.ai-timeline__text :deep(pre) {
  background: rgba(0, 0, 0, 0.35);
  padding: 8px;
  border-radius: 8px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11.5px;
}

.ai-timeline__tool-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #b0b0b0;
  font-size: 12px;
}

.ai-timeline__tool-icon {
  width: 14px;
  height: 14px;
}

.ai-timeline__tool-spinner {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid rgba(191, 255, 9, 0.2);
  border-top-color: #bfff09;
  animation: ai-timeline-spin 0.9s linear infinite;
  flex-shrink: 0;
}

@keyframes ai-timeline-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-timeline__details {
  margin-top: 8px;
  padding-left: 8px;
}

.ai-timeline__detail-block {
  margin-bottom: 10px;
}

.ai-timeline__detail-label {
  font-size: 10px;
  font-weight: 700;
  color: #6a6a6a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.ai-timeline__detail-json {
  padding: 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  color: #b0b0b0;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 220px;
  overflow-y: auto;
  margin: 0;
}

.ai-timeline__posts {
  margin: 0;
  padding-left: 16px;
  color: #b0b0b0;
}

.ai-timeline__post {
  margin: 2px 0;
}

.ai-timeline__empty {
  padding: 24px 0;
  text-align: center;
  color: #6a6a6a;
  font-size: 13px;
}
</style>
