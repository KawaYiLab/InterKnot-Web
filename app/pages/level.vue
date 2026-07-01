<script setup lang="ts">
import { useMessage } from "zenless-ui";
import {
  LEVEL_THRESHOLDS,
  LEVEL_TITLES,
  MAX_LEVEL,
  expNeededWithinLevel,
} from "~/utils/level";

const auth = useAuthStore();
const api = useApi();
const loginDialog = useLoginDialog();
const { start: startProgress, finish: finishProgress } = usePageDataLoading();

// -- Auth guard --
if (import.meta.client && !auth.isLogin) {
  loginDialog.open();
  navigateTo("/");
}

// -- User data --
const userLevel = computed(() => auth.user?.level ?? 1);
const userExp = computed(() => auth.user?.exp ?? 0);
const userName = computed(() => auth.user?.name || "用户");
const userAvatar = computed(() => auth.user?.avatar || "/images/default-avatar.webp");

const levelTitle = computed(() => LEVEL_TITLES[userLevel.value] ?? "");
const nextLevelTitle = computed(() => {
  if (userLevel.value >= MAX_LEVEL) return "";
  return LEVEL_TITLES[userLevel.value + 1] ?? "";
});

const currentLevelExp = computed(() => {
  const currentThreshold = LEVEL_THRESHOLDS[userLevel.value - 1] || 0;
  return userExp.value - currentThreshold;
});

const expNeededToNext = computed(() => {
  if (userLevel.value >= MAX_LEVEL) return 0;
  return expNeededWithinLevel(userLevel.value);
});

const expProgressPercent = computed(() => {
  if (userLevel.value >= MAX_LEVEL) return 100;
  const current = Math.max(0, currentLevelExp.value);
  const needed = expNeededToNext.value;
  if (needed <= 0) return 100;
  return Math.min(100, (current / needed) * 100);
});

const expToNextLevel = computed(() => {
  if (userLevel.value >= MAX_LEVEL) return 0;
  return Math.max(0, expNeededToNext.value - currentLevelExp.value);
});

// -- Denny --
const dennyBalance = ref(0);
const dennyGiven = ref(0);

// -- Check-in --
const checkInStatus = ref({
  canCheckIn: false,
  totalDays: 0,
  consecutiveDays: 0,
  rank: 0,
});
const checkInLoading = ref(false);
const dataLoaded = ref(false);

const checkInReward = computed(() => {
  const consecutive = checkInStatus.value.consecutiveDays;
  return Math.min(6 + consecutive, 10);
});

const message = useMessage();

const loadData = async () => {
  if (!auth.isLogin) return;
  startProgress();
  try {
    const [dennyData, statusData] = await Promise.all([
      api.getMyDenny(),
      api.getCheckInStatus(),
    ]);
    dennyBalance.value = dennyData.denny;
    dennyGiven.value = dennyData.dennyGiven;
    checkInStatus.value = {
      canCheckIn: statusData.canCheckIn,
      totalDays: statusData.totalDays,
      consecutiveDays: statusData.consecutiveDays,
      rank: statusData.rank,
    };
    dataLoaded.value = true;
  } catch {
    // silent
  } finally {
    finishProgress();
  }
};

const doCheckIn = async () => {
  if (!checkInStatus.value.canCheckIn || checkInLoading.value) return;
  checkInLoading.value = true;
  try {
    const result = await api.checkIn();
    checkInStatus.value.canCheckIn = false;
    checkInStatus.value.totalDays = result.totalDays || checkInStatus.value.totalDays;
    checkInStatus.value.consecutiveDays = result.consecutiveDays || checkInStatus.value.consecutiveDays;
    checkInStatus.value.rank = result.rank > 0 ? result.rank : checkInStatus.value.rank;

    const userUpdates: Partial<{ exp: number; level: number }> = {};
    if (result.currentExp !== undefined) userUpdates.exp = result.currentExp;
    if (result.currentLevel !== undefined) userUpdates.level = result.currentLevel;
    if (Object.keys(userUpdates).length > 0) {
      auth.updateUserPartial(userUpdates);
    }
    if (result.currentDenny !== undefined) {
      dennyBalance.value = result.currentDenny;
      window.dispatchEvent(new CustomEvent("ik:denny-updated", { detail: result.currentDenny }));
    }

    const dennyAdded = result.dennyAdded > 0 ? result.dennyAdded : 10;
    const parts = [`丁尼+${dennyAdded}`];
    if (result.reward > 0) parts.push(`绳网信用+${result.reward}`);
    const rankText = result.rank > 0 ? `，今日第${result.rank}名` : "";
    message.success(`签到成功！${parts.join("，")}${rankText}`);
  } catch (err: any) {
    if (err?.data?.error?.code === "CHECK_IN_ALREADY_TODAY") {
      message.warning("今日已签到");
      checkInStatus.value.canCheckIn = false;
    } else {
      message.error(err?.data?.error?.message || "签到失败");
    }
  } finally {
    checkInLoading.value = false;
  }
};

