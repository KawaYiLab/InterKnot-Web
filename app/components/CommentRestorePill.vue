<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { CommentReadRecord } from "~/composables/useCommentReadHistory";
import Badge from "~/components/ui/badge/Badge.vue";
import Tooltip from "~/components/ui/tooltip/Tooltip.vue";
import TooltipTrigger from "~/components/ui/tooltip/TooltipTrigger.vue";
import TooltipContent from "~/components/ui/tooltip/TooltipContent.vue";
import TooltipProvider from "~/components/ui/tooltip/TooltipProvider.vue";
import { ArrowDownIcon, ArrowUpIcon, XMarkIcon, Cog6ToothIcon, CheckIcon } from "@heroicons/vue/24/outline";

const props = withDefaults(
  defineProps<{
    record: CommentReadRecord;
    seeking?: boolean;
    autoRestore?: boolean;
    /** 是否已完成定位并抵达目标评论 */
    arrived?: boolean;
    /** 自动淡出时长（毫秒，0 为不自动隐藏） */
    autoHideMs?: number;
  }>(),
  {
    seeking: false,
    autoRestore: false,
    arrived: false,
    autoHideMs: 8000,
  },
);

const emit = defineEmits<{
  restore: [];
  dismiss: [];
  backToTop: [];
  toggleAutoRestore: [enabled: boolean];
}>();

let hideTimer: ReturnType<typeof setTimeout> | null = null;
const isHovered = ref(false);

const startAutoHide = () => {
  if (props.autoHideMs <= 0 || props.seeking) return;
  clearAutoHide();
  hideTimer = setTimeout(() => {
    if (!isHovered.value && !props.seeking) {
      emit("dismiss");
    }
  }, props.autoHideMs);
};

const clearAutoHide = () => {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
};

const onMouseEnter = () => {
  isHovered.value = true;
  clearAutoHide();
};

const onMouseLeave = () => {
  isHovered.value = false;
  startAutoHide();
};

const handleRestore = () => {
  clearAutoHide();
  emit("restore");
};

const handleDismiss = () => {
  clearAutoHide();
  emit("dismiss");
};

const handleToggleAutoRestore = () => {
  emit("toggleAutoRestore", !props.autoRestore);
};

const floorLabel = computed(() => {
  if (props.record.floor) return `F${props.record.floor}`;
  return "上次位置";
});

onMounted(() => {
  startAutoHide();
});

onBeforeUnmount(() => {
  clearAutoHide();
});
</script>

<template>
  <TooltipProvider :delay-duration="200">
    <div
      class="ik-restore-pill"
      :class="{ 'is-seeking': seeking, 'is-arrived': arrived }"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
      role="region"
      aria-label="恢复上次评论阅读位置"
    >
      <!-- 左侧图标与提示文案 -->
      <div class="ik-restore-pill__info">
        <span class="ik-restore-pill__pulse" aria-hidden="true"></span>
        <span class="ik-restore-pill__label">上次阅读至</span>
        <Badge variant="zzz" class="ik-restore-pill__badge">
          {{ floorLabel }}
        </Badge>
        <span v-if="record.authorName" class="ik-restore-pill__author" :title="`作者：${record.authorName}`">
          @{{ record.authorName }}
        </span>
      </div>

      <!-- 操作区域 -->
      <div class="ik-restore-pill__actions">
        <!-- 未到达且未在寻址中：前往按钮 -->
        <button
          v-if="!arrived && !seeking"
          type="button"
          class="ik-restore-pill__btn ik-restore-pill__btn--primary"
          @click="handleRestore"
          title="跳转到上次阅读评论"
        >
          <span>回到该位置</span>
          <ArrowDownIcon class="ik-restore-pill__icon" aria-hidden="true" />
        </button>

        <!-- 寻址中 -->
        <span v-else-if="seeking" class="ik-restore-pill__btn ik-restore-pill__btn--loading">
          <span class="ik-restore-pill__spinner"></span>
          <span>定位中...</span>
        </span>

        <!-- 已到达态：提示已定位，并提供回到顶部按钮 -->
        <template v-else-if="arrived">
          <span class="ik-restore-pill__status">
            <CheckIcon class="ik-restore-pill__icon ik-restore-pill__icon--check" aria-hidden="true" />
            <span>已定位</span>
          </span>
          <button
            type="button"
            class="ik-restore-pill__btn ik-restore-pill__btn--ghost"
            @click="emit('backToTop')"
            title="回到评论区顶部"
          >
            <ArrowUpIcon class="ik-restore-pill__icon" aria-hidden="true" />
            <span>回顶</span>
          </button>
        </template>

        <!-- 自动恢复设置开关 -->
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="ik-restore-pill__tool-btn"
              :class="{ 'is-active': autoRestore }"
              :aria-label="autoRestore ? '已开启打开帖子自动跳转（点击关闭）' : '下次打开帖子自动跳转（点击开启）'"
              @click="handleToggleAutoRestore"
            >
              <Cog6ToothIcon class="ik-restore-pill__icon" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {{ autoRestore ? '已开启：打开帖子自动恢复' : '点击开启：下次打开帖子自动恢复' }}
          </TooltipContent>
        </Tooltip>

        <!-- 关闭按钮 -->
        <button
          type="button"
          class="ik-restore-pill__close"
          aria-label="关闭提示"
          @click="handleDismiss"
        >
          <XMarkIcon class="ik-restore-pill__icon" aria-hidden="true" />
        </button>
      </div>
    </div>
  </TooltipProvider>
