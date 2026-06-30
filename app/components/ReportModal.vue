<script setup lang="ts">
import { REPORT_REASONS, useReportDialog } from "~/composables/useReportDialog";

const { state, confirm, cancel, setReason } = useReportDialog();

const DETAIL_MAX = 500;

const onDetailInput = (e: Event) => {
  const target = e.target as HTMLTextAreaElement;
  // state 为 readonly，但底层是同一个 reactive 对象；通过可写引用回写。
  (state as { detail: string }).detail = target.value.slice(0, DETAIL_MAX);
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    e.stopImmediatePropagation();
    cancel();
  }
};

watch(
  () => state.visible,
  (v) => {
    if (import.meta.client) {
      if (v) {
        window.addEventListener("keydown", onKeyDown, true);
      } else {
        window.removeEventListener("keydown", onKeyDown, true);
      }
    }
  },
);

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
                  <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                </button>
              </div>

              <!-- Body -->
              <div class="ik-dialog__body">
                <p class="ik-report__label">请选择举报原因</p>
                <div class="ik-report__reasons">
                  <button
                    v-for="opt in REPORT_REASONS"
                    :key="opt.value"
                    type="button"
                    class="ik-report__reason"
                    :class="{ 'ik-report__reason--active': state.reason === opt.value }"
                    @click="setReason(opt.value)"
                  >
                    {{ opt.label }}
                  </button>
                </div>

                <p class="ik-report__label">补充说明（选填）</p>
                <textarea
                  class="ik-report__detail"
                  :value="state.detail"
                  :maxlength="DETAIL_MAX"
                  rows="3"
                  placeholder="可补充具体情况，帮助管理员判断"
                  @input="onDetailInput"
                ></textarea>
                <div class="ik-report__count">{{ state.detail.length }}/{{ DETAIL_MAX }}</div>

                <div class="ik-report__footer">
                  <z-button :icon="{ error: '#ff4444' }" @click="cancel">取消</z-button>
                  <z-button
                    :icon="{ success: '#00cc0d' }"
                    :disabled="!state.reason"
                    @click="confirm"
                  >
                    提交举报
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
   Overlay — 与 ConfirmDialog / 登录弹窗一致
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
  width: 440px;
  max-width: 90%;
  will-change: transform;
}

.ik-dialog__outer {
  width: 100%;
  padding: 4px;
  background: #2d2c2d;
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
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

/* ── Body ──────────────────────────────────────── */
.ik-dialog__body {
  padding: 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
}

.ik-report__label {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: #e0e0e0;
}

.ik-report__reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.ik-report__reason {
  padding: 7px 14px;
  font-size: 13px;
  color: #cfcfcf;
  background: #1d1d1d;
  border: 1px solid #333;
  border-radius: 999px;
  cursor: pointer;
  transition: all 140ms ease;
}

.ik-report__reason:hover {
  border-color: #666;
  color: #fff;
}

.ik-report__reason--active {
  color: #000;
  background: #ffd54a;
  border-color: #ffd54a;
  font-weight: 600;
}

.ik-report__detail {
  width: 100%;
  resize: vertical;
  min-height: 64px;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.5;
  color: #e8e8e8;
  background: #0c0c0c;
  border: 1px solid #333;
  border-radius: 10px;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
}

.ik-report__detail:focus {
  border-color: #666;
}

.ik-report__count {
  margin-top: 6px;
  font-size: 12px;
  color: #777;
  text-align: right;
}

.ik-report__footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}

@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }
}
</style>