// -- Level guide rows --
const levelGuideRows = Array.from({ length: MAX_LEVEL }, (_, i) => {
  const level = i + 1;
  return {
    level,
    title: LEVEL_TITLES[level] ?? "",
    totalExp: LEVEL_THRESHOLDS[i] ?? 0,
    spanExp: level < MAX_LEVEL ? expNeededWithinLevel(level) : 0,
  };
});

const formatExp = (n: number) => n.toLocaleString("zh-CN");

// -- Rules expand --
const rulesExpanded = ref(false);

onMounted(() => {
  void loadData();
});

useHead({ title: "绳网等级" });
</script>

<template>
  <div class="ik-lv">
    <!-- 45° 斜线纹理背景（与主页 / 发帖页一致；跑马灯由 app.vue 全局背景透出） -->
    <div class="ik-lv__stripe" aria-hidden="true"></div>
    <div class="ik-lv__container">

      <!-- Hero: avatar + level ring -->
      <section class="ik-lv__hero">
        <div class="ik-lv__ring-wrap">
          <svg class="ik-lv__ring" viewBox="0 0 120 120">
            <circle
              cx="60" cy="60" r="54"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              stroke-width="5"
            />
            <circle
              cx="60" cy="60" r="54"
              fill="none"
              stroke="url(#ik-lv-gradient)"
              stroke-width="5"
              stroke-linecap="round"
              :stroke-dasharray="339.29"
              :stroke-dashoffset="339.29 * (1 - expProgressPercent / 100)"
              transform="rotate(-90 60 60)"
              class="ik-lv__ring-fill"
            />
            <defs>
              <linearGradient id="ik-lv-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#4661fd" />
                <stop offset="100%" stop-color="#10bff0" />
              </linearGradient>
            </defs>
          </svg>
          <img
            :src="userAvatar"
            alt=""
            class="ik-lv__avatar"
            @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
          />
        </div>

        <h1 class="ik-lv__name">{{ userName }}</h1>

        <div class="ik-lv__level-badge">
          <span class="ik-lv__level-num">Lv.{{ userLevel }}</span>
          <span class="ik-lv__level-title">{{ levelTitle }}</span>
        </div>

        <p v-if="userLevel < MAX_LEVEL" class="ik-lv__exp-text">
          {{ formatExp(Math.max(0, currentLevelExp)) }}
          <span class="ik-lv__exp-sep">/</span>
          {{ formatExp(expNeededToNext) }}
        </p>
        <p v-else class="ik-lv__exp-text ik-lv__exp-text--max">满级</p>

        <p v-if="userLevel < MAX_LEVEL" class="ik-lv__exp-hint">
          距 <strong>{{ nextLevelTitle }}</strong> 还需 {{ formatExp(expToNextLevel) }} 绳网信用
        </p>
      </section>

      <!-- Check-in card -->
      <section class="ik-lv__card">
        <div class="ik-lv__card-header">
          <h2 class="ik-lv__card-title">每日签到</h2>
          <span v-if="checkInStatus.rank > 0" class="ik-lv__rank">
            今日第 {{ checkInStatus.rank }} 名
          </span>
        </div>

        <div class="ik-lv__checkin-body">
          <div class="ik-lv__checkin-stats">
            <div class="ik-lv__stat">
              <span class="ik-lv__stat-num">{{ checkInStatus.totalDays }}</span>
              <span class="ik-lv__stat-label">累计签到</span>
            </div>
            <div class="ik-lv__stat-divider" />
            <div class="ik-lv__stat">
              <span class="ik-lv__stat-num">{{ checkInStatus.consecutiveDays }}</span>
              <span class="ik-lv__stat-label">连续签到</span>
            </div>
            <div class="ik-lv__stat-divider" />
            <div class="ik-lv__stat">
              <span class="ik-lv__stat-num">{{ checkInReward }}</span>
              <span class="ik-lv__stat-label">绳网信用</span>
            </div>
          </div>

          <button
            class="ik-lv__checkin-btn"
            :class="{ 'is-disabled': !checkInStatus.canCheckIn || checkInLoading }"
            :disabled="!checkInStatus.canCheckIn || checkInLoading"
            @click="doCheckIn"
          >
            {{ checkInLoading ? '签到中...' : checkInStatus.canCheckIn ? '今日签到' : '已签到' }}
          </button>
        </div>
      </section>

      <!-- Denny card -->
      <section class="ik-lv__card">
        <div class="ik-lv__card-header">
          <h2 class="ik-lv__card-title">丁尼</h2>
        </div>
        <div class="ik-lv__denny-body">
          <div class="ik-lv__denny-row">
            <img src="/images/materials/dennies_v2.webp" alt="" class="ik-lv__denny-icon" draggable="false" />
            <span class="ik-lv__denny-balance">{{ formatExp(dennyBalance) }}</span>
          </div>
          <p class="ik-lv__denny-sub">
            已投出 {{ formatExp(dennyGiven) }} 丁尼
          </p>
        </div>
      </section>

      <!-- Credit rules card -->
      <section class="ik-lv__card">
        <button class="ik-lv__card-header ik-lv__card-header--toggle" @click="rulesExpanded = !rulesExpanded">
          <h2 class="ik-lv__card-title">绳网信用规则</h2>
          <svg
            class="ik-lv__chevron"
            :class="{ 'is-open': rulesExpanded }"
            width="20" height="20" viewBox="0 0 20 20" fill="none"
          >
            <path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <Transition name="ik-lv-expand">
          <div v-if="rulesExpanded" class="ik-lv__rules">
            <div class="ik-lv__rule-group">
              <h3 class="ik-lv__rule-heading">主动行为<span class="ik-lv__rule-cap">上限 50/天</span></h3>
              <div class="ik-lv__rule-items">
                <div class="ik-lv__rule-item">
                  <span>签到</span><span class="ik-lv__rule-val">+6 ~ +10</span>
                </div>
                <div class="ik-lv__rule-item">
                  <span>发帖</span><span class="ik-lv__rule-val">+4</span>
                </div>
                <div class="ik-lv__rule-item">
                  <span>评论</span><span class="ik-lv__rule-val">+3</span>
                </div>
                <div class="ik-lv__rule-item">
                  <span>点赞</span><span class="ik-lv__rule-val">+1</span>
                </div>
              </div>
            </div>
            <div class="ik-lv__rule-group">
              <h3 class="ik-lv__rule-heading">被动收入<span class="ik-lv__rule-cap">上限 1,000/天</span></h3>
              <div class="ik-lv__rule-items">
                <div class="ik-lv__rule-item">
                  <span>被点赞</span><span class="ik-lv__rule-val">+1</span>
                </div>
                <div class="ik-lv__rule-item">
                  <span>被评论</span><span class="ik-lv__rule-val">+1</span>
                </div>
                <div class="ik-lv__rule-item">
                  <span>被收藏</span><span class="ik-lv__rule-val">+2</span>
                </div>
              </div>
            </div>
            <p class="ik-lv__rule-note">签到日以每天凌晨 4:00 为界</p>
          </div>
        </Transition>
      </section>

      <!-- Level guide -->
      <section class="ik-lv__card ik-lv__card--levels">
        <div class="ik-lv__card-header">
          <h2 class="ik-lv__card-title">等级一览</h2>
        </div>
        <div class="ik-lv__levels">
          <div
            v-for="row in levelGuideRows"
            :key="row.level"
            class="ik-lv__level-row"
            :class="{ 'is-current': row.level === userLevel }"
          >
            <div class="ik-lv__level-row-left">
              <span class="ik-lv__level-row-num">Lv.{{ row.level }}</span>
              <span class="ik-lv__level-row-title">{{ row.title }}</span>
            </div>
            <div class="ik-lv__level-row-right">
              <span class="ik-lv__level-row-exp">{{ formatExp(row.totalExp) }}</span>
              <span v-if="row.spanExp > 0" class="ik-lv__level-row-span">
                需 {{ formatExp(row.spanExp) }}
              </span>
              <span v-else class="ik-lv__level-row-span ik-lv__level-row-span--max">满级</span>
            </div>
          </div>
        </div>
      </section>

    </div>
  </div>
