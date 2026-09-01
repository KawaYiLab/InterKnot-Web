<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ChevronDownIcon, CheckIcon } from "@heroicons/vue/24/outline";
import type { AiModel } from "~/types/entities";

/**
 * 模型切换（会话级）：标题栏里角色名右侧的无边框下拉。
 * 只负责展示与交互，选择结果 emit 给容器（数据仍由 useDmConversations 单源）。
 * 原先挂在 DmComposer 输入行上，移到标题栏后与「这条回复用了哪个模型」的气泡标签分工更清楚。
 */
const props = defineProps<{
  /** 可选模型（已按角色卡白名单过滤）；空/未传时整个选择器不渲染 */
  models?: AiModel[];
  /** 当前会话级选择的 key；null = 跟随角色默认 */
  modelKey?: string | null;
  /** 角色卡默认模型 key */
  defaultModelKey?: string | null;
  /** AI 生成中：禁止切换，避免这一轮回复的模型与界面显示不一致 */
  streaming?: boolean;
}>();

const emit = defineEmits<{
  /** null = 清除会话级选择，回落角色卡默认 */
  (e: "select", key: string | null): void;
}>();

const visible = computed(() => (props.models?.length ?? 0) > 0);

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

/** 会话未选模型时按角色卡默认展示，两者都空则回落到首个可选模型 */
const effectiveModel = computed<AiModel | null>(() => {
  const list = props.models ?? [];
  const byKey = (k?: string | null) => (k ? list.find((m) => m.key === k) : undefined);
  return byKey(props.modelKey) ?? byKey(props.defaultModelKey) ?? list[0] ?? null;
});

const buttonLabel = computed(() => effectiveModel.value?.displayName || "模型");
const activeKey = computed(() => effectiveModel.value?.key ?? null);

/** 关菜单：点击外部 / Esc。菜单开着才挂监听，避免常驻全局 handler */
const close = () => {
  open.value = false;
};

const onDocumentPointerDown = (e: MouseEvent | TouchEvent) => {
  const root = rootRef.value;
  if (root && e.target instanceof Node && !root.contains(e.target)) close();
};

const onDocumentKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape") close();
};

watch(open, (isOpen) => {
  if (typeof document === "undefined") return;
  if (isOpen) {
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeyDown);
  } else {
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown);
  }
});

onBeforeUnmount(() => {
  if (typeof document === "undefined") return;
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  document.removeEventListener("keydown", onDocumentKeyDown);
});

// 流式开始时自动收起
watch(
  () => props.streaming,
  (streaming) => {
    if (streaming) close();
  },
);

const toggle = () => {
  if (props.streaming) return;
  open.value = !open.value;
};

const pick = (key: string | null) => {
  close();
  // 点的就是当前生效的那个模型：不发请求（也不会把「跟随角色默认」变成显式选择）
  if (activeKey.value === key) return;
  emit("select", key);
};
</script>

<template>
  <div v-if="visible" ref="rootRef" class="ik-model">
    <button
      type="button"
      class="ik-model__btn"
      :class="{ 'is-open': open }"
      :disabled="streaming"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :title="`切换模型（当前：${buttonLabel}）`"
      @click.stop="toggle"
    >
      <span class="ik-model__name">{{ buttonLabel }}</span>
      <ChevronDownIcon class="ik-model__caret" aria-hidden="true" />
    </button>
    <Transition name="ik-model-pop">
      <div v-if="open" class="ik-model__menu" role="listbox">
        <button
          v-for="m in models"
          :key="m.key"
          type="button"
          class="ik-model__item"
          :class="{ 'is-active': activeKey === m.key }"
          role="option"
          :aria-selected="activeKey === m.key"
          @click.stop="pick(m.key)"
        >
          <span class="ik-model__item-main">
            <span class="ik-model__item-head">
              <span class="ik-model__item-name">{{ m.displayName }}</span>
              <span v-if="m.badge" class="ik-model__item-badge">{{ m.badge }}</span>
              <span v-if="m.key === defaultModelKey" class="ik-model__item-default">默认</span>
            </span>
            <span v-if="m.description" class="ik-model__item-desc">{{ m.description }}</span>
          </span>
          <CheckIcon v-if="activeKey === m.key" class="ik-model__item-check" aria-hidden="true" />
        </button>
        <!-- 已显式选过模型时才给「跟随角色默认」的回退入口 -->
        <button
          v-if="modelKey"
          type="button"
          class="ik-model__item is-reset"
          role="option"
          :aria-selected="false"
          @click.stop="pick(null)"
        >
          <span class="ik-model__item-name">跟随角色默认</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ik-model {
  position: relative;
  flex-shrink: 0;
}

