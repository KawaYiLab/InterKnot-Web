<script setup lang="ts">
/**
 * 表情选择面板（参照 MentionPicker.vue 的浮层范式）。
 *
 * - Teleport 到 body，fixed 定位避免父级 overflow 截断
 * - 按锚点按钮位置自动翻转（下方空间不够就翻到上方）
 * - 底部横向分类 tab：最近 / 各后台分组（用分组自定义图标，未设置时降级用首个表情，不显示分类名）/ emoji
 * - mousedown + preventDefault 避免 textarea 失焦
 * - 最近使用（localStorage，最多 12 个）
 * - 点击外部 / 按 ESC 自动关闭（emit close）
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useMediaQuery } from "@vueuse/core";
import { useEmotes, type Emote } from "~/composables/useEmotes";

const props = defineProps<{
  visible: boolean;
  /** 触发按钮在视口里的坐标（CSS pixel） */
  anchor: { top: number; left: number; height: number } | null;
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

const isMobile = useMediaQuery("(max-width: 640px)");

const PICKER_W = 320;
const PICKER_MAX_H = 280;
const SAFE_PADDING = 8;

const pickerRootRef = ref<HTMLDivElement | null>(null);
const actualH = ref(PICKER_MAX_H);
let resizeObserver: ResizeObserver | null = null;

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

const onTabMouseDown = (e: MouseEvent, tab: PickerTab) => {
  e.preventDefault();
  activeTabKey.value = tab.key;
};

const styleObj = computed(() => {
  if (!props.visible) return { display: "none" } as Record<string, string>;

  // 小屏直接作为底部面板，不依赖触发按钮的锚点
  if (isMobile.value) {
    return {
      top: "auto",
      left: "0",
      right: "0",
      bottom: "max(0px, env(safe-area-inset-bottom))",
      width: "100%",
      maxWidth: "100vw",
    } as Record<string, string>;
  }

  if (!props.anchor) return { display: "none" } as Record<string, string>;
  const a = props.anchor;

  const vh = typeof window !== "undefined" ? window.innerHeight : Number.POSITIVE_INFINITY;
  const vw = typeof window !== "undefined" ? window.innerWidth : Number.POSITIVE_INFINITY;
  const h = actualH.value;

  const naturalTop = a.top + a.height + 4;
  const fitsBelow = naturalTop + h + SAFE_PADDING <= vh;
  const top = fitsBelow
    ? naturalTop
    : Math.max(SAFE_PADDING, a.top - 4 - h);

  const naturalLeft = a.left;
  const fitsRight = naturalLeft + PICKER_W + SAFE_PADDING <= vw;
  const left = fitsRight
    ? Math.max(SAFE_PADDING, naturalLeft)
    : Math.max(SAFE_PADDING, vw - PICKER_W - SAFE_PADDING);

  return {
    top: `${top}px`,
    left: `${left}px`,
  };
});

const teardownObserver = () => {
  resizeObserver?.disconnect();
  resizeObserver = null;
};

/**
 * 点击外部关闭：mousedown 冒泡到 document 时检查 target 是否落在 picker 内部。
 * 触发按钮在父组件用 @mousedown.stop 阻止冒泡，因此点击按钮不会触发此逻辑——
 * 避免了「mousedown 关闭 → click 又重新打开」的竞态。
 */
const onDocMouseDown = (e: MouseEvent) => {
  const el = pickerRootRef.value;
  if (el && !el.contains(e.target as Node)) {
    emit("close");
  }
};

/** ESC 关闭：与 ConfirmDialog / ReportModal 的 keydown(Capture) 模式一致 */
const onDocKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    e.stopImmediatePropagation();
    emit("close");
  }
};

const teardownListeners = () => {
  document.removeEventListener("mousedown", onDocMouseDown);
  window.removeEventListener("keydown", onDocKeyDown, true);
};

