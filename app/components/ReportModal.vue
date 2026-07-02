<script setup lang="ts">
import { useMessage } from "zenless-ui";
import { resolveErrorMessage } from "~/utils/api-error";
import { REPORT_REASON_OPTIONS } from "~/composables/useReportDialog";

const { state, close } = useReportDialog();
const api = useApi();
const message = useMessage();

const reason = ref("");
const detail = ref("");
const submitting = ref(false);

const MAX_DETAIL_LENGTH = 500;

const canSubmit = computed(() => {
  if (!reason.value || submitting.value) return false;
  // 「其他」必须补充说明，否则管理员无从判断
  if (reason.value === "other" && !detail.value.trim()) return false;
  return true;
});

const cancel = () => {
  if (submitting.value) return;
  close(false);
};

const submit = async () => {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    await api.createReport({
      targetType: state.targetType,
      targetId: state.targetId,
      reason: reason.value,
      detail: detail.value.trim() || undefined,
    });
    message.success("举报已提交，感谢你维护绳网环境");
    close(true);
  } catch (err) {
    message.error(resolveErrorMessage(err, "举报提交失败，请稍后再试"));
  } finally {
    submitting.value = false;
  }
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    e.stopImmediatePropagation();
    cancel();
  }
};

watch(() => state.visible, (v) => {
  if (v) {
    reason.value = "";
    detail.value = "";
    submitting.value = false;
  }
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
                <span class="ik-dialog__title">举报{{ state.targetLabel }}</span>
                <button class="ik-dialog__close" aria-label="关闭" @click="cancel">
                  <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                </button>
              </div>

              <!-- Body -->
              <div class="ik-dialog__body">
                <p class="ik-report__hint">请选择举报理由，我们会尽快核实处理。</p>

                <div class="ik-report__reasons">
                  <button
                    v-for="option in REPORT_REASON_OPTIONS"
                    :key="option.value"
                    type="button"
                    class="ik-report__reason"
                    :class="{ 'ik-report__reason--active': reason === option.value }"
                    @click="reason = option.value"
                  >
                    {{ option.label }}
                  </button>
                </div>

                <textarea
                  v-model="detail"
                  class="ik-report__detail"
                  :maxlength="MAX_DETAIL_LENGTH"
                  rows="3"
                  :placeholder="reason === 'other' ? '请补充说明举报原因（必填）' : '补充说明（选填）'"
                ></textarea>
                <div class="ik-report__counter">{{ detail.length }} / {{ MAX_DETAIL_LENGTH }}</div>

                <div class="ik-report__footer">
                  <z-button :icon="{ error: '#ff4444' }" @click="cancel">取消</z-button>
                  <z-button
                    :icon="{ success: '#00cc0d' }"
                    :disabled="!canSubmit"
                    @click="submit"
                  >
                    {{ submitting ? "提交中..." : "提交举报" }}
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
/* Overlay / Dialog 外壳与 ConfirmDialog 完全一致 */
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

.ik-dialog {
  position: relative;
  width: 440px;
  max-width: 90%;
  will-change: transform;
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
  padding: 20px 24px 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
}

/* ── Report form ───────────────────────────────── */
.ik-report__hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: #999;
}

.ik-report__reasons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.ik-report__reason {
  padding: 8px 10px;
  border: 1px solid #333;
  border-radius: 0 8px 8px 8px;
  background: #1a1a1a;
  color: #ccc;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
}

.ik-report__reason:hover {
  border-color: #555;
  color: #fff;
}

.ik-report__reason--active {
  border-color: #BFFF09;
  color: #BFFF09;
  background: rgba(191, 255, 9, 0.08);
}

.ik-report__detail {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #333;
  border-radius: 0 8px 8px 8px;
  background: #1a1a1a;
  color: #e0e0e0;
  font-size: 14px;
  line-height: 1.5;
  font-family: inherit;
  resize: vertical;
  min-height: 72px;
  box-sizing: border-box;
}

.ik-report__detail:focus {
  outline: none;
  border-color: #555;
}

.ik-report__counter {
  margin-top: 4px;
  font-size: 11px;
  color: #555;
  text-align: right;
}

.ik-report__footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }
}
</style>
