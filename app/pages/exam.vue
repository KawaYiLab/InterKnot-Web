<script setup lang="ts">
import { useMessage } from "zenless-ui";
import type { ExamQuestion, ExamStatus, ExamSubmitResult } from "~/types/entities";

const auth = useAuthStore();
const api = useApi();
const message = useMessage();
const loginDialog = useLoginDialog();

type Phase = "loading" | "intro" | "quiz" | "result";

const phase = ref<Phase>("loading");
const status = ref<ExamStatus | null>(null);
const starting = ref(false);
const submitting = ref(false);

const attemptId = ref("");
const questions = ref<ExamQuestion[]>([]);
const answers = reactive<Record<string, string[]>>({});
const expiresAt = ref<string>("");
const result = ref<ExamSubmitResult | null>(null);

// ── 倒计时 ──────────────────────────────────────
const nowTs = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;

const remainingSeconds = computed(() => {
  if (!expiresAt.value) return 0;
  return Math.max(0, Math.floor((new Date(expiresAt.value).getTime() - nowTs.value) / 1000));
});

const cooldownRemaining = ref(0);

const formatDuration = (total: number) => {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const answeredCount = computed(
  () => questions.value.filter((q) => (answers[q.questionId] || []).length > 0).length,
);

const typeLabel = (type: ExamQuestion["type"]) =>
  type === "multiple" ? "多选" : type === "boolean" ? "判断" : "单选";

// 逐题作答：当前题号
const qIndex = ref(0);
const currentQuestion = computed(() => questions.value[qIndex.value] ?? null);
const goPrev = () => {
  if (qIndex.value > 0) qIndex.value -= 1;
};
const goNext = () => {
  if (qIndex.value < questions.value.length - 1) qIndex.value += 1;
};
const setSingle = (q: ExamQuestion, val: unknown) => {
  answers[q.questionId] = val == null || val === "" ? [] : [String(val)];
};
const setMulti = (q: ExamQuestion, val: unknown) => {
  answers[q.questionId] = Array.isArray(val) ? val.map(String) : [];
};

const loadStatus = async () => {
  phase.value = "loading";
  try {
    const res = await api.getExamStatus();
    status.value = res;
    cooldownRemaining.value = res.cooldownRemaining || 0;
    phase.value = "intro";
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取考试状态失败"));
    phase.value = "intro";
  }
};

const start = async () => {
  if (starting.value) return;
  starting.value = true;
  try {
    const res = await api.startExam();
    attemptId.value = res.attemptId;
    questions.value = res.questions;
    expiresAt.value = res.expiresAt;
    for (const q of res.questions) {
      if (!answers[q.questionId]) answers[q.questionId] = [];
    }
    qIndex.value = 0;
    phase.value = "quiz";
    if (res.resumed) {
      message.success("已开始进行中的考试");
    }
  } catch (err) {
    const e = err as { code?: string; details?: { retryAfter?: number } };
    if (e?.code === "EXAM_COOLDOWN") {
      cooldownRemaining.value = Number(e.details?.retryAfter) || 0;
    }
    message.error(resolveErrorMessage(err, "开始考试失败"));
  } finally {
    starting.value = false;
  }
};

const submit = async (auto = false) => {
  if (submitting.value || !attemptId.value) return;
  if (!auto && answeredCount.value < questions.value.length) {
    const remain = questions.value.length - answeredCount.value;
    if (!window.confirm(`还有 ${remain} 题未作答，确定提交吗？`)) return;
  }
  submitting.value = true;
  try {
    const payload: Record<string, string[]> = {};
    for (const q of questions.value) {
      payload[q.questionId] = answers[q.questionId] || [];
    }
    const res = await api.submitExam(attemptId.value, payload);
    result.value = res;
    cooldownRemaining.value = res.cooldownRemaining || 0;
    phase.value = "result";
    if (res.passed) {
      // 刷新本地用户信息（examPassed / level / 绳网信用）
      api.clearAllCache();
      await auth.fetchSelfUser();
    }
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === "EXAM_ATTEMPT_EXPIRED") {
      message.error("考试已超时，请重新开始");
      attemptId.value = "";
      await loadStatus();
    } else {
      message.error(resolveErrorMessage(err, "提交失败"));
    }
  } finally {
    submitting.value = false;
  }
};

watch(remainingSeconds, (val) => {
  if (phase.value === "quiz" && val <= 0 && attemptId.value && !submitting.value) {
    submit(true);
  }
});

