<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";

/**
 * 移植自 Inspira UI「Placeholders And Vanish Input」的消散效果：
 * 把输入框里的字画到 canvas 上取像素，再从右往左碎成粒子散掉。
 * 叠在输入框所在的定位容器里，play() 传入输入框即可；输入框本身照常清空。
 */
interface Particle {
  x: number;
  y: number;
  r: number;
  color: string;
}

const canvasRef = ref<HTMLCanvasElement | null>(null);
let frame: number | null = null;

const stop = () => {
  if (frame != null) cancelAnimationFrame(frame);
  frame = null;
};

const play = (el: HTMLTextAreaElement | HTMLInputElement) => {
  const canvas = canvasRef.value;
  const text = el.value;
  if (!canvas || !text.trim()) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  stop();

  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.left = `${el.offsetLeft}px`;
  canvas.style.top = `${el.offsetTop}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const style = getComputedStyle(el);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  ctx.scale(dpr, dpr);
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.fillStyle = style.color;
  ctx.textBaseline = "top";
  const left = parseFloat(style.paddingLeft) || 0;
  const top = (parseFloat(style.paddingTop) || 0) + (lineHeight - parseFloat(style.fontSize)) / 2 - el.scrollTop;
  text.split("\n").forEach((line, i) => ctx.fillText(line, left, top + i * lineHeight));

  const { data, width: w, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let particles: Particle[] = [];
  let maxX = 0;
  // 隔一个像素取一个点，长消息也不会卡
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (data[i + 3]! < 40) continue;
      particles.push({ x: x / dpr, y: y / dpr, r: 1, color: `rgba(${data[i]}, ${data[i + 1]}, ${data[i + 2]}, ${data[i + 3]! / 255})` });
      if (x / dpr > maxX) maxX = x / dpr;
    }
  }

  let edge = maxX;
  const step = () => {
    particles = particles.filter((p) => {
      if (p.x < edge) return true;
      p.x += Math.random() > 0.5 ? 1 : -1;
      p.y += Math.random() > 0.5 ? 1 : -1;
      p.r -= 0.04 + 0.06 * Math.random();
      return p.r > 0;
    });
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    }
    edge -= 8;
    frame = particles.length ? requestAnimationFrame(step) : null;
  };
  frame = requestAnimationFrame(step);
};

onBeforeUnmount(stop);

defineExpose({ play });
</script>

<template>
  <canvas ref="canvasRef" class="ik-vanish-canvas" aria-hidden="true" />
</template>

<style scoped>
.ik-vanish-canvas {
  position: absolute;
  pointer-events: none;
}
</style>
