<script setup lang="ts">
import { useMessage } from "zenless-ui";
import { Cropper, CircleStencil } from "vue-advanced-cropper";
import "vue-advanced-cropper/dist/style.css";
import type { Avatar, AvatarType, Profile } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";

const props = defineProps<{
  profile: Profile;
}>();

const emit = defineEmits<{
  close: [];
  equipped: [avatar: Avatar | null];
  customUploaded: [avatarUrl: string];
}>();

const api = useApi();
const message = useMessage();

const avatars = ref<Avatar[]>([]);
const equippedId = ref<string | null>(null);
const selectedAvatar = ref<Avatar | null>(null);
const loading = ref(true);
const equipping = ref(false);

type TabKey = "all" | AvatarType;
const activeTab = ref<TabKey>("all");
const tabs: { key: TabKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "character", label: "代理人" },
  { key: "city", label: "城募" },
  { key: "news", label: "纪闻" },
];

const filteredAvatars = computed(() =>
  activeTab.value === "all" ? avatars.value : avatars.value.filter((a) => a.type === activeTab.value),
);

// 网格缩略图：拼接七牛云 -small.webp，避免列表里加载原图。
// 预览区保留原 URL。
const toThumbUrl = (url: string | undefined): string => {
  if (!url) return "";
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (url.endsWith("-small.webp")) return url;
  return `${url}-small.webp`;
};

const previewAvatar = computed(
  () => selectedAvatar.value ?? avatars.value.find((a) => a.documentId === equippedId.value) ?? null,
);

const previewAvatarImage = computed(
  () => previewAvatar.value?.image || props.profile.avatar || "/images/default-avatar.webp",
);

// 选中状态：是否与当前装备一致
const isSelectionEquipped = computed(() => {
  if (!selectedAvatar.value) return true;
  return selectedAvatar.value.documentId === equippedId.value;
});

const handleTabChange = (key: TabKey) => {
  activeTab.value = key;
  selectedAvatar.value = null;
};

const selectAvatar = (avatar: Avatar) => {
  selectedAvatar.value = avatar;
};

const handleConfirm = async () => {
  if (equipping.value) return;
  if (!selectedAvatar.value) {
    message.warning("请选择一个头像");
    return;
  }
  if (selectedAvatar.value.documentId === equippedId.value) {
    message.warning("什么都没改呢！");
    return;
  }
  equipping.value = true;
  try {
    await api.equipAvatar(selectedAvatar.value.documentId);
    equippedId.value = selectedAvatar.value.documentId;
    emit("equipped", selectedAvatar.value);
    message.success("头像修改成功");
  } catch (err) {
    message.error(resolveErrorMessage(err, "修改头像失败"));
  } finally {
    equipping.value = false;
  }
};

// ── Custom avatar upload + crop ──
const fileInputRef = ref<HTMLInputElement | null>(null);
const showCropper = ref(false);
const cropImageSrc = ref("");
const cropperRef = ref<InstanceType<any> | null>(null);
const uploading = ref(false);

const triggerFileInput = () => {
  fileInputRef.value?.click();
};

const onFileSelected = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    message.warning("请选择图片文件");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    message.warning("图片大小不能超过 10MB");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    cropImageSrc.value = reader.result as string;
    showCropper.value = true;
  };
  reader.readAsDataURL(file);
};

const cancelCrop = () => {
  showCropper.value = false;
  cropImageSrc.value = "";
};

const confirmCrop = async () => {
  if (!cropperRef.value || uploading.value) return;
  uploading.value = true;
  try {
    const { canvas } = cropperRef.value.getResult();
    if (!canvas) throw new Error("Canvas export failed");
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b: Blob | null) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
        "image/webp",
        0.9,
      );
    });
    const file = new File([blob], "custom-avatar.webp", { type: "image/webp" });
    const result = await api.uploadCustomAvatar(file);
    equippedId.value = null;
    selectedAvatar.value = null;
    emit("customUploaded", result.url);
    message.success("自定义头像上传成功");
    cancelCrop();
  } catch (err) {
    message.error(resolveErrorMessage(err, "上传头像失败"));
  } finally {
    uploading.value = false;
  }
};