</template>

<style scoped>
/* ── Page container ── */
.ik-lv {
  position: relative;
  width: 100%;
  min-height: 100vh;
  padding-bottom: calc(74px + env(safe-area-inset-bottom, 0px));
}

/* 45° 斜线纹理背景（与 .ik-home-page__stripe 完全一致） */
.ik-lv__stripe {
  position: fixed;
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

.ik-lv__container {
  position: relative;
  z-index: 1;
  max-width: 480px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Hero section ── */
.ik-lv__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 0 20px;
  gap: 0;
}

.ik-lv__ring-wrap {
  position: relative;
  width: 120px;
  height: 120px;
  margin-bottom: 16px;
}

.ik-lv__ring {
  width: 100%;
  height: 100%;
}

.ik-lv__ring-fill {
  transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.ik-lv__avatar {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 96px;
  height: 96px;
  border-radius: 50%;
  object-fit: cover;
  background: #111;
}

.ik-lv__name {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.3px;
}

.ik-lv__level-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.ik-lv__level-num {
  font-size: 15px;
  font-weight: 800;
  background: linear-gradient(135deg, #4661fd, #10bff0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ik-lv__level-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
}

.ik-lv__exp-text {
  margin: 12px 0 0;
  font-size: 28px;
  font-weight: 800;
  color: #fff;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px;
}

.ik-lv__exp-text--max {
  background: linear-gradient(135deg, #fbfe00, #f0a000);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ik-lv__exp-sep {
  color: rgba(255, 255, 255, 0.25);
  font-weight: 400;
  margin: 0 2px;
}

.ik-lv__exp-hint {
  margin: 6px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
}

.ik-lv__exp-hint strong {
  color: rgba(255, 255, 255, 0.7);
}

/* ── Card ── */
.ik-lv__card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 20px;
  overflow: hidden;
}

.ik-lv__card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 0;
}

.ik-lv__card-header--toggle {
  width: 100%;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
  padding: 18px 20px;
  -webkit-tap-highlight-color: transparent;
}

.ik-lv__card-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.2px;
}

.ik-lv__rank {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.35);
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
}

