export const DEFAULT_COVER_ASPECT_RATIO = 643 / 408;
export const MIN_COVER_ASPECT_RATIO = 0.80;

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
