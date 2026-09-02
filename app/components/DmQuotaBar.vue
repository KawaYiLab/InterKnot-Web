<script setup lang="ts">
import { computed } from "vue";

/**
 * 敲敲当日额度：标题栏里模型选择器右侧的一条内联迷你进度条。
 *
 * 这条的活儿只有一件 —— 在被拒之前让人看见自己快撞墙了。所以按「够用就好」排版：
 * - 正常态：迷你条 + 一个裸百分比。「今日」「额度」这些字不进标题栏（那儿还挤着
 *   返回/搜索/删除），全交给 hover 出来的 title；
 * - 80% 起转黄、打满转红：颜色是不占地方的提示通道；
 * - 只有打满时换成一句「额度已用完」—— 此刻用户要的是「AI 不会回了」这个事实，
 *   不是数字。也只有这一次会撑宽，而它本就该被注意到。
 *
 * 额度按 token 扣（真实 token × 该模型的倍率），绝对数不下发也不显示：换一个倍率
 * 不同的模型，同一句话吃掉的 token 就变了，百分比不会看着莫名其妙。
 */
const props = defineProps<{
  percent: number;
  exhausted: boolean;
  /** 下一次日切（本地 04:00）的 ISO 时刻 */
  resetAt: string;
}>();

/** 是「已用」还是「剩余」由 title 说清；这里只留数字，省下的宽度还给标题栏的按钮 */
const label = computed(() => (props.exhausted ? "额度已用完" : `${props.percent}%`));

const resetLabel = computed(() => {
  const t = new Date(props.resetAt);
  if (Number.isNaN(t.getTime())) return "";
  // resetAt 是绝对时刻，换成本地时间显示才是用户能对上的那个「04:00」
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} 重置`;
});

const detail = computed(() => {
  const head = props.exhausted ? "今日额度已用完" : `今日额度已用 ${props.percent}%`;
  return resetLabel.value ? `${head} · ${resetLabel.value}` : head;
});

/** 80% 起转黄、打满转红：颜色本身就是提示，不用额外文案 */
const level = computed(() => {
  if (props.exhausted) return "is-full";
  if (props.percent >= 80) return "is-warn";
  return "";
});
</script>

<template>
  <div class="ik-quota" :class="level" :title="detail" :aria-label="detail">
    <span class="ik-quota__track">
      <span class="ik-quota__fill" :style="{ width: `${Math.max(percent, 4)}%` }" />
    </span>
    <span class="ik-quota__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.ik-quota {
  display: inline-flex;
  align-items: center;
  /* 组内间距：迷你条与百分比是一个整体，比下面分隔线两侧的 12px 明显窄 */
  gap: 6px;
  min-width: 0;
  /* 与 ::before 的 margin 一起把「分隔线两侧」和「百分比到右邻按钮」都凑成 12px，
     算式见 ::before —— 都基于父级 .ik-knock__main-header 的 8px gap */
  padding: 0 4px;
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

/*
 * 与左侧模型选择器之间的细分隔。这条线属于额度条（不是标题栏的),
 * 好处是它跟着额度条一起出现/消失；坏处是两侧留白得手算 —— 它是 flex 首项，
 * 所以右侧留白 = 这里的 margin + .ik-quota 的 gap，左侧 = 父级 header 的 gap + 自身 padding：
 *   左 = 8(header gap) + 4(padding) = 12px
 *   右 = 6(margin)     + 6(gap)     = 12px
 * 两侧相等且宽于组内的 6px，线才读作「两组之间的边界」而不是又一个部件。
 */
.ik-quota::before {
  content: "";
  flex-shrink: 0;
  width: 1px;
  height: 12px;
  margin-right: 12px;
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
  /* 等宽数字 + 固定最小宽右对齐：0% 一路涨到 100% 都不会把右边的按钮推着走 */
  min-width: 2.5em;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

/* 窄屏标题栏还挤着返回/搜索/删除：去掉迷你条，只留百分比 */
@media (max-width: 768px) {
  .ik-quota {
    font-size: 11px;
  }

  .ik-quota__track {
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
