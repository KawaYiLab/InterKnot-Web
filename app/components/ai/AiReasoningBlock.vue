<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { ChevronRightIcon, ArrowTopRightOnSquareIcon } from "@heroicons/vue/24/outline";
import type { DmMessage } from "~/types/entities";
import { buildWorkflowSteps } from "~/utils/workflow";

const props = defineProps<{
  msg: DmMessage;
  streaming?: boolean;
}>();

const emit = defineEmits<{
  (e: "open-sidebar", msg: DmMessage): void;
}>();

const expanded = ref(false);
const previewText = ref("");
let previewTimer: ReturnType<typeof setInterval> | null = null;
let previewStartTimer: ReturnType<typeof setTimeout> | null = null;

const events = computed(() => props.msg.workflow ?? []);
const steps = computed(() => buildWorkflowSteps(events.value));
const settled = computed(() => {
  return events.value.some((ev) => ev.type === "answer.finish" || ev.type === "error");
});

const thinkSteps = computed(() => steps.value.filter((s) => s.kind === "thinking"));
const toolSteps = computed(() =>
  steps.value.filter((s) => s.kind === "tool" || s.kind === "search" || s.kind === "read"),
);

const reasoningText = computed(() =>
  thinkSteps.value
    .map((s) => s.text || "")
    .filter(Boolean)
    .join("\n"),
);

const title = computed(() => {
  if (!settled.value) {
    const running = steps.value.find((s) => s.status === "running");
    if (running) return `正在${running.title}…`;
    return "正在分析…";
  }
  const parts: string[] = [];
  if (thinkSteps.value.length) parts.push(`思考了 ${thinkSteps.value.length} 次`);
  if (toolSteps.value.length) parts.push(`使用了 ${toolSteps.value.length} 次工具`);
  if (!parts.length) parts.push("思考完成");
  return parts.join(" · ");
});

const durationText = computed(() => {
  if (!settled.value || !events.value.length) return "";
  const start = new Date(events.value[0]!.at).getTime();
  const end = new Date(events.value[events.value.length - 1]!.at).getTime();
  const ms = end - start;
  if (ms < 1000) return `${Math.round(ms / 100)}0ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
});

function latestPreview() {
  return reasoningText.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .join("\n");
}

function updatePreview() {
  const next = latestPreview();
  if (!next || next === previewText.value) return;
  previewText.value = next;
}

function stopPreviewTimer() {
  if (previewTimer) {
    clearInterval(previewTimer);
    previewTimer = null;
  }
  if (previewStartTimer) {
    clearTimeout(previewStartTimer);
    previewStartTimer = null;
  }
}

function syncPreview() {
  if (props.streaming && !expanded.value && reasoningText.value) {
    if (!previewTimer && !previewStartTimer) {
      previewStartTimer = setTimeout(() => {
        previewStartTimer = null;
        if (props.streaming && !expanded.value) {
          updatePreview();
          previewTimer = setInterval(updatePreview, 1500);
        }
      }, 1200);
    }
    return;
  }
  stopPreviewTimer();
  if (!props.streaming) previewText.value = "";
}

watch(
  () => [props.streaming, expanded.value, reasoningText.value],
  syncPreview,
  { immediate: true },
);

onBeforeUnmount(stopPreviewTimer);
</script>

<template>
  <div class="ai-rb">
    <button type="button" class="ai-rb__head" @click="expanded = !expanded">
      <span class="ai-rb__status" :class="{ running: !settled }">
        <span v-if="!settled" class="ai-rb__spinner" />
        <svg v-else class="ai-rb__ok" viewBox="0 0 20 20" fill="none">
          <path d="M4 10l4 4 8-8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="ai-rb__title-wrap">
        <span class="ai-rb__title">{{ title }}</span>
        <span v-if="durationText" class="ai-rb__duration">{{ durationText }}</span>
      </span>
      <ChevronRightIcon class="ai-rb__chevron" :class="{ expanded }" />
    </button>

    <button
      v-if="steps.length"
      type="button"
      class="ai-rb__open"
      title="在侧边栏打开"
      @click="emit('open-sidebar', msg)"
    >
      <ArrowTopRightOnSquareIcon class="ai-rb__icon" />
    </button>

    <div v-if="expanded" class="ai-rb__body">
      <AiReasoningTimeline :steps="steps" />
    </div>

    <div v-else-if="previewText" class="ai-rb__preview">
      {{ previewText }}
    </div>
  </div>
</template>

<style scoped>
.ai-rb {
  display: inline-flex;
  flex-direction: column;
  max-width: 100%;
  margin: 2px 0 8px;
  padding: 8px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: #9a9a9a;
  font-size: 13px;
  line-height: 1.5;
  position: relative;
}

.ai-rb__head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  user-select: none;
  min-width: 0;
}

.ai-rb__head:hover {
  color: #e8e8e8;
}

.ai-rb__status {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #2fa552;
}

.ai-rb__status.running {
  color: #bfff09;
}

.ai-rb__spinner {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid rgba(191, 255, 9, 0.2);
  border-top-color: #bfff09;
  animation: ai-rb-spin 0.9s linear infinite;
}

@keyframes ai-rb-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-rb__ok {
  width: 15px;
  height: 15px;
}

.ai-rb__title-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.ai-rb__title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #b8b8b8;
}

.ai-rb__head:hover .ai-rb__title {
  color: #e8e8e8;
}

.ai-rb__duration {
  flex-shrink: 0;
  font-size: 11px;
  color: #6a6a6a;
}

.ai-rb__chevron {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.ai-rb__chevron.expanded {
  transform: rotate(90deg);
}

.ai-rb__open {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #6a6a6a;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}

.ai-rb:hover .ai-rb__open {
  opacity: 1;
}

.ai-rb__open:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #e8e8e8;
}

.ai-rb__icon {
  width: 14px;
  height: 14px;
}

.ai-rb__body {
  margin-top: 10px;
  padding-top: 2px;
  animation: ai-rb-fade 0.2s ease;
}

.ai-rb__preview {
  margin-top: 6px;
  max-height: 4.8em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  white-space: pre-line;
  color: #7a7a7a;
  font-size: 12.5px;
  line-height: 1.6;
}

@keyframes ai-rb-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
