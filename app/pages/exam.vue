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
    phase.value = "quiz";
    if (res.resumed) {
      message.success("已恢复进行中的考试");
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

const toggleAnswer = (q: ExamQuestion, key: string) => {
  const current = answers[q.questionId] || [];
  if (q.type === "multiple") {
    answers[q.questionId] = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
  } else {
    answers[q.questionId] = [key];
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
      // 刷新本地用户信息（examPassed / level / 经验）
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
    <div class="ik-exam-page__inner">
      <!-- 未登录 -->
      <div v-if="!auth.isLogin" class="ik-exam-card ik-exam-card--center">
        <h1 class="ik-exam-title">入站考试</h1>
        <p class="ik-exam-desc">登录后才能参加入站考试。</p>
        <button class="ik-exam-btn" type="button" @click="loginDialog.open()">去登录</button>
      </div>

      <!-- 加载中 -->
      <div v-else-if="phase === 'loading'" class="ik-exam-card ik-exam-card--center">
        <p class="ik-exam-desc">加载中…</p>
      </div>

      <!-- 已通过 -->
      <div v-else-if="phase === 'intro' && status?.passed" class="ik-exam-card ik-exam-card--center">
        <h1 class="ik-exam-title">你已通过入站考试</h1>
        <p class="ik-exam-desc">所有功能均已解锁，去发现绳网的精彩吧。</p>
        <NuxtLink to="/" class="ik-exam-btn">返回首页</NuxtLink>
      </div>

      <!-- 介绍 / 开始 -->
      <div v-else-if="phase === 'intro'" class="ik-exam-card">
        <h1 class="ik-exam-title">入站考试</h1>
        <p class="ik-exam-desc">
          为了维护绳网的社区氛围，新成员需要先通过入站考试才能解锁发帖、评论、点赞、私聊等功能。
          考试内容主要为社区规范与基本常识，请认真作答。
        </p>
        <ul v-if="status" class="ik-exam-rules">
          <li>共 <b>{{ status.config.questionCount }}</b> 题，限时 <b>{{ Math.round(status.config.timeLimitSeconds / 60) }}</b> 分钟</li>
          <li>得分达到 <b>{{ status.config.passScorePercent }}%</b> 即为通过</li>
          <li>多选题需选出全部正确选项才得分</li>
          <li>连续失败 <b>{{ status.config.maxFailsBeforeCooldown }}</b> 次需等待 <b>{{ Math.round(status.config.failCooldownSeconds / 60) }}</b> 分钟后再试</li>
          <li v-if="status.config.rewardDenny > 0 || status.config.rewardExp > 0">
            通过可获得 <b>{{ status.config.rewardDenny }}</b> 丁尼与 <b>{{ status.config.rewardExp }}</b> 经验奖励
          </li>
        </ul>
        <p v-if="status?.activeAttempt" class="ik-exam-hint">
          你有一场进行中的考试，点击开始将继续作答。
        </p>
        <p v-if="cooldownRemaining > 0" class="ik-exam-hint ik-exam-hint--warn">
          失败次数过多，请在 {{ formatDuration(cooldownRemaining) }} 后再试。
        </p>
        <button
          class="ik-exam-btn"
          type="button"
          :disabled="starting || cooldownRemaining > 0"
          @click="start"
        >
          {{ starting ? "准备中…" : status?.activeAttempt ? "继续考试" : "开始考试" }}
        </button>
      </div>

      <!-- 答题 -->
      <div v-else-if="phase === 'quiz'" class="ik-exam-quiz">
        <div class="ik-exam-quiz__bar">
          <span>已答 {{ answeredCount }} / {{ questions.length }}</span>
          <span class="ik-exam-quiz__timer" :class="{ 'ik-exam-quiz__timer--warn': remainingSeconds < 300 }">
            ⏱ {{ formatDuration(remainingSeconds) }}
          </span>
        </div>
        <ol class="ik-exam-questions">
          <li v-for="(q, idx) in questions" :key="q.questionId" class="ik-exam-question">
            <p class="ik-exam-question__title">
              <span class="ik-exam-question__type">{{ typeLabel(q.type) }}</span>
              {{ idx + 1 }}. {{ q.question }}
            </p>
            <div class="ik-exam-options">
              <label
                v-for="opt in q.options"
                :key="opt.key"
                class="ik-exam-option"
                :class="{ 'ik-exam-option--checked': (answers[q.questionId] || []).includes(opt.key) }"
              >
                <input
                  :type="q.type === 'multiple' ? 'checkbox' : 'radio'"
                  :name="q.questionId"
                  :checked="(answers[q.questionId] || []).includes(opt.key)"
                  @change="toggleAnswer(q, opt.key)"
                />
                <span>{{ opt.text }}</span>
              </label>
            </div>
          </li>
        </ol>
        <div class="ik-exam-quiz__footer">
          <button class="ik-exam-btn" type="button" :disabled="submitting" @click="submit()">
            {{ submitting ? "提交中…" : "提交答卷" }}
          </button>
        </div>
      </div>

      <!-- 结果 -->
      <div v-else-if="phase === 'result' && result" class="ik-exam-card ik-exam-card--center">
        <h1 class="ik-exam-title">
          {{ result.passed ? "🎉 考试通过！" : "未通过" }}
        </h1>
        <p class="ik-exam-score">
          得分 <b>{{ result.scorePercent }}%</b>（{{ result.correctCount }} / {{ result.questionCount }} 题正确，及格线 {{ result.passScorePercent }}%）
        </p>
        <template v-if="result.passed">
          <p v-if="result.reward" class="ik-exam-desc">
            奖励已发放：{{ result.reward.denny }} 丁尼 + {{ result.reward.exp }} 经验。欢迎加入绳网！
          </p>
          <NuxtLink to="/" class="ik-exam-btn">开始探索</NuxtLink>
        </template>
        <template v-else>
          <p v-if="cooldownRemaining > 0" class="ik-exam-hint ik-exam-hint--warn">
            失败次数过多，请在 {{ formatDuration(cooldownRemaining) }} 后再试。
          </p>
          <button
            class="ik-exam-btn"
            type="button"
            :disabled="cooldownRemaining > 0"
            @click="retry"
          >
            再试一次
          </button>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ik-exam-page {
  min-height: 100vh;
  padding: 96px 16px 64px;
  display: flex;
  justify-content: center;
}

.ik-exam-page__inner {
  width: 100%;
  max-width: 760px;
}

.ik-exam-card {
  background: rgba(20, 20, 20, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 32px;
  color: #eee;
}

.ik-exam-card--center {
  text-align: center;
}

.ik-exam-title {
  font-size: 28px;
  font-weight: 800;
  margin: 0 0 16px;
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

.ik-exam-btn {
  display: inline-block;
  background: #bfff09;
  color: #111;
  font-weight: 700;
  border: none;
  border-radius: 999px;
  padding: 10px 32px;
  font-size: 16px;
  cursor: pointer;
  text-decoration: none;
  transition: opacity 0.15s;
}

.ik-exam-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ik-exam-quiz__bar {
  position: sticky;
  top: 64px;
  z-index: 5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(20, 20, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px 20px;
  color: #ccc;
  margin-bottom: 16px;
}

.ik-exam-quiz__timer {
  font-variant-numeric: tabular-nums;
  color: #bfff09;
  font-weight: 700;
}

.ik-exam-quiz__timer--warn {
  color: #ff7a45;
}

.ik-exam-questions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ik-exam-question {
  background: rgba(20, 20, 20, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px 24px;
  color: #eee;
}

.ik-exam-question__title {
  margin: 0 0 12px;
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
  gap: 8px;
}

.ik-exam-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  color: #ccc;
  transition: border-color 0.15s, background 0.15s;
}

.ik-exam-option:hover {
  border-color: rgba(191, 255, 9, 0.5);
}

.ik-exam-option--checked {
  border-color: #bfff09;
  background: rgba(191, 255, 9, 0.08);
  color: #fff;
}

.ik-exam-option input {
  accent-color: #bfff09;
}

.ik-exam-quiz__footer {
  margin-top: 24px;
  text-align: center;
}

.ik-exam-score {
  font-size: 18px;
  margin: 0 0 16px;
}

.ik-exam-score b {
  color: #bfff09;
  font-size: 24px;
}
</style>
