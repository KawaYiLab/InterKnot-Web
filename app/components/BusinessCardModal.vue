<script setup lang="ts">
import { useMessage } from "zenless-ui";
import type { BusinessCard, BusinessCardType, Profile } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";

const props = defineProps<{
  profile: Profile;
}>();

const emit = defineEmits<{
  close: [];
  equipped: [card: BusinessCard | null];
}>();

const api = useApi();
const message = useMessage();

const cards = ref<BusinessCard[]>([]);
const equippedId = ref<string | null>(null);
const selectedCard = ref<BusinessCard | null>(null);
const loading = ref(true);
const equipping = ref(false);

type TabKey = "all" | BusinessCardType;
const activeTab = ref<TabKey>("all");
const tabs: { key: TabKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "character", label: "代理人" },
  { key: "city", label: "城募" },
  { key: "news", label: "纪闻" },
];

const filteredCards = computed(() =>
  activeTab.value === "all" ? cards.value : cards.value.filter((c) => c.type === activeTab.value),
);

const previewCard = computed(() => selectedCard.value ?? cards.value.find((c) => c.documentId === equippedId.value) ?? null);

const blocksToText = (blocks: unknown[] | undefined): string => {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block: any) => {
      if (Array.isArray(block?.children)) {
        return block.children.map((c: any) => c?.text ?? "").join("");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const previewStory = computed(() => blocksToText(previewCard.value?.story));

const handleTabChange = (key: TabKey) => {
  activeTab.value = key;
  selectedCard.value = null;
};

const selectCard = (card: BusinessCard) => {
  selectedCard.value = card;
};

const handleEquip = async () => {
  if (!selectedCard.value || equipping.value) return;
  equipping.value = true;
  try {
    await api.equipBusinessCard(selectedCard.value.documentId);
    equippedId.value = selectedCard.value.documentId;
    emit("equipped", selectedCard.value);
    message.success("已使用此名片");
  } catch (err) {
    message.error(resolveErrorMessage(err, "使用名片失败"));
  } finally {
    equipping.value = false;
  }
};

const handleUnequip = async () => {
  if (equipping.value) return;
  equipping.value = true;
  try {
    await api.equipBusinessCard(null);
    equippedId.value = null;
    selectedCard.value = null;
    emit("equipped", null);
    message.success("已卸下名片");
  } catch (err) {
    message.error(resolveErrorMessage(err, "卸下名片失败"));
  } finally {
    equipping.value = false;
  }
};

const handleClose = () => {
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

onMounted(async () => {
  window.addEventListener("keydown", handleKeydown);
  loading.value = true;
  try {
    const result = await api.getMyBusinessCards();
    cards.value = result.cards;
    equippedId.value = result.equippedCardDocumentId;
    if (!equippedId.value && cards.value.length > 0) {
      selectedCard.value = cards.value[0] ?? null;
    }
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取名片列表失败"));
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div class="ik-overlay" @click="handleOverlayClick">
    <div class="ik-overlay__stripe" />
    <div class="ik-bc-dialog">
      <!-- Outer / Inner frame (reuse profile frame style) -->
      <div class="ik-bc-frame">
        <div class="ik-bc-frame__inner">
          <div class="ik-bc-frame__body">

            <!-- Tab Bar -->
            <div class="ik-bc-tab-bar">
              <!-- Close button (left) -->
              <button class="ik-bc-close" aria-label="关闭" @click="handleClose">
                <img src="/images/close-btn.webp" alt="关闭" class="ik-bc-close__img" draggable="false" />
              </button>

              <!-- Type tabs (right) -->
              <div class="ik-bc-tabs" role="tablist">
                <button
                  v-for="(tab, idx) in tabs"
                  :key="tab.key"
                  type="button"
                  role="tab"
                  class="ik-bc-tab"
                  :class="[
                    idx === 0 ? 'ik-bc-tab--first' : idx === tabs.length - 1 ? 'ik-bc-tab--last' : 'ik-bc-tab--middle',
                    { 'is-active': activeTab === tab.key },
                  ]"
                  :aria-selected="activeTab === tab.key"
                  @click="handleTabChange(tab.key)"
                >
                  <svg v-if="idx === 0" class="ik-bc-tab__highlight ik-bc-tab__highlight--first" viewBox="0 0 110.7 42" aria-hidden="true">
                    <path d="M 21 0 L 94.38 0 A 10 10 0 0 1 103.29 14.54 L 93.75 33.26 A 16 16 0 0 1 79.5 42 L 21 42 A 21 21 0 0 1 21 0 Z" fill="currentColor" />
                  </svg>
                  <svg v-else-if="idx === tabs.length - 1" class="ik-bc-tab__highlight ik-bc-tab__highlight--last" viewBox="0 0 110.7 42" aria-hidden="true">
                    <path d="M 89.7 0 A 21 21 0 0 1 89.7 42 L 13.05 42 A 8 8 0 0 1 5.93 30.37 L 16.95 8.74 A 16 16 0 0 1 31.2 0 Z" fill="currentColor" />
                  </svg>
                  <svg v-else class="ik-bc-tab__highlight ik-bc-tab__highlight--middle" viewBox="0 0 121.4 42" aria-hidden="true">
                    <path d="M 105.08 0 A 10 10 0 0 1 113.99 14.54 L 104.45 33.26 A 16 16 0 0 1 90.2 42 L 16.32 42 A 10 10 0 0 1 7.41 27.46 L 16.95 8.74 A 16 16 0 0 1 31.2 0 Z" fill="currentColor" />
                  </svg>
                  <span class="ik-bc-tab__content">{{ tab.label }}</span>
                </button>
              </div>
            </div>

            <!-- Main content area -->
            <div class="ik-bc-main">

              <!-- Banner preview (top) -->
              <div class="ik-bc-preview">
                <div class="ik-bc-preview__banner-card">
                  <div
                    class="ik-bc-preview__banner"
                    :style="previewCard?.image ? { backgroundImage: `url('${previewCard.image}')` } : undefined"
                  >
                    <div class="ik-bc-preview__user">
                      <div class="ik-bc-preview__avatar-wrap">
                        <div class="ik-bc-preview__avatar">
                          <img
                            :src="profile.avatar || '/images/default-avatar.webp'"
                            alt=""
                            class="ik-bc-preview__avatar-img"
                            @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                          />
                        </div>
                      </div>
                      <div class="ik-bc-preview__info">
                        <h2 class="ik-bc-preview__name">{{ profile.name || profile.login || "匿名用户" }}</h2>
                        <span v-if="profile.bio" class="ik-bc-preview__tag">{{ profile.bio }}</span>
                        <span v-else class="ik-bc-preview__tag ik-bc-preview__tag--empty"><span class="ik-bc-preview__lv">Lv.</span>{{ profile.level || 1 }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Bottom: card list (left) + card detail (right) -->
              <div class="ik-bc-bottom">

                <!-- Card grid (left) -->
                <div class="ik-bc-grid-wrap">
                  <div v-if="loading" class="ik-bc-grid-loading">
                    <i class="z-icon-loading ik-spin" /> 加载中...
                  </div>
                  <div v-else-if="!filteredCards.length" class="ik-bc-grid-empty">
                    暂无此类名片
                  </div>
                  <z-scrollbar v-else class="ik-bc-grid-scroll">
                    <div class="ik-bc-grid">
                      <button
                        v-for="card in filteredCards"
                        :key="card.documentId"
                        class="ik-bc-grid__item"
                        :class="{
                          'is-selected': selectedCard?.documentId === card.documentId,
                          'is-equipped': equippedId === card.documentId,
                        }"
                        @click="selectCard(card)"
                      >
                        <div class="ik-bc-grid__thumb">
                          <img
                            v-if="card.image"
                            :src="card.image"
                            alt=""
                            class="ik-bc-grid__img"
                          />
                          <div v-else class="ik-bc-grid__placeholder">
                            {{ card.name.charAt(0) }}
                          </div>
                        </div>
                        <i v-if="equippedId === card.documentId" class="z-icon-success ik-bc-grid__badge-icon" />
                      </button>
                    </div>
                  </z-scrollbar>
                </div>

                <!-- Card detail (right) -->
                <div class="ik-bc-detail">
                  <template v-if="previewCard">
                    <h3 class="ik-bc-detail__name">{{ previewCard.name }}</h3>
                    <p v-if="previewStory" class="ik-bc-detail__story">{{ previewStory }}</p>
                    <p v-if="previewCard.description" class="ik-bc-detail__desc">{{ previewCard.description }}</p>
                    <p v-else class="ik-bc-detail__desc ik-bc-detail__desc--empty">暂无描述</p>

                    <div class="ik-bc-detail__actions">
                      <z-button
                        v-if="selectedCard && selectedCard.documentId !== equippedId"
                        :disabled="equipping"
                        @click="handleEquip"
                      >
                        {{ equipping ? '使用中...' : '使用名片' }}
                      </z-button>
                      <z-button
                        v-if="equippedId && (!selectedCard || selectedCard.documentId === equippedId)"
                        :disabled="equipping"
                        @click="handleUnequip"
                      >
                        {{ equipping ? '卸下中...' : '卸下名片' }}
                      </z-button>
                    </div>
                  </template>
                  <div v-else class="ik-bc-detail__empty">
                    选择一张名片查看详情
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Overlay (reuse discussion overlay pattern) ── */
.ik-overlay {
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

/* ── Dialog shell ── */
.ik-bc-dialog {
  position: relative;
  width: 70%;
  height: 75%;
  transform: scale(1.1);
  transform-origin: center;
}

/* ── Frame (reuse profile double-border) ── */
.ik-bc-frame {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px;
}
.ik-bc-frame__inner {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #000;
  border-radius: 22px;
  overflow: hidden;
}
.ik-bc-frame__body {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  border-radius: 20px;
  overflow: hidden;
}

/* ── Tab bar ── */
.ik-bc-tab-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  min-height: 52px;
  flex-shrink: 0;
  border-radius: 0 0 16px 16px;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #161616 0%, #080808 100%);
}

/* Close button (left side) */
.ik-bc-close {
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
.ik-bc-close:hover { opacity: 0.85; transform: scale(1.08); }
.ik-bc-close:active { transform: scale(0.95); }
.ik-bc-close__img {
  height: 32px;
  width: auto;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

/* Type tabs (right side, reuse header tab style) */
.ik-bc-tabs {
  position: relative;
  display: flex;
  overflow: visible;
  border: 3px solid #313131;
  border-radius: 999px;
  background: #050505 url("/images/tab-bg-point.webp") repeat;
}

.ik-bc-tab {
  position: relative;
  z-index: 0;
  width: 90px;
  height: 38px;
  padding: 0;
  overflow: visible;
  border: 0;
  appearance: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-family: inherit;
  font-size: 16px;
  font-weight: 700;
  font-style: italic;
  line-height: 1;
  text-align: center;
  user-select: none;
  transition: color 140ms ease;
}
.ik-bc-tab:focus-visible { outline: 2px solid rgba(215, 255, 0, 0.7); outline-offset: 4px; }
.ik-bc-tab:active { color: #b8b8b8; }
.ik-bc-tab.is-active { color: #000; }

.ik-bc-tab__content {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.ik-bc-tab__highlight {
  position: absolute;
  top: 0;
  z-index: 1;
  height: 38px;
  color: #fbfe00;
  opacity: 0;
  pointer-events: none;
  transform: scale(1.1);
  transform-origin: center;
}
.ik-bc-tab__highlight--first { left: 0; width: 100px; }
.ik-bc-tab__highlight--middle { left: -10px; width: 110px; }
.ik-bc-tab__highlight--last { right: 0; width: 100px; }

.ik-bc-tab.is-active .ik-bc-tab__highlight {
  opacity: 1;
  animation:
    ik-bc-tab-color 800ms linear infinite alternate,
    ik-bc-tab-scale 700ms linear infinite;
}

@keyframes ik-bc-tab-color {
  from { color: #fbfe00; }
  to { color: #dcfe00; }
}
@keyframes ik-bc-tab-scale {
  0% { transform: scale(1.1); animation-timing-function: cubic-bezier(0.55, 0.055, 0.675, 0.19); }
  50% { transform: scale(1.25); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
  100% { transform: scale(1.1); }
}

/* ── Main content ── */
.ik-bc-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #010101 0%, #161616 100%);
}

/* ── Banner preview ── */
.ik-bc-preview {
  flex-shrink: 0;
  padding: 12px 16px 0;
}
.ik-bc-preview__banner-card {
  background: transparent;
  overflow: hidden;
  border-radius: 14px;
}
.ik-bc-preview__banner {
  position: relative;
  border-radius: 0 0 14px 14px;
  overflow: hidden;
  background: #2a2d33 url("/images/banner.png") center/cover no-repeat;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
}
.ik-bc-preview__user {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.ik-bc-preview__avatar-wrap { position: relative; flex-shrink: 0; }
.ik-bc-preview__avatar {
  width: 64px;
  height: 64px;
  border-radius: 999px;
  overflow: hidden;
  border: 3px solid #000;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  background: #000;
}
.ik-bc-preview__avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ik-bc-preview__level {
  position: absolute;
  top: -4px;
  left: -4px;
  min-width: 26px;
  height: 26px;
  border-radius: 999px;
  background: #000;
  border: 2px solid #000;
  color: #fff;
  font-size: 11px;
  font-weight: 900;
  line-height: 22px;
  text-align: center;
  padding: 0 5px;
}
.ik-bc-preview__info { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.ik-bc-preview__name {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  color: #fff;
  line-height: 1.1;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.4);
}
.ik-bc-preview__tag {
  display: inline-block;
  align-self: flex-start;
  padding: 4px 12px;
  border-radius: 999px;
  background: #000;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.ik-bc-preview__tag--empty { color: rgba(255,255,255,0.85); }
.ik-bc-preview__lv { color: rgba(255,255,255,0.45); }
.ik-bc-preview__footer {
  padding: 6px 14px;
  border-bottom: 2px solid #000;
  border-radius: 0 0 14px 14px;
  overflow: hidden;
}
.ik-bc-preview__sig { margin: 0; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.95); line-height: 1.5; }
.ik-bc-preview__sig--empty { color: rgba(255,255,255,0.35); font-style: italic; }

/* ── Bottom split ── */
.ik-bc-bottom {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0;
  padding: 12px 16px 16px;
}

/* ── Card grid (left) ── */
.ik-bc-grid-wrap {
  flex: 3;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ik-bc-grid-scroll {
  flex: 1;
  height: 100%;
}

.ik-bc-grid-loading,
.ik-bc-grid-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-size: 14px;
  gap: 8px;
}

.ik-bc-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.ik-bc-grid__item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: 2px;
  border-radius: 12px;
  background: #0f0f0f;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
  appearance: none;
  color: #fff;
  font-family: inherit;
}
.ik-bc-grid__item:hover { background: #1a1a1a; border-color: #333; }
.ik-bc-grid__item.is-selected { border-color: #fbfe00; background: #1a1a0a; }
.ik-bc-grid__item.is-equipped { border-color: #fbfe00; }
.ik-bc-grid__item.is-selected.is-equipped { border-color: #fbfe00; }

.ik-bc-grid__thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: #1a1a1a;
}
.ik-bc-grid__img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ik-bc-grid__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 900;
  color: #444;
}

.ik-bc-grid__badge-icon {
  position: absolute;
  top: 0px;
  right: 0px;
  font-size: 25px;
  color: #00cc0d;
}

/* ── Card detail (right) ── */
.ik-bc-detail {
  flex: 2;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow-y: auto;
  -ms-overflow-style: none;
  scrollbar-width: none;
  background: #000;
  border-radius: 12px;
}
.ik-bc-detail::-webkit-scrollbar { display: none; }

.ik-bc-detail__name {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 900;
  color: #fff;
}
.ik-bc-detail__story {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #ccc;
  font-weight: 900;
  white-space: pre-wrap;
}
.ik-bc-detail__desc {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.7;
  color: #888;
  font-weight: 900;
  white-space: pre-wrap;
}
.ik-bc-detail__desc--empty {
  color: #555;
  font-style: italic;
}
.ik-bc-detail__actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 12px;
  font-weight: 900;
}
.ik-bc-detail__actions .z-button {
  min-width: 130px;
}
.ik-bc-detail__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #555;
  font-size: 14px;
}

/* ── Spin animation ── */
@keyframes ik-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.ik-spin { display: inline-block; animation: ik-spin 0.8s linear infinite; }

/* ── Transition animations (reuse discussion overlay pattern) ── */
@keyframes stripe-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes stripe-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

.ik-overlay-enter-active {
  transition: background-color 80ms ease-out, backdrop-filter 80ms ease-out, -webkit-backdrop-filter 80ms ease-out;
}
.ik-overlay-enter-from {
  background-color: transparent !important;
  backdrop-filter: blur(0) !important;
  -webkit-backdrop-filter: blur(0) !important;
}
.ik-overlay-enter-active .ik-overlay__stripe { animation: stripe-fade-in 250ms ease-out both; }
.ik-overlay-enter-active .ik-bc-dialog {
  transition: transform 250ms cubic-bezier(0.165, 0.84, 0.44, 1), opacity 200ms cubic-bezier(0.165, 0.84, 0.44, 1);
}
.ik-overlay-enter-from .ik-overlay__stripe { opacity: 0; }
.ik-overlay-enter-from .ik-bc-dialog { opacity: 0; transform: scale(1.1) translateX(5%); }

.ik-overlay-leave-active {
  transition: background-color 160ms ease-out, backdrop-filter 160ms ease-out, -webkit-backdrop-filter 160ms ease-out;
}
.ik-overlay-leave-active .ik-overlay__stripe { animation: stripe-fade-out 180ms ease-in both; }
.ik-overlay-leave-active .ik-bc-dialog {
  transition: transform 200ms cubic-bezier(0.55, 0, 1, 0.45), opacity 180ms ease-in;
}
.ik-overlay-leave-to {
  background-color: transparent !important;
  backdrop-filter: blur(0) !important;
  -webkit-backdrop-filter: blur(0) !important;
}
.ik-overlay-leave-to .ik-bc-dialog { opacity: 0; transform: scale(1.1) translateX(-5%); }

/* ── Mobile ── */
@media (max-width: 800px) {
  .ik-bc-dialog { width: 90%; height: 90%; transform: scale(1); }
  .ik-overlay-enter-from .ik-bc-dialog { transform: scale(1) translateX(5%); }
  .ik-overlay-leave-to .ik-bc-dialog { transform: scale(1) translateX(-5%); }
  .ik-bc-bottom { flex-direction: column; }
  .ik-bc-detail { padding: 12px 0 0; }
  .ik-bc-grid { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 500px) {
  .ik-bc-dialog { width: 100%; height: 100%; }
  .ik-bc-frame { border-radius: 0; }
  .ik-bc-frame__inner { border-radius: 0; }
  .ik-bc-frame__body { border-radius: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ik-overlay-enter-active,
  .ik-overlay-enter-active .ik-bc-dialog,
  .ik-overlay-leave-active,
  .ik-overlay-leave-active .ik-bc-dialog { transition: none; }
  .ik-overlay-enter-active .ik-overlay__stripe,
  .ik-overlay-leave-active .ik-overlay__stripe { animation: none; }
}
</style>