const handleClose = () => {
  cancelCrop();
  emit("close");
};

const handleOverlayClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains("ik-overlay")) {
    handleClose();
  }
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    if (showCropper.value) {
      cancelCrop();
    } else {
      handleClose();
    }
  }
};

// 锁住 body 滚动，避免弹窗打开时滚轮事件穿透到下方页面
const { acquire, release } = useBodyScrollLock();
const SCROLL_LOCK_TOKEN = Symbol("avatar-modal");

onMounted(async () => {
  window.addEventListener("keydown", handleKeydown);
  acquire(SCROLL_LOCK_TOKEN);
  loading.value = true;
  try {
    const result = await api.getMyAvatars();
    avatars.value = result.avatars;
    equippedId.value = result.equippedAvatarDocumentId;
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取头像列表失败"));
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
    <div class="ik-overlay__stripe" />
    <div class="ik-av-dialog">
      <div class="ik-av-frame">
        <div class="ik-av-frame__inner">
          <div class="ik-av-frame__body">

            <!-- Tab Bar (tabs LEFT, close RIGHT — 与名片相反) -->
            <div class="ik-av-tab-bar">
              <!-- Type tabs (left) -->
              <div class="ik-av-tabs" role="tablist">
                <button
                  v-for="(tab, idx) in tabs"
                  :key="tab.key"
                  type="button"
                  role="tab"
                  class="ik-av-tab"
                  :class="[
                    idx === 0 ? 'ik-av-tab--first' : idx === tabs.length - 1 ? 'ik-av-tab--last' : 'ik-av-tab--middle',
                    { 'is-active': activeTab === tab.key },
                  ]"
                  :aria-selected="activeTab === tab.key"
                  @click="handleTabChange(tab.key)"
                >
                  <svg v-if="idx === 0" class="ik-av-tab__highlight ik-av-tab__highlight--first" viewBox="0 0 110.7 42" aria-hidden="true">
                    <path d="M 21 0 L 94.38 0 A 10 10 0 0 1 103.29 14.54 L 93.75 33.26 A 16 16 0 0 1 79.5 42 L 21 42 A 21 21 0 0 1 21 0 Z" fill="currentColor" />
                  </svg>
                  <svg v-else-if="idx === tabs.length - 1" class="ik-av-tab__highlight ik-av-tab__highlight--last" viewBox="0 0 110.7 42" aria-hidden="true">
                    <path d="M 89.7 0 A 21 21 0 0 1 89.7 42 L 13.05 42 A 8 8 0 0 1 5.93 30.37 L 16.95 8.74 A 16 16 0 0 1 31.2 0 Z" fill="currentColor" />
                  </svg>
                  <svg v-else class="ik-av-tab__highlight ik-av-tab__highlight--middle" viewBox="0 0 121.4 42" aria-hidden="true">
                    <path d="M 105.08 0 A 10 10 0 0 1 113.99 14.54 L 104.45 33.26 A 16 16 0 0 1 90.2 42 L 16.32 42 A 10 10 0 0 1 7.41 27.46 L 16.95 8.74 A 16 16 0 0 1 31.2 0 Z" fill="currentColor" />
                  </svg>
                  <span class="ik-av-tab__content">{{ tab.label }}</span>
                </button>
              </div>

              <!-- Close button (right) -->
              <button class="ik-av-close" aria-label="关闭" @click="handleClose">
                <img src="/images/close-btn.webp" alt="关闭" class="ik-av-close__img" draggable="false" />
              </button>
            </div>

            <!-- Main content area -->
            <div class="ik-av-main">

              <!-- Banner preview (top) -->
              <div class="ik-av-preview">
                <div v-if="loading" class="ik-av-preview__banner-card">
                  <div class="ik-skel ik-av-preview__banner-skel"></div>
                </div>
                <div v-else class="ik-av-preview__banner-card">
                  <div
                    class="ik-av-preview__banner"
                    :style="profile.equippedCard?.image ? { backgroundImage: `url('${profile.equippedCard.image}')` } : undefined"
                  >
                    <div class="ik-av-preview__user">
                      <div class="ik-av-preview__avatar-wrap">
                        <div class="ik-av-preview__avatar">
                          <img
                            :src="previewAvatarImage"
                            alt=""
                            class="ik-av-preview__avatar-img"
                            @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                          />
                        </div>
                      </div>
                      <div class="ik-av-preview__info">
                        <h2 class="ik-av-preview__name">{{ profile.name || profile.login || "匿名用户" }}</h2>
                        <span v-if="profile.bio" class="ik-av-preview__tag">{{ profile.bio }}</span>
                        <span v-else class="ik-av-preview__tag ik-av-preview__tag--empty"><span class="ik-av-preview__lv">Lv.</span>{{ profile.level || 1 }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Avatar list (8 cols, ~3.5 rows visible) -->
              <div class="ik-av-grid-wrap">
                <div v-if="loading" class="ik-av-grid-loading">
                  <i class="z-icon-loading ik-spin" /> 加载中...
                </div>
                <div v-else-if="!filteredAvatars.length" class="ik-av-grid-empty">
                  暂无此类头像
                </div>
                <Transition name="ik-fade">
                  <z-scrollbar v-if="!loading && filteredAvatars.length" class="ik-av-grid-scroll">
                    <div class="ik-av-grid">
                      <!-- Upload custom avatar entry -->
                      <button class="ik-av-grid__item ik-av-grid__item--upload" @click="triggerFileInput">
                        <div class="ik-av-grid__thumb ik-av-grid__thumb--upload">
                          <svg class="ik-av-grid__upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </div>
                      </button>
                      <input ref="fileInputRef" type="file" accept="image/*" class="ik-av-grid__file-input" @change="onFileSelected" />
                      <button
                        v-for="avatar in filteredAvatars"
                        :key="avatar.documentId"
                        class="ik-av-grid__item"
                        :class="{
                          'is-selected': selectedAvatar?.documentId === avatar.documentId,
                          'is-equipped': equippedId === avatar.documentId,
                        }"
                        @click="selectAvatar(avatar)"
                      >
                        <div class="ik-av-grid__thumb">
                          <img
                            v-if="avatar.image"
                            :src="toThumbUrl(avatar.image)"
                            :alt="avatar.name"
                            class="ik-av-grid__img"
                          />
                          <div v-else class="ik-av-grid__placeholder">
                            {{ avatar.name.charAt(0) }}
                          </div>
                        </div>
                        <i v-if="equippedId === avatar.documentId" class="z-icon-success ik-av-grid__badge-icon" />
                      </button>
                    </div>
                  </z-scrollbar>
                </Transition>
              </div>

              <!-- Confirm button (与修改用户名/签名一致) -->
              <div class="ik-av-submit-wrap">
                <z-button
                  class="ik-av-submit"
                  :disabled="loading || equipping || isSelectionEquipped"
                  @click="handleConfirm"
                >
                  {{ equipping ? '保存中...' : '确定' }}
                </z-button>
              </div>

            </div>

          </div>
        </div>
      </div>
    </div>

    <!-- Cropper overlay -->
    <Transition name="ik-overlay" appear>
      <div v-if="showCropper" class="ik-overlay ik-crop-overlay">
        <div class="ik-overlay__stripe" />
        <div class="ik-crop-dialog">
          <div class="ik-av-frame">
            <div class="ik-av-frame__inner">
              <div class="ik-av-frame__body">

                <!-- Header bar -->
                <div class="ik-crop-tab-bar">
                  <span class="ik-crop-title">裁剪头像</span>
                  <button class="ik-av-close" aria-label="关闭" @click="cancelCrop">
                    <img src="/images/close-btn.webp" alt="关闭" class="ik-av-close__img" draggable="false" />
                  </button>
                </div>

                <!-- Cropper area -->
                <div class="ik-crop-body">
                  <Cropper
                    ref="cropperRef"
                    class="ik-crop-cropper"
                    :src="cropImageSrc"
                    :stencil-component="CircleStencil"
                    :stencil-props="{
                      aspectRatio: 1,
                      handlerComponent: 'CircleHandler',
                      handlers: { eastNorth: true, westNorth: true, eastSouth: true, westSouth: true },
                      lines: {},
                    }"
                    :canvas="{ width: 512, height: 512, imageSmoothingQuality: 'high' }"
                    :resize-image="{ adjustStencil: false }"
                    :default-size="({ imageSize, visibleArea }: any) => ({ width: visibleArea?.width || imageSize.width, height: visibleArea?.height || imageSize.height })"
                    :min-width="0"
                    :min-height="0"
                  />
                </div>

                <!-- Submit -->
                <div class="ik-av-submit-wrap">
                  <z-button class="ik-av-submit" :disabled="uploading" @click="confirmCrop">
                    {{ uploading ? '上传中...' : '确认上传' }}
                  </z-button>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── Overlay ── */
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
.ik-av-dialog {
  position: relative;
  width: 50%;
  height: 60%;
  transform: scale(1.1);
  transform-origin: center;
}

/* ── Frame ── */
.ik-av-frame {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px;
}
.ik-av-frame__inner {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #000;
  border-radius: 22px;
  overflow: hidden;
}
.ik-av-frame__body {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  border-radius: 20px;
  overflow: hidden;
}

/* ── Tab bar ── (tabs 左, close 右) */
.ik-av-tab-bar {
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

/* Close button (right side) */
.ik-av-close {
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
.ik-av-close:hover { opacity: 0.85; transform: scale(1.08); }
.ik-av-close:active { transform: scale(0.95); }
.ik-av-close__img {
  height: 32px;
  width: auto;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

/* Type tabs (left side, reuse header tab style) */
.ik-av-tabs {
  position: relative;
  display: flex;
  overflow: visible;
  border: 3px solid #313131;
  border-radius: 999px;
  background: #050505 url("/images/tab-bg-point.webp") repeat;
}

.ik-av-tab {
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
.ik-av-tab:focus-visible { outline: 2px solid rgba(215, 255, 0, 0.7); outline-offset: 4px; }
.ik-av-tab:active { color: #b8b8b8; }
.ik-av-tab.is-active { color: #000; }

.ik-av-tab__content {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.ik-av-tab__highlight {
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
.ik-av-tab__highlight--first { left: 0; width: 100px; }
.ik-av-tab__highlight--middle { left: -10px; width: 110px; }
.ik-av-tab__highlight--last { right: 0; width: 100px; }

.ik-av-tab.is-active .ik-av-tab__highlight {
  opacity: 1;
  animation:
    ik-av-tab-color 800ms linear infinite alternate,
    ik-av-tab-scale 700ms linear infinite;
}

@keyframes ik-av-tab-color {
  from { color: #fbfe00; }
  to { color: #dcfe00; }
}
@keyframes ik-av-tab-scale {
  0% { transform: scale(1.1); animation-timing-function: cubic-bezier(0.55, 0.055, 0.675, 0.19); }
  50% { transform: scale(1.25); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
  100% { transform: scale(1.1); }
}

/* ── Main content ── */
.ik-av-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #010101 0%, #161616 100%);
}

/* ── Banner preview ── */
.ik-av-preview {
  flex-shrink: 0;
  padding: 12px 16px 0;
}
.ik-av-preview__banner-card {
  background: transparent;
  overflow: hidden;
  border-radius: 14px;
}
.ik-av-preview__banner {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  background: #2a2d33 url("/images/banner.png") center/cover no-repeat;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px;
}
.ik-av-preview__user {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.ik-av-preview__avatar-wrap { position: relative; flex-shrink: 0; }
.ik-av-preview__avatar {
  width: 64px;
  height: 64px;
  border-radius: 999px;
  overflow: hidden;
  border: 3px solid #000;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  background: #000;
}
.ik-av-preview__avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ik-av-preview__info { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.ik-av-preview__name {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  color: #fff;
  line-height: 1.1;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.4);
}
.ik-av-preview__tag {
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
.ik-av-preview__tag--empty { color: rgba(255,255,255,0.85); }
.ik-av-preview__lv { color: rgba(255,255,255,0.45); }

/* ── Avatar grid ── (8 列 / ~3.5 行可见) */
.ik-av-grid-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px 0;
  overflow: hidden;
}
.ik-av-grid-scroll {
  flex: 1;
  min-height: 0;
  max-height: 280px;
  border-radius: 16px;
  overflow: hidden;
}
.ik-av-grid-scroll :deep(.z-scrollbar__wrap) {
  background: #00000065;
}
.ik-av-grid-scroll :deep(.z-scrollbar__view) {
  min-height: auto;
}

.ik-av-grid-loading,
.ik-av-grid-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-size: 14px;
  gap: 8px;
}

.ik-av-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
  justify-items: center;
  gap: 0;
  padding: 20px 28px 20px 20px;
}
.ik-av-grid__item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  padding: 2px;
  aspect-ratio: 1 / 1;
  border-radius: 999px;
  background: #0f0f0f;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
  appearance: none;
  color: #fff;
  font-family: inherit;
}
.ik-av-grid__item:hover { background: #1a1a1a; border-color: #333; }
.ik-av-grid__item.is-selected { border-color: #fbfe00; background: #1a1a0a; }
.ik-av-grid__item.is-equipped { border-color: #fbfe00; }

.ik-av-grid__thumb {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  overflow: hidden;
  background: #1a1a1a;
}
.ik-av-grid__img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ik-av-grid__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 900;
  color: #444;
}

.ik-av-grid__badge-icon {
  position: absolute;
  top: -2px;
  right: -2px;
  font-size: 22px;
  color: #00cc0d;
  background: #000;
  border-radius: 999px;
}

/* ── Submit button (与修改用户名/签名一致) ── */
.ik-av-submit-wrap {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  margin-top: -18px;
  padding: 0 16px 18px;
}
.ik-av-submit-wrap :deep(.z-button) {
  min-width: 130px;
  font-weight: 900;
}

/* ── Skeleton ── */
@keyframes ik-skel-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.ik-skel {
  background: #222;
  animation: ik-skel-pulse 1.5s ease-in-out infinite;
}
.ik-av-preview__banner-skel {
  width: 100%;
  min-height: 120px;
  border-radius: 14px;
}

/* ── Fade transition ── */
.ik-fade-enter-active { transition: opacity 0.35s ease; }
.ik-fade-enter-from { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .ik-skel { animation: none; opacity: 0.6; }
}

/* ── Spin ── */
@keyframes ik-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.ik-spin { display: inline-block; animation: ik-spin 0.8s linear infinite; }

/* ── Overlay transitions ──
   动画时长 / 曲线在 theme.css 全局维护；这里只负责给 .ik-av-dialog / .ik-crop-dialog
   补回 scale(1.1)，避免全局默认 transform: translateX(±5%) 覆盖掉静态缩放。 */
.ik-overlay-enter-from .ik-av-dialog,
.ik-overlay-enter-from .ik-crop-dialog { transform: scale(1.1) translateX(5%); }
.ik-overlay-leave-to .ik-av-dialog,
.ik-overlay-leave-to .ik-crop-dialog { transform: scale(1.1) translateX(-5%); }

/* ── Mobile ──
   Avatars are only 64px circles, so we keep the column count denser than
   the BusinessCardModal (which uses larger card thumbnails). */
@media (max-width: 1100px) {
  .ik-av-grid { grid-template-columns: repeat(6, 1fr); }
}
@media (max-width: 800px) {
  .ik-av-dialog { width: 92%; height: 85%; transform: scale(1); }
  .ik-overlay-enter-from .ik-av-dialog { transform: scale(1) translateX(5%); }
  .ik-overlay-leave-to .ik-av-dialog { transform: scale(1) translateX(-5%); }
  .ik-overlay-enter-from .ik-crop-dialog { transform: scale(1) translateX(5%); }
  .ik-overlay-leave-to .ik-crop-dialog { transform: scale(1) translateX(-5%); }
  .ik-av-grid { grid-template-columns: repeat(5, 1fr); padding: 14px; }
  /* On mobile/tablet the dialog is much taller than desktop's 60vh; let the
     scroll area fill the leftover space instead of being capped at 280px. */
  .ik-av-grid-scroll { max-height: none; }
}
@media (max-width: 500px) {
  .ik-av-dialog { width: 100%; height: 95%; }
  .ik-av-frame { border-radius: 0; }
  .ik-av-frame__inner { border-radius: 0; }
  .ik-av-frame__body { border-radius: 0; }
  .ik-av-grid { grid-template-columns: repeat(4, 1fr); padding: 12px; gap: 4px; }
}

/* prefers-reduced-motion 由 theme.css 全局接管 */

/* ── Upload button in grid ── */
.ik-av-grid__item--upload { border: 2px dashed #444; }
.ik-av-grid__item--upload:hover { border-color: #fbfe00; }
.ik-av-grid__thumb--upload {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: transparent;
}
.ik-av-grid__upload-icon { width: 28px; height: 28px; color: #666; transition: color 0.15s; }
.ik-av-grid__item--upload:hover .ik-av-grid__upload-icon { color: #fbfe00; }
.ik-av-grid__file-input { display: none; }

/* ── Cropper overlay (reuses .ik-overlay / .ik-av-frame) ── */
.ik-crop-overlay { z-index: 9500; }
.ik-crop-dialog {
  position: relative;
  width: 440px;
  max-width: 92vw;
  transform: scale(1.1);
  transform-origin: center;
}
.ik-crop-tab-bar {
  position: relative;
  z-index: 2;
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
.ik-crop-title { font-size: 16px; font-weight: 700; color: #fff; }
.ik-crop-body {
  flex: none;
  width: 100%;
  height: 340px;
  margin-top: 14px;
  background: #111;
  overflow: visible;
}
.ik-crop-cropper {
  width: 100%;
  height: 100%;
}

/* ── Cropper stencil theme ── */
.ik-crop-cropper :deep(.vue-circle-stencil) {
  border: 2px solid rgba(251, 254, 0, 0.8);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
}
.ik-crop-cropper :deep(.vue-simple-handler) {
  width: 12px;
  height: 12px;
  background: #fbfe00;
  border: 2px solid #111;
  border-radius: 50%;
  opacity: 0.9;
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.ik-crop-cropper :deep(.vue-simple-handler:hover) {
  transform: scale(1.3);
  opacity: 1;
}
.ik-crop-cropper :deep(.vue-line-wrapper .vue-simple-line) {
  border-color: rgba(251, 254, 0, 0.4);
}

@media (max-width: 800px) {
  .ik-crop-dialog { width: 92%; transform: scale(1); }
}
@media (max-width: 500px) {
  .ik-crop-dialog { width: 100%; max-width: 100%; }
  .ik-crop-body { height: 280px; }
}
</style>
