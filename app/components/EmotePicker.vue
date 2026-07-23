<script setup lang="ts">
/**
 * 表情选择弹窗（参照 PostImagePickerModal 的弹窗范式）。
 *
 * - Teleport 到 body，居中弹窗，桌面端 56%×66%，移动端底部滑出
 * - 顶部横向分类 tab：最近 / 各后台分组 / emoji
 * - 点击外部 / 按 ESC / 点击关闭 自动关闭（emit close）
 * - 最近使用（localStorage，最多 12 个）
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useEmotes, type Emote } from "~/composables/useEmotes";

const props = defineProps<{
  visible: boolean;
  /** 已废弃：仅保留兼容，新 UI 为居中弹窗 */
  anchor?: { top: number; left: number; height: number } | null;
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
const { acquire, release } = useBodyScrollLock();
const SCROLL_LOCK_TOKEN = Symbol("emote-picker");

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

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    e.stopImmediatePropagation();
    emit("close");
  }
};

onMounted(() => {
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", handleKeydown, true);
  }
  acquire(SCROLL_LOCK_TOKEN);
  refreshIfStale();
  activeTabKey.value = tabs.value[0]?.key ?? "";
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", handleKeydown, true);
  }
  release(SCROLL_LOCK_TOKEN);
});

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
  <Teleport to="body">
    <Transition name="ik-emote-picker">
      <div
        v-if="visible"
        class="ik-emote-picker-overlay"
        @click.self="emit('close')"
      >
        <div class="ik-emote-picker-overlay__stripe" aria-hidden="true" />
        <div class="ik-emote-picker-dialog" @click.stop>
          <div class="ik-emote-picker-frame">
            <div class="ik-emote-picker-frame__inner">
              <div class="ik-emote-picker-body">
                <div class="ik-emote-picker-header">
                  <div class="ik-emote-picker-header__text">
                    <span class="ik-emote-picker-title">表情</span>
                    <span class="ik-emote-picker-subtitle">{{ activeTab?.title || "" }}</span>
                  </div>
                  <button
                    type="button"
                    class="ik-emote-picker-close"
                    aria-label="关闭"
                    @click="emit('close')"
                  >
                    <img src="/images/close-btn.webp" alt="关闭" class="ik-emote-picker-close__img" draggable="false" />
                  </button>
                </div>

                <div class="ik-emote-picker-main">
                  <div class="ik-emote-picker-tabs">
                    <button
                      v-for="tab in tabs"
                      :key="tab.key"
                      type="button"
                      class="ik-emote-picker-tab"
                      :class="{ 'ik-emote-picker-tab--active': tab.key === activeTab?.key }"
                      :title="tab.title"
                      @mousedown.prevent="setActiveTab(tab)"
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

                  <div class="ik-emote-picker-grid-wrap">
                    <Transition name="ik-emote-picker-fade">
                      <div v-if="loading && !emotes.length" class="ik-emote-picker-state">
                        <span class="ik-emote-picker-spinner" aria-hidden="true"></span>
                        加载中…
                      </div>
                    </Transition>

                    <Transition name="ik-emote-picker-fade">
                      <z-scrollbar v-if="!loading || emotes.length" class="ik-emote-picker-grid-scroll">
                        <div class="ik-emote-picker-grid">
                          <template v-if="activeTab?.isEmoji">
                            <button
                              v-for="emoji in EMOJI_LIST"
                              :key="emoji"
                              type="button"
                              class="ik-emote-picker-card ik-emote-picker-card--emoji"
                              @mousedown.prevent="onEmojiMouseDown($event, emoji)"
                            >
                              <div class="ik-emote-picker-card__thumb">
                                <span class="ik-emote-picker-card__emoji">{{ emoji }}</span>
                              </div>
                            </button>
                          </template>
                          <template v-else-if="activeTab?.emotes">
                            <button
                              v-for="emote in activeTab.emotes"
                              :key="emote.code"
                              type="button"
                              class="ik-emote-picker-card"
                              :title="emote.name"
                              @mousedown.prevent="onItemMouseDown($event, emote)"
                            >
                              <div class="ik-emote-picker-card__thumb">
                                <img
                                  :src="emote.url"
                                  :alt="emote.name"
                                  loading="lazy"
                                  decoding="async"
                                  draggable="false"
                                />
                              </div>
                              <span class="ik-emote-picker-card__name">{{ emote.name }}</span>
                            </button>
                          </template>
                        </div>
                        <div v-if="!activeTab" class="ik-emote-picker-empty">暂无表情</div>
                      </z-scrollbar>
                    </Transition>
                  </div>
                </div>

                <div class="ik-emote-picker-footer">
                  <z-button @click="emit('close')">关闭</z-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ik-emote-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.ik-emote-picker-overlay__stripe {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    40deg,
    transparent,
    transparent 3.5px,
    rgba(255, 255, 255, 0.09) 4.5px,
    rgba(255, 255, 255, 0.09) 7.5px,
    transparent 8.5px
  );
}

