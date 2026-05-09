export interface SkeletonItem {
  id: string;
  coverAspectRatio: number;
  authorWidth: string;
  titleWidth: string;
}

type SkeletonLayout = Omit<SkeletonItem, "id">;

export function calculateSkeletonCount(width: number, isClient: boolean): number {
  if (!isClient) return 6;
  if (width >= 1400) return 18;
  if (width >= 1024) return 12;
  if (width >= 768) return 9;
  return 6;
}

// 与 utils/cover.ts 中的归一化比例保持一致（4:3 / 1:1 / 3:4）
const RATIO_LANDSCAPE = 4 / 3;
const RATIO_SQUARE = 1;
const RATIO_PORTRAIT = 3 / 4;

const DEFAULT_SKELETON_LAYOUT: SkeletonLayout = {
  coverAspectRatio: RATIO_LANDSCAPE,
  authorWidth: "62%",
  titleWidth: "86%",
};

// 三种 cover 比例分布尽量均衡（约 LANDSCAPE 44% / SQUARE 28% / PORTRAIT 28%），
// 避免视觉上 LANDSCAPE 一边倒导致的重复感。
const SKELETON_LAYOUTS: SkeletonLayout[] = [
  DEFAULT_SKELETON_LAYOUT, // LANDSCAPE
  { coverAspectRatio: RATIO_PORTRAIT, authorWidth: "70%", titleWidth: "64%" },
  { coverAspectRatio: RATIO_SQUARE, authorWidth: "48%", titleWidth: "72%" },
  { coverAspectRatio: RATIO_LANDSCAPE, authorWidth: "56%", titleWidth: "90%" },
  { coverAspectRatio: RATIO_PORTRAIT, authorWidth: "58%", titleWidth: "82%" },
  { coverAspectRatio: RATIO_LANDSCAPE, authorWidth: "52%", titleWidth: "78%" },
  { coverAspectRatio: RATIO_SQUARE, authorWidth: "66%", titleWidth: "94%" },
];

// 卡片外层 padding（--ik-discussion-card-padding: 4px），封面实际宽度 = itemWidth - 2*padding
const SKELETON_CARD_PADDING = 4;

// 骨架卡片固定部分高度（不含封面）：
//   card padding top+bottom(8) + body padding-bottom(12) + author-row min-height(32)
// + body gap(8) + title placeholder(ceil(17*1.25)=22) = 82px
// 必须严格匹配 DiscussionCardSkeleton 的实际 DOM 渲染高度，否则 VirtualMasonry
// 在 measureItems=false 模式下会用估算值做 transform 定位，产生与实际卡片高度不一致的间隙。
const SKELETON_FIXED_HEIGHT = 82;

export function estimateSkeletonHeight(item: SkeletonItem, itemWidth: number): number {
  const innerWidth = itemWidth - SKELETON_CARD_PADDING * 2;
  const coverHeight = innerWidth / item.coverAspectRatio;
  return Math.ceil(coverHeight + SKELETON_FIXED_HEIGHT);
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
