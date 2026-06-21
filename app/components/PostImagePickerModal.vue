<script setup lang="ts">
import { CheckIcon } from "@heroicons/vue/24/outline";
import { useMessage } from "zenless-ui";
import type { UploadedFile } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";

const props = withDefaults(defineProps<{
  existingIds?: string[];
  remaining: number;
  pageSize?: number;
}>(), {
  existingIds: () => [],
  pageSize: 100,
});

const emit = defineEmits<{
  close: [];
  upload: [files: File[]];
  select: [uploads: UploadedFile[]];
}>();

const api = useApi();
const message = useMessage();

const fileInputRef = ref<HTMLInputElement | null>(null);
const uploads = ref<UploadedFile[]>([]);
const selectedUploadIds = ref<string[]>([]);
const loading = ref(true);

const existingIdSet = computed(() => new Set(props.existingIds));
const selectedIdSet = computed(() => new Set(selectedUploadIds.value));
const remainingCount = computed(() => Math.max(0, props.remaining));
const selectedUploads = computed(() => {
  const selected = selectedIdSet.value;
  return uploads.value.filter((upload) => selected.has(upload.documentId));
});

const toThumbUrl = (url: string): string => {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `${url}-small.webp`;
};

const triggerFileInput = () => {
  if (remainingCount.value <= 0) {
    message.warning("图片数量已达上限");
    return;
  }
  fileInputRef.value?.click();
};

const onFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = "";
  if (!files.length) return;
  emit("upload", files);
  emit("close");
};

const toggleUpload = (upload: UploadedFile) => {
  if (!upload.documentId) return;
  if (existingIdSet.value.has(upload.documentId)) {
    message.warning("这张图片已经添加过了");
    return;
  }
  if (selectedIdSet.value.has(upload.documentId)) {
    selectedUploadIds.value = selectedUploadIds.value.filter((id) => id !== upload.documentId);
    return;
  }
  if (selectedUploadIds.value.length >= remainingCount.value) {
    message.warning(`最多还能添加 ${remainingCount.value} 张图片`);
    return;
  }
  selectedUploadIds.value = [...selectedUploadIds.value, upload.documentId];
};

const confirmSelection = () => {
  if (!selectedUploads.value.length) {
    message.warning("请选择要引用的图片");
    return;
  }
  emit("select", selectedUploads.value);
  emit("close");
};

const handleClose = () => {
  emit("close");
};

const handleOverlayClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement).classList.contains("ik-overlay")) {
    handleClose();
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") handleClose();
};

const { acquire, release } = useBodyScrollLock();
const SCROLL_LOCK_TOKEN = Symbol("post-image-picker-modal");

onMounted(async () => {
  window.addEventListener("keydown", handleKeydown);
  acquire(SCROLL_LOCK_TOKEN);
  loading.value = true;
  try {
    const result = await api.getMyUploads(1, props.pageSize);
    uploads.value = result.uploads;
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取图片列表失败"));
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  release(SCROLL_LOCK_TOKEN);
});
</script>

<template>
  <div class="ik-overlay" @click="handleOverlayClick">
    <div class="ik-overlay__stripe" aria-hidden="true" />
    <div class="ik-img-dialog" @click.stop>
      <div class="ik-img-frame">
        <div class="ik-img-frame__inner">
          <div class="ik-img-frame__body">
            <div class="ik-img-header">
              <div class="ik-img-header__text">
                <span class="ik-img-title">添加图片</span>
                <span class="ik-img-subtitle">已选 {{ selectedUploadIds.length }} / {{ remainingCount }}</span>
              </div>
              <button class="ik-img-close" aria-label="关闭" @click="handleClose">
                <img src="/images/close-btn.webp" alt="关闭" class="ik-img-close__img" draggable="false" />
              </button>
            </div>

            <div class="ik-img-main">
              <IkZzzMarquee />
              <div class="ik-img-grid-wrap">
                <div v-if="loading" class="ik-img-state">
                  <span class="ik-img-spinner" aria-hidden="true"></span>
                  加载中...
                </div>

                <z-scrollbar v-else class="ik-img-grid-scroll">
                  <div class="ik-img-grid">
                    <CoverImageAddButton
                      :disabled="remainingCount <= 0"
                      @click="triggerFileInput"
                    />
                    <input
                      ref="fileInputRef"
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      multiple
                      class="ik-img-file-input"
                      @change="onFileSelected"
                    />

                    <button
                      v-for="upload in uploads"
                      :key="upload.documentId"
                      type="button"
                      class="ik-img-card"
                      :class="{
                        'is-selected': selectedIdSet.has(upload.documentId),
                        'is-disabled': existingIdSet.has(upload.documentId),
                      }"
                      @click="toggleUpload(upload)"
                    >
                      <div class="ik-img-card__thumb">
                        <img
                          :src="toThumbUrl(upload.url)"
                          :alt="upload.name || '历史图片'"
                          class="ik-img-card__image"
                          loading="lazy"
                          decoding="async"
                          draggable="false"
                          @error="($event.target as HTMLImageElement).src = upload.url"
                        />
                      </div>
                      <span class="ik-img-card__name">{{ upload.name || '历史图片' }}</span>
                      <span v-if="selectedIdSet.has(upload.documentId)" class="ik-img-card__badge">
                        <CheckIcon class="ik-img-card__badge-icon" />
                      </span>
                      <span v-else-if="existingIdSet.has(upload.documentId)" class="ik-img-card__used">已添加</span>
                    </button>
                  </div>
                  <div v-if="!uploads.length" class="ik-img-empty">暂无图片，请上传一张图片试试吧(✿◡‿◡)</div>
                </z-scrollbar>
              </div>

              <div class="ik-img-footer">
                <z-button :disabled="loading" @click="handleClose">取消</z-button>
                <z-button :disabled="loading || !selectedUploads.length" @click="confirmSelection">
                  确定
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