.ik-emote-picker-dialog {
  position: relative;
  z-index: 1;
  width: 56%;
  height: 66%;
}

.ik-emote-picker-frame {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px;
}

.ik-emote-picker-frame__inner {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #000;
  border-radius: 22px;
  overflow: hidden;
}

.ik-emote-picker-body {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  overflow: hidden;
}

.ik-emote-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 58px;
  padding: 10px 20px;
  flex-shrink: 0;
  border-radius: 0 0 16px 16px;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #161616 0%, #080808 100%);
}

.ik-emote-picker-header__text {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}

.ik-emote-picker-title {
  color: #fff;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.4px;
}

.ik-emote-picker-subtitle {
  color: #888;
  font-size: 12px;
  font-weight: 700;
}

.ik-emote-picker-close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.ik-emote-picker-close__img {
  height: 32px;
  width: auto;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

.ik-emote-picker-main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(180deg, #010101 0%, #161616 100%);
}

.ik-emote-picker-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.ik-emote-picker-tabs::-webkit-scrollbar {
  display: none;
}

.ik-emote-picker-tab {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 34px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  color: #bfbfbf;
  transition: background-color 120ms ease;
}

.ik-emote-picker-tab:hover {
  background-color: rgba(255, 255, 255, 0.08);
}

.ik-emote-picker-tab--active {
  color: #fff;
  background-color: rgba(255, 255, 255, 0.14);
}

.ik-emote-picker-tab img {
  width: 26px;
  height: 26px;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-emote-picker-grid-wrap {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.92) 0%,
    rgba(26, 26, 26, 0.82) 100%
  );
  overflow: hidden;
}

.ik-emote-picker-grid-scroll {
  flex: 1;
  min-height: 0;
  border-radius: 16px;
  overflow: hidden;
  will-change: transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
}

.ik-emote-picker-grid-scroll :deep(.z-scrollbar__wrap) {
  background: transparent;
}

.ik-emote-picker-grid-scroll :deep(.z-scrollbar__view) {
  min-height: auto;
}

.ik-emote-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 14px;
  box-sizing: border-box;
  padding: 18px 24px 58px 18px;
}

.ik-emote-picker-card {
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

.ik-emote-picker-card:hover:not(:disabled) {
  border-color: #333;
  background: #1a1a1a;
  transform: translateY(-2px);
}

.ik-emote-picker-card--emoji .ik-emote-picker-card__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
}

.ik-emote-picker-card__thumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1e1e1e;
}

.ik-emote-picker-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-emote-picker-card__emoji {
  font-size: 32px;
  line-height: 1;
  user-select: none;
}

.ik-emote-picker-card__name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: block;
  min-width: 0;
  padding: 18px 6px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.72) 100%);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  pointer-events: none;
}

.ik-emote-picker-state,
.ik-emote-picker-empty {
  flex: 1;
  min-height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #777;
  font-size: 14px;
  font-weight: 700;
}

