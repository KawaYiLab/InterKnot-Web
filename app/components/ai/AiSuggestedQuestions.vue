<script setup lang="ts">
import { computed, ref } from "vue";
import type { AiRoleCard } from "~/types/entities";

/**
 * AI 对话开场推荐问题（Phase 2）：
 * 在 AI 会话消息为空或首次进入时展示，降低用户首句输入成本。
 * 支持后端配置 suggestedQuestions，也支持前端兜底生成。
 */
const props = defineProps<{
  character: AiRoleCard | null | undefined;
}>();

const emit = defineEmits<{
  (e: "send", question: string): void;
  (e: "refresh", character: AiRoleCard): void;
}>();

const rotationSeed = ref(0);

const allQuestions = computed(() => {
  if (!props.character) return ["介绍一下你自己", "最近论坛有什么热门委托？", "帮我推荐一篇值得看的帖子"];
  if (Array.isArray(props.character.suggestedQuestions) && props.character.suggestedQuestions.length > 0) {
    return props.character.suggestedQuestions;
  }
  const name = props.character.displayName || "你";
  return [
    `介绍一下${name}自己`,
    `作为${name}，你怎么看最近的委托？`,
    `给我推荐一篇适合${name}介绍的帖子`,
    `${name}有什么比较擅长的领域？`,
  ];
});

const shownQuestions = computed(() => {
  const pool = allQuestions.value;
  if (pool.length <= 4) return pool;
  // 轮询展示：每次点击「换一批」从池中取 4 个
  const start = (rotationSeed.value * 4) % pool.length;
  const result: string[] = [];
  for (let i = 0; i < 4; i++) {
    result.push(pool[(start + i) % pool.length]!);
  }
  return result;
});

const canRotate = computed(() => allQuestions.value.length > 4);

const rotate = () => {
  if (!canRotate.value) return;
  rotationSeed.value = (rotationSeed.value + 1) % Math.ceil(allQuestions.value.length / 4);
};
</script>

<template>
  <div class="ik-ai-sq">
    <div class="ik-ai-sq__head">
      <span class="ik-ai-sq__title">你可以问我</span>
      <button
        v-if="canRotate"
        type="button"
        class="ik-ai-sq__refresh"
        aria-label="换一批推荐问题"
        @click="rotate"
      >
        <svg class="ik-ai-sq__refresh-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M4 10a6 6 0 0 1 6-6m4 0v4h-4m6 6a6 6 0 0 1-6 6m-4 0v-4h4"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        换一批
      </button>
    </div>
    <ul class="ik-ai-sq__list">
      <li v-for="(question, idx) in shownQuestions" :key="`${rotationSeed}-${idx}`" class="ik-ai-sq__item">
        <button
          type="button"
          class="ik-ai-sq__chip"
          @click="emit('send', question)"
        >
          {{ question }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ik-ai-sq {
  align-self: stretch;
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.ik-ai-sq__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.ik-ai-sq__title {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.5px;
}

.ik-ai-sq__refresh {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}

.ik-ai-sq__refresh:hover {
  color: #fbfe00;
  background: rgba(255, 255, 255, 0.06);
}

.ik-ai-sq__refresh-icon {
  width: 14px;
  height: 14px;
}

.ik-ai-sq__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ik-ai-sq__item {
  flex: 0 1 auto;
  min-width: 0;
}

.ik-ai-sq__chip {
  display: inline-block;
  max-width: 100%;
  padding: 7px 13px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.78);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}

.ik-ai-sq__chip:hover {
  background: #fbfe00;
  border-color: #fbfe00;
  color: #000;
}
</style>
