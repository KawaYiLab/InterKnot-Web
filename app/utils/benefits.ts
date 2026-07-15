/**
 * 等级权益矩阵（index 即等级，0 = 未通过入站考试）。
 * 与后端 ikserver/src/utils/benefits.ts 保持一致；服务端是配额的
 * 唯一裁决方，这里仅用于展示与接口失败时的体验兜底。
 */
export const BENEFIT_MAX_LEVEL = 7;

export const BENEFIT_MATRIX = {
  /** 发帖图片数量上限 */
  articleMaxImages: [0, 9, 12, 15, 18, 24, 30, 40],
  /** 评论图片数量上限 */
  commentMaxImages: [0, 3, 6, 9, 9, 12, 12, 18],
  /** 帖子正文字数上限 */
  articleMaxBody: [0, 10240, 12000, 15000, 20000, 25000, 30000, 40000],
} as const satisfies Record<string, readonly number[]>;

export type BenefitKey = keyof typeof BENEFIT_MATRIX;
export type BenefitValues = Record<BenefitKey, number>;

export const clampBenefitLevel = (level: unknown): number => {
  const value =
    typeof level === "number" && Number.isFinite(level) ? Math.floor(level) : 0;
  return Math.min(Math.max(value, 0), BENEFIT_MAX_LEVEL);
};

export const benefitsForLevel = (level: number): BenefitValues => {
  const clamped = clampBenefitLevel(level);
  return {
    articleMaxImages: BENEFIT_MATRIX.articleMaxImages[clamped]!,
    commentMaxImages: BENEFIT_MATRIX.commentMaxImages[clamped]!,
    articleMaxBody: BENEFIT_MATRIX.articleMaxBody[clamped]!,
  };
};