const retry = async () => {
  result.value = null;
  attemptId.value = "";
  questions.value = [];
  qIndex.value = 0;
  await loadStatus();
};

onMounted(() => {
  ticker = setInterval(() => {
    nowTs.value = Date.now();
    if (cooldownRemaining.value > 0) cooldownRemaining.value -= 1;
  }, 1000);
  if (!auth.isLogin) {
    phase.value = "intro";
    return;
  }
  loadStatus();
});

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker);
});

watch(
  () => auth.isLogin,
  (loggedIn) => {
    if (loggedIn) loadStatus();
  },
);

useHead({ title: "入站考试 - 绳网" });
</script>

<template>
  <section class="ik-exam-page">
    <!-- 45° 斜线纹理背景（与发帖页一致） -->
    <div class="ik-exam-page__stripe" aria-hidden="true"></div>

    <div class="ik-exam-page__inner">
      <!-- 未登录 -->
      <div v-if="!auth.isLogin" class="ik-exam-panel">
        <div class="ik-exam-panel__body ik-exam-panel__body--center">
          <h1 class="ik-exam-title">入站考试</h1>
          <p class="ik-exam-desc">登录后才能参加入站考试。</p>
          <z-button @click="loginDialog.open()">去登录</z-button>
        </div>
      </div>

      <!-- 加载中 -->
      <div v-else-if="phase === 'loading'" class="ik-exam-panel">
        <div class="ik-exam-panel__body ik-exam-panel__body--center">
          <p class="ik-exam-desc">加载中…</p>
        </div>
      </div>

      <!-- 已通过 -->
      <div v-else-if="phase === 'intro' && status?.passed" class="ik-exam-panel">
        <div class="ik-exam-panel__body ik-exam-panel__body--center">
          <h1 class="ik-exam-title">你已通过入站考试</h1>
          <p class="ik-exam-desc">所有功能已解锁，欢迎加入神秘组织...INTERKNOT。</p>
          <p class="ik-exam-desc">
            为入站考试投稿题目：<a
              class="ik-exam-link"
              href="https://docs.qq.com/sheet/DRkRLYkd4a0VScG9I"
              target="_blank"
              rel="noopener noreferrer"
            >题目投稿入口</a>
          </p>
          <z-button @click="navigateTo('/')">返回首页</z-button>
        </div>
      </div>

      <!-- 介绍 / 开始 -->
      <div v-else-if="phase === 'intro'" class="ik-exam-panel">
        <div class="ik-exam-panel__body">
          <h1 class="ik-exam-title">入站考试</h1>
          <p class="ik-exam-desc">
            为了维护绳网的社区氛围，新成员需要先通过入站考试才能正式入站。
            考试内容主要为世界观知识与基本常识，请认真作答。
          </p>
          <ul v-if="status" class="ik-exam-rules">
            <li>共 <b>{{ status.config.questionCount }}</b> 题，限时 <b>{{ Math.round(status.config.timeLimitSeconds / 60) }}</b> 分钟</li>
            <li>得分达到 <b>{{ status.config.passScorePercent }}%</b> 即为通过</li>
            <li>多选题需选出全部正确选项才得分</li>
            <li>连续失败 <b>{{ status.config.maxFailsBeforeCooldown }}</b> 次需等待 <b>{{ Math.round(status.config.failCooldownSeconds / 60) }}</b> 分钟后再试</li>
            <li v-if="status.config.rewardDenny > 0 || status.config.rewardExp > 0">
              通过可获得 <b>{{ status.config.rewardDenny }}</b> 丁尼与 <b>{{ status.config.rewardExp }}</b> 绳网信用奖励
            </li>
          </ul>
          <p v-if="status?.activeAttempt" class="ik-exam-hint">
            你有一场进行中的考试，点击「继续考试」将继续作答。
          </p>
          <p v-if="cooldownRemaining > 0" class="ik-exam-hint ik-exam-hint--warn">
            失败次数过多，请在 {{ formatDuration(cooldownRemaining) }} 后再试。
          </p>
          <z-button
            :loading="starting"
            :disabled="cooldownRemaining > 0"
            @click="start"
          >
            {{ starting ? "准备中…" : status?.activeAttempt ? "继续考试" : "开始考试" }}
          </z-button>
        </div>
      </div>

      <!-- 答题 -->
      <div v-else-if="phase === 'quiz'" class="ik-exam-quiz">
        <div class="ik-exam-quiz__bar">
          <span>已答 {{ answeredCount }} / {{ questions.length }}</span>
          <span class="ik-exam-quiz__timer" :class="{ 'ik-exam-quiz__timer--warn': remainingSeconds < 300 }">
            ⏱ {{ formatDuration(remainingSeconds) }}
          </span>
        </div>
        <div class="ik-exam-panel">
          <div class="ik-exam-panel__body">
            <z-progress
              class="ik-exam-progress"
              :percent="questions.length ? Math.round((answeredCount / questions.length) * 100) : 0"
              color="#bfff09"
            />

            <div v-if="currentQuestion" :key="currentQuestion.questionId" class="ik-exam-question">
              <p class="ik-exam-question__title">
                <span class="ik-exam-question__type">{{ typeLabel(currentQuestion.type) }}</span>
                {{ qIndex + 1 }}. {{ currentQuestion.question }}
              </p>

              <z-radio-group
                v-if="currentQuestion.type === 'multiple'"
                mode="checkbox"
                class="ik-exam-options"
                :model-value="answers[currentQuestion.questionId] || []"
                @change="(v: unknown) => setMulti(currentQuestion!, v)"
              >
                <z-checkbox v-for="opt in currentQuestion.options" :key="opt.key" :value="opt.key">
                  {{ opt.text }}
                </z-checkbox>
              </z-radio-group>

              <z-radio-group
                v-else
                class="ik-exam-options"
                :model-value="(answers[currentQuestion.questionId] || [])[0] ?? ''"
                @change="(v: unknown) => setSingle(currentQuestion!, v)"
              >
                <z-radio v-for="opt in currentQuestion.options" :key="opt.key" :value="opt.key">
                  {{ opt.text }}
                </z-radio>
              </z-radio-group>
            </div>

            <div class="ik-exam-quiz__nav">
              <z-button :disabled="qIndex === 0" @click="goPrev">上一题</z-button>
              <z-button v-if="qIndex < questions.length - 1" @click="goNext">下一题</z-button>
              <z-button
                v-else
                :loading="submitting"
                @click="submit()"
              >
                {{ submitting ? "提交中…" : "提交答卷" }}
              </z-button>
            </div>

          </div>
        </div>
      </div>

      <!-- 结果 -->
      <div v-else-if="phase === 'result' && result" class="ik-exam-panel">
        <div class="ik-exam-panel__body ik-exam-panel__body--center">
          <h1 class="ik-exam-title">
            {{ result.passed ? "🎉 考试通过！" : "未通过" }}
          </h1>
          <p class="ik-exam-score">
            得分 <b>{{ result.scorePercent }}%</b>（{{ result.correctCount }} / {{ result.questionCount }} 题正确，及格线 {{ result.passScorePercent }}%）
          </p>
          <template v-if="result.passed">
            <p v-if="result.reward" class="ik-exam-desc">
              奖励已发放：{{ result.reward.denny }} 丁尼 + {{ result.reward.exp }} 绳网信用。欢迎加入绳网！
            </p>
            <p class="ik-exam-desc">
              欢迎为入站考试投稿题目：<a
                class="ik-exam-link"
                href="https://docs.qq.com/sheet/DRkRLYkd4a0VScG9I"
                target="_blank"
                rel="noopener noreferrer"
              >题目投稿入口</a>
            </p>
            <z-button @click="navigateTo('/')">开始探索</z-button>
          </template>
          <template v-else>
            <p v-if="cooldownRemaining > 0" class="ik-exam-hint ik-exam-hint--warn">
              失败次数过多，请在 {{ formatDuration(cooldownRemaining) }} 后再试。
            </p>
            <z-button :disabled="cooldownRemaining > 0" @click="retry">
              再试一次
            </z-button>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ik-exam-page {
  position: relative;
  min-height: 100vh;
  padding: 96px 16px 64px;
  display: flex;
  justify-content: center;
}

