<script setup lang="ts">
import {
  LEVEL_THRESHOLDS,
  LEVEL_TITLES,
  MAX_LEVEL,
  expNeededWithinLevel,
} from "~/utils/level";

defineProps<{
  totalDays?: number;
  consecutiveDays?: number;
  rank?: number;
  canCheckIn?: boolean;
}>();

const formatExp = (n: number) => n.toLocaleString("zh-CN");

const levelGuideRows = Array.from({ length: MAX_LEVEL }, (_, index) => {
  const level = index + 1;
  return {
    level,
    title: LEVEL_TITLES[level] ?? "",
    totalExp: LEVEL_THRESHOLDS[index] ?? 0,
    spanExp: level < MAX_LEVEL ? expNeededWithinLevel(level) : 0,
  };
});

const emit = defineEmits<{
  close: [];
}>();

const handleClose = () => {
  emit("close");
};

const handleOverlayClick = (e: MouseEvent) => {
  if (e.target === e.currentTarget) {
    handleClose();
  }
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") handleClose();
};

const { acquire, release } = useBodyScrollLock();
const SCROLL_LOCK_TOKEN = Symbol("check-in-help-modal");

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  acquire(SCROLL_LOCK_TOKEN);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  release(SCROLL_LOCK_TOKEN);
});
</script>