/* 无边框触发器：只有模型名 + 一个向下的箭头 */
.ik-model__btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 160px;
  padding: 2px 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  line-height: 1.2;
  cursor: pointer;
  transition: color 140ms ease;
}

.ik-model__btn:hover:not(:disabled),
.ik-model__btn.is-open {
  color: #fff;
}

.ik-model__btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ik-model__btn:focus-visible {
  outline: 2px solid #fbfe00;
  outline-offset: 2px;
}

.ik-model__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-model__caret {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  transition: transform 140ms ease;
}

.ik-model__btn.is-open .ik-model__caret {
  transform: rotate(180deg);
}

/* 下拉面板：向下展开，贴着标题栏 */
.ik-model__menu {
  position: absolute;
  top: calc(100% + 8px);
  left: -4px;
  z-index: 40;
  min-width: 232px;
  max-width: 300px;
  max-height: min(60vh, 360px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  border-radius: 14px;
  background: rgba(20, 20, 20, 0.96);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55), 0 1px 0 rgba(255, 255, 255, 0.05) inset;
  transform-origin: top left;
}

/* 弹出动效：从触发器左上角轻微展开，收起更快一点 */
.ik-model-pop-enter-active {
  transition: opacity 140ms ease, transform 140ms cubic-bezier(0.16, 1, 0.3, 1);
}

.ik-model-pop-leave-active {
  transition: opacity 100ms ease, transform 100ms ease;
}

.ik-model-pop-enter-from,
.ik-model-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}

.ik-model__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.ik-model__item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}

.ik-model__item:focus-visible {
  outline: 2px solid #fbfe00;
  outline-offset: -2px;
}

/* 当前生效的模型：品牌色淡底 + 左侧短竖条，扫一眼就知道选的是哪个 */
.ik-model__item.is-active {
  background: rgba(251, 254, 0, 0.08);
  color: #fff;
}

.ik-model__item.is-active::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 50%;
  width: 2px;
  height: 14px;
  margin-top: -7px;
  border-radius: 999px;
  background: #fbfe00;
}

/* 「跟随角色默认」是回退项，用一条分隔线与模型列表分开 */
.ik-model__item.is-reset {
  margin-top: 5px;
  padding-top: 9px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0 0 10px 10px;
  color: rgba(255, 255, 255, 0.5);
}

.ik-model__item.is-reset .ik-model__item-name {
  font-size: 12px;
  font-weight: 500;
}

.ik-model__item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.ik-model__item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ik-model__item-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-model__item-badge {
  flex-shrink: 0;
  padding: 1.5px 5px;
  border-radius: 5px;
  background: rgba(251, 254, 0, 0.14);
  color: #fbfe00;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.3px;
}

.ik-model__item-default {
  flex-shrink: 0;
  padding: 1.5px 5px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px;
  line-height: 1.2;
}

.ik-model__item-desc {
  color: rgba(255, 255, 255, 0.42);
  font-size: 11px;
  line-height: 1.45;
}

.ik-model__item-check {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  color: #fbfe00;
}

/* 窄屏标题栏里还挤着返回/搜索/删除，模型名再收紧一档，别把角色名压没 */
@media (max-width: 768px) {
  .ik-model__btn {
    max-width: 96px;
    font-size: 12px;
  }

  .ik-model__menu {
    min-width: 200px;
  }
}

/* 无障碍：跟随系统的「减少动态效果」 */
@media (prefers-reduced-motion: reduce) {
  .ik-model__btn,
  .ik-model__caret,
  .ik-model__item,
  .ik-model-pop-enter-active,
  .ik-model-pop-leave-active {
    transition: none;
  }
}
</style>