watch(
  () => props.visible,
  async (vis) => {
    if (!vis) {
      teardownObserver();
      teardownListeners();
      actualH.value = PICKER_MAX_H;
      return;
    }
    if (typeof window === "undefined") return;
    // 每次打开时重拉过期清单，后台增删表情能尽快生效
    refreshIfStale();
    // 每次打开回到第一个 tab
    activeTabKey.value = tabs.value[0]?.key ?? "";
    await nextTick();
    const el = pickerRootRef.value;
    if (!el) return;
    actualH.value = el.offsetHeight || PICKER_MAX_H;
    teardownObserver();
    resizeObserver = new ResizeObserver(() => {
      const node = pickerRootRef.value;
      if (!node) return;
      const next = node.offsetHeight;
      if (next > 0) actualH.value = next;
    });
    resizeObserver.observe(el);
    // 延迟一帧注册 mousedown，避免打开 picker 的那一次点击余波触发 close
    requestAnimationFrame(() => {
      if (!props.visible) return;
      document.addEventListener("mousedown", onDocMouseDown);
      window.addEventListener("keydown", onDocKeyDown, true);
    });
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  teardownObserver();
  teardownListeners();
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
    <div
      v-if="visible"
      ref="pickerRootRef"
      class="ik-emote-picker"
      :class="{ 'is-mobile': isMobile }"
      :style="styleObj"
      role="dialog"
      aria-label="表情"
    >
      <div class="ik-emote-picker__inner">
        <!-- loading -->
        <div v-if="loading && !emotes.length" class="ik-emote-picker__hint">
          加载中…
        </div>
        <!-- 当前 tab 的表情/emoji 网格（无表情包时仍有 emoji tab 可用） -->
        <template v-else>
          <div class="ik-emote-picker__content">
            <!-- emoji tab -->
            <div v-if="activeTab?.isEmoji" class="ik-emote-picker__grid ik-emote-picker__grid--emoji">
              <button
                v-for="emoji in EMOJI_LIST"
                :key="emoji"
                type="button"
                class="ik-emote-picker__item ik-emote-picker__item--emoji"
                @mousedown="onEmojiMouseDown($event, emoji)"
              >
                {{ emoji }}
              </button>
            </div>
            <!-- 表情包 tab -->
            <div v-else class="ik-emote-picker__grid">
              <button
                v-for="emote in activeTab?.emotes ?? []"
                :key="emote.code"
                type="button"
                class="ik-emote-picker__item"
                :title="emote.name"
                @mousedown="onItemMouseDown($event, emote)"
              >
                <img
                  :src="emote.url"
                  :alt="emote.name"
                  loading="lazy"
                  decoding="async"
                  draggable="false"
                />
              </button>
            </div>
          </div>
          <!-- 底部横向分类 tab（不显示分类名，图标 + title 提示） -->
          <div class="ik-emote-picker__tabs">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              type="button"
              class="ik-emote-picker__tab"
              :class="{ 'ik-emote-picker__tab--active': tab.key === activeTab?.key }"
              :title="tab.title"
              @mousedown="onTabMouseDown($event, tab)"
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
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ik-emote-picker {
  position: fixed;
  z-index: 9999;
  width: 320px;
  padding: 3px;
  background: #2d2c2d;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
}

.ik-emote-picker__inner {
  position: relative;
  background: #050505 url("/images/tab-bg-point.webp") repeat;
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-emote-picker__content {
  height: 224px;
  overflow-y: auto;
}

.ik-emote-picker__content::-webkit-scrollbar {
  width: 4px;
}
.ik-emote-picker__content::-webkit-scrollbar-track {
  background: transparent;
}
.ik-emote-picker__content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}
.ik-emote-picker__content {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.ik-emote-picker__hint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 224px;
  text-align: center;
  font-size: 13px;
  color: #888;
}


.ik-emote-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
  gap: 2px;
}

.ik-emote-picker__item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 120ms ease, transform 120ms ease;
}

.ik-emote-picker__item:hover {
  background-color: rgba(255, 255, 255, 0.08);
  transform: scale(1.12);
}

.ik-emote-picker__item:active {
  transform: scale(0.92);
}

.ik-emote-picker__item img {
  width: 40px;
  height: 40px;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-emote-picker__item--emoji {
  font-size: 26px;
  line-height: 1;
}

.ik-emote-picker__tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.ik-emote-picker__tabs::-webkit-scrollbar {
  height: 4px;
}
.ik-emote-picker__tabs::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}

.ik-emote-picker__tab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 34px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  transition: background-color 120ms ease;
}

.ik-emote-picker__tab:hover {
  background-color: rgba(255, 255, 255, 0.08);
}

.ik-emote-picker__tab--active {
  background-color: rgba(255, 255, 255, 0.14);
}

.ik-emote-picker__tab img {
  width: 26px;
  height: 26px;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

/* 移动端底部面板：宽度撑满、避开 Home 指示条 */
@media (max-width: 640px) {
  .ik-emote-picker.is-mobile {
    top: auto !important;
    left: 0 !important;
    right: 0;
    bottom: max(0px, env(safe-area-inset-bottom));
    width: 100%;
    max-width: 100vw;
    border-radius: 16px 16px 0 0;
    padding: 0;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.55);
  }

  .ik-emote-picker.is-mobile .ik-emote-picker__inner {
    border-radius: 14px 14px 0 0;
  }

  .ik-emote-picker.is-mobile .ik-emote-picker__content {
    height: auto;
    min-height: 180px;
    max-height: min(40vh, 260px);
  }

  .ik-emote-picker.is-mobile .ik-emote-picker__item {
    width: 44px;
    height: 44px;
  }

  .ik-emote-picker.is-mobile .ik-emote-picker__item img {
    width: 36px;
    height: 36px;
  }

  .ik-emote-picker.is-mobile .ik-emote-picker__item--emoji {
    font-size: 24px;
  }

  .ik-emote-picker.is-mobile .ik-emote-picker__tab {
    width: 38px;
    height: 32px;
  }

  .ik-emote-picker.is-mobile .ik-emote-picker__tab img {
    width: 22px;
    height: 22px;
  }
}
</style>
