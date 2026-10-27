<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  ChevronRightIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  MagnifyingGlassIcon,
  StopCircleIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/vue/24/outline";
import type { WorkflowStepView } from "~/utils/workflow";

/**
 * AI 回复里一组连续的过程步骤（思考 / 检索 / 读帖 / 工具），穿插在回答气泡之间。
 * 每步一行：图标 + 动作 + 对象 + 耗时；检索可展开看命中帖子。
 * 生成中逐行展开；这组步骤跑完、后面已经开始写回答（或整条回复结束）时，多步的组收成一行摘要，可再点开。
 * 思考原文与工具参数 / 结果后端不下发（WF-003），这里只展示骨架。
 */
const props = defineProps<{
  steps: WorkflowStepView[];
  /** 整条回复已结束（正文定稿）：多步组自动收起 */
  settled: boolean;
  /** 后面已经有回答气泡：这组步骤跑完就收起，不等整条回复结束 */
  followed?: boolean;
}>();

const emit = defineEmits<{
  (e: "open-post", documentId: string): void;
}>();

const collapsible = computed(() => props.steps.length > 1);
/** 这组步骤已告一段落 */
const done = computed(
  () => props.settled || (!!props.followed && props.steps.every((s) => s.status !== "running")),
);
const collapsed = ref(done.value && collapsible.value);
watch(done, (v) => {
  if (v && collapsible.value) collapsed.value = true;
});

/** 展开了命中列表的检索步骤 */
const openItems = ref(new Set<string>());
function toggleItems(stepId: string) {
  const next = new Set(openItems.value);
  if (next.has(stepId)) next.delete(stepId);
  else next.add(stepId);
  openItems.value = next;
}

function formatMs(ms?: number): string {
  if (ms == null || ms < 0) return "";
  if (ms < 1000) return `${Math.max(0.1, Math.round(ms / 100) / 10)}s`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

/**
 * 进行中步骤的实时计时：按本机首次看到它运行的时刻算，避免服务端与本机时钟偏差；
 * 只在有步骤运行时每秒走一次。
 */
const now = ref(Date.now());
const firstSeen = new Map<string, number>();
let ticker: ReturnType<typeof setInterval> | null = null;
watch(
  () => props.steps.filter((s) => s.status === "running").map((s) => s.stepId),
  (running) => {
    for (const id of running) if (!firstSeen.has(id)) firstSeen.set(id, Date.now());
    if (running.length && !ticker) {
      ticker = setInterval(() => (now.value = Date.now()), 1000);
    } else if (!running.length && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker);
});

function iconOf(step: WorkflowStepView) {
  if (step.kind === "error") return ExclamationTriangleIcon;
  if (step.kind === "limit") return StopCircleIcon;
  if (step.kind === "thinking") return LightBulbIcon;
  if (step.kind === "search") return MagnifyingGlassIcon;
  if (step.kind === "read") return DocumentTextIcon;
  return WrenchScrewdriverIcon;
}

function titleOf(step: WorkflowStepView): string {
  if (step.kind !== "thinking") return step.title;
  return step.status === "running" ? "思考中" : "已思考";
}

/** 行尾只放耗时：进行中走实时计时，结束后只有思考保留用时；失败、上限靠图标与颜色表达 */
function metaOf(step: WorkflowStepView): string {
  if (step.status === "running") {
    const seen = firstSeen.get(step.stepId);
    const elapsed = seen == null ? 0 : now.value - seen;
    return elapsed >= 1000 ? `${Math.floor(elapsed / 1000)}s` : "";
  }
  return step.kind === "thinking" ? formatMs(step.durationMs) : "";
}

/**
 * 只有整条回复生成出错才标红。单个工具调用失败（参数不对、文档不存在）是模型试探后自己改参数重试的常态，
 * 照常显示，不吓人。
 */
const failed = computed(() => props.steps.some((s) => s.kind === "error"));

const summary = computed(() => {
  const tools = props.steps.filter((s) => !["thinking", "error", "limit"].includes(s.kind)).length;
  return tools ? `调用了 ${tools} 个工具` : "已思考";
});
</script>

<template>
  <div class="ai-steps" :class="{ 'is-collapsed': collapsed }">
    <button
      v-if="collapsible && collapsed"
      type="button"
      class="ai-steps__row ai-steps__summary"
      :aria-expanded="false"
      @click="collapsed = false"
    >
      <span class="ai-steps__icon" :class="{ 'is-error': failed }">
        <ExclamationTriangleIcon v-if="failed" />
        <WrenchScrewdriverIcon v-else />
      </span>
      <span class="ai-steps__title">{{ summary }}</span>
      <ChevronRightIcon class="ai-steps__chevron" />
    </button>

    <template v-else>
      <button
        v-if="collapsible && done"
        type="button"
        class="ai-steps__row ai-steps__summary"
        :aria-expanded="true"
        @click="collapsed = true"
      >
        <span class="ai-steps__icon" :class="{ 'is-error': failed }">
          <ExclamationTriangleIcon v-if="failed" />
          <WrenchScrewdriverIcon v-else />
        </span>
        <span class="ai-steps__title">{{ summary }}</span>
          <ChevronRightIcon class="ai-steps__chevron is-open" />
      </button>

      <ol class="ai-steps__list" :class="{ 'is-nested': collapsible && done }">
        <li v-for="step in steps" :key="step.stepId" class="ai-steps__item">
          <component
            :is="step.items?.length ? 'button' : 'div'"
            :type="step.items?.length ? 'button' : undefined"
            class="ai-steps__row"
            :class="[`is-${step.status}`, `kind-${step.kind}`, { 'is-clickable': !!step.items?.length }]"
            :aria-expanded="step.items?.length ? openItems.has(step.stepId) : undefined"
            @click="step.items?.length ? toggleItems(step.stepId) : undefined"
          >
            <span class="ai-steps__icon" :class="{ 'is-error': step.kind === 'error' }">
              <span v-if="step.status === 'running'" class="ai-steps__spinner" />
              <component :is="iconOf(step)" v-else />
            </span>
            <span class="ai-steps__title" :class="{ 'is-shimmer': step.status === 'running' }">
              {{ titleOf(step) }}
            </span>
            <a
              v-if="step.postId && step.subtitle"
              :href="`/post/${step.postId}`"
              class="ai-steps__subtitle is-link"
              @click.prevent.stop="emit('open-post', step.postId)"
            >{{ step.subtitle }}</a>
            <span v-else-if="step.subtitle" class="ai-steps__subtitle">{{ step.subtitle }}</span>
            <span v-if="metaOf(step)" class="ai-steps__meta">{{ metaOf(step) }}</span>
            <ChevronRightIcon
              v-if="step.items?.length"
              class="ai-steps__chevron"
              :class="{ 'is-open': openItems.has(step.stepId) }"
            />
          </component>
          <ul v-if="step.items?.length && openItems.has(step.stepId)" class="ai-steps__hits">
            <li v-for="item in step.items" :key="item.documentId">
              <a
                :href="`/post/${item.documentId}`"
                class="ai-steps__hit"
                @click.prevent="emit('open-post', item.documentId)"
              >{{ item.title || "无标题" }}</a>
            </li>
          </ul>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.ai-steps {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  color: #8f8f8f;
  font-size: 13px;
  line-height: 1.45;
}

.ai-steps__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 摘要展开后的步骤：左侧一条细竖线，和摘要行形成层级 */
.ai-steps__list.is-nested {
  margin: 2px 0 2px 7px;
  padding-left: 12px;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}

.ai-steps__item {
  min-width: 0;
}

.ai-steps__row {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  min-width: 0;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

button.ai-steps__row {
  cursor: pointer;
}

button.ai-steps__row:hover,
button.ai-steps__row:hover .ai-steps__title {
  color: #e8e8e8;
}

button.ai-steps__row:focus-visible {
  outline: 2px solid #fbfe00;
  outline-offset: 2px;
  border-radius: 4px;
}

.ai-steps__icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #6f6f6f;
}

.ai-steps__icon > :deep(svg) {
  width: 15px;
  height: 15px;
}

.ai-steps__icon.is-error {
  color: #ff6b6b;
}

.ai-steps__spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1.6px solid rgba(191, 255, 9, 0.2);
  border-top-color: #bfff09;
  animation: ai-steps-spin 0.9s linear infinite;
}

