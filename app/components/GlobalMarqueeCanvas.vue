<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { brandFontsReady } from "~/utils/brand-fonts";
import {
  MARQUEE_FRAME_MS,
  drawMarquee,
  type MarqueeGeometry,
  type MarqueeWorkerMessage,
} from "~/utils/marquee-canvas";

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false });
const canvasRef = ref<HTMLCanvasElement | null>(null);
const WORD = "INTERKNOT";
const SCROLL_IDLE_MS = 150;
// 支持 OffscreenCanvas 时由 Worker 绘制，主线程只负责烘焙单词位图和转发状态；
// 否则退回主线程 rAF 绘制。
let worker: Worker | null = null;
let workerRunning = false;
let tileVersion = 0;
let context: CanvasRenderingContext2D | null = null;
let tile: HTMLCanvasElement | null = null;
let hasTile = false;
let observer: ResizeObserver | null = null;
let pageObserver: MutationObserver | null = null;
let motion: MediaQueryList | null = null;
let frame: number | null = null;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;
const geometry: MarqueeGeometry = { width: 0, height: 0, dpr: 1, fontSize: 0, wordStep: 0 };
let elapsed = 0, lastTime = 0, lastPaint = 0;
let scrolling = false;
let pagePaused = false;

function post(message: MarqueeWorkerMessage, transfer: Transferable[] = []) {
  worker?.postMessage(message, transfer);
}

function bakeWord() {
  const { fontSize, dpr } = geometry;
  const baked = document.createElement("canvas");
  const ctx = baked.getContext("2d");
  if (!ctx) { tile = null; hasTile = false; return; }
  const font = `800 ${fontSize}px ${getComputedStyle(document.body).fontFamily || '"InterKnot Sans", sans-serif'}`;
  const spacing = -0.04 * fontSize;
  ctx.font = font;
  // Bake each glyph once, including tracking, on browsers without canvas tracking.
  const nativeSpacing = typeof ctx.letterSpacing === "string";
  if (nativeSpacing) ctx.letterSpacing = `${spacing}px`;
  const metrics = ctx.measureText(WORD);
  const wordWidth = nativeSpacing ? metrics.width : metrics.width + spacing * WORD.length;
  geometry.wordStep = wordWidth + ctx.measureText(" ").width + (nativeSpacing ? 0 : spacing);
  const rowHeight = 0.74 * fontSize;
  // Negative tracking reduces advance width, but the last T still paints past it.
  baked.width = Math.ceil(Math.max(wordWidth, metrics.actualBoundingBoxRight) * dpr);
  baked.height = Math.ceil(rowHeight * dpr);
  ctx.scale(dpr, dpr);
  ctx.font = font;
  if (nativeSpacing) ctx.letterSpacing = `${spacing}px`;
  ctx.fillStyle = "#fff";
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  const baseline = (rowHeight - ascent - descent) / 2 + ascent;
  if (nativeSpacing) ctx.fillText(WORD, 0, baseline);
  else {
    let x = 0;
    for (const char of WORD) {
      ctx.fillText(char, x, baseline);
      x += ctx.measureText(char).width + spacing;
    }
  }
  hasTile = true;
  if (!worker) { tile = baked; return; }
  // 位图交给 Worker 后主线程不再持有；版本号丢弃乱序返回的旧位图。
  const version = ++tileVersion;
  void createImageBitmap(baked).then((bitmap) => {
    if (!worker || version !== tileVersion) { bitmap.close(); return; }
    post({ type: "tile", tile: bitmap }, [bitmap]);
  }, () => undefined).finally(() => {
    baked.width = 0;
    baked.height = 0;
  });
}

function draw() {
  if (context && tile) drawMarquee(context, tile, geometry, elapsed);
}

function stop() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
}

function tick(now: number) {
  elapsed += now - lastTime;
  lastTime = now;
  if (now - lastPaint >= MARQUEE_FRAME_MS) {
    lastPaint = now - (now - lastPaint) % MARQUEE_FRAME_MS;
    draw();
  }
  frame = requestAnimationFrame(tick);
}

function syncAnimation() {
  const running = hasTile && !props.paused && !pagePaused && !scrolling && !document.hidden && !motion?.matches;
  if (worker) {
    if (running !== workerRunning) {
      workerRunning = running;
      post({ type: "running", running });
    }
    return;
  }
  stop();
  if (!running) return;
  lastTime = performance.now();
  lastPaint = lastTime;
  frame = requestAnimationFrame(tick);
}

