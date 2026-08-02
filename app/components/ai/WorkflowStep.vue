<script setup lang="ts">
import { computed, ref } from "vue";
import type { WorkflowStepView } from "~/utils/workflow";

/**
 * 单条工作流步骤（3.3）：纵向时间轴样式，对齐 ChatGPT / Claude 的 reasoning step。
 * - pending / running / done / error 四态点
 * - 搜索 / 阅读 步骤可展开命中/已读帖子列表
 * - 帖子列表带 grid 展开动画
 */
const props = defineProps<{
  step: WorkflowStepView;
}>();

const emit = defineEmits<{
  (e: "open-post", documentId: string): void;
  /** 追问此帖子：把预设问题回填到输入框 */
  (e: "follow-up", text: string): void;
}>();

const followUpText = (title: string) => `关于《${title || "无标题"}》再详细讲讲：`;

const expanded = ref(false);

const hasDetails = computed(() => (props.step.posts?.length ?? 0) > 0);

const detailLabel = computed(() => {
  if (!hasDetails.value) return "";
  if (props.step.kind === "search") return `命中 ${props.step.hits ?? props.step.posts!.length} 篇`;
  return `${props.step.posts!.length} 篇`;
});

function formatDuration(ms: number): string {
  if (ms < 100) return "<0.1s";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

const durationText = computed(() => {
  if (props.step.status !== "done" || !props.step.durationMs || props.step.durationMs < 50) return "";
  return formatDuration(props.step.durationMs);
});
</script>

<template>
  <li class="ik-aiwf-step" :data-status="step.status">
    <div class="ik-aiwf-step__main">
      <span class="ik-aiwf-step__dot-wrap" aria-hidden="true">
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

      <div class="ik-aiwf-step__content">
        <div class="ik-aiwf-step__row">
          <span class="ik-aiwf-step__title">{{ step.title }}</span>
          <span v-if="step.subtitle" class="ik-aiwf-step__sub">{{ step.subtitle }}</span>
          <span v-if="durationText" class="ik-aiwf-step__time">{{ durationText }}</span>

          <button
            v-if="hasDetails"
            type="button"
            class="ik-aiwf-step__expand"
            @click.stop="expanded = !expanded"
          >
            <span>{{ detailLabel }}</span>
            <svg
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
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="hasDetails"
      class="ik-aiwf-step__details-wrap"
      :class="{ 'is-open': expanded }"
    >
      <ul class="ik-aiwf-step__posts">
        <li
          v-for="post in step.posts"
          :key="post.documentId"
          class="ik-aiwf-step__post-item"
        >
          <button
            type="button"
            class="ik-aiwf-step__post"
            @click="emit('open-post', post.documentId)"
          >
            {{ post.title || "（无标题）" }}
          </button>
          <button
            type="button"
            class="ik-aiwf-step__post-follow"
            :aria-label="`追问《${post.title || '无标题'}》`"
            @click="emit('follow-up', followUpText(post.title ?? ''))"
          >
            追问
          </button>
        </li>
      </ul>
    </div>
  </li>
</template>

<style scoped>
.ik-aiwf-step {
  position: relative;
  margin: 0;
}

.ik-aiwf-step__main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 5px 0;
}

.ik-aiwf-step__dot-wrap {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-top: 1px;
}

/* 时间轴连线：除最后一个 step 外向下延伸 */
.ik-aiwf-step__dot-wrap::before {
  content: "";
  position: absolute;
  top: 18px;
  left: 50%;
  width: 2px;
  height: calc(100% + 10px);
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.08);
}

.ik-aiwf-step:last-child .ik-aiwf-step__dot-wrap::before {
  display: none;
}

.ik-aiwf-step__idle {
  color: rgba(0, 0, 0, 0.28);
  font-size: 10px;
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

.ik-aiwf-step__content {
  flex: 1;
  min-width: 0;
  padding-bottom: 4px;
}

.ik-aiwf-step__row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 10px;
  min-height: 20px;
}

.ik-aiwf-step__title {
  font-weight: 600;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.85);
}

.ik-aiwf-step__sub {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.ik-aiwf-step__time {
  margin-left: auto;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.38);
}

.ik-aiwf-step__expand {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: #2c58e2;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.ik-aiwf-step__expand:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.ik-aiwf-step__chevron {
  width: 13px;
  height: 13px;
  transition: transform 160ms ease;
}

.ik-aiwf-step__chevron.is-open {
  transform: rotate(180deg);
}

/* 帖子列表展开动画 */
.ik-aiwf-step__details-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms ease;
}

.ik-aiwf-step__details-wrap.is-open {
  grid-template-rows: 1fr;
}

.ik-aiwf-step__posts {
  min-height: 0;
  overflow: hidden;
  margin: 0;
  padding: 0 0 8px 28px;
  list-style: none;
}

.ik-aiwf-step__post-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ik-aiwf-step__post {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
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
  transition: background-color 120ms ease;
}

.ik-aiwf-step__post:hover {
  background: rgba(44, 88, 226, 0.08);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.ik-aiwf-step__post-follow {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(44, 88, 226, 0.65);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}

.ik-aiwf-step__post-item:hover .ik-aiwf-step__post-follow,
.ik-aiwf-step__post-follow:focus-visible {
  opacity: 1;
  visibility: visible;
}

.ik-aiwf-step__post-follow:hover {
  background: rgba(44, 88, 226, 0.1);
  color: #2c58e2;
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
