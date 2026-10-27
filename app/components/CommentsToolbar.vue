<script setup lang="ts">
import { ref, watch } from "vue";
import { ArrowRightIcon } from "@heroicons/vue/20/solid";
import type { CommentSort } from "~/composables/useApi";
import SpotlightInput from "~/components/inspira/SpotlightInput.vue";

/** 评论区顶部：最早 / 最新切换 + 跳到第几楼。帖子页与弹窗共用。 */
defineProps<{ disabled?: boolean }>();
const sort = defineModel<CommentSort>("sort", { required: true });
const emit = defineEmits<{ jump: [floor: number] }>();

const options: { value: CommentSort; label: string }[] = [
  { value: "oldest", label: "最早" },
  { value: "newest", label: "最新" },
];

const floorInput = ref("");
// 只留数字。
watch(floorInput, (value) => {
  const digits = value.replace(/\D/g, "");
  if (digits !== value) floorInput.value = digits;
});

const submitJump = () => {
  const floor = Number.parseInt(floorInput.value, 10);
  if (!Number.isFinite(floor) || floor < 1) return;
  emit("jump", floor);
  floorInput.value = "";
};
</script>

<template>
  <div class="ik-comments-toolbar">
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

    <form class="ik-jump" @submit.prevent="submitJump">
      <SpotlightInput
        v-model="floorInput"
        inputmode="numeric"
        maxlength="7"
        placeholder="跳到楼层"
        aria-label="跳到楼层"
        :disabled="disabled"
      >
        <template #prefix><span class="ik-jump__hash">#</span></template>
        <template #suffix>
          <button type="submit" class="ik-jump__go" :disabled="disabled || !floorInput" aria-label="跳转">
            <ArrowRightIcon />
          </button>
        </template>
      </SpotlightInput>
    </form>
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

.ik-jump {
  width: 132px;
}

.ik-jump__hash {
  color: #666;
  font-size: 13px;
  font-weight: 700;
}

.ik-jump__go {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--ik-primary);
  color: #000;
  cursor: var(--ik-cursor-pointer);
  transition: opacity 160ms ease, transform 160ms ease;
}

.ik-jump__go svg {
  width: 14px;
  height: 14px;
}

.ik-jump__go:disabled {
  opacity: 0;
  transform: scale(0.6);
  pointer-events: none;
}
</style>
