<script setup lang="ts">
/**
 * 表情选择面板（QQ/微信风格）：可连续插入、实时预览。
 *
 * - 桌面端：在 ik-engage-bar 内向下展开（max-height）
 * - 移动端（< 768px）：固定底部抽屉（bottom sheet），从屏幕底部滑出
 * - 底部分类 tab 始终可见；表情内容在上方滚动
 */
import { computed, ref, watch } from "vue";
import { useEmotes, type Emote } from "~/composables/useEmotes";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  select: [emote: Emote];
  selectEmoji: [emoji: string];
  close: [];
}>();

/** 默认 emoji（纯 Unicode 字符，与表情包图片无关） */
const EMOJI_LIST = [
  "😀", "😁", "😂", "🤣", "😅", "😊", "😇", "🙂", "🙃", "😉",
  "😍", "🥰", "😘", "😋", "😛", "😜", "🤪", "🤗", "🤔", "🤨",
  "😐", "😶", "🙄", "😏", "😣", "😥", "😮", "😪", "😫", "😴",
  "😌", "😒", "😔", "😕", "🙁", "😖", "😞", "😤", "😢", "😭",
  "😨", "😩", "🤯", "😬", "😰", "😱", "🥵", "🥶", "😳", "🥴",
  "😵", "🤠", "🥳", "😎", "🤓", "🧐", "😷", "🤒", "🤕", "🤢",
  "👍", "👎", "👌", "✌️", "🤝", "👏", "🙏", "💪", "🤙", "👋",
  "❤️", "💔", "✨", "🔥", "🎉", "🌟", "💤", "💦", "💀", "🌺",
];

const { groupedEmotes, emoteGroups, loading, emotes, refreshIfStale } = useEmotes();

const RECENT_KEY = "ik-emote-recent";
const RECENT_MAX = 12;

const recentCodes = ref<string[]>([]);

function loadRecent() {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        recentCodes.value = arr.filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        ).slice(0, RECENT_MAX);
      }
    }
  } catch {
    /* ignore */
  }
}

function saveRecent(code: string) {
  if (typeof window === "undefined") return;
  const next = [code, ...recentCodes.value.filter((c) => c !== code)].slice(0, RECENT_MAX);
  recentCodes.value = next;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

loadRecent();

const recentEmotes = computed<Emote[]>(() => {
  if (!recentCodes.value.length || !emotes.value.length) return [];
  const map = new Map(emotes.value.map((e) => [e.code, e]));
  return recentCodes.value
    .map((code) => map.get(code))
    .filter((e): e is Emote => !!e);
});

interface PickerTab {
  key: string;
  /** tab 图标：图片 url（分组自定义图标或首个表情）或 emoji 字符 */
  iconUrl?: string;
  iconChar?: string;
  title: string;
  emotes?: Emote[];
  isEmoji?: boolean;
}

const tabs = computed<PickerTab[]>(() => {
  // 分组名 → 自定义图标 URL 的查找表
  const groupIconMap = new Map<string, string | null>();
  for (const g of emoteGroups.value) {
    groupIconMap.set(g.name, g.iconUrl);
  }

  const list: PickerTab[] = [];
  if (recentEmotes.value.length) {
    list.push({ key: "recent", iconChar: "\uD83D\uDD52", title: "最近使用", emotes: recentEmotes.value });
  }
  list.push({ key: "emoji", iconChar: "\uD83D\uDE00", title: "emoji", isEmoji: true });
  for (const [group, groupList] of groupedEmotes.value) {
    const first = groupList[0];
    if (!first) continue;
    // 优先使用分组自定义图标，未设置则降级用首个表情图片
    const iconUrl = groupIconMap.get(group) || first.url;
    list.push({ key: `g:${group}`, iconUrl, title: group, emotes: groupList });
  }
  return list;
});

const activeTabKey = ref<string>("");

const activeTab = computed<PickerTab | null>(() => {
  const found = tabs.value.find((t) => t.key === activeTabKey.value);
  return found ?? tabs.value[0] ?? null;
});

const setActiveTab = (tab: PickerTab) => {
  activeTabKey.value = tab.key;
};

watch(
  () => props.visible,
  (vis) => {
    if (vis) {
      refreshIfStale();
      activeTabKey.value = tabs.value[0]?.key ?? "";
    }
  },
  { immediate: true },
);

const onItemMouseDown = (e: MouseEvent, emote: Emote) => {
  e.preventDefault();
  saveRecent(emote.code);
  emit("select", emote);
};

const onEmojiMouseDown = (e: MouseEvent, emoji: string) => {
  e.preventDefault();
  emit("selectEmoji", emoji);
};
</script>

<template>
  <Transition name="ik-emote-picker-panel" appear>
    <div
      v-show="visible"
      class="ik-emote-picker"
      @keydown.esc.stop="emit('close')"
    >
      <div class="ik-emote-picker__body">
        <Transition name="ik-emote-picker-fade">
          <div v-if="loading && !emotes.length" class="ik-emote-picker__state">
            <span class="ik-emote-picker__spinner" aria-hidden="true"></span>
            加载中…
          </div>
        </Transition>

        <Transition name="ik-emote-picker-fade">
          <z-scrollbar v-if="!loading || emotes.length" class="ik-emote-picker__scroll">
            <Transition name="ik-emote-picker-grid" mode="out-in">
              <div :key="activeTab?.key" class="ik-emote-picker__grid">
                <template v-if="activeTab?.isEmoji">
                  <button
                    v-for="emoji in EMOJI_LIST"
                    :key="emoji"
                    type="button"
                    class="ik-emote-picker__card ik-emote-picker__card--emoji"
                    @mousedown.prevent="onEmojiMouseDown($event, emoji)"
                  >
                    <div class="ik-emote-picker__thumb">
                      <span class="ik-emote-picker__emoji">{{ emoji }}</span>
                    </div>
                  </button>
                </template>
                <template v-else-if="activeTab?.emotes">
                  <button
                    v-for="emote in activeTab.emotes"
                    :key="emote.code"
                    type="button"
                    class="ik-emote-picker__card"
                    :title="emote.name"
                    @mousedown.prevent="onItemMouseDown($event, emote)"
                  >
                    <div class="ik-emote-picker__thumb">
                      <img
                        :src="emote.url"
                        :alt="emote.name"
                        loading="lazy"
                        decoding="async"
                        draggable="false"
                      />
                    </div>
                    <span class="ik-emote-picker__name">{{ emote.name }}</span>
                  </button>
                </template>
              </div>
            </Transition>
            <div v-if="!activeTab" class="ik-emote-picker__empty">暂无表情</div>
          </z-scrollbar>
        </Transition>
      </div>

      <div class="ik-emote-picker__tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="ik-emote-picker__tab"
          :class="{ 'ik-emote-picker__tab--active': tab.key === activeTab?.key }"
          :title="tab.title"
          @click.stop.prevent="setActiveTab(tab)"
        >
          <img
            v-if="tab.iconUrl"
            :src="tab.iconUrl"
            :alt="tab.title"
            draggable="false"
          />
          <span v-else>{{ tab.iconChar }}</span>
        </button>
      </div>
    </div>
  </Transition>
</template>

<style>
:root {
  --emote-panel-height: clamp(220px, 45vh, 420px);
}
</style>

<style scoped>
.ik-emote-picker {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 320px;
  margin-top: 8px;
  background: #0a0a0a;
  border-top: 1px solid #202020;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.35);
  color: #f5f5f5;
  overflow: hidden;
  will-change: max-height, opacity;
}

.ik-emote-picker__body {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.ik-emote-picker__scroll {
  height: 100%;
}

.ik-emote-picker__scroll :deep(.z-scrollbar__wrap) {
  background: transparent;
}

.ik-emote-picker__scroll :deep(.z-scrollbar__view) {
  min-height: auto;
}

.ik-emote-picker__tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
  border-top: 1px solid #202020;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.ik-emote-picker__tabs::-webkit-scrollbar {
  display: none;
}

.ik-emote-picker__tab {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 32px;
  padding: 0;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  color: #888;
  transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease;
}

.ik-emote-picker__tab:hover {
  background-color: rgba(255, 255, 255, 0.06);
}

.ik-emote-picker__tab--active {
  color: #4aa3ff;
  border-color: #4aa3ff;
  background-color: rgba(74, 163, 255, 0.08);
}

.ik-emote-picker__tab img {
  width: 22px;
  height: 22px;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-emote-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 6px;
  padding: 10px;
}

.ik-emote-picker__card {
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
  aspect-ratio: 1 / 1;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 8px;
  background: #111;
  color: #fff;
  appearance: none;
  font-family: inherit;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 160ms ease, transform 160ms ease, background-color 160ms ease;
}

.ik-emote-picker__card:hover:not(:disabled) {
  border-color: #333;
  background: #1a1a1a;
  transform: translateY(-2px);
}

.ik-emote-picker__card--emoji .ik-emote-picker__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
}

