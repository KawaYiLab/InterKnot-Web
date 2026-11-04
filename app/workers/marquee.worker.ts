/// <reference lib="webworker" />
/**
 * 全局背景跑马灯的绘制线程。
 *
 * 画布通过 transferControlToOffscreen 交给这里，绘制结果由 Worker 直接提交给
 * 合成器：主线程不再每帧执行绘制、也不再为画布提交帧，滚动、挂载卡片和
 * 处理输入时不会和跑马灯抢主线程。
 */
import {
  MARQUEE_FRAME_MS,
  drawMarquee,
  type MarqueeGeometry,
  type MarqueeWorkerMessage,
} from "../utils/marquee-canvas";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const hasRaf = typeof scope.requestAnimationFrame === "function";

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let tile: ImageBitmap | null = null;
let geometry: MarqueeGeometry | null = null;
let running = false;
let frame: number | null = null;
let elapsed = 0, lastTime = 0, lastPaint = 0;

function draw() {
  if (ctx && tile && geometry) drawMarquee(ctx, tile, geometry, elapsed);
}

function schedule() {
  frame = hasRaf
    ? scope.requestAnimationFrame(tick)
    : (setTimeout(() => tick(performance.now()), MARQUEE_FRAME_MS) as unknown as number);
}

function stop() {
  if (frame === null) return;
  if (hasRaf) scope.cancelAnimationFrame(frame);
  else clearTimeout(frame);
  frame = null;
}

function tick(now: number) {
  elapsed += now - lastTime;
  lastTime = now;
  if (now - lastPaint >= MARQUEE_FRAME_MS) {
    lastPaint = now - (now - lastPaint) % MARQUEE_FRAME_MS;
    draw();
  }
  schedule();
}

function sync() {
  stop();
  if (!running || !tile || !geometry) return;
  lastTime = performance.now();
  lastPaint = lastTime;
  schedule();
}

scope.onmessage = (event: MessageEvent<MarqueeWorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      canvas = message.canvas;
      ctx = canvas.getContext("2d");
      break;
    case "geometry": {
      geometry = message.geometry;
      if (canvas) {
        const w = Math.ceil(geometry.width * geometry.dpr);
        const h = Math.ceil(geometry.height * geometry.dpr);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
      }
      draw();
      sync();
      break;
    }
    case "tile":
      tile?.close();
      tile = message.tile;
      draw();
      sync();
      break;
    case "running":
      running = message.running;
      sync();
      break;
    case "dispose":
      stop();
      tile?.close();
      tile = null;
      scope.close();
      break;
  }
};
