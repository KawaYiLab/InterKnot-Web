<script setup lang="ts">
/**
 * 表情选择面板。
 * - 顶部 tab：最近使用 + 各系统表情包
 * - 网格展示，点击派发 select 事件（由调用方决定插入正文还是贴回应）
 *
 * 定位：本组件自身为 absolute 面板，调用方放进一个
 * `position: relative` 的容器里并控制 v-if / 关闭。
 * 点击面板外部区域时派发 close（由调用方移除）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { StickerItem } from "~/types/entities";
import { useStickers } from "~/composables/useStickers";

const emit = defineEmits<{
  select: [sticker: StickerItem];
  close: [];
}>();

const { packs, ensureCatalog, catalogLoaded, recentStickers } = useStickers();

const loading = ref(false);
const loadError = ref(false);

const RECENT_TAB = "__recent__";
const activeTab = ref<string>(RECENT_TAB);

// 没有最近使用时默认落到第一个包
const syncDefaultTab = () => {
  if (activeTab.value === RECENT_TAB && !recentStickers.value.length) {
    activeTab.value = packs.value[0]?.documentId ?? RECENT_TAB;
  }
};

onMounted(async () => {
  if (!catalogLoaded.value) {
    loading.value = true;
    try {
      await ensureCatalog();
    } catch {
      loadError.value = true;
    } finally {
      loading.value = false;
    }
  }
  syncDefaultTab();
});

const tabs = computed(() => [
  ...(recentStickers.value.length ? [{ id: RECENT_TAB, name: "最近" }] : []),
  ...packs.value.map((p) => ({ id: p.documentId, name: p.name })),
]);

const activeStickers = computed<StickerItem[]>(() => {
  if (activeTab.value === RECENT_TAB) return recentStickers.value;
  return packs.value.find((p) => p.documentId === activeTab.value)?.stickers ?? [];
});

// 点击面板外关闭
const rootRef = ref<HTMLDivElement | null>(null);
const onDocClick = (e: MouseEvent) => {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    emit("close");
  }
};
onMounted(() => {
  // 延迟一拍绑定，避免打开 picker 的那次点击立刻触发关闭
  setTimeout(() => document.addEventListener("click", onDocClick), 0);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
});
</script>

<template>
  <div ref="rootRef" class="ik-sticker-picker" @click.stop>
    <div v-if="loading" class="ik-sticker-picker__hint">加载中…</div>
    <div v-else-if="loadError" class="ik-sticker-picker__hint">表情加载失败</div>
    <template v-else>
      <div class="ik-sticker-picker__tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="ik-sticker-picker__tab"
          :class="{ 'is-active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.name }}
        </button>
      </div>
      <div v-if="!activeStickers.length" class="ik-sticker-picker__hint">
        暂无表情
      </div>
      <div v-else class="ik-sticker-picker__grid">
        <button
          v-for="sticker in activeStickers"
          :key="sticker.documentId"
          type="button"
          class="ik-sticker-picker__item"
          :title="sticker.name"
          @click="emit('select', sticker)"
        >
          <img
            :src="sticker.url"
            :alt="sticker.name"
            loading="lazy"
            draggable="false"
          />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ik-sticker-picker {
  position: absolute;
  z-index: 60;
  width: 300px;
  max-width: calc(100vw - 24px);
  background: rgba(24, 24, 24, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  padding: 8px;
}

.ik-sticker-picker__tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.ik-sticker-picker__tab {
  flex: none;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
}

.ik-sticker-picker__tab.is-active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.ik-sticker-picker__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.ik-sticker-picker__item {
  border: none;
  background: transparent;
  padding: 4px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ik-sticker-picker__item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.ik-sticker-picker__item img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  user-select: none;
}

.ik-sticker-picker__hint {
  padding: 16px;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}
</style>
