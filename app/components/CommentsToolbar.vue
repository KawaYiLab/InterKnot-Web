<script setup lang="ts">
import type { CommentSort } from "~/composables/useApi";

/** 评论区顶部：评论数 + 最早 / 最新切换。帖子页与弹窗共用。 */
defineProps<{ count: number; disabled?: boolean }>();
const sort = defineModel<CommentSort>("sort", { required: true });

const options: { value: CommentSort; label: string }[] = [
  { value: "oldest", label: "最早" },
  { value: "newest", label: "最新" },
];
</script>

<template>
  <div class="ik-comments-toolbar">
    <h2 class="ik-comments-toolbar__count">评论 <span>{{ count }}</span></h2>
    <!-- 滑块式切换（参考 Inspira UI Animated Tabs 的高亮块） -->
    <div class="ik-sort" role="radiogroup" :class="{ 'is-newest': sort === 'newest' }">
      <span class="ik-sort__pill" aria-hidden="true" />
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        role="radio"
        class="ik-sort__option"
        :class="{ 'is-active': sort === opt.value }"
        :aria-checked="sort === opt.value"
        :disabled="disabled"
        @click="sort = opt.value"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ik-comments-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 8px;
}

.ik-comments-toolbar__count {
  margin: 0;
  color: #ededed;
  font-size: 16px;
  line-height: 1.4;
  font-weight: 700;
}

.ik-comments-toolbar__count span {
  margin-left: 4px;
  color: #9a9a9a;
  font-size: 13px;
  font-weight: 400;
}

.ik-sort {
  position: relative;
  display: inline-grid;
  grid-template-columns: 1fr 1fr;
  padding: 3px;
  border: 1px solid #2a2a2a;
  border-radius: 999px;
  background: #111;
}

.ik-sort__pill {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  border-radius: 999px;
  background: var(--ik-primary);
  transition: transform 260ms cubic-bezier(0.3, 1.3, 0.5, 1);
}

.ik-sort.is-newest .ik-sort__pill {
  transform: translateX(100%);
}

.ik-sort__option {
  position: relative;
  z-index: 1;
  min-width: 52px;
  height: 26px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: #9a9a9a;
  font-size: 13px;
  font-weight: 700;
  cursor: var(--ik-cursor-pointer);
  transition: color 200ms ease;
}

.ik-sort__option:hover:not(.is-active):not(:disabled) {
  color: #ededed;
}

.ik-sort__option.is-active {
  color: #000;
}

.ik-sort__option:disabled {
  cursor: default;
}
</style>
