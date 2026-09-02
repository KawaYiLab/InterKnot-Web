<script setup lang="ts">
/**
 * CheckInReminderModal —— 登录后弹出的「今日签到」提醒。
 *
 * 弹窗自己就能完成签到，成功后不关闭，而是原地翻面做奖励揭晓：连签轨道上「今天」
 * 那格点亮，丁尼与绳网信用数字滚上来。触发闸门、日戳与单例状态都在
 * useCheckInReminder，本组件只负责呈现与这一次签到请求。
 *
 * 外壳（.ik-overlay + .ik-dialog__outer/inner 三圆角）与登录 / 确认弹窗完全一致，
 * 进出场动画吃 theme.css 的全局 .ik-overlay-* 规则。z-index 取 8950，低于 9000
 * 那一批「主」弹窗；嵌在里面的「签到说明」再由 .ik-cir-help 抬回 9000。
 */
import { useMessage } from "zenless-ui";
import { resolveErrorMessage } from "~/utils/api-error";
import { CHECK_IN_DENNY_REWARD, buildCheckInTrack, checkInRewardForDay } from "~/utils/check-in";
import type { Author } from "~/types/entities";

const reminder = useCheckInReminder();
const status = reminder.status;
const auth = useAuthStore();
const api = useApi();
const message = useMessage();

/** 奖励揭晓后自动收起；期间关闭按钮与点遮罩随时可用 */
const AUTO_CLOSE_MS = 2800;

type Phase = "idle" | "signing" | "done";

const phase = ref<Phase>("idle");
const result = ref<Awaited<ReturnType<typeof api.checkIn>> | null>(null);
/** 先留 0，揭晓时再赋真值——IkRollingDigit 靠值变化触发滚动 */
const rolledDenny = ref(0);
const rolledExp = ref(0);
const helpVisible = ref(false);

const userName = computed(
  () => auth.user?.name || auth.user?.username || "代理人",
);

let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 今天是连签的第几天。后端 nextConsecutiveDays 已把断签情况算进去了；老后端没有
 * 这个字段时退回 consecutiveDays + 1——那个值断签后不会清零，可能偏高，所以这种
 * 情况下奖励只显示 +6 ~ +10 区间，不报一个可能错的数。
 */
const streakDay = computed(() => {
  const s = status.value;
  if (!s) return 1;
  if (s.nextConsecutiveDays != null) return Math.max(1, s.nextConsecutiveDays);
  return Math.max(1, s.consecutiveDays + 1);
});

/** 签到成功后以服务端返回的连签天数为准 */
const activeDay = computed(() => result.value?.consecutiveDays ?? streakDay.value);

/**
 * 今天签到能拿到的绳网信用。后端 nextReward 是权威值（已把断签算进去）；老后端
 * 没有这个字段时按 streakDay 本地推算——断签场景下可能偏高一档，但比给用户看一个
 * 「+6~10」的区间直观得多。
 */
const expReward = computed(
  () => status.value?.nextReward ?? checkInRewardForDay(streakDay.value),
);

/** 已连续签到天数：揭晓后含今天，揭晓前不含 */
const completedStreak = computed(() =>
  result.value ? result.value.consecutiveDays : Math.max(0, streakDay.value - 1),
);

const totalDays = computed(() => result.value?.totalDays ?? status.value?.totalDays ?? 0);
const rank = computed(() => result.value?.rank ?? 0);

const trackCells = computed(() => buildCheckInTrack(activeDay.value));

const close = () => {
  reminder.close();
};

const doCheckIn = async () => {
  if (phase.value !== "idle") return;
  phase.value = "signing";
  try {
    const res = await api.checkIn();
    result.value = res;
    phase.value = "done";

    // 下一帧再赋值，让滚轮真的从 0 滚上来而不是直接就位
    requestAnimationFrame(() => {
      rolledDenny.value = res.dennyAdded > 0 ? res.dennyAdded : CHECK_IN_DENNY_REWARD;
      rolledExp.value = res.reward;
    });

    const updates: Partial<Author> = {};
    if (res.currentExp !== undefined) updates.exp = res.currentExp;
    if (res.currentLevel !== undefined) updates.level = res.currentLevel;
    if (Object.keys(updates).length > 0) auth.updateUserPartial(updates);

    // 顶栏丁尼余额立刻跟上（AppHeader 监听这个事件）
    window.dispatchEvent(new CustomEvent("ik:denny-updated", { detail: res.currentDenny }));

    // 写日戳 + 通知已挂载的 /level、/profile 页把按钮切成「已签到」
    reminder.notifyCheckedIn({
      totalDays: res.totalDays,
      consecutiveDays: res.consecutiveDays,
      rank: res.rank,
      reward: res.reward,
      currentDenny: res.currentDenny,
    });

    autoCloseTimer = setTimeout(close, AUTO_CLOSE_MS);
  } catch (err) {
    // 多标签页并发、或用户刚在别处签过：不是错误，安静收起就好
    if ((err as { code?: string })?.code === "CHECK_IN_ALREADY_TODAY") {
      message.warning("今日已签到");
      close();
      return;
    }
    message.error(resolveErrorMessage(err, "签到失败"));
    phase.value = "idle";
  }
};

