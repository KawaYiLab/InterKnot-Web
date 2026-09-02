/**
 * 签到奖励与连签轨道的纯计算，与后端 check-in 控制器同规则
 * （server/src/api/check-in/controllers/check-in.ts 的 rewardForConsecutiveDays）。
 * 抽成 util 是为了能单测，弹窗组件里只剩呈现。
 */

/** 每次签到的基础绳网信用 */
export const CHECK_IN_BASE_REWARD = 6;
/** 连签加成上限：每多连签 1 天 +1，最多 +4（连签 5 天起恒为 10） */
export const CHECK_IN_MAX_STREAK_BONUS = 4;
/** 每次签到固定发放的丁尼 */
export const CHECK_IN_DENNY_REWARD = 10;

/** 连签轨道的格子数 */
export const CHECK_IN_TRACK_SIZE = 7;
/** 「今天」在轨道里的目标索引；连签超过它之后整条轨道开始向前滑动 */
export const CHECK_IN_TRACK_TODAY_OFFSET = 3;

/** 连签第 N 天签到发放的绳网信用 */
export function checkInRewardForDay(consecutiveDays: number): number {
  return (
    CHECK_IN_BASE_REWARD +
    Math.min(Math.max(consecutiveDays - 1, 0), CHECK_IN_MAX_STREAK_BONUS)
  );
}

export interface CheckInTrackCell {
  /** 连签第几天 */
  day: number;
  /** 这一天签到能拿到的绳网信用 */
  reward: number;
  /** 已经签过的往日 */
  done: boolean;
  /** 当前签到日 */
  today: boolean;
  /** 还没到的将来 */
  future: boolean;
}

/**
 * 连签轨道：固定 7 格，「今天」尽量落在第 4 格 —— 前面留 3 天已签的成就感，
 * 后面留 3 天「别断」的牵引。连签 ≤ 4 天时窗口贴住第 1 天（没有第 0 天），
 * 之后整条轨道随连签天数向前滑。
 */
export function buildCheckInTrack(todayStreakDay: number): CheckInTrackCell[] {
  const today = Math.max(1, Math.floor(todayStreakDay) || 1);
  const start = Math.max(1, today - CHECK_IN_TRACK_TODAY_OFFSET);
  return Array.from({ length: CHECK_IN_TRACK_SIZE }, (_, index) => {
    const day = start + index;
    return {
      day,
      reward: checkInRewardForDay(day),
      done: day < today,
      today: day === today,
      future: day > today,
    };
  });
}
