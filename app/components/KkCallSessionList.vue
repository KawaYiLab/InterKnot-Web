<script setup lang="ts">
/**
 * 敲敲通话 左栏列表（在 KnockKnockModal 的 calls tab 渲染）
 *
 * 视觉与 KnockKnockModal 的 DM 列表完全一致：黑棋盘格背景、灰描边、
 * 圆角胶囊、选中态实底主题色。
 *
 * 注：项目惯例是 *每个组件 scoped 内重复定义* 公共 .ik-knock__* 类，
 * 这样模板与 KnockKnockModal 的私聊列表保持同一套 class，便于以后
 * 统一调整；样式块的内容直接复制自 KnockKnockModal 对应段落。
 */
import type { KkCallSessionSummary } from "~/types/entities";

const props = defineProps<{
  items: KkCallSessionSummary[];
  activeId: string | null;
  isLoading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  (e: "pick", id: string): void;
}>();

const onPick = (id: string) => emit("pick", id);
</script>

<template>
  <div class="ik-knock__list" role="listbox">
    <button
      v-for="item in props.items"
      :key="item.documentId"
      type="button"
      role="option"
      class="ik-knock__list-item"
      :class="{ 'is-active': props.activeId === item.documentId }"
      :aria-selected="props.activeId === item.documentId"
      @click="onPick(item.documentId)"
    >
      <span class="ik-knock__avatar" aria-hidden="true">
        <img
          v-if="item.character.avatar"
          :src="item.character.avatar"
          :alt="item.character.name"
          class="ik-knock__avatar-img"
          draggable="false"
        />
        <img
          v-else
          src="/images/default-avatar.webp"
          alt=""
          class="ik-knock__avatar-img"
          draggable="false"
        />
      </span>
      <span class="ik-knock__item-text">
        <span class="ik-knock__item-title">{{ item.character.name }}</span>
        <span class="ik-knock__item-subtitle">
          {{ item.lastPreview || item.character.tagline || "尚未对话" }}
        </span>
      </span>
    </button>

    <div v-if="!props.items.length" class="ik-knock__list-empty">
      <span v-if="props.isLoading">加载中…</span>
      <span v-else-if="props.error">{{ props.error }}</span>
      <span v-else>暂无可通话角色</span>
    </div>
  </div>
</template>

<style scoped>
/* ─── 列表容器 ─── */
.ik-knock__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.ik-knock__list::-webkit-scrollbar {
  width: 4px;
}
.ik-knock__list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}

/* ─── 列表项（chessboard + 灰描边胶囊） ─── */
.ik-knock__list-item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-width: 0;
  padding: 10px 16px;
  border: 0;
  border-radius: 999px;
  background-color: transparent;
  background-image:
    linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.06) 25%,
      transparent 0 75%,
      rgba(255, 255, 255, 0.06) 0
    ),
    linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.06) 25%,
      transparent 0 75%,
      rgba(255, 255, 255, 0.06) 0
    );
  background-position: 0 0, 3px 3px;
  background-size: 6px 6px;
  background-repeat: repeat;
  box-shadow:
    inset 0 0 0 1px #000,
    inset 0 0 0 5px #3a3a3a;
  color: #888;
  text-align: left;
  cursor: pointer;
  transition: background-color 140ms ease, box-shadow 140ms ease,
    color 140ms ease;
}

.ik-knock__list-item:hover {
  background-color: rgba(255, 255, 255, 0.04);
  box-shadow:
    inset 0 0 0 1px #000,
    inset 0 0 0 5px rgba(255, 255, 255, 0.35);
}

.ik-knock__list-item.is-active {
  background-color: #fbfe00;
  background-image: none;
  box-shadow: none;
  color: #000;
}

.ik-knock__list-item.is-active .ik-knock__item-title {
  color: #000;
  font-weight: 800;
}

.ik-knock__list-item.is-active .ik-knock__item-subtitle {
  color: #3a3a3a;
  font-weight: 700;
}

/* ─── 头像 ─── */
.ik-knock__avatar {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: transparent;
  color: #4a4a4a;
  border: 3px solid #000;
  box-sizing: border-box;
  overflow: hidden;
}

.ik-knock__avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  object-fit: cover;
  user-select: none;
  -webkit-user-drag: none;
}

/* ─── 文本块 ─── */
.ik-knock__item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  line-height: 1.2;
}

.ik-knock__item-title {
  font-size: 16px;
  font-weight: 800;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-knock__item-subtitle {
  font-size: 13px;
  font-weight: 700;
  color: #5a5a5a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── 空态 ─── */
.ik-knock__list-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
}

/* ─── 响应式（与 KnockKnockModal 一致） ─── */
@media (max-width: 768px) {
  .ik-knock__list-item {
    padding: 10px 12px;
    gap: 12px;
  }
  .ik-knock__avatar {
    width: 36px;
    height: 36px;
  }
  .ik-knock__item-title {
    font-size: 14px;
  }
  .ik-knock__item-subtitle {
    font-size: 12px;
  }
}
</style>
