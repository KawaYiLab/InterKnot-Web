<script setup lang="ts">
import { useMessage } from "zenless-ui";
import { resolveErrorMessage } from "~/utils/api-error";

interface Candidate {
  documentId: string;
  title: string;
  cover: { url: string; width?: number; height?: number } | null;
  updatedAt?: string;
}

const emit = defineEmits<{
  close: [];
  saved: [pinned: string[] | null];
}>();

const api = useApi();
const message = useMessage();

const loading = ref(true);
const saving = ref(false);
const max = ref(6);
const candidates = ref<Candidate[]>([]);
// null = 未配置（默认全部展示）；string[] = 已配置（可能为空）
const pinned = ref<string[] | null>(null);
// 编辑态拷贝
const draft = ref<string[] | null>(null);

const draftCount = computed(() => (Array.isArray(draft.value) ? draft.value.length : 0));

// 每张卡片的选中序号（1-based），未选中返回 0
const orderOf = (id: string): number => {
  if (!Array.isArray(draft.value)) return 0;
  const idx = draft.value.indexOf(id);
  return idx >= 0 ? idx + 1 : 0;
};

const isDirty = computed(() => {
  const a = pinned.value;
  const b = draft.value;
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  if (a.length !== b.length) return true;
  return a.some((id, i) => id !== b[i]);
});

const handleClose = () => {
  if (saving.value) return;
  emit("close");
};

const handleOverlayClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains("ik-overlay")) {
    handleClose();
  }
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") handleClose();
};

const restoreDefault = () => {
  draft.value = null;
};

// 点击卡片：未选中 → 追加到末尾（下一个序号）；已选中 → 移除（后续自动补位）
// 若当前处于默认模式（draft === null），自动进入自定义并选中该卡片
const toggleCard = (id: string) => {
  if (!Array.isArray(draft.value)) {
    draft.value = [id];
    return;
  }
  const idx = draft.value.indexOf(id);
  if (idx >= 0) {
    draft.value = draft.value.filter((x) => x !== id);
  } else {
    if (draft.value.length >= max.value) {
      message.warning(`最多只能选 ${max.value} 篇`);
      return;
    }
    draft.value = [...draft.value, id];
  }
};

