<script setup lang="ts">
import { BENEFIT_MAX_LEVEL, BENEFIT_MATRIX } from "~/utils/benefits";
import { LEVEL_TITLES } from "~/utils/level";

const { level } = useBenefits();
const { close } = useBenefitsModal();

const formatNum = (n: number) => n.toLocaleString("zh-CN");

const benefitRows = Array.from({ length: BENEFIT_MAX_LEVEL }, (_, i) => {
  const lv = i + 1;
  return {
    level: lv,
    title: LEVEL_TITLES[lv] ?? "",
    articleMaxImages: BENEFIT_MATRIX.articleMaxImages[lv]!,
    commentMaxImages: BENEFIT_MATRIX.commentMaxImages[lv]!,
    articleMaxBody: BENEFIT_MATRIX.articleMaxBody[lv]!,
  };
});

const levelTitle = computed(() =>
  level.value > 0 ? LEVEL_TITLES[level.value] ?? "" : "待通过入站考试",
);

const handleOverlayClick = (e: MouseEvent) => {
  if (e.target === e.currentTarget) {
    close();
  }
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    // 捕获阶段优先消费 Escape，避免下方签到说明等弹窗同时关闭
    e.stopImmediatePropagation();
    close();
  }
};

const { acquire, release } = useBodyScrollLock();
const SCROLL_LOCK_TOKEN = Symbol("benefits-modal");

onMounted(() => {
  window.addEventListener("keydown", handleKeydown, true);
  acquire(SCROLL_LOCK_TOKEN);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown, true);
  release(SCROLL_LOCK_TOKEN);
});
</script>

<template>
  <div class="ik-overlay" @mousedown.self="handleOverlayClick">
    <!-- 斜线纹理背景（与委托弹窗一致） -->
    <div class="ik-overlay__stripe" aria-hidden="true"></div>

    <!-- 弹窗主体 -->
    <div class="ik-dialog" @click.stop>
      <!-- 外边框（半透明白色，三圆角） -->
      <div class="ik-dialog__outer">
        <!-- 内边框（纯黑，三圆角） -->
        <div class="ik-dialog__inner">
          <div class="ik-dialog__header">
            <span class="ik-dialog__header-title">创作权益</span>
            <button class="ik-dialog__close" aria-label="关闭" @click="close">
              <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
            </button>
          </div>

          <div class="ik-dialog__body">
            <div class="ik-benefits__panel">
              <p class="ik-benefits__lead">
                当前 <strong>Lv.{{ level }}</strong> · {{ levelTitle }}。等级越高，可发布的<strong>图片数量</strong>与<strong>正文字数</strong>上限越高；未通过入站考试（<strong>Lv.0</strong>）暂无法发布委托与评论。
              </p>

              <div class="ik-benefits__table">
                <div class="ik-benefits__thead">
                  <span class="ik-benefits__th ik-benefits__th--level">等级</span>
                  <span class="ik-benefits__th">发帖图片</span>
                  <span class="ik-benefits__th">评论图片</span>
                  <span class="ik-benefits__th">正文字数</span>
                </div>
                <div
                  v-for="row in benefitRows"
                  :key="row.level"
                  class="ik-benefits__tr"
                  :class="{ 'is-current': row.level === level }"
                >
                  <span class="ik-benefits__td ik-benefits__td--level">
                    <span class="ik-benefits__num">Lv.{{ row.level }}</span>
                    <span class="ik-benefits__title">{{ row.title }}</span>
                  </span>
                  <span class="ik-benefits__td">{{ row.articleMaxImages }}</span>
                  <span class="ik-benefits__td">{{ row.commentMaxImages }}</span>
                  <span class="ik-benefits__td">{{ formatNum(row.articleMaxBody) }}</span>
                </div>
              </div>

              <ul class="ik-benefits__notes">
                <li>单张图片大小上限 10MB，全等级一致。</li>
                <li>已发布的内容不受等级调整影响，仅在新建 / 编辑时生效。</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Overlay / Dialog Shell —— 与 CheckInHelpModal 一致
   ═══════════════════════════════════════════════ */
.ik-overlay {
  position: fixed;
  inset: 0;
  z-index: 9300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
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
  width: 520px;
  max-width: 92%;
  max-height: 85vh;
  overflow: hidden;
  will-change: transform;
}

.ik-dialog__outer {
  width: 100%;
  max-height: 85vh;
  padding: 4px;
  background: #2d2c2d;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
  box-sizing: border-box;
}

.ik-dialog__inner {
  width: 100%;
  max-height: calc(85vh - 8px);
  padding: 4px;
  background: #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.ik-dialog__header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 8px 24px;
  gap: 8px;
  flex-shrink: 0;
  border-radius: 18px 0 0 0;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #161616 0%, #080808 100%);
}

.ik-dialog__header-title {
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
  flex: 1 1 auto;
  min-height: 0;
  padding: 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.ik-dialog__body::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

/* ── 面板内容 ── */
.ik-benefits__panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: #00000065;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.65;
  color: rgba(255, 255, 255, 0.88);
  box-sizing: border-box;
}

.ik-benefits__panel strong {
  color: #fff;
  font-weight: 700;
}

.ik-benefits__lead {
  margin: 0;
  color: rgba(255, 255, 255, 0.75);
}

/* ── 权益表 ── */
.ik-benefits__table {
  display: flex;
  flex-direction: column;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.ik-benefits__thead,
.ik-benefits__tr {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 8px;
}

.ik-benefits__thead {
  padding: 6px 0 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.ik-benefits__th {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  text-align: right;
}

.ik-benefits__th--level {
  text-align: left;
}

.ik-benefits__tr {
  padding: 11px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  transition: background 0.16s ease;
}

.ik-benefits__tr:last-child {
  border-bottom: none;
}

.ik-benefits__tr.is-current {
  background: rgba(70, 97, 253, 0.12);
  margin: 0 -14px;
  padding: 11px 14px;
  border-bottom-color: transparent;
}

.ik-benefits__td--level {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ik-benefits__num {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.ik-benefits__tr.is-current .ik-benefits__num {
  background: linear-gradient(135deg, #4661fd, #10bff0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: #10bff0;
}

.ik-benefits__title {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-benefits__tr.is-current .ik-benefits__title {
  color: rgba(255, 255, 255, 0.85);
}

.ik-benefits__td {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.65);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.ik-benefits__tr.is-current .ik-benefits__td {
  color: #fff;
}

/* ── 备注 ── */
.ik-benefits__notes {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-benefits__notes li {
  position: relative;
  padding-left: 14px;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.4);
}

.ik-benefits__notes li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.7em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
}

@media (max-width: 420px) {
  .ik-benefits__title {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-benefits__tr {
    transition: none;
  }
}
</style>