/**
 * 捕获阶段接管 Escape：说明子弹窗自己也监听 Escape（非捕获），这里先判断层级再
 * 决定关谁，避免一次按键把两层一起关掉。
 */
const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== "Escape") return;
  e.stopImmediatePropagation();
  if (helpVisible.value) {
    helpVisible.value = false;
    return;
  }
  close();
};

const { acquire, release } = useBodyScrollLock();
const SCROLL_LOCK_TOKEN = Symbol("check-in-reminder-modal");

onMounted(() => {
  window.addEventListener("keydown", onKeyDown, true);
  acquire(SCROLL_LOCK_TOKEN);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown, true);
  release(SCROLL_LOCK_TOKEN);
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
});
</script>

<template>
  <div class="ik-overlay" @mousedown.self="close">
    <div class="ik-overlay__stripe" aria-hidden="true"></div>

    <div class="ik-dialog" @click.stop>
      <div class="ik-dialog__outer">
        <div class="ik-dialog__inner">
          <div class="ik-dialog__header">
            <span class="ik-dialog__title">{{ phase === 'done' ? '签到成功' : '绳网签到' }}</span>
            <button class="ik-dialog__close" aria-label="关闭" @click="close">
              <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
            </button>
          </div>

          <div class="ik-dialog__body">
            <IkZzzMarquee />

            <div class="ik-cir">
              <div class="ik-cir__panel">
                <p v-if="phase !== 'done'" class="ik-cir__greeting">
                  欢迎回到绳网社区，{{ userName }}
                </p>

                <div class="ik-cir__track">
                  <div
                    v-for="cell in trackCells"
                    :key="cell.day"
                    class="ik-cir__cell"
                    :class="{
                      'is-done': cell.done,
                      'is-today': cell.today,
                      'is-future': cell.future,
                      'is-claimed': cell.today && phase === 'done',
                    }"
                  >
                    <span class="ik-cir__cell-box">
                      <svg
                        v-if="cell.done || (cell.today && phase === 'done')"
                        class="ik-cir__cell-check"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                      >
                        <path
                          d="M3.5 8.4l3 3 6-6"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                      <span v-else class="ik-cir__cell-day">{{ cell.day }}</span>
                    </span>
                    <span class="ik-cir__cell-reward">+{{ cell.reward }}</span>
                  </div>
                </div>

                <!-- 奖励：未签到时是预览，签到后原地放大成揭晓 -->
                <div class="ik-cir__reward" :class="{ 'is-revealed': phase === 'done' }">
                  <div class="ik-cir__reward-item">
                    <span class="ik-cir__denny">
                      <img src="/images/materials/dennies_v2.webp" alt="" draggable="false" />
                    </span>
                    <span class="ik-cir__reward-text">
                      <span class="ik-cir__reward-num">
                        <template v-if="phase === 'done'">
                          +<IkRollingDigit :value="rolledDenny" :duration="700" />
                        </template>
                        <template v-else>{{ CHECK_IN_DENNY_REWARD }}</template>
                      </span>
                      <span class="ik-cir__reward-name">丁尼</span>
                    </span>
                  </div>

                  <span class="ik-cir__reward-divider" aria-hidden="true"></span>

                  <div class="ik-cir__reward-item">
                    <span class="ik-cir__reward-text">
                      <span class="ik-cir__reward-num ik-cir__reward-num--exp">
                        <template v-if="phase === 'done'">
                          +<IkRollingDigit :value="rolledExp" :duration="700" />
                        </template>
                        <template v-else>+{{ expReward }}</template>
                        <span class="ik-cir__reward-unit">EXP</span>
                      </span>
                      <span class="ik-cir__reward-name">绳网信用</span>
                    </span>
                  </div>
                </div>

                <p v-if="phase === 'done'" class="ik-cir__note">
                  <template v-if="rank > 0">
                    今日第 <strong>{{ rank }}</strong> 位打卡的代理人
                  </template>
                  <template v-else>
                    已累计签到 <strong>{{ totalDays }}</strong> 天
                  </template>
                </p>
                <p v-else class="ik-cir__note">
                  累计签到 <strong>{{ totalDays }}</strong> 天
                  <template v-if="completedStreak > 0">
                    <span class="ik-cir__note-sep">·</span>
                    已连续 <strong>{{ completedStreak }}</strong> 天
                  </template>
                </p>
              </div>

              <button
                type="button"
                class="ik-cir__btn"
                :class="{ 'is-quiet': phase === 'done', 'is-busy': phase === 'signing' }"
                :disabled="phase === 'signing'"
                @click="phase === 'done' ? close() : doCheckIn()"
              >
                {{ phase === 'signing' ? '签到中…' : phase === 'done' ? '确认' : '立即签到' }}
              </button>

              <div class="ik-cir__footer">
                <span class="ik-cir__footer-hint">关闭后今日不再提醒</span>
                <button type="button" class="ik-cir__footer-help" @click="helpVisible = true">
                  签到说明
                </button>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>

    <!-- 签到说明：复用 /profile 页那一份 -->
    <Teleport to="body">
      <Transition name="ik-overlay" appear>
        <CheckInHelpModal
          v-if="helpVisible"
          class="ik-cir-help"
          :total-days="totalDays"
          :consecutive-days="completedStreak"
          :rank="rank"
          :can-check-in="phase !== 'done'"
          @close="helpVisible = false"
        />
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Overlay —— 与登录 / 确认弹窗完全一致。
   z-index 取 8950，低于 9000 那一批「主」弹窗。
   ═══════════════════════════════════════════════ */