@keyframes ai-steps-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-steps__title {
  flex-shrink: 0;
  color: #b5b5b5;
  font-weight: 500;
  white-space: nowrap;
}

/* 工具轮数用完：琥珀色提示，不算出错 */
.ai-steps__row.kind-limit .ai-steps__icon,
.ai-steps__row.kind-limit .ai-steps__title {
  color: #d9a441;
}

.ai-steps__row.kind-error .ai-steps__title {
  color: #ff8a8a;
}

/* 进行中：文字上扫过一道高光 */
.ai-steps__title.is-shimmer {
  color: transparent;
  background: linear-gradient(
    90deg,
    #8a8a8a 0%,
    #8a8a8a 35%,
    #f2f2f2 50%,
    #8a8a8a 65%,
    #8a8a8a 100%
  );
  background-size: 250% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation: ai-steps-shimmer 1.8s linear infinite;
}

@keyframes ai-steps-shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -50% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-steps__title.is-shimmer {
    animation: none;
    color: #d0d0d0;
    background: none;
  }
}

.ai-steps__subtitle {
  min-width: 0;
  color: #7c7c7c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-steps__subtitle.is-link {
  text-decoration: none;
  cursor: pointer;
}

.ai-steps__subtitle.is-link:hover {
  color: #fbfe00;
}

.ai-steps__meta {
  flex-shrink: 0;
  color: #5f5f5f;
  font-size: 12px;
  white-space: nowrap;
}

.ai-steps__chevron {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  color: #6a6a6a;
  transition: transform 0.18s ease;
}

.ai-steps__chevron.is-open {
  transform: rotate(90deg);
}

.ai-steps__hits {
  margin: 2px 0 4px 22px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ai-steps__hit {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8a8a8a;
  font-size: 12.5px;
  text-decoration: none;
  cursor: pointer;
}

.ai-steps__hit::before {
  content: "·";
  margin-right: 6px;
  color: #555;
}

.ai-steps__hit:hover {
  color: #fbfe00;
}
</style>
