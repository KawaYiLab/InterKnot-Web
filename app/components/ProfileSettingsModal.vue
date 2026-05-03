<script setup lang="ts">
const emit = defineEmits<{
  close: [];
}>();

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

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div class="ik-overlay" @click="handleOverlayClick">
    <div class="ik-overlay__stripe" aria-hidden="true"></div>

    <div class="ik-dialog" @click.stop>
      <div class="ik-dialog__outer">
        <div class="ik-dialog__inner">
          <!-- Header -->
          <div class="ik-dialog__header">
            <span class="ik-dialog__title">更多操作</span>
            <button class="ik-dialog__close" aria-label="关闭" @click="handleClose">
              <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" />
            </button>
          </div>

          <!-- Body -->
          <div class="ik-dialog__body">
            <div class="ik-settings__list">
              <z-button @click="$emit('close')">修改用户名</z-button>
              <z-button @click="$emit('close')">隐藏生日信息</z-button>
              <z-button @click="$emit('close')">修改签名</z-button>
              <z-button @click="$emit('close')">修改帖子展示</z-button>
              <z-button @click="$emit('close')">社交设置</z-button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Overlay — 与帖子弹窗 / 登录弹窗完全一致
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

/* ── Dialog Shell ──────────────────────────────── */
.ik-dialog {
  position: relative;
  width: 450px;
  max-width: 90%;
  height: 300px;
  max-height: 90%;
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
}

/* ── Body ──────────────────────────────────────── */
.ik-dialog__body {
  flex: 1;
  min-height: 0;
  padding: 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ik-settings__list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  max-width: 336px;
  margin: 0 auto;
  padding: 20px;
  background: #00000065;
  border-radius: 16px;
}

.ik-settings__list :deep(.z-button) {
  width: 100%;
  box-sizing: border-box;
  margin-left: 0;
}

/* ═══════════════════════════════════════════════
   Animations — 与项目其他弹窗一致
   ═══════════════════════════════════════════════ */
@keyframes stripe-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes stripe-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}

.ik-overlay-enter-active {
  transition: background-color 80ms ease-out, backdrop-filter 80ms ease-out, -webkit-backdrop-filter 80ms ease-out;
}

.ik-overlay-enter-from {
  background-color: transparent !important;
  backdrop-filter: blur(0) !important;
  -webkit-backdrop-filter: blur(0) !important;
}

.ik-overlay-enter-active .ik-overlay__stripe {
  animation: stripe-fade-in 250ms ease-out both;
}

.ik-overlay-enter-active .ik-dialog {
  transition: transform 250ms cubic-bezier(0.165, 0.84, 0.44, 1),
              opacity 200ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.ik-overlay-enter-from .ik-overlay__stripe {
  opacity: 0;
}

.ik-overlay-enter-from .ik-dialog {
  opacity: 0;
  transform: translateX(5%);
}

.ik-overlay-leave-active {
  transition: background-color 160ms ease-out,
              backdrop-filter 160ms ease-out,
              -webkit-backdrop-filter 160ms ease-out;
}

.ik-overlay-leave-active .ik-overlay__stripe {
  animation: stripe-fade-out 180ms ease-in both;
}

.ik-overlay-leave-active .ik-dialog {
  transition: transform 200ms cubic-bezier(0.55, 0, 1, 0.45),
              opacity 180ms ease-in;
}

.ik-overlay-leave-to {
  background-color: transparent !important;
  backdrop-filter: blur(0) !important;
  -webkit-backdrop-filter: blur(0) !important;
}

.ik-overlay-leave-to .ik-dialog {
  opacity: 0;
  transform: translateX(-5%);
}

/* ── Mobile ───────────────────────────────────── */
@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }

  .ik-dialog__outer {
    border-radius: 0;
  }

  .ik-dialog__inner {
    border-radius: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-overlay-enter-active,
  .ik-overlay-enter-active .ik-dialog,
  .ik-overlay-leave-active,
  .ik-overlay-leave-active .ik-dialog {
    transition: none;
  }

  .ik-overlay-enter-active .ik-overlay__stripe,
  .ik-overlay-leave-active .ik-overlay__stripe {
    animation: none;
  }
}
</style>