<template>
  <div class="ik-overlay" @mousedown.self="handleOverlayClick">
    <!-- 斜线纹理背景（与帖子弹窗一致） -->
    <div class="ik-overlay__stripe" aria-hidden="true"></div>

    <!-- 弹窗主体 -->
    <div class="ik-dialog" @click.stop>
      <!-- 外边框（半透明白色，三圆角） -->
      <div class="ik-dialog__outer">
        <!-- 内边框（纯黑，三圆角） -->
        <div class="ik-dialog__inner">
          <div class="ik-dialog__header">
            <span class="ik-dialog__header-title">签到说明</span>
            <button class="ik-dialog__close" aria-label="关闭" @click="handleClose">
              <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
            </button>
          </div>

          <div class="ik-dialog__body">
            <div class="ik-checkin-help__panel">
              <section class="ik-checkin-help__block">
                <h3 class="ik-checkin-help__heading">签到</h3>
                <p>点击「今日签到」完成今日的签到；<strong>每天只能签到一次</strong>，至下一签到日开启后可再次签到。</p>
                <p>签到成功可获得 <strong>10 丁尼</strong> 与绳网信用（信用规则见下），按钮旁括号内为累计签到天数。</p>
                <p>签到日以<strong>每天凌晨 4:00</strong>为界（例如 3:59 仍算前一日，4:00 起算新一日），与连续签到、当日名次统计一致。</p>
              </section>

              <section class="ik-checkin-help__block">
                <h3 class="ik-checkin-help__heading">绳网信用</h3>
                <p>签到奖励计入绳网信用，并受「主动行为」每日上限约束（当前上限 <strong>50 绳网信用/每天</strong>）。</p>
                <ul class="ik-checkin-help__list">
                  <li>每次签到基础 <strong>6 绳网信用</strong></li>
                  <li>连签加成：每多连续 1 天额外 <strong>+1 绳网信用</strong>，最多额外 <strong>+4 绳网信用</strong>（即连签 5 天起均为 <strong>10 绳网信用</strong>）</li>
                  <li>当日名次：按签到时间先后排名，越早签到名次越靠前</li>
                </ul>
                <p class="ik-checkin-help__muted">其他主动行为：发帖 +4、评论 +3、点赞 +1（均计入上述 50 绳网信用日上限）。他人与你互动还可获得绳网信用（如被点赞 +1、被评论 +1、被收藏 +2），该部分日上限为 1000 绳网信用。</p>
              </section>

              <section class="ik-checkin-help__block">
                <h3 class="ik-checkin-help__heading">绳网等级</h3>
                <p>绳网等级（<strong>Lv.</strong>）由<strong>累计绳网信用</strong>决定，最高 <strong>Lv.{{ MAX_LEVEL }}</strong>。总绳网信用达到门槛后自动升级，显示在顶部左上角区域。</p>
                <p>下表为各等级的<strong>累计绳网信用门槛</strong>；「本级还需」指从该等级起点升到下一级，在本级内还要获得的绳网信用（等级越高，跨度越大）：</p>
                <ul class="ik-checkin-help__list ik-checkin-help__list--levels">
                  <li
                    v-for="row in levelGuideRows"
                    :key="row.level"
                  >
                    <strong>Lv.{{ row.level }}</strong> {{ row.title }} — 累计 {{ formatExp(row.totalExp) }}
                    <template v-if="row.spanExp > 0">
                      （本级还需 {{ formatExp(row.spanExp) }}）
                    </template>
                    <template v-else>
                      （满级）
                    </template>
                  </li>
                </ul>
                <p class="ik-checkin-help__muted">顶栏进度条上的 <strong>当前/目标</strong> 即「本级已获得 / 本级还需」；例如 Lv.2 需在本级攒满 1,500 绳网信用（总绳网信用从 500 到 2,000）。</p>
              </section>

              <section class="ik-checkin-help__block">
                <h3 class="ik-checkin-help__heading">丁尼</h3>
                <p>丁尼是站内流通货币，存放于你的丁尼余额中。每日签到会发放 <strong>10 丁尼</strong>（与绳网信用一并到账）。</p>
                <p>你可以将丁尼投给喜欢的帖子以支持作者：投币会消耗你的余额，帖子会累计显示收到的丁尼数量。</p>
              </section>

              <p
                v-if="(totalDays ?? 0) > 0 || (consecutiveDays ?? 0) > 0 || (rank ?? 0) > 0"
                class="ik-checkin-help__stats"
              >
                <template v-if="(totalDays ?? 0) > 0">
                  你已累计签到 <strong>{{ totalDays }}</strong> 天
                </template>
                <template v-if="(consecutiveDays ?? 0) > 0">
                  <template v-if="(totalDays ?? 0) > 0">，</template>
                  当前连续签到 <strong>{{ consecutiveDays }}</strong> 天
                </template>
                <template v-if="(rank ?? 0) > 0">
                  <template v-if="(totalDays ?? 0) > 0 || (consecutiveDays ?? 0) > 0">，</template>
                  今日签到排名第 <strong>{{ rank }}</strong> 名
                </template>
                <template v-else-if="canCheckIn === false && ((totalDays ?? 0) > 0 || (consecutiveDays ?? 0) > 0)">
                  <template v-if="(totalDays ?? 0) > 0 || (consecutiveDays ?? 0) > 0">，</template>
                  今日已签到
                </template>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Overlay — 与 PostOverlay 完全一致
   ═══════════════════════════════════════════════ */
.ik-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
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

/* ── Dialog Shell（紧凑尺寸，外壳与帖子弹窗一致） ── */
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

.ik-checkin-help__panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  background: #00000065;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.65;
  color: rgba(255, 255, 255, 0.88);
  box-sizing: border-box;
}

.ik-checkin-help__panel p {
  margin: 0;
}

.ik-checkin-help__panel strong {
  color: #fff;
  font-weight: 700;
}

.ik-checkin-help__block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ik-checkin-help__heading {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #BFFF09;
}

.ik-checkin-help__list {
  margin: 0;
  padding-left: 1.25em;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-checkin-help__list--levels {
  gap: 4px;
  font-size: 13px;
}

.ik-checkin-help__list--levels li {
  line-height: 1.5;
}

.ik-checkin-help__muted {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.62);
}

.ik-checkin-help__stats {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.75);
}

/* 入场/出场动画统一在 theme.css；本弹窗无 scale，使用全局 translateX 即可 */
</style>
