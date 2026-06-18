/** 绳网等级累计绳网信用门槛（与后端 / 顶栏进度条一致，最高 Lv.7） */
export const LEVEL_THRESHOLDS = [0, 500, 2000, 6000, 15000, 35000, 80000] as const;

export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

export const LEVEL_TITLES: Record<number, string> = {
  1: "新手绳匠",
  2: "见习绳匠",
  3: "正式绳匠",
  4: "资深绳匠",
  5: "精英绳匠",
  6: "传奇绳匠",
  7: "传说绳匠",
};

/** 升到下一级，在当前等级内还需获得的绳网信用 */
export function expNeededWithinLevel(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return LEVEL_THRESHOLDS[level]! - LEVEL_THRESHOLDS[level - 1]!;
}