</template>

<style scoped>
.ik-restore-pill {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  background: rgba(18, 18, 18, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 18px 0 18px 18px;
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.65),
    0 0 0 1px rgba(251, 254, 0, 0.12);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  user-select: none;
  pointer-events: auto;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  max-width: calc(100% - 24px);
}

.ik-restore-pill:hover {
  border-color: rgba(251, 254, 0, 0.45);
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.75),
    0 0 12px rgba(251, 254, 0, 0.2);
}

.ik-restore-pill__info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ik-restore-pill__pulse {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background-color: #fbfe00;
  box-shadow: 0 0 6px #fbfe00;
  flex-shrink: 0;
  animation: ik-pulse 2s infinite;
}

@keyframes ik-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}

.ik-restore-pill__label {
  font-size: 12px;
  color: #a3a3a3;
  white-space: nowrap;
}

.ik-restore-pill__badge {
  font-size: 11px;
  padding: 1px 6px;
  flex-shrink: 0;
}

.ik-restore-pill__author {
  font-size: 12px;
  color: #d4d4d4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90px;
}

.ik-restore-pill__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.ik-restore-pill__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.ik-restore-pill__btn--primary {
  background: #fbfe00;
  color: #000;
  border-color: #fbfe00;
}

.ik-restore-pill__btn--primary:hover {
  background: #ffff33;
  box-shadow: 0 0 8px rgba(251, 254, 0, 0.4);
  transform: translateY(-1px);
}

.ik-restore-pill__btn--ghost {
  background: rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  border-color: rgba(255, 255, 255, 0.15);
}

.ik-restore-pill__btn--ghost:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.ik-restore-pill__btn--loading {
  background: rgba(255, 255, 255, 0.06);
  color: #a3a3a3;
  cursor: default;
}

.ik-restore-pill__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #4ade80;
  font-weight: 500;
  padding: 0 4px;
}

.ik-restore-pill__tool-btn,
.ik-restore-pill__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: #737373;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ik-restore-pill__tool-btn:hover,
.ik-restore-pill__close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.ik-restore-pill__tool-btn.is-active {
  color: #fbfe00;
}

.ik-restore-pill__icon {
  width: 14px;
  height: 14px;
}

.ik-restore-pill__icon--check {
  color: #4ade80;
}

.ik-restore-pill__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fbfe00;
  border-radius: 999px;
  animation: ik-spin 0.8s linear infinite;
}

@keyframes ik-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .ik-restore-pill__author {
    display: none;
  }
}
</style>