.ik-emote-picker-empty {
  min-height: 80px;
}

.ik-emote-picker-spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(215, 255, 0, 0.25);
  border-top-color: #BFFF09;
  animation: ik-emote-picker-spin 800ms linear infinite;
}

@keyframes ik-emote-picker-spin {
  to { transform: rotate(360deg); }
}

.ik-emote-picker-footer {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: -24px;
  position: relative;
  z-index: 1;
  flex-shrink: 0;
}

.ik-emote-picker-footer :deep(.z-button) {
  min-width: 120px;
  font-weight: 900;
}

/* 过渡动画 */
.ik-emote-picker-enter-active,
.ik-emote-picker-leave-active {
  transition: opacity 200ms ease;
}

.ik-emote-picker-enter-from,
.ik-emote-picker-leave-to {
  opacity: 0;
}

.ik-emote-picker-enter-active .ik-emote-picker-dialog,
.ik-emote-picker-leave-active .ik-emote-picker-dialog {
  transition: transform 200ms ease, opacity 200ms ease;
}

.ik-emote-picker-enter-from .ik-emote-picker-dialog,
.ik-emote-picker-leave-to .ik-emote-picker-dialog {
  opacity: 0;
  transform: translateY(-10%) scale(0.96);
}

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

@media (max-width: 800px) {
  .ik-emote-picker-dialog {
    width: 92%;
    height: 85%;
  }

  .ik-emote-picker-grid {
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 10px;
    padding: 14px 14px 56px;
  }
}

@media (max-width: 768px) {
  .ik-emote-picker-overlay {
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
  }

  .ik-emote-picker-overlay__stripe {
    display: none;
  }

  .ik-emote-picker-dialog {
    width: 100%;
    height: auto;
    max-height: 88vh;
  }

  .ik-emote-picker-enter-from .ik-emote-picker-dialog,
  .ik-emote-picker-leave-to .ik-emote-picker-dialog {
    transform: translateY(100%) scale(1);
  }

  .ik-emote-picker-frame {
    padding: 0;
    background: #181818;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
    height: auto;
  }

  .ik-emote-picker-frame__inner {
    padding: 0;
    background: transparent;
    border-radius: 16px 16px 0 0;
    height: auto;
  }

  .ik-emote-picker-body {
    border-radius: 16px 16px 0 0;
    height: auto;
  }

  .ik-emote-picker-header {
    min-height: auto;
    padding: 16px 16px 10px;
    background: transparent;
    border-radius: 0;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }

  .ik-emote-picker-header::before {
    content: "";
    width: 36px;
    height: 4px;
    margin: 0 auto 12px;
    border-radius: 99px;
    background: #383838;
  }

  .ik-emote-picker-header__text {
    justify-content: space-between;
  }

  .ik-emote-picker-title {
    font-size: 16px;
    font-weight: 700;
  }

  .ik-emote-picker-close {
    display: none;
  }

  .ik-emote-picker-main {
    padding: 0 16px 12px;
    background: transparent;
    flex: none;
  }

  .ik-emote-picker-grid-wrap {
    position: relative;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    min-height: 120px;
    flex: none;
    overflow: hidden;
  }

  .ik-emote-picker-state {
    min-height: 120px;
  }

  .ik-emote-picker-grid-scroll {
    border-radius: 12px;
    max-height: 60vh;
  }

  .ik-emote-picker-grid-scroll :deep(.z-scrollbar__bar) {
    display: none;
  }

  .ik-emote-picker-grid {
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: 8px;
    padding: 12px;
  }

  .ik-emote-picker-card__emoji {
    font-size: 28px;
  }

  .ik-emote-picker-footer {
    margin-top: 0;
    padding: 10px 0 calc(10px + env(safe-area-inset-bottom, 0px));
    gap: 10px;
  }

  .ik-emote-picker-footer :deep(.z-button) {
    flex: 1;
    min-width: 0;
  }
}
</style>
