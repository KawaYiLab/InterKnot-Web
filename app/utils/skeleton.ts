export interface SkeletonItem {
  id: string;
  coverAspectRatio: number;
  authorWidth: string;
  titleWidth: string;
  excerptWidth: string;
}

type SkeletonLayout = Omit<SkeletonItem, "id">;

export function calculateSkeletonCount(width: number, isClient: boolean): number {
  if (!isClient) return 6;
  if (width >= 1400) return 18;
  if (width >= 1024) return 12;
  if (width >= 768) return 9;
  return 6;
}

const DEFAULT_SKELETON_LAYOUT: SkeletonLayout = {
  coverAspectRatio: 1.58,
  authorWidth: "62%",
  titleWidth: "86%",
  excerptWidth: "78%",
};

const SKELETON_LAYOUTS: SkeletonLayout[] = [
  DEFAULT_SKELETON_LAYOUT,
  { coverAspectRatio: 1.58, authorWidth: "62%", titleWidth: "86%", excerptWidth: "78%" },
  { coverAspectRatio: 1.12, authorWidth: "48%", titleWidth: "72%", excerptWidth: "92%" },
  { coverAspectRatio: 1.36, authorWidth: "56%", titleWidth: "90%", excerptWidth: "68%" },
  { coverAspectRatio: 0.92, authorWidth: "70%", titleWidth: "64%", excerptWidth: "84%" },
  { coverAspectRatio: 1.78, authorWidth: "52%", titleWidth: "78%", excerptWidth: "58%" },
  { coverAspectRatio: 1.24, authorWidth: "66%", titleWidth: "94%", excerptWidth: "74%" },
];

const SKELETON_FIXED_HEIGHT = 83;
const SKELETON_EXCERPT_HEIGHT = 42;

export function estimateSkeletonHeight(item: SkeletonItem, itemWidth: number): number {
  const coverHeight = itemWidth / item.coverAspectRatio;
  return Math.ceil(coverHeight + SKELETON_FIXED_HEIGHT + SKELETON_EXCERPT_HEIGHT);
}

export function generateSkeletons(count: number): SkeletonItem[] {
  const normalizedCount = Number.isFinite(count) ? Math.trunc(count) : 6;
  const safeCount = Math.max(6, Math.min(18, normalizedCount));
  return Array.from({ length: safeCount }, (_, i) => {
    const layout = SKELETON_LAYOUTS[i % SKELETON_LAYOUTS.length] || DEFAULT_SKELETON_LAYOUT;
    return {
      id: `skeleton-${i}`,
      ...layout,
    };
  });
}
