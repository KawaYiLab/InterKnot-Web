<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { brandFontsReady } from "~/utils/brand-fonts";

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false });
const canvasRef = ref<HTMLCanvasElement | null>(null);
const WORD = "INTERKNOT";
const FRAME_MS = 1000 / 30;
const SCROLL_IDLE_MS = 150;
let context: CanvasRenderingContext2D | null = null;
let tile: HTMLCanvasElement | null = null;
let observer: ResizeObserver | null = null;
let pageObserver: MutationObserver | null = null;
let motion: MediaQueryList | null = null;
let frame: number | null = null;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;
let width = 0, height = 0, dpr = 1, fontSize = 0, wordWidth = 0, wordStep = 0;
let elapsed = 0, lastTime = 0, lastPaint = 0;
let scrolling = false;
let pagePaused = false;

function bakeWord() {
  tile = document.createElement("canvas");
  const ctx = tile.getContext("2d");
  if (!ctx) { tile = null; return; }
  const font = `800 ${fontSize}px ${getComputedStyle(document.body).fontFamily || '"InterKnot Sans", sans-serif'}`;
  const spacing = -0.04 * fontSize;
  ctx.font = font;
  // Bake each glyph once, including tracking, on browsers without canvas tracking.
  const nativeSpacing = typeof ctx.letterSpacing === "string";
  if (nativeSpacing) ctx.letterSpacing = `${spacing}px`;
  const metrics = ctx.measureText(WORD);
  wordWidth = nativeSpacing ? metrics.width : metrics.width + spacing * WORD.length;
  wordStep = wordWidth + ctx.measureText(" ").width + (nativeSpacing ? 0 : spacing);
  const rowHeight = 0.74 * fontSize;
  // Negative tracking reduces advance width, but the last T still paints past it.
  tile.width = Math.ceil(Math.max(wordWidth, metrics.actualBoundingBoxRight) * dpr);
  tile.height = Math.ceil(rowHeight * dpr);
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
}

function draw() {
  if (!context || !tile || !width || !height) return;
  const ctx = context;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  // Rotation is baked inside a viewport-sized bitmap, never a giant CSS layer.
  ctx.translate(width / 2, height * 0.55);
  ctx.rotate(-Math.PI / 12);
  ctx.globalAlpha = 0.07;
  const rowHeight = 0.74 * fontSize;
  const gap = 0.006 * fontSize;
  const period = 3 * wordStep + 0.15 * fontSize;
  const left = -1.3 * width;
  ctx.beginPath(); ctx.rect(left, -1.3 * height, 2.6 * width, 2.6 * height); ctx.clip();
  for (let row = 0; row < 3; row++) {
    const top = -(3 * rowHeight + 2 * gap) / 2 + row * (rowHeight + gap);
    const phase = ((elapsed / (row === 1 ? 480000 : 400000)) + (row === 2 ? 0.35 : 0)) % 1;
    const offset = (row === 1 ? -phase : phase) * period;
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, 2.6 * width, rowHeight); ctx.clip();
    for (let group = left + offset - period; group < -left; group += period) {
      for (let word = 0; word < 3; word++) {
        const x = group + word * wordStep;
        if (x + tile.width / dpr >= left && x <= -left) {
          ctx.drawImage(tile, x, top, tile.width / dpr, tile.height / dpr);
        }
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

function stop() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
}

function tick(now: number) {
  elapsed += now - lastTime;
  lastTime = now;
  if (now - lastPaint >= FRAME_MS) {
    lastPaint = now - (now - lastPaint) % FRAME_MS;
    draw();
  }
  frame = requestAnimationFrame(tick);
}

function syncAnimation() {
  stop();
  if (!tile || props.paused || pagePaused || scrolling || document.hidden || motion?.matches) return;
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
  if (!canvasRef.value || !context || !nextWidth || !nextHeight) return;
  const nextDpr = window.devicePixelRatio || 1;
  const nextFontSize = Math.max(360, Math.min(640, window.innerWidth * 0.48));
  const rebuild = !tile || fontSize !== nextFontSize || dpr !== nextDpr;
  const resized = width !== nextWidth || height !== nextHeight || dpr !== nextDpr;
  width = nextWidth; height = nextHeight; dpr = nextDpr; fontSize = nextFontSize;
  if (resized) {
    canvasRef.value.width = Math.ceil(width * dpr);
    canvasRef.value.height = Math.ceil(height * dpr);
  }
  if (!brandFontsReady.value) return;
  if (rebuild) bakeWord();
  if (resized || rebuild) draw();
  syncAnimation();
}

function resizeViewport() {
  const rect = canvasRef.value?.getBoundingClientRect();
  if (rect) resize(rect.width, rect.height);
}

function onScroll() {
  scrolling = true;
  stop();
  if (scrollTimer !== null) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    scrollTimer = null;
    scrolling = false;
    syncAnimation();
  }, SCROLL_IDLE_MS);
}

watch(() => props.paused, syncAnimation);
watch(brandFontsReady, () => { if (context) resizeViewport(); });
onMounted(() => {
  context = canvasRef.value?.getContext("2d") ?? null;
  if (!context) return;
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
  observer.observe(canvasRef.value!);
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
  tile = null;
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
