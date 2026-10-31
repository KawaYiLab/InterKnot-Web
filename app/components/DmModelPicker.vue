<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ChevronDownIcon, CheckIcon } from "@heroicons/vue/24/outline";
import type { AiModel } from "~/types/entities";

/**
 * 模型切换（会话级）：标题栏里角色名右侧的胶囊。后台配的模型名往往很长，
 * 胶囊里只放截断后的当前模型名；点开时胶囊原地「长大」成面板（仿 Inspira UI 的
 * Scroll Island 形变），面板里完整显示模型名、角标与说明。换模型时名字做一次模糊翻转（Flip Words）。
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
const btnRef = ref<HTMLButtonElement | null>(null);
/** 面板收起时裁成触发胶囊的大小，展开时从这个尺寸长开 */
const triggerSize = ref({ w: 0, h: 0 });
const measureTrigger = () => {
  const btn = btnRef.value;
  if (btn) triggerSize.value = { w: btn.offsetWidth, h: btn.offsetHeight };
};

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
  measureTrigger();
  open.value = !open.value;
};

// 模型名变了胶囊宽度跟着变，收起态的裁剪尺寸要跟上
watch(buttonLabel, () => nextTick(measureTrigger));
watch(visible, (v) => v && nextTick(measureTrigger), { immediate: true });

const pick = (key: string | null) => {
  close();
  // 点的就是当前生效的那个模型：不发请求（也不会把「跟随角色默认」变成显式选择）
  if (activeKey.value === key) return;
  emit("select", key);
};
</script>

<template>
  <div
    v-if="visible"
    ref="rootRef"
    class="ik-model"
    :style="{ '--ik-trigger-w': `${triggerSize.w}px`, '--ik-trigger-h': `${triggerSize.h}px` }"
  >
    <button
      ref="btnRef"
      type="button"
      class="ik-model__btn"
      :class="{ 'is-open': open, 'has-badge': !!effectiveModel?.badge }"
      :disabled="streaming"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :title="`切换模型（当前：${buttonLabel}）`"
      @click.stop="toggle"
    >
      <Transition name="ik-flip" mode="out-in">
        <span :key="buttonLabel" class="ik-model__name">{{ buttonLabel }}</span>
      </Transition>
      <span v-if="effectiveModel?.badge" class="ik-model__item-badge">{{ effectiveModel.badge }}</span>
      <ChevronDownIcon class="ik-model__caret" aria-hidden="true" />
    </button>
    <!-- 面板始终挂着：收起时裁成胶囊大小并隐藏，展开时从胶囊处长开 -->
    <div
      class="ik-model__island"
      :class="{ 'is-open': open }"
      role="listbox"
      aria-label="选择模型"
      :aria-hidden="!open"
      :inert="!open"
    >
      <button type="button" class="ik-model__island-head" tabindex="-1" @click.stop="close">
        <span class="ik-model__island-title">选择模型</span>
        <ChevronDownIcon class="ik-model__caret is-up" aria-hidden="true" />
      </button>
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
  </div>
</template>

<style scoped>
.ik-model {
  position: relative;
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
}

/* 触发胶囊：黑底点阵 + 深灰粗描边（同侧栏 tab 条），模型名过长截断 */
.ik-model__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  height: var(--ik-header-control-size, 36px);
  padding: 0 12px;
  border: 2px solid #313131;
  border-radius: 999px;
  background: #050505 url("/images/tab-bg-point.webp") repeat;
  color: rgba(255, 255, 255, 0.82);
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease;
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
  display: inline-block;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Flip Words：换模型时旧名字往上模糊淡出，新名字从下面清晰起来 */
.ik-flip-enter-active,
.ik-flip-leave-active {
  transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1), filter 180ms ease;
}

.ik-flip-enter-from {
  opacity: 0;
  transform: translateY(8px);
  filter: blur(6px);
}

.ik-flip-leave-to {
  opacity: 0;
  transform: translateY(-8px);
  filter: blur(6px);
}

.ik-model__caret {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  transition: transform 140ms ease;
}

.ik-model__btn.is-open .ik-model__caret,
.ik-model__caret.is-up {
  transform: rotate(180deg);
}

/*
 * 面板：左上角与胶囊对齐。收起态用 clip-path 裁成胶囊的大小（看起来就是胶囊本身），
 * 展开时 clip-path 放开到整块面板，形成「胶囊长成面板」的形变。
 */
.ik-model__island {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 40;
  width: max-content;
  min-width: min(max(260px, var(--ik-trigger-w)), calc(100cqi - 36px));
  max-width: min(360px, calc(100cqi - 36px), calc(100vw - 24px));
  max-height: min(60vh, 380px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 6px 6px;
  border: 2px solid #313131;
  border-radius: 18px;
  background: #050505 url("/images/tab-bg-point.webp") repeat;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.6);
  clip-path: inset(0 calc(100% - var(--ik-trigger-w)) calc(100% - var(--ik-trigger-h)) 0 round calc(var(--ik-trigger-h) / 2));
  opacity: 0;
  visibility: hidden;
  transition:
    clip-path 280ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 120ms ease 160ms,
    visibility 0s linear 280ms;
}

.ik-model__island.is-open {
  clip-path: inset(0 round 18px);
  opacity: 1;
  visibility: visible;
  transition:
    clip-path 360ms cubic-bezier(0.2, 0.9, 0.3, 1.05),
    opacity 80ms ease,
    visibility 0s;
}

.ik-model__island-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: calc(var(--ik-header-control-size, 36px) - 4px);
  padding: 0 6px 0 6px;
  margin-bottom: 4px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.ik-model__island-title {
  white-space: nowrap;
}

.ik-model__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.ik-model__item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.ik-model__item:focus-visible {
  outline: 2px solid #fbfe00;
  outline-offset: -2px;
}

/* 当前生效的模型：整行亮黄（同侧栏选中项） */
.ik-model__item.is-active {
  background: #fbfe00;
  color: #000;
}

.ik-model__item.is-active .ik-model__item-desc {
  color: rgba(0, 0, 0, 0.6);
}

.ik-model__item.is-active .ik-model__item-badge {
  background: #000;
  color: #fbfe00;
}

.ik-model__item.is-active .ik-model__item-default {
  background: rgba(0, 0, 0, 0.12);
  color: rgba(0, 0, 0, 0.6);
}

/* 「跟随角色默认」是回退项，用一条分隔线与模型列表分开 */
.ik-model__item.is-reset {
  margin-top: 5px;
  padding-top: 9px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0 0 12px 12px;
  color: rgba(255, 255, 255, 0.5);
}

.ik-model__item.is-reset .ik-model__item-name {
  font-size: 12px;
  font-weight: 500;
}

.ik-model__item-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.ik-model__item-head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

/* 面板里模型名完整显示，太长就换行 */
.ik-model__item-name {
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  word-break: break-all;
}

.ik-model__item-badge {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(251, 254, 0, 0.14);
  color: #fbfe00;
  font-size: 10px;
  font-weight: 800;
  font-style: italic;
  line-height: 1.2;
  letter-spacing: 0.3px;
}

.ik-model__item-default {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  line-height: 1.2;
}

.ik-model__item-desc {
  color: rgba(255, 255, 255, 0.45);
  font-size: 11.5px;
  line-height: 1.45;
}

.ik-model__item-check {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

@media (prefers-reduced-motion: reduce) {
  .ik-model__island,
  .ik-model__island.is-open,
  .ik-flip-enter-active,
  .ik-flip-leave-active {
    transition: none;
  }
}
</style>
