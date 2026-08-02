<script setup lang="ts">
const visible = defineModel<boolean>("visible", { default: false });
const emit = defineEmits<{
  confirm: [value: string];
  cancel: [];
}>();

const URL_MAX = 300;
const input = ref("");

watch(visible, (v) => {
  if (!v) input.value = "";
});

function onConfirm() {
  const value = input.value.trim();
  if (!value) return;
  emit("confirm", value);
}

function onCancel() {
  emit("cancel");
}

function onKeydown(e: KeyboardEvent) {
  if (!visible.value) return;
  if (e.key === "Escape") {
    onCancel();
  }
}

onMounted(() => {
  if (import.meta.client) {
    window.addEventListener("keydown", onKeydown, true);
  }
});

onBeforeUnmount(() => {
  if (import.meta.client) {
    window.removeEventListener("keydown", onKeydown, true);
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="ik-overlay" appear>
      <div v-if="visible" class="ik-overlay" @mousedown.self="onCancel">
        <div class="ik-overlay__stripe" aria-hidden="true"></div>

        <div class="ik-dialog" @click.stop>
          <div class="ik-dialog__outer">
            <div class="ik-dialog__inner">
              <!-- Header -->
              <div class="ik-dialog__header">
                <span class="ik-dialog__title">添加 B 站视频</span>
                <button class="ik-dialog__close" aria-label="关闭" @click="onCancel">
                  <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                </button>
              </div>

              <!-- Body -->
              <div class="ik-dialog__body">
                <IkZzzMarquee />
                <div class="ik-edit-name__wrapper">
                  <div class="ik-edit-name">
                    <div class="ik-edit-name__field">
                      <z-input
                        v-model="input"
                        :maxlength="URL_MAX"
                        placeholder="粘贴 B 站链接或 BV 号"
                        clearable
                        @keydown.enter="onConfirm"
                      />
                    </div>
                    <div class="ik-edit-name__meta">
                      <span class="ik-edit-name__count">{{ input.trim().length }}/{{ URL_MAX }}</span>
                    </div>
                  </div>
                  <z-button
                    class="ik-edit-name__submit"
                    :icon="{ success: '#00cc0d' }"
                    :disabled="!input.trim()"
                    @click="onConfirm"
                  >
                    添加
                  </z-button>
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
/* ════════════════════════════════════════════════
   Overlay + Dialog shell (copied from ProfileSettingsModal / ConfirmDialog)
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
  z-index: 0;
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

.ik-dialog {
  position: relative;
  z-index: 1;
  width: 450px;
  max-width: 90%;
  height: 300px;
  max-height: 90%;
  will-change: transform;
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

.ik-dialog__body {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Edit form (matches ProfileSettingsModal edit-name) ── */
.ik-edit-name {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  max-width: 360px;
  margin: 0 auto;
  padding: 32px 20px 45px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
}

.ik-edit-name__field {
  position: relative;
}

.ik-edit-name__field :deep(.z-input) {
  width: 100%;
}

.ik-edit-name__meta {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: -6px;
  width: 100%;
}

.ik-edit-name__count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
}

.ik-edit-name__wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.ik-edit-name__wrapper > :deep(.z-button) {
  margin-top: -18px;
  position: relative;
  z-index: 1;
  min-width: 70px;
}
</style>
