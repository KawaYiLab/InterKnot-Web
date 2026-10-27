<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

/**
 * 移植自 Inspira UI「Hyper Text」：文字先乱码，再从左到右逐字解码成原文。
 * 挂载时播一次，悬停再播；读屏只读原文。
 */
const props = withDefaults(
  defineProps<{
    text: string;
    /** 整段解码时长（ms） */
    duration?: number;
    /** 乱码字符表 */
    charset?: string;
  }>(),
  {
    duration: 800,
    charset: "abcdefghijklmnopqrstuvwxyz#%&@$",
  },
);

const display = ref(props.text);
let timer: ReturnType<typeof setInterval> | null = null;

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

const play = () => {
  if (timer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target = props.text;
  const steps = Math.max(1, target.length);
  const interval = props.duration / (steps * 3);
  let frame = 0;
  timer = setInterval(() => {
    frame++;
    const settled = frame / 3;
    display.value = [...target]
      .map((ch, i) =>
        ch === " " || i < settled ? ch : props.charset[Math.floor(Math.random() * props.charset.length)],
      )
      .join("");
    if (settled >= steps) {
      stop();
      display.value = target;
    }
  }, interval);
};

onMounted(play);
onBeforeUnmount(stop);
</script>

<template>
  <span class="ik-hyper-text" @mouseenter="play">
    <span class="ik-hyper-text__label">{{ text }}</span>
    <span aria-hidden="true">{{ display }}</span>
  </span>
</template>

<style scoped>
/* 读屏读这份原文，乱码那份对读屏隐藏 */
.ik-hyper-text__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
