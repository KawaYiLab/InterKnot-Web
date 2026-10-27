<script setup lang="ts">
import { computed } from "vue";

/**
 * 敲敲当日额度：标题栏里模型选择器右侧的 5 格电量 + 剩余百分比。
 *
 * 这条的活儿只有一件 —— 在被拒之前让人看见自己快撞墙了。所以按「够用就好」排版：
 * - 正常态：电量格 + 剩余百分比。「今日」「额度」这些字不进标题栏（那儿还挤着
 *   返回/搜索/删除），全交给 hover 出来的 title；
 * - 用到 80% 起转橙、打满转红：颜色是不占地方的提示通道；
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

/** 标题栏上显示剩余（像游戏里的「剩余邀约」），已用多少由 title 说清 */
const remaining = computed(() => Math.max(0, Math.min(100, 100 - props.percent)));
const label = computed(() => (props.exhausted ? "额度已用完" : `剩余 ${remaining.value}%`));

/** 5 格电量：每格 20%，有剩就亮 */
const CELLS = 5;
const litCells = computed(() => (props.exhausted ? 0 : Math.ceil(remaining.value / (100 / CELLS))));

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

/** 用到 80% 起转橙、打满转红：颜色本身就是提示，不用额外文案 */
const level = computed(() => {
  if (props.exhausted) return "is-full";
  if (props.percent >= 80) return "is-warn";
  return "";
});
</script>

<template>
  <div class="ik-quota" :class="level" :title="detail" :aria-label="detail">
    <span class="ik-quota__cells" aria-hidden="true">
      <span
        v-for="i in CELLS"
        :key="i"
        class="ik-quota__cell"
        :class="{ 'is-lit': i <= litCells }"
      />
    </span>
    <span class="ik-quota__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.ik-quota {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
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

/* 5 格电量：亮格黄色，快用完转红 */
.ik-quota__cells {
  flex-shrink: 0;
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1.5px solid #3a3a3a;
  border-radius: 4px;
}

.ik-quota__cell {
  width: 5px;
  height: 9px;
  border-radius: 1px;
  background: #222;
  transition: background 240ms ease, box-shadow 240ms ease;
}

.ik-quota__cell.is-lit {
  background: #fbfe00;
}

.ik-quota.is-warn .ik-quota__cell.is-lit {
  background: #ff9a3d;
}

.ik-quota.is-full .ik-quota__cells {
  border-color: #ff5a5a;
}

.ik-quota.is-warn {
  color: #ffb36b;
}

.ik-quota.is-full {
  color: #ff8a8a;
}

.ik-quota__label {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 等宽数字 + 固定最小宽右对齐：0% 一路涨到 100% 都不会把右边的按钮推着走 */
  min-width: 5em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

/* 窄屏标题栏还挤着返回/搜索/删除：去掉迷你条，只留百分比 */
@media (max-width: 768px) {
  .ik-quota {
    font-size: 11px;
  }

  .ik-quota__cells {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-quota,
  .ik-quota__cell {
    transition: none;
  }
}
</style>