.ik-img-dialog {
  position: relative;
  width: 56%;
  height: 66%;
  transform: scale(1.1);
  transform-origin: center;
}

.ik-img-frame {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px;
}

.ik-img-frame__inner {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #000;
  border-radius: 22px;
  overflow: hidden;
}

.ik-img-frame__body {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  overflow: hidden;
}

.ik-img-header {
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

.ik-img-header__text {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}

.ik-img-title {
  color: #fff;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.4px;
}

.ik-img-subtitle {
  color: #888;
  font-size: 12px;
  font-weight: 700;
}

.ik-img-close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.ik-img-close__img {
  height: 32px;
  width: auto;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

.ik-img-main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 16px;
  background: linear-gradient(180deg, #010101 0%, #161616 100%);
}

.ik-img-grid-wrap {
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

.ik-img-grid-scroll {
  flex: 1;
  min-height: 0;
  border-radius: 16px;
  overflow: hidden;
}

.ik-img-grid-scroll :deep(.z-scrollbar__wrap) {
  background: transparent;
}

.ik-img-grid-scroll :deep(.z-scrollbar__view) {
  min-height: auto;
}

.ik-img-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 14px;
  box-sizing: border-box;
  padding: 18px 24px 58px 18px;
}

.ik-img-card {
  position: relative;
  display: block;
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
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.ik-img-card:hover:not(:disabled) {
  border-color: #333;
  background: #1a1a1a;
  transform: translateY(-2px);
}

.ik-img-card.is-selected {
  border-color: #fbfe00;
  background: #1a1a0a;
}

.ik-img-card.is-selected:hover:not(:disabled) {
  border-color: #fbfe00;
  background: #1a1a0a;
}

.ik-img-card.is-disabled {
  opacity: 0.55;
}

.ik-img-card:disabled {
  opacity: 0.45;
}

.ik-img-card__thumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1e1e1e;
}

.ik-img-card__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ik-img-card__name {
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

.ik-img-card__badge,
.ik-img-card__used {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-weight: 900;
}

.ik-img-card__badge {
  width: 24px;
  height: 24px;
  background: #BFFF09;
  color: #000;
}

.ik-img-card__badge-icon {
  width: 16px;
  height: 16px;
}

.ik-img-card__used {
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.72);
  color: #aaa;
  font-size: 10px;
}

.ik-img-state,
.ik-img-empty {
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

.ik-img-empty {
  min-height: 80px;
}

.ik-img-spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(215, 255, 0, 0.25);
  border-top-color: #BFFF09;
  animation: ik-img-spin 800ms linear infinite;
}

@keyframes ik-img-spin {
  to { transform: rotate(360deg); }
}

.ik-img-footer {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: -24px;
  position: relative;
  z-index: 1;
  flex-shrink: 0;
}

.ik-img-footer :deep(.z-button) {
  min-width: 120px;
  font-weight: 900;
}

.ik-img-file-input {
  display: none;
}

.ik-overlay-enter-from .ik-img-dialog { transform: scale(1.1) translateX(5%); }
.ik-overlay-leave-to .ik-img-dialog { transform: scale(1.1) translateX(-5%); }

@media (max-width: 800px) {
  .ik-img-dialog {
    width: 92%;
    height: 85%;
    transform: scale(1);
  }

  .ik-overlay-enter-from .ik-img-dialog { transform: scale(1) translateX(5%); }
  .ik-overlay-leave-to .ik-img-dialog { transform: scale(1) translateX(-5%); }

  .ik-img-grid {
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px;
    padding: 14px 14px 56px;
  }
}

@media (max-width: 768px) {
  .ik-overlay {
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
  }

  .ik-overlay__stripe {
    display: none;
  }

  .ik-img-dialog {
    width: 100%;
    height: auto;
    max-height: 88vh;
    transform: none;
  }

  .ik-overlay-enter-from .ik-img-dialog {
    transform: translateY(100%);
  }
  .ik-overlay-leave-to .ik-img-dialog {
    transform: translateY(100%);
  }

  .ik-img-frame {
    padding: 0;
    background: #181818;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
  }

  .ik-img-frame__inner {
    padding: 0;
    background: transparent;
    border-radius: 16px 16px 0 0;
  }

  .ik-img-frame__body {
    border-radius: 16px 16px 0 0;
  }

  .ik-img-header {
    min-height: auto;
    padding: 16px 16px 10px;
    background: transparent;
    border-radius: 0;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }

  .ik-img-header::before {
    content: "";
    width: 36px;
    height: 4px;
    margin: 0 auto 12px;
    border-radius: 99px;
    background: #383838;
  }

  .ik-img-header__text {
    justify-content: space-between;
  }

  .ik-img-title {
    font-size: 16px;
    font-weight: 700;
  }

  .ik-img-close {
    display: none;
  }

  .ik-img-main {
    padding: 0 16px 12px;
    background: transparent;
  }

  .ik-img-main :deep(.ik-zzz-marquee) {
    display: none;
  }

  .ik-img-grid-wrap {
    background: rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    max-height: 50vh;
  }

  .ik-img-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    padding: 12px 12px calc(12px + env(safe-area-inset-bottom, 0px));
  }

  .ik-img-footer {
    margin-top: 0;
    padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px));
    gap: 10px;
  }

  .ik-img-footer :deep(.z-button) {
    flex: 1;
    min-width: 0;
  }
}
</style>
