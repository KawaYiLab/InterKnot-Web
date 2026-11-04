/**
 * 全局背景跑马灯的绘制逻辑，主线程兜底与 Worker 共用。
 *
 * 文字由主线程烘焙成一张单词位图（字体只在 document 里可用），这里只做
 * 旋转、平移和 drawImage，不依赖 DOM，可以在 Worker 里运行。
 */

export const MARQUEE_FRAME_MS = 1000 / 30;

/** 单词位图：HTMLCanvasElement（主线程）或 ImageBitmap（Worker）。 */
export type MarqueeTile = CanvasImageSource & { width: number; height: number };

export interface MarqueeGeometry {
  width: number;
  height: number;
  dpr: number;
  fontSize: number;
  wordStep: number;
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawMarquee(
  ctx: Context2D,
  tile: MarqueeTile,
  { width, height, dpr, fontSize, wordStep }: MarqueeGeometry,
  elapsed: number,
) {
  if (!width || !height) return;
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
  const tileWidth = tile.width / dpr;
  const tileHeight = tile.height / dpr;
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
        if (x + tileWidth >= left && x <= -left) {
          ctx.drawImage(tile, x, top, tileWidth, tileHeight);
        }
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/** 主线程 → Worker 的消息。 */
export type MarqueeWorkerMessage =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "geometry"; geometry: MarqueeGeometry }
  | { type: "tile"; tile: ImageBitmap }
  | { type: "running"; running: boolean }
  | { type: "dispose" };
