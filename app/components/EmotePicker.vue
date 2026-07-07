<script setup lang="ts">
/**
 * 表情选择面板（参照 MentionPicker.vue 的浮层范式）。
 *
 * - Teleport 到 body，fixed 定位避免父级 overflow 截断
 * - 按锚点按钮位置自动翻转（下方空间不够就翻到上方）
 * - 按 group 分区展示表情网格
 * - mousedown + preventDefault 避免 textarea 失焦
 * - 最近使用（localStorage，最多 12 个）
 * - 点击外部 / 按 ESC 自动关闭（emit close）
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useEmotes, type Emote } from "~/composables/useEmotes";

const props = defineProps<{
  visible: boolean;
  /** 触发按钮在视口里的坐标（CSS pixel） */
  anchor: { top: number; left: number; height: number } | null;
}>();

const emit = defineEmits<{
  select: [emote: Emote];
  close: [];
}>();

const { groupedEmotes, loading, emotes, refreshIfStale } = useEmotes();

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

const styleObj = computed(() => {
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

</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="pickerRootRef"
      class="ik-emote-picker"
      :style="styleObj"
      role="dialog"
      aria-label="表情"
    >
      <div class="ik-emote-picker__inner">
        <!-- loading -->
        <div v-if="loading && !emotes.length" class="ik-emote-picker__hint">
          加载中…
        </div>
        <!-- empty -->
        <div v-else-if="!emotes.length" class="ik-emote-picker__hint">
          暂无表情
        </div>
        <!-- grid -->
        <template v-else>
          <!-- 最近使用 -->
          <div v-if="recentEmotes.length" class="ik-emote-picker__section">
            <div class="ik-emote-picker__section-label">最近</div>
            <div class="ik-emote-picker__grid">
              <button
                v-for="emote in recentEmotes"
                :key="`recent-${emote.code}`"
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
          <!-- 按分组分区（分组名与顺序由后台维护） -->
          <div
            v-for="[group, list] in groupedEmotes"
            :key="group"
            class="ik-emote-picker__section"
          >
            <div class="ik-emote-picker__section-label">
              {{ group }}
            </div>
            <div class="ik-emote-picker__grid">
              <button
                v-for="emote in list"
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
  max-height: 274px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ik-emote-picker__inner::-webkit-scrollbar {
  width: 4px;
}
.ik-emote-picker__inner::-webkit-scrollbar-track {
  background: transparent;
}
.ik-emote-picker__inner::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}
.ik-emote-picker__inner {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.ik-emote-picker__hint {
  padding: 24px 8px;
  text-align: center;
  font-size: 13px;
  color: #888;
}

.ik-emote-picker__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ik-emote-picker__section-label {
  font-size: 11px;
  color: #777;
  padding: 0 4px;
  user-select: none;
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
</style>
