<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

/**
 * 移植自 Inspira UI「Flickering Grid」：一层随机明灭的方点阵（canvas 绘制）。
 * 只在可见时跑动画（IntersectionObserver），尺寸跟随父元素（ResizeObserver）；
 * 系统开了「减少动态效果」时只画一帧静态点阵。
 */
const props = withDefaults(
  defineProps<{
    squareSize?: number;
    gridGap?: number;
    /** 每个方点每秒重新取亮度的概率 */
    flickerChance?: number;
    /** r,g,b */
    color?: string;
    maxOpacity?: number;
  }>(),
  {
    squareSize: 3,
    gridGap: 6,
    flickerChance: 0.3,
    color: "251, 254, 0",
    maxOpacity: 0.25,
  },
);

const rootRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

let cols = 0;
let rows = 0;
let dpr = 1;
let squares = new Float32Array(0);
let frame: number | null = null;
let lastTime = 0;
let visible = false;
let resizeObserver: ResizeObserver | null = null;
let intersectionObserver: IntersectionObserver | null = null;
const reducedMotion = import.meta.client && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const setup = () => {
  const root = rootRef.value;
  const canvas = canvasRef.value;
  if (!root || !canvas) return;
  dpr = window.devicePixelRatio || 1;
  const { clientWidth: width, clientHeight: height } = root;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const cell = props.squareSize + props.gridGap;
  cols = Math.ceil(width / cell);
  rows = Math.ceil(height / cell);
  squares = new Float32Array(cols * rows);
  for (let i = 0; i < squares.length; i++) squares[i] = Math.random() * props.maxOpacity;
  draw();
};

const draw = () => {
  const ctx = canvasRef.value?.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const cell = (props.squareSize + props.gridGap) * dpr;
  const size = props.squareSize * dpr;
  for (let i = 0; i < squares.length; i++) {
    ctx.fillStyle = `rgba(${props.color}, ${squares[i]})`;
    ctx.fillRect((i % cols) * cell, Math.floor(i / cols) * cell, size, size);
  }
};

watch(() => props.color, draw);

const FRAME_INTERVAL_MS = 50;

const tick = (time: number) => {
  frame = null;
  if (!visible) return;
  if (time - lastTime >= FRAME_INTERVAL_MS) {
    const delta = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    const chance = props.flickerChance * delta;
    const ctx = canvasRef.value?.getContext("2d");
    if (ctx) {
      const cell = (props.squareSize + props.gridGap) * dpr;
      const size = props.squareSize * dpr;
      for (let i = 0; i < squares.length; i++) {
        if (Math.random() >= chance) continue;
        squares[i] = Math.random() * props.maxOpacity;
        const x = (i % cols) * cell;
        const y = Math.floor(i / cols) * cell;
        // 擦除完整像素范围，避免非整数 DPR 下留下半透明边缘。
        ctx.clearRect(
          Math.floor(x), Math.floor(y),
          Math.ceil(x + size) - Math.floor(x), Math.ceil(y + size) - Math.floor(y),
        );
        ctx.fillStyle = `rgba(${props.color}, ${squares[i]})`;
        ctx.fillRect(x, y, size, size);
      }
    }
  }
  frame = requestAnimationFrame(tick);
};

const start = () => {
  if (reducedMotion || frame != null) return;
  lastTime = performance.now();
  frame = requestAnimationFrame(tick);
};

onMounted(() => {
  setup();
  if (!rootRef.value) return;
  resizeObserver = new ResizeObserver(setup);
  resizeObserver.observe(rootRef.value);
  intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    if (visible) start();
  });
  intersectionObserver.observe(rootRef.value);
});

onBeforeUnmount(() => {
  visible = false;
  if (frame != null) cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  intersectionObserver?.disconnect();
});
</script>

<template>
  <div ref="rootRef" class="ik-flickering-grid" aria-hidden="true">
    <canvas ref="canvasRef" class="ik-flickering-grid__canvas" />
  </div>
</template>

<style scoped>
.ik-flickering-grid {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.ik-flickering-grid__canvas {
  display: block;
}
</style>
