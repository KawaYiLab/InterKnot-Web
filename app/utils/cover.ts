export const DEFAULT_COVER_ASPECT_RATIO = 643 / 408;
export const MIN_COVER_ASPECT_RATIO = 0.80;

/**
 * 默认占位图（/images/default-cover.webp）的原生宽高比 643:408 ≈ 1.576。
 * fallback 状态的卡片使用这个比例，让占位图完整填满 frame 不被裁剪。
 */
export const FALLBACK_COVER_ASPECT_RATIO = 643 / 408;

/**
 * 列表瀑布流封面比例归一化：
 * - 横图（>1.05）→ 4:3
 * - 方图（0.95~1.05）→ 1:1
 * - 竖图（<0.95）→ 3:4
 * 用于卡片渲染与 masonry 高度估算，配合 object-fit: cover 居中裁剪。
 */
export const NORMALIZED_LANDSCAPE_RATIO = 4 / 3;
export const NORMALIZED_PORTRAIT_RATIO = 3 / 4;
export const NORMALIZED_SQUARE_RATIO = 1;

export function normalizeCoverAspectRatio(rawRatio: number): number {
  if (!Number.isFinite(rawRatio) || rawRatio <= 0) return NORMALIZED_LANDSCAPE_RATIO;
  if (rawRatio >= 1.05) return NORMALIZED_LANDSCAPE_RATIO;
  if (rawRatio <= 0.95) return NORMALIZED_PORTRAIT_RATIO;
  return NORMALIZED_SQUARE_RATIO;
}

/**
 * 原始封面比例（用于详情页等需要完整呈现的场景）。
 * 仅做最小比例兜底，避免极端窄长图破坏布局。
 */
export function getCoverAspectRatio(
  coverWidth: number | undefined,
  coverHeight: number | undefined,
): number {
  if (
    typeof coverWidth === "number" &&
    typeof coverHeight === "number" &&
    Number.isFinite(coverWidth) &&
    Number.isFinite(coverHeight) &&
    coverWidth > 0 &&
    coverHeight > 0
  ) {
    return Math.max(coverWidth / coverHeight, MIN_COVER_ASPECT_RATIO);
  }

  return DEFAULT_COVER_ASPECT_RATIO;
}

/**
 * 列表卡片封面比例（归一化为 4:3 / 1:1 / 3:4 三档）。
 */
export function getNormalizedCoverAspectRatio(
  coverWidth: number | undefined,
  coverHeight: number | undefined,
): number {
  if (
    typeof coverWidth === "number" &&
    typeof coverHeight === "number" &&
    Number.isFinite(coverWidth) &&
    Number.isFinite(coverHeight) &&
    coverWidth > 0 &&
    coverHeight > 0
  ) {
    return normalizeCoverAspectRatio(coverWidth / coverHeight);
  }
  return NORMALIZED_LANDSCAPE_RATIO;
}