function syncPagePause() {
  const paused = document.body.classList.contains("is-page-blurred") ||
    !!document.body.querySelector(".ik-overlay, .ik-img-overlay");
  if (paused === pagePaused) return;
  pagePaused = paused;
  syncAnimation();
}

function resize(nextWidth: number, nextHeight: number) {
  if (!canvasRef.value || (!context && !worker) || !nextWidth || !nextHeight) return;
  const nextDpr = window.devicePixelRatio || 1;
  const nextFontSize = Math.max(360, Math.min(640, window.innerWidth * 0.48));
  const rebuild = !hasTile || geometry.fontSize !== nextFontSize || geometry.dpr !== nextDpr;
  const resized = geometry.width !== nextWidth || geometry.height !== nextHeight || geometry.dpr !== nextDpr;
  Object.assign(geometry, { width: nextWidth, height: nextHeight, dpr: nextDpr, fontSize: nextFontSize });
  if (resized && context) {
    canvasRef.value.width = Math.ceil(nextWidth * nextDpr);
    canvasRef.value.height = Math.ceil(nextHeight * nextDpr);
  }
  if (!brandFontsReady.value) return;
  if (rebuild) bakeWord();
  if (resized || rebuild) {
    if (worker) post({ type: "geometry", geometry: { ...geometry } });
    else draw();
  }
  syncAnimation();
}

function resizeViewport() {
  const rect = canvasRef.value?.getBoundingClientRect();
  if (rect) resize(rect.width, rect.height);
}

function onScroll() {
  scrolling = true;
  if (worker) syncAnimation();
  else stop();
  if (scrollTimer !== null) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    scrollTimer = null;
    scrolling = false;
    syncAnimation();
  }, SCROLL_IDLE_MS);
}

function startWorker(canvas: HTMLCanvasElement) {
  if (typeof canvas.transferControlToOffscreen !== "function" ||
      typeof Worker === "undefined" || typeof createImageBitmap !== "function") return;
  let next: Worker | null = null;
  try {
    next = new Worker(new URL("../workers/marquee.worker.ts", import.meta.url), { type: "module" });
    const offscreen = canvas.transferControlToOffscreen();
    next.postMessage({ type: "init", canvas: offscreen } satisfies MarqueeWorkerMessage, [offscreen]);
    worker = next;
  } catch {
    next?.terminate();
  }
}

watch(() => props.paused, syncAnimation);
watch(brandFontsReady, () => { if (context || worker) resizeViewport(); });
onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  startWorker(canvas);
  if (!worker) {
    context = canvas.getContext("2d");
    if (!context) return;
  }
  // Overlays teleport to body. Observe only those direct insertions/removals and
  // app.vue's focus class, never the scrolling feed's descendant mutations.
  // Presence includes leaving overlays, matching the existing body:has CSS rule.
  pageObserver = new MutationObserver(syncPagePause);
  pageObserver.observe(document.body, { childList: true, attributes: true, attributeFilter: ["class"] });
  syncPagePause();
  motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", syncAnimation);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", resizeViewport, { passive: true });
  document.addEventListener("visibilitychange", syncAnimation);
  observer = new ResizeObserver(([entry]) => {
    if (entry) resize(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(canvas);
  resizeViewport();
});
onBeforeUnmount(() => {
  stop();
  if (scrollTimer !== null) clearTimeout(scrollTimer);
  observer?.disconnect();
  pageObserver?.disconnect();
  motion?.removeEventListener("change", syncAnimation);
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", resizeViewport);
  document.removeEventListener("visibilitychange", syncAnimation);
  post({ type: "dispose" });
  worker?.terminate();
  worker = null;
  tile = null;
  hasTile = false;
});
</script>

<template>
  <canvas ref="canvasRef" class="ik-global-marquee-canvas" :class="{ 'is-ready': brandFontsReady }" aria-hidden="true" />
</template>

<style scoped>
.ik-global-marquee-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  contain: strict;
}
.is-ready { animation: ik-global-marquee-appear 0.8s ease-out; }
@keyframes ik-global-marquee-appear { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .is-ready { animation: none; } }
</style>
