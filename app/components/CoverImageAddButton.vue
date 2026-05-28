<script setup lang="ts">
import { ArrowUpTrayIcon, PlusIcon } from "@heroicons/vue/24/outline";

const props = withDefaults(defineProps<{
  isDragging?: boolean;
  disabled?: boolean;
}>(), {
  isDragging: false,
  disabled: false,
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();
</script>

<template>
  <button
    type="button"
    class="ik-cover-add"
    :class="{ 'ik-cover-add--dragging': props.isDragging }"
    :disabled="props.disabled"
    @click="emit('click', $event)"
  >
    <component :is="props.isDragging ? ArrowUpTrayIcon : PlusIcon" class="ik-cover-add__icon" />
    <span class="ik-cover-add__text">{{ props.isDragging ? '释放以上传' : '添加图片' }}</span>
  </button>
</template>

<style scoped>
.ik-cover-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  aspect-ratio: 1 / 1;
  width: 100%;
  padding: 0;
  appearance: none;
  border-radius: 8px;
  border: 2px dashed #313132;
  background: #1e1e1e;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 200ms, background 200ms, transform 200ms, color 200ms;
  color: #909090;
}

.ik-cover-add:hover:not(:disabled) {
  border-color: #d7ff00;
  background: rgba(215, 255, 0, 0.06);
  color: #d7ff00;
  transform: translateY(-2px);
}

.ik-cover-add:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.ik-cover-add--dragging {
  border-color: #fbc02d;
  background: rgba(251, 192, 45, 0.1);
  color: #fbc02d;
}

.ik-cover-add__icon {
  width: 28px;
  height: 28px;
  stroke-width: 2;
}

.ik-cover-add__text {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
</style>