const handleSave = async () => {
  if (saving.value) return;
  if (!isDirty.value) {
    message.warning("什么都没改呢！");
    return;
  }
  saving.value = true;
  try {
    const result = await api.updatePinnedArticles(draft.value);
    pinned.value = result.pinned;
    draft.value = result.pinned == null ? null : [...result.pinned];
    emit("saved", result.pinned);
    message.success("保存成功");
    emit("close");
  } catch (err) {
    message.error(resolveErrorMessage(err, "保存失败"));
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  window.addEventListener("keydown", handleKeydown);
  loading.value = true;
  try {
    const result = await api.getPinnedArticles(50);
    candidates.value = result.candidates;
    pinned.value = result.pinned;
    draft.value = result.pinned == null ? null : [...result.pinned];
    max.value = result.max || 6;
  } catch (err) {
    message.error(resolveErrorMessage(err, "加载失败"));
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div class="ik-overlay ik-overlay--sub" @click="handleOverlayClick">
    <div class="ik-overlay__stripe" aria-hidden="true"></div>
    <div class="ik-dialog" @click.stop>
      <div class="ik-dialog__outer">
        <div class="ik-dialog__inner">
          <div class="ik-dialog__header">
            <span class="ik-dialog__title">修改委托展示</span>
            <button class="ik-dialog__close" aria-label="关闭" @click="handleClose">
              <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
            </button>
          </div>

          <div class="ik-dialog__body">
            <IkZzzMarquee />
            <div v-if="loading" class="ik-pin__state">加载中...</div>

            <div v-else class="ik-pin">
              <!-- 顶部说明 -->
              <div class="ik-pin__head">
                <div class="ik-pin__head-text">
                  <template v-if="!Array.isArray(draft)">
                    <strong>当前：默认展示</strong>
                    <span class="ik-pin__hint">点击下方委托卡片即可开始自定义展示顺序。</span>
                  </template>
                  <template v-else>
                    <strong>已选 {{ draftCount }} / {{ max }}</strong>
                    <span class="ik-pin__hint">
                      <template v-if="draftCount === 0">点击下方委托卡片，按点击顺序决定展示顺序。</template>
                      <template v-else>再次点击已选委托可取消选中。</template>
                    </span>
                  </template>
                </div>
              </div>

              <!-- 卡片网格 -->
              <div class="ik-pin__grid-wrap">
                <div v-if="!candidates.length" class="ik-pin__empty">
                  你还没有发布任何委托。
                </div>
                <z-scrollbar v-else class="ik-pin__grid-scroll">
                <div class="ik-pin__grid">
                  <button
                    v-for="card in candidates"
                    :key="card.documentId"
                    class="ik-pin__card"
                    :class="{ 'ik-pin__card--active': orderOf(card.documentId) > 0 }"
                    @click="toggleCard(card.documentId)"
                  >
                    <div class="ik-pin__card-cover">
                      <img
                        :src="card.cover?.url || '/images/default-cover.webp'"
                        :alt="card.title"
                        @error="($event.target as HTMLImageElement).src = '/images/default-cover.webp'"
                      />
                    </div>
                    <span class="ik-pin__card-title">{{ card.title || "（无标题）" }}</span>
                    <span v-if="orderOf(card.documentId) > 0" class="ik-pin__badge">
                      {{ orderOf(card.documentId) }}
                    </span>
                  </button>
                </div>
                </z-scrollbar>
              </div>

              <!-- 底部操作 -->
              <div class="ik-pin__footer">
                <z-button v-if="Array.isArray(draft)" :icon="{ error: '#c01c00' }" :disabled="saving" @click="restoreDefault">默认</z-button>
                <z-button
                  :disabled="saving || !isDirty"
                  :icon="isDirty ? { success: '#00cc0d' } : 'success'"
                  @click="handleSave"
                >
                  {{ saving ? "保存中..." : "保存" }}
                </z-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Overlay — 与委托弹窗 / 登录弹窗完全一致
   ═══════════════════════════════════════════════ */
.ik-overlay {
  position: fixed;
  inset: 0;
  z-index: 9100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.ik-overlay__stripe {
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

.ik-overlay--sub {
  z-index: 9200;
}

/* ── Dialog Shell ──────────────────────────────── */
.ik-dialog {
  position: relative;
  width: 70%;
  max-width: 90%;
  height: 75%;
  max-height: 90%;
  will-change: transform;
}

@media (max-width: 800px) {
  .ik-dialog {
    width: 90%;
    height: 90%;
  }
}

@media (max-width: 500px) {
  .ik-dialog {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
  }
}

.ik-dialog__outer {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
}

.ik-dialog__inner {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Header ────────────────────────────────────── */
.ik-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 12px 24px;
  flex-shrink: 0;
  border-radius: 18px 0 0 0;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #161616 0%, #080808 100%);
}

.ik-dialog__title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}

.ik-dialog__close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: opacity 140ms ease, transform 140ms ease;
}

.ik-dialog__close:hover {
  opacity: 0.85;
  transform: scale(1.08);
}

.ik-dialog__close:active {
  transform: scale(0.95);
}

.ik-dialog__close-img {
  height: 32px;
  width: auto;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

/* ── Body ──────────────────────────────────────── */
.ik-dialog__body {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 20px;
  background: #121212;
  border-radius: 0 0 18px 18px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Pinned Articles Content ───────────────────── */
.ik-pin {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.ik-pin__state {
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  padding: 60px 0;
}

.ik-pin__head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 14px;
  flex-shrink: 0;
}
.ik-pin__head-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ik-pin__head-text strong {
  color: #fff;
  font-size: 15px;
}
.ik-pin__hint {
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
}
.ik-pin__head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.ik-pin__section-title {
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  margin-bottom: 8px;
  text-transform: uppercase;
}

.ik-pin__empty {
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
  padding: 24px 0;
  font-size: 13px;
}

/* ── Card Grid ──────────────────────────────────── */
.ik-pin__grid-wrap {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ik-pin__grid-scroll {
  flex: 1;
  min-height: 0;
}

.ik-pin__grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.ik-pin__grid--readonly {
  pointer-events: none;
  opacity: 0.7;
}

.ik-pin__card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: #0f0f0f;
  border: 2px solid transparent;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  padding: 2px;
  text-align: left;
  color: inherit;
  font: inherit;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.ik-pin__card:hover {
  background: #1a1a1a;
  border-color: #333;
}

.ik-pin__card:active {
  transform: scale(0.97);
}

.ik-pin__card--active,
.ik-pin__card--active:hover {
  border-color: #fbfe00;
  background: #1a1a0a;
}

.ik-pin__card-cover {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  background: #1a1a1a;
  overflow: hidden;
}
.ik-pin__card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ik-pin__card-cover-empty {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #222, #181818);
}

.ik-pin__card-title {
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Selection Badge ───────────────────────────── */
.ik-pin__badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fbfe00;
  color: #000;
  font-weight: 900;
  font-size: 14px;
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.ik-pin__footer {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding-top: 4px;
}

/* 入场/出场动画统一在 theme.css 的 .ik-overlay-* 全局规则里维护 */

/* ── Mobile ───────────────────────────────────── */
@media (max-width: 640px) {
  /* Fewer columns so covers are large enough and titles are legible
     (the desktop 5-column grid shrank each card to ~64px on phones,
     clipping titles down to a single character). */
  .ik-pin__grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 500px) {
  .ik-dialog__outer {
    border-radius: 0;
  }

  .ik-dialog__inner {
    border-radius: 0;
  }

  .ik-dialog__header {
    border-radius: 0;
  }

  .ik-dialog__body {
    border-radius: 0;
    padding: 14px;
  }

  .ik-pin__grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .ik-pin__card-title {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.3;
  }
}
</style>