/* 与发帖页一致的 45° 斜线纹理背景 */
.ik-exam-page__stripe {
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

.ik-exam-page__inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 760px;
}

.ik-exam-panel {
  padding: 4px;
  background: #2d2c2d;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
}

.ik-exam-panel__body {
  padding: 28px 32px;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #0a0a0a 0%, #070707 100%);
  border: 4px solid #000;
  border-radius: 22px 0 22px 22px;
  color: #eee;
}

.ik-exam-panel__body--center {
  text-align: center;
}

.ik-exam-title {
  font-size: 28px;
  font-weight: 800;
  margin: 0 0 16px;
  letter-spacing: -0.02em;
}

.ik-exam-desc {
  color: #aaa;
  line-height: 1.8;
  margin: 0 0 16px;
}

.ik-exam-rules {
  margin: 0 0 16px;
  padding-left: 20px;
  color: #ccc;
  line-height: 2;
}

.ik-exam-rules b {
  color: #bfff09;
}

.ik-exam-hint {
  color: #9bd60a;
  margin: 0 0 12px;
}

.ik-exam-hint--warn {
  color: #ff7a45;
}

.ik-exam-quiz__bar {
  position: sticky;
  top: 64px;
  z-index: 5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  margin-bottom: 16px;
  color: #ccc;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #0a0a0a 0%, #070707 100%);
  border: 4px solid #000;
  border-radius: 12px 0 12px 12px;
  box-shadow: 0 0 0 4px #2d2c2d;
}

