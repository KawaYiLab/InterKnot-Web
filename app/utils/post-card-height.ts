import type { Post } from "~/types/entities";
import {
  FALLBACK_COVER_ASPECT_RATIO,
  estimateTitleLineCount,
  getNormalizedCoverAspectRatio,
} from "~/utils/cover";
import { toCardExcerpt } from "~/utils/card-excerpt";

// 固定部分（不含封面、title 高度）：
//   card padding(4 * 2) + author-row min-height(32) + body gap(8)
// + body padding-bottom(12) = 60px（PostCard 的 h3 标题 margin 为 0）
// title 高度按真实行数（1 或 2）动态加，与 PostCard 实际渲染严格匹配，
// 避免 ResizeObserver 测量后触发 layout 重排引起的滚动跳动。
const POST_CARD_FIXED_HEIGHT = 60;
// 外框 padding（--ik-post-card-padding）：封面与 body 的实际宽度 = itemWidth - 4 * 2
const POST_CARD_PADDING_X = 8;
const POST_CARD_TITLE_FONT_SIZE = 17;
const POST_CARD_TITLE_FONT_WEIGHT = 600;
const POST_CARD_TITLE_LINE_HEIGHT = 1.25;
// 卡片 body 横向内边距 = 8 * 2 = 16px，title 可用宽度 = itemWidth - 8 - 16
const POST_CARD_BODY_PADDING_X = 16;
// 正文摘要（.ik-card__excerpt）：15px / 行高 21px，最多 2 行，与标题之间隔一个 body gap
const POST_CARD_EXCERPT_FONT = "400 15px";
const POST_CARD_EXCERPT_LINE_HEIGHT = 21;
const POST_CARD_BODY_GAP = 8;
// 与 theme.css 中 body 的 font-family 保持一致；运行时优先读 body 的计算值
const FALLBACK_FONT_FAMILY =
  '"InterKnot Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

let measureCtx: CanvasRenderingContext2D | null | undefined;
let fontFamily = FALLBACK_FONT_FAMILY;

function getMeasureContext() {
  if (measureCtx !== undefined) return measureCtx;
  measureCtx = null;
  if (typeof document === "undefined") return measureCtx;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      fontFamily = getComputedStyle(document.body).fontFamily || FALLBACK_FONT_FAMILY;
      measureCtx = ctx;
    }
  } catch {
    // 无 canvas（如 jsdom）时回落到字符宽度估算
  }
  return measureCtx;
}

/**
 * 标题行数（1 或 2，PostCard 用 line-clamp: 2 截断）。
 * 是否需要换行只取决于整行宽度，所以用 canvas 按卡片标题同款字体量出宽度即可精确判断，
 * 不受中英文混排、标点、字体差异影响。字体尚未加载时 canvas 与 DOM 同样用回退字体，
 * 二者仍一致；字体换上后的差异由 ResizeObserver 实测修正。
 */
function countTitleLines(title: string, availableWidth: number) {
  // DOM 会合并连续空白、行首行尾空白不占宽
  const text = title.replace(/\s+/g, " ").trim();
  const ctx = getMeasureContext();
  if (!ctx) {
    return estimateTitleLineCount(text, availableWidth, POST_CARD_TITLE_FONT_SIZE);
  }
  ctx.font = `${POST_CARD_TITLE_FONT_WEIGHT} ${POST_CARD_TITLE_FONT_SIZE}px ${fontFamily}`;
  return ctx.measureText(text).width <= availableWidth ? 1 : 2;
}

/** 摘要行数（0–2）。量法同标题。 */
function countExcerptLines(text: string, availableWidth: number) {
  if (!text) return 0;
  const ctx = getMeasureContext();
  if (!ctx) return estimateTitleLineCount(text, availableWidth, 15);
  ctx.font = `${POST_CARD_EXCERPT_FONT} ${fontFamily}`;
  return ctx.measureText(text).width <= availableWidth ? 1 : 2;
}

/** 按 PostCard 的实际渲染结构估算卡片高度，供 VirtualMasonry 的 heightMapper 使用。 */
export function estimatePostCardHeight(post: Post, itemWidth: number) {
  // 无封面文章使用占位图原生比例，与卡片实际渲染保持一致
  const ratio = post.cover
    ? getNormalizedCoverAspectRatio(post.coverWidth, post.coverHeight)
    : FALLBACK_COVER_ASPECT_RATIO;
  const innerWidth = Math.max(0, itemWidth - POST_CARD_PADDING_X);
  const coverHeight = innerWidth / ratio;

  const titleLines = countTitleLines(
    post.title ?? "",
    Math.max(0, innerWidth - POST_CARD_BODY_PADDING_X),
  );
  const titleHeight = POST_CARD_TITLE_FONT_SIZE * POST_CARD_TITLE_LINE_HEIGHT * titleLines;
  const excerptLines = countExcerptLines(
    toCardExcerpt(post.bodyText),
    Math.max(0, innerWidth - POST_CARD_BODY_PADDING_X),
  );
  const excerptHeight = excerptLines
    ? POST_CARD_BODY_GAP + POST_CARD_EXCERPT_LINE_HEIGHT * excerptLines
    : 0;

  // 与 VirtualMasonry 对实测高度的取整方式（Math.round）保持一致，避免差 1px 也触发重排
  return Math.round(coverHeight + POST_CARD_FIXED_HEIGHT + titleHeight + excerptHeight);
}
