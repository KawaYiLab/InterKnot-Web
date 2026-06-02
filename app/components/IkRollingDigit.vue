<script setup lang="ts">
/**
 * IkRollingDigit — 滚轮式数字组件（Rolling digits / Split-flap 风格）
 *
 * 接收一个整数值，将其拆分为逐位数字，每位以垂直条带 + translateY 实现滚轮切换动画。
 * 适用于点赞数、投币数等需要视觉反馈的计数场景。
 *
 * Props:
 *   value     - 要显示的数字（负数取绝对值）
 *   fallback  - value ≤ 0 时显示的回退文本（如 "点赞"、"投币"），不提供则始终显示数字
 *   minDigits - 最少显示位数（不足位用低透明度占位），默认 1
 *   duration  - 滚轮动画时长(ms)，默认 600
 *   padEnd    - true 时右补零（有效数字在左，如机械计数器），false 时左补零（默认，如数字显示）
 */

const props = withDefaults(
  defineProps<{
    value: number;
    fallback?: string;
    minDigits?: number;
    duration?: number;
    padEnd?: boolean;
  }>(),
  {
    minDigits: 1,
    duration: 600,
    padEnd: false,
  },
);

const slots = computed(() => {
  const n = Math.abs(props.value);
  const str = String(n);
  const totalLength = Math.max(props.minDigits, str.length);
  const activeLength = str.length;
  const fullStr = props.padEnd ? str.padEnd(totalLength, "0") : str.padStart(totalLength, "0");

  return Array.from(fullStr).map((char, i) => {
    const digit = parseInt(char, 10);
    return {
      digit: isNaN(digit) ? 0 : digit,
      isActive: props.padEnd ? i < activeLength : i >= totalLength - activeLength,
    };
  });
});
</script>

<template>
  <span v-if="value <= 0 && fallback" class="ik-rolling-digit ik-rolling-digit--fallback">{{ fallback }}</span>
  <span v-else class="ik-rolling-digit">
    <span
      v-for="(slot, i) in slots"
      :key="i"
      class="ik-rolling-digit__slot"
      :class="{ 'is-active': slot.isActive }"
    >
      <span
        class="ik-rolling-digit__strip"
        :style="{
          transform: `translateY(-${slot.digit * 10}%)`,
          transitionDuration: `${duration}ms`,
        }"
      >
        <span v-for="num in 10" :key="num - 1" class="ik-rolling-digit__num">{{ num - 1 }}</span>
      </span>
    </span>
  </span>
</template>

<style>
.ik-rolling-digit {
  display: inline-flex;
  align-items: center;
  font-feature-settings: "tnum";
  line-height: inherit;
}

.ik-rolling-digit__slot {
  position: relative;
  height: 1em;
  line-height: 1;
  width: 1ch;
  overflow: hidden;
  display: inline-block;
  color: rgba(255, 255, 255, 0.22);
  transition: color 0.15s ease;
}

.ik-rolling-digit__slot.is-active {
  color: inherit;
}

.ik-rolling-digit__strip {
  display: flex;
  flex-direction: column;
  transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ik-rolling-digit__num {
  height: 1em;
  line-height: 1;
  display: block;
  text-align: center;
  color: inherit;
}
</style>