/* ── Check-in ── */
.ik-lv__checkin-body {
  padding: 16px 20px 20px;
}

.ik-lv__checkin-stats {
  display: flex;
  align-items: center;
  justify-content: space-around;
  margin-bottom: 20px;
}

.ik-lv__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.ik-lv__stat-num {
  font-size: 24px;
  font-weight: 800;
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.ik-lv__stat-label {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.35);
}

.ik-lv__stat-divider {
  width: 1px;
  height: 28px;
  background: rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.ik-lv__checkin-btn {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
  background: linear-gradient(135deg, #4661fd 0%, #10bff0 100%);
  color: #fff;
  -webkit-tap-highlight-color: transparent;
}

.ik-lv__checkin-btn:active:not(.is-disabled) {
  transform: scale(0.97);
}

.ik-lv__checkin-btn.is-disabled {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.3);
  cursor: default;
}

/* ── Denny ── */
.ik-lv__denny-body {
  padding: 16px 20px 20px;
}

.ik-lv__denny-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ik-lv__denny-icon {
  width: 44px;
  height: 44px;
  object-fit: contain;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.4));
}

.ik-lv__denny-balance {
  font-size: 32px;
  font-weight: 800;
  color: #fff;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px;
}

.ik-lv__denny-sub {
  margin: 8px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
}

/* ── Chevron ── */
.ik-lv__chevron {
  color: rgba(255, 255, 255, 0.3);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.ik-lv__chevron.is-open {
  transform: rotate(180deg);
}

/* ── Rules ── */
.ik-lv__rules {
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ik-lv__rule-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ik-lv__rule-heading {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  gap: 8px;
}

.ik-lv__rule-cap {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.25);
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
}

.ik-lv__rule-items {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ik-lv__rule-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 14px;
  color: rgba(255, 255, 255, 0.75);
}

.ik-lv__rule-item:last-child {
  border-bottom: none;
}

.ik-lv__rule-val {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.5);
}

.ik-lv__rule-note {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.2);
  text-align: center;
}

/* ── Expand transition ── */
.ik-lv-expand-enter-active,
.ik-lv-expand-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.ik-lv-expand-enter-from,
.ik-lv-expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.ik-lv-expand-enter-to,
.ik-lv-expand-leave-from {
  opacity: 1;
  max-height: 500px;
}

/* ── Level guide ── */
.ik-lv__levels {
  padding: 12px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ik-lv__level-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.2s;
}

.ik-lv__level-row:last-child {
  border-bottom: none;
}

.ik-lv__level-row.is-current {
  background: rgba(70, 97, 253, 0.08);
  margin: 0 -20px;
  padding: 12px 20px;
  border-radius: 12px;
  border-bottom-color: transparent;
}

.ik-lv__level-row-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ik-lv__level-row-num {
  font-size: 15px;
  font-weight: 800;
  color: #fff;
  min-width: 38px;
}

.ik-lv__level-row.is-current .ik-lv__level-row-num {
  background: linear-gradient(135deg, #4661fd, #10bff0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ik-lv__level-row-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
}

.ik-lv__level-row.is-current .ik-lv__level-row-title {
  color: rgba(255, 255, 255, 0.85);
}

.ik-lv__level-row-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.ik-lv__level-row-exp {
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}

.ik-lv__level-row-span {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.25);
}

.ik-lv__level-row-span--max {
  color: rgba(251, 254, 0, 0.5);
}

/* ── Desktop: limit width + center ── */
@media (min-width: 769px) {
  .ik-lv {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-lv__ring-fill { transition: none; }
  .ik-lv__checkin-btn { transition: none; }
  .ik-lv__chevron { transition: none; }
  .ik-lv-expand-enter-active,
  .ik-lv-expand-leave-active { transition: none; }
}
</style>