.ik-emote-picker__thumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1e1e1e;
}

.ik-emote-picker__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-emote-picker__emoji {
  font-size: 26px;
  line-height: 1;
  user-select: none;
}

.ik-emote-picker__name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: block;
  min-width: 0;
  padding: 14px 3px 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.72) 100%);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  pointer-events: none;
}

.ik-emote-picker__state,
.ik-emote-picker__empty {
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #777;
  font-size: 14px;
  font-weight: 700;
}

.ik-emote-picker__spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(215, 255, 0, 0.25);
  border-top-color: #BFFF09;
  animation: ik-emote-picker-spin 800ms linear infinite;
}

@keyframes ik-emote-picker-spin {
  to { transform: rotate(360deg); }
}

/* 桌面端：max-height + opacity 展开 */
.ik-emote-picker-panel-enter-active,
.ik-emote-picker-panel-leave-active {
  transition: max-height 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease;
}

.ik-emote-picker-panel-enter-from,
.ik-emote-picker-panel-leave-to {
  max-height: 0;
  opacity: 0;
}

/* 分类内容切换动画：旧网格上滑淡出，新网格上滑淡入 */
.ik-emote-picker-grid-enter-active,
.ik-emote-picker-grid-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
  will-change: opacity, transform;
}

.ik-emote-picker-grid-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.ik-emote-picker-grid-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* 加载/空状态淡入淡出 */
.ik-emote-picker-fade-enter-active,
.ik-emote-picker-fade-leave-active {
  transition: opacity 200ms ease;
}

.ik-emote-picker-fade-enter-from,
.ik-emote-picker-fade-leave-to {
  opacity: 0;
}

.ik-emote-picker-fade-leave-active {
  position: absolute;
  inset: 0;
}

@media (max-width: 767px) {
  .ik-emote-picker {
    position: relative;
    left: auto;
    right: auto;
    bottom: auto;
    height: var(--emote-panel-height);
    max-height: var(--emote-panel-height);
    margin-top: 0;
    z-index: auto;
    border-radius: 16px 16px 0 0;
    will-change: height, opacity;
  }

  .ik-emote-picker__tabs {
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
  }

  /* 移动端：在互动栏内展开，高度固定，不遮挡输入框 */
  .ik-emote-picker-panel-enter-active,
  .ik-emote-picker-panel-leave-active {
    transition: height 250ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease;
  }

  .ik-emote-picker-panel-enter-from,
  .ik-emote-picker-panel-leave-to {
    height: 0;
    opacity: 0;
  }
}
</style>
