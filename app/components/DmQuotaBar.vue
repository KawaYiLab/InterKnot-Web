<script setup lang="ts">
import { computed } from "vue";

/**
 * 敲敲当日额度：标题栏里模型选择器右侧的一条内联迷你进度条。
 *
 * 只有一条口径 —— 每人每天的 token 额度（贵模型按后台倍率多扣，1 倍模型
 * 就是真实 token；倍率一事放进 tooltip，正文不解释）。打满时不给数字，
 * 直接说「额度已用完」：用户此刻只需要知道这件事和什么时候恢复。
 */
const props = defineProps<{
  percent: number;
  exhausted: boolean;
  tokensUsed: number;
  tokensLimit: number;
  /** 下一次日切（本地 04:00）的 ISO 时刻 */
  resetAt: string;
}>();

/** 大数收成 42.0万 / 100万：标题栏里放不下九位数，也不需要精确到个位 */
const compact = (n: number): string => {
  if (n >= 10_000) {
    const w = n / 10_000;
    return `${w >= 100 ? Math.round(w) : w.toFixed(1)}万`;
  }
  return String(Math.round(n));
};

/** 标题栏里位置紧张：只给一组数字，前缀「今日」窄屏还会隐藏 */
const label = computed(() => {
  if (props.exhausted) return "额度已用完";
  return `${compact(props.tokensUsed)}/${compact(props.tokensLimit)} token`;
});

const resetLabel = computed(() => {
  const t = new Date(props.resetAt);
  if (Number.isNaN(t.getTime())) return "";
  // resetAt 是绝对时刻，换成本地时间显示才是用户能对上的那个「04:00」
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} 重置`;
});

const detail = computed(() => {
  const parts = [
    `今日 token ${props.tokensUsed.toLocaleString()}/${props.tokensLimit.toLocaleString()}（贵模型按倍率折算）`,
  ];
  if (resetLabel.value) parts.push(resetLabel.value);
  return parts.join(" · ");
});

/** 80% 起转黄、打满转红：颜色本身就是提示，不用额外文案 */
const level = computed(() => {
  if (props.exhausted) return "is-full";
  if (props.percent >= 80) return "is-warn";
  return "";
});
</script>

<template>
  <div class="ik-quota" :class="level" :title="detail">
    <span class="ik-quota__track">
      <span class="ik-quota__fill" :style="{ width: `${Math.max(percent, 4)}%` }" />
    </span>
    <span class="ik-quota__label">
      <span class="ik-quota__prefix">今日</span>{{ label }}
    </span>
  </div>
</template>

<style scoped>
.ik-quota {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 2px;
  user-select: none;
  font-size: 11.5px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.38);
  /* 有 title 才有明细，用 help 光标提示可以 hover */
  cursor: help;
  transition: color 140ms ease;
}

.ik-quota:hover {
  color: rgba(255, 255, 255, 0.62);
}

/* 与左侧模型选择器之间的细分隔，两个内联小件才不糊成一块 */
.ik-quota::before {
  content: "";
  flex-shrink: 0;
  width: 1px;
  height: 12px;
  margin-right: 2px;
  background: rgba(255, 255, 255, 0.12);
}

.ik-quota__track {
  flex-shrink: 0;
  width: 42px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.09);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  overflow: hidden;
}

.ik-quota__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0.5));
  transition: width 320ms cubic-bezier(0.16, 1, 0.3, 1), background 240ms ease;
}

.ik-quota.is-warn .ik-quota__fill {
  background: linear-gradient(90deg, #d8db00, #fbfe00);
  box-shadow: 0 0 6px rgba(251, 254, 0, 0.45);
}

.ik-quota.is-full .ik-quota__fill {
  background: linear-gradient(90deg, #ff3d3d, #ff7a7a);
  box-shadow: 0 0 6px rgba(255, 90, 90, 0.5);
}

.ik-quota.is-warn {
  color: rgba(251, 254, 0, 0.75);
}

.ik-quota.is-full {
  color: #ff8a8a;
}

.ik-quota.is-warn:hover {
  color: #fbfe00;
}

.ik-quota.is-full:hover {
  color: #ffa5a5;
}

.ik-quota__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 等宽数字：用量跳动时数字不会左右抖 */
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

.ik-quota__prefix {
  margin-right: 2px;
  opacity: 0.75;
}

/* 「今日额度已用完」是一句整话，不要中间那点字距 */
.ik-quota.is-full .ik-quota__prefix {
  margin-right: 0;
}

/* 窄屏标题栏还挤着返回/搜索/删除：去掉迷你条与「今日」前缀，只留数字 */
@media (max-width: 768px) {
  .ik-quota {
    font-size: 11px;
  }

  .ik-quota__track,
  .ik-quota__prefix {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-quota,
  .ik-quota__fill {
    transition: none;
  }
}
</style>