.ik-exam-quiz__timer {
  font-variant-numeric: tabular-nums;
  color: #bfff09;
  font-weight: 700;
}

.ik-exam-quiz__timer--warn {
  color: #ff7a45;
}

.ik-exam-progress {
  margin-bottom: 20px;
}

.ik-exam-question {
  min-height: 260px;
  color: #eee;
}

.ik-exam-question__title {
  margin: 0 0 16px;
  font-weight: 600;
  line-height: 1.7;
}

.ik-exam-question__type {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  color: #111;
  background: #bfff09;
  border-radius: 4px;
  padding: 1px 6px;
  margin-right: 8px;
  vertical-align: middle;
}

.ik-exam-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
}

.ik-exam-options :deep(.z-radio),
.ik-exam-options :deep(.z-checkbox) {
  white-space: normal;
  word-break: break-word;
  overflow-wrap: break-word;
  height: auto;
  min-height: 40px;
  padding: 10px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: background 0.2s ease, border-color 0.2s ease;
}

.ik-exam-options :deep(.z-radio:hover),
.ik-exam-options :deep(.z-checkbox:hover) {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.15);
}

.ik-exam-options :deep(.z-radio.is-checked),
.ik-exam-options :deep(.z-checkbox.is-checked) {
  background: #bfff09;
  border-color: #bfff09;
  color: #000;
}

.ik-exam-options :deep(.z-radio.is-checked .z-radio__label),
.ik-exam-options :deep(.z-checkbox.is-checked .z-radio__label) {
  color: #000;
  font-weight: 600;
}

.ik-exam-options :deep(.z-radio.is-checked .z-radio__input),
.ik-exam-options :deep(.z-checkbox.is-checked .z-radio__input) {
  border-color: #000;
  outline-color: #000;
}

.ik-exam-options :deep(.z-radio__label),
.ik-exam-options :deep(.z-checkbox__label) {
  white-space: normal;
  word-break: break-word;
  overflow-wrap: break-word;
  line-height: 1.5;
}

.ik-exam-quiz__nav {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 28px;
}

.ik-exam-score {
  font-size: 18px;
  margin: 0 0 16px;
}

.ik-exam-score b {
  color: #bfff09;
  font-size: 24px;
}

.ik-exam-link {
  color: #bfff09;
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color 0.2s;
}

.ik-exam-link:hover {
  color: #d9ff66;
}

/* ── 移动端优化 ── */
@media (max-width: 768px) {
  .ik-exam-page {
    padding: 72px 12px 48px;
  }

  .ik-exam-panel {
    border-radius: 20px 0 20px 20px;
  }

  .ik-exam-panel__body {
    padding: 20px 16px;
    border-radius: 18px 0 18px 18px;
  }

  .ik-exam-title {
    font-size: 22px;
  }

  .ik-exam-desc {
    font-size: 14px;
    line-height: 1.7;
  }

  .ik-exam-rules {
    padding-left: 16px;
    font-size: 14px;
    line-height: 1.8;
  }

  .ik-exam-quiz__bar {
    top: 56px;
    padding: 10px 14px;
    font-size: 14px;
    border-radius: 10px 0 10px 10px;
  }

  .ik-exam-question {
    min-height: 200px;
  }

  .ik-exam-question__title {
    font-size: 15px;
    line-height: 1.6;
  }

  .ik-exam-options {
    gap: 8px;
  }

  .ik-exam-options :deep(.z-radio),
  .ik-exam-options :deep(.z-checkbox) {
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 14px;
  }

  .ik-exam-quiz__nav {
    gap: 12px;
    margin-top: 24px;
  }

  .ik-exam-score {
    font-size: 16px;
  }

  .ik-exam-score b {
    font-size: 20px;
  }
}
</style>