.ik-overlay {
  /* 「今天」与主按钮共用的强调色；与 /level 页签到按钮保持一致 */
  --ik-cir-accent: #ffde00;
  position: fixed;
  inset: 0;
  z-index: 8950;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

/* 「签到说明」子弹窗自己声明了 z-index:9000，但 Vue 会把本组件的 scoped 作用域
   属性也打到子组件根节点上 —— 两条 .ik-overlay 规则特异性相同，靠源序决胜，
   结果它被这里的 8950 压住。加一个类把它显式抬回子弹窗层。 */
.ik-overlay.ik-cir-help {
  z-index: 9000;
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
  width: 420px;
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
  position: relative;
  padding: 20px;
  background: #121212;
  border-radius: 0 0 18px 18px;
}

/* 内容层统一压在跑马灯（position:absolute; z-index:0）之上 */
.ik-cir {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ik-cir__panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 16px;
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
}

.ik-cir__greeting {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
  letter-spacing: 0.2px;
}

/* ── 连签轨道 ──────────────────────────────────── */
.ik-cir__track {
  display: flex;
  gap: 6px;
}

.ik-cir__cell {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.ik-cir__cell-box {
  width: 100%;
  max-width: 40px;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  color: rgba(255, 255, 255, 0.28);
  transition: background 200ms ease, border-color 200ms ease, color 200ms ease;
}

.ik-cir__cell-day {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ik-cir__cell-check {
  width: 18px;
  height: 18px;
}

.ik-cir__cell-reward {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.22);
  transition: color 200ms ease;
}

/* 已签到 / 今天：整格实底强调色 + 黑字黑勾，去掉描边
   （同敲敲会话列表的选中态）。今天额外一圈呼吸光晕作区分。 */
.ik-cir__cell.is-done .ik-cir__cell-box,
.ik-cir__cell.is-today .ik-cir__cell-box {
  background: var(--ik-cir-accent);
  border-color: var(--ik-cir-accent);
  color: #000;
  font-weight: 800;
}

.ik-cir__cell.is-done .ik-cir__cell-reward,
.ik-cir__cell.is-today .ik-cir__cell-reward {
  color: var(--ik-cir-accent);
}

.ik-cir__cell.is-today .ik-cir__cell-box {
  animation: ik-cir-pulse 2s ease-out infinite;
}

/* 刚签到成功的那一格：停掉呼吸，弹一下 */
.ik-cir__cell.is-claimed .ik-cir__cell-box {
  animation: ik-cir-claim 460ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ── 奖励卡 ────────────────────────────────────── */
.ik-cir__reward {
  display: flex;
  align-items: center;
  padding: 12px 8px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  transition: padding 260ms cubic-bezier(0.165, 0.84, 0.44, 1),
    background 260ms ease, border-color 260ms ease;
}

.ik-cir__reward.is-revealed {
  padding: 18px 8px;
  background: rgba(255, 222, 0, 0.06);
  border-color: rgba(255, 222, 0, 0.24);
}

.ik-cir__reward-item {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.ik-cir__reward-divider {
  width: 1px;
  height: 30px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
}

/* 丁尼图标包一层 span 再做动画：theme.css 对所有 <img> 有 opacity:0 →
   ik-img-revealed 的全局淡入，直接给 img 上关键帧会和它打架。 */
.ik-cir__denny {
  display: block;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  transition: width 260ms cubic-bezier(0.165, 0.84, 0.44, 1),
    height 260ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.ik-cir__denny img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-cir__reward.is-revealed .ik-cir__denny {
  /* 只动 width/height：pop 关键帧占用 transform，改尺寸不会互相打架 */
  width: 34px;
  height: 34px;
  animation: ik-cir-denny-pop 520ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ik-cir__reward-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 0;
}

.ik-cir__reward-num {
  display: flex;
  align-items: center;
  font-size: 20px;
  font-weight: 800;
  line-height: 1.15;
  color: #fff;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.3px;
  transition: font-size 260ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.ik-cir__reward-num--exp {
  color: var(--ik-cir-accent);
}

/* EXP 作为单位跟在数字后面，压小一档避免和数字抢注意力 */
.ik-cir__reward-unit {
  margin-left: 2px;
  font-size: 0.55em;
  font-weight: 700;
  letter-spacing: 0.4px;
}

.ik-cir__reward.is-revealed .ik-cir__reward-num {
  font-size: 28px;
}

.ik-cir__reward-name {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.35);
  white-space: nowrap;
}

/* ── 统计 / 名次 ───────────────────────────────── */
.ik-cir__note {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
}

.ik-cir__note strong {
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  font-variant-numeric: tabular-nums;
}

.ik-cir__note-sep {
  margin: 0 6px;
  color: rgba(255, 255, 255, 0.18);
}

/* ── 主按钮（与 /level 页签到按钮同色） ────────── */
.ik-cir__btn {
  width: 100%;
  height: 46px;
  border: none;
  border-radius: 14px;
  font-family: inherit;
  font-size: 16px;
  font-weight: 800;
  color: #000;
  background: var(--ik-cir-accent);
  cursor: pointer;
  transition: transform 150ms ease, opacity 150ms ease, background 260ms ease,
    color 260ms ease;
}

.ik-cir__btn:active:not(:disabled) {
  transform: scale(0.98);
}

.ik-cir__btn.is-busy {
  opacity: 0.6;
}

/* 揭晓后按钮退成配角：奖励才是此刻的主角 */
.ik-cir__btn.is-quiet {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

/* ── 页脚 ──────────────────────────────────────── */
.ik-cir__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: -4px;
}

.ik-cir__footer-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
}

.ik-cir__footer-help {
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  text-decoration: underline;
  text-decoration-color: rgba(255, 255, 255, 0.2);
  text-underline-offset: 3px;
  cursor: pointer;
  transition: color 140ms ease;
}

.ik-cir__footer-help:hover {
  color: var(--ik-cir-accent);
}

/* ── Keyframes ─────────────────────────────────── */
@keyframes ik-cir-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 222, 0, 0.4);
  }
  70%,
  100% {
    box-shadow: 0 0 0 6px rgba(255, 222, 0, 0);
  }
}

@keyframes ik-cir-claim {
  0% {
    transform: scale(1);
  }
  45% {
    transform: scale(1.26);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes ik-cir-denny-pop {
  0% {
    transform: scale(0.55) translateY(6px);
  }
  55% {
    transform: scale(1.18) translateY(0);
  }
  100% {
    transform: scale(1) translateY(0);
  }
}

/* ── Mobile ────────────────────────────────────── */
@media (max-width: 500px) {
  .ik-dialog {
    max-width: 100%;
  }

  .ik-dialog__body {
    padding: 16px;
  }

  .ik-cir__panel {
    padding: 16px 12px;
  }

  .ik-cir__track {
    gap: 4px;
  }
}

/* 入场 / 出场动画由 theme.css 的 .ik-overlay-* 全局规则接管；
   这里只关掉本组件自己的强调动效。 */
@media (prefers-reduced-motion: reduce) {
  .ik-cir__cell.is-today .ik-cir__cell-box,
  .ik-cir__cell.is-claimed .ik-cir__cell-box,
  .ik-cir__reward.is-revealed .ik-cir__denny {
    animation: none;
  }

  .ik-cir__cell-box,
  .ik-cir__cell-reward,
  .ik-cir__reward,
  .ik-cir__reward-num,
  .ik-cir__denny,
  .ik-cir__btn,
  .ik-dialog__close {
    transition: none;
  }
}

/* 软件渲染路径下逐帧重算 box-shadow / 缩放同样吃 CPU，一并关掉 */
:global(html.no-gpu) .ik-cir__cell.is-today .ik-cir__cell-box,
:global(html.no-gpu) .ik-cir__cell.is-claimed .ik-cir__cell-box,
:global(html.no-gpu) .ik-cir__reward.is-revealed .ik-cir__denny {
  animation: none;
}
</style>
