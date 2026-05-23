<script setup lang="ts">
const { state, confirm, cancel } = useConfirmDialog();

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    e.stopImmediatePropagation();
    cancel();
  }
};

watch(() => state.visible, (v) => {
  if (import.meta.client) {
    if (v) {
      window.addEventListener("keydown", onKeyDown, true);
    } else {
      window.removeEventListener("keydown", onKeyDown, true);
    }
  }
});

onBeforeUnmount(() => {
  if (import.meta.client) {
    window.removeEventListener("keydown", onKeyDown, true);
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="ik-overlay">
      <div v-if="state.visible" class="ik-overlay" @mousedown.self="cancel">
        <div class="ik-overlay__stripe" aria-hidden="true"></div>

        <div class="ik-dialog" @click.stop>
          <div class="ik-dialog__outer">
            <div class="ik-dialog__inner">
              <!-- Header -->
              <div class="ik-dialog__header">
                <span class="ik-dialog__title">{{ state.title }}</span>
                <button class="ik-dialog__close" aria-label="关闭" @click="cancel">
                  <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" />
                </button>
              </div>

              <!-- Body -->
              <div class="ik-dialog__body">
                <p class="ik-confirm__message">{{ state.message }}</p>
                <div class="ik-confirm__footer">
                  <z-button :icon="{ error: '#ff4444' }" @click="cancel">{{ state.cancelText }}</z-button>
                  <z-button
                    :icon="{ success: '#00cc0d' }"
                    @click="confirm"
                  >
                    {{ state.confirmText }}
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
/* ═══════════════════════════════════════════════
   Overlay — 与登录弹窗 / 帖子弹窗完全一致
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
  width: 400px;
  max-width: 90%;
}

.ik-dialog__outer {
  width: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
}

.ik-dialog__inner {
  width: 100%;
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
  padding: 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
}

.ik-confirm__message {
  margin: 0 0 24px;
  font-size: 15px;
  line-height: 1.6;
  color: #e0e0e0;
}

.ik-confirm__footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* 入场/出场动画统一在 theme.css 的 .ik-overlay-* 全局规则里维护 */

/* ── Mobile ─────────────────────────────────────── */
@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }

  /* Keep the ZZZ-style 3-rounded-corner frame on mobile; the dialog is a
     centered popup, not a fullscreen sheet. */
}

/* prefers-reduced-motion 由 theme.css 全局接管 */
</style>
