<script setup lang="ts">
import { useMessage } from "zenless-ui";
import type { Category } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";

const { state, close } = useMovePostDialog();
const api = useApi();
const auth = useAuthStore();
const message = useMessage();

const categories = ref<Category[]>([]);
const target = ref("");
const note = ref("");
const submitting = ref(false);

const MAX_NOTE_LENGTH = 500;

// 仅限管理员发帖的分区，版主移不进去（后端同样拦截）。
const choices = computed(() =>
  categories.value.filter((c) => c.documentId && (!c.adminOnly || auth.user?.isAdmin === true)),
);
const canSubmit = computed(
  () => !!target.value && target.value !== state.currentSlug && !submitting.value,
);

const cancel = () => {
  if (submitting.value) return;
  close(null);
};

const submit = async () => {
  const chosen = choices.value.find((c) => c.slug === target.value);
  if (!canSubmit.value || !chosen?.documentId) return;
  submitting.value = true;
  try {
    await api.moderateMove(state.postId, chosen.documentId, note.value);
    message.success(`已移动至「${chosen.name}」`);
    close(chosen);
  } catch (err) {
    message.error(resolveErrorMessage(err, "移动失败，请稍后再试"));
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
    // 默认选里区：最常见的用法是把不好的委托移进去。
    target.value = state.currentSlug === INNER_CATEGORY_SLUG ? "" : INNER_CATEGORY_SLUG;
    note.value = "";
    submitting.value = false;
    api.getCategories().then((list) => { categories.value = list; }).catch(() => undefined);
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
              <div class="ik-dialog__header">
                <span class="ik-dialog__title">移动分区</span>
                <button class="ik-dialog__close" aria-label="关闭" @click="cancel">
                  <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
                </button>
              </div>

              <div class="ik-dialog__body">
                <IkZzzMarquee />
                <div class="ik-move__wrapper">
                  <div class="ik-move__inner">
                    <p class="ik-move__hint">请选择分区。</p>

                    <div class="ik-move__reasons">
                      <button
                        v-for="cat in choices"
                        :key="cat.slug"
                        type="button"
                        class="ik-move__reason"
                        :class="{
                          'ik-move__reason--active': target === cat.slug,
                          'ik-move__reason--current': state.currentSlug === cat.slug,
                        }"
                        :disabled="state.currentSlug === cat.slug"
                        @click="target = cat.slug"
                      >
                        {{ cat.name }}
                      </button>
                    </div>

                    <textarea
                      v-model="note"
                      class="ik-move__detail"
                      :maxlength="MAX_NOTE_LENGTH"
                      rows="2"
                      placeholder="理由（选填）"
                    ></textarea>
                  </div>

                  <div class="ik-move__actions">
                    <z-button :icon="{ error: '#ff4444' }" @click="cancel">取消</z-button>
                    <z-button
                      :icon="{ success: '#00cc0d' }"
                      :disabled="!canSubmit"
                      @click="submit"
                    >
                      {{ submitting ? "移动中..." : "移动" }}
                    </z-button>
                  </div>
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
/* Overlay / Dialog 外壳与 ConfirmDialog、ReportModal 一致 */
.ik-overlay {
  position: fixed;
  inset: 0;
  z-index: 9100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
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
  position: relative;
  padding: 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 与举报弹窗同构：黑卡片 + 底部叠压按钮 */
.ik-move__wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.ik-move__inner {
  position: relative;
  z-index: 1;
  width: 100%;
  margin: 0 auto;
  padding: 20px 24px 40px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
}

.ik-move__hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: #999;
}

.ik-move__reasons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.ik-move__reason {
  padding: 8px 10px;
  border: none;
  border-radius: 9999px;
  background: #2d2c2d;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease;
}

.ik-move__reason:hover {
  background: #3a3a3a;
}

.ik-move__reason--active,
.ik-move__reason--active:hover {
  background: var(--ik-primary, #BFFF09);
  color: #000;
}

.ik-move__reason--current,
.ik-move__reason--current:hover {
  opacity: 0.4;
  cursor: not-allowed;
  background: #2d2c2d;
}

.ik-move__detail {
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 12px;
  background: #2d2c2d;
  color: #fff;
  font-size: 14px;
  line-height: 1.5;
  font-family: inherit;
  resize: vertical;
  min-height: 72px;
  box-sizing: border-box;
}

.ik-move__detail::placeholder {
  color: #808080;
}

.ik-move__detail:focus {
  outline: none;
  background: #3a3a3a;
}

.ik-move__counter {
  margin-top: 4px;
  font-size: 11px;
  color: #808080;
  text-align: right;
}

.ik-move__actions {
  display: flex;
  gap: 12px;
  margin-top: -18px;
  position: relative;
  z-index: 1;
}

@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }
}
</style>
