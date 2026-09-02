/**
 * useCheckInDoneSync —— 订阅 ik:check-in-done，把当前页面那份签到状态同步成「已签到」。
 *
 * 登录提醒弹窗（CheckInReminderModal）可以直接完成签到，而 /level、/profile 这类
 * 页面此刻可能正挂载着自己的一份 checkInStatus。不同步的话按钮还停在「今日签到」，
 * 点下去只会吃后端一个 409（CHECK_IN_ALREADY_TODAY）。
 *
 * 事件由 useCheckInReminder.notifyCheckedIn() 派发，detail 见 CheckInDoneDetail。
 * 两个页面的状态对象形状不完全一样（/profile 多一个 nextEligibleAt），所以 status
 * 用泛型收，只约束这里真正会写的那几个字段。
 */
import { useEventListener } from "@vueuse/core";
import type { Ref } from "vue";
import type { DailyExpStatus } from "~/types/entities";
import type { CheckInDoneDetail } from "~/composables/useCheckInReminder";

/** 页面侧签到状态里本 composable 会写到的字段 */
export interface CheckInSyncStatus {
  canCheckIn: boolean;
  totalDays: number;
  consecutiveDays: number;
  rank: number;
}

export function useCheckInDoneSync<T extends CheckInSyncStatus>(refs: {
  status: Ref<T>;
  /** 传了就把「签到」这一项标成已获取，并累加当日主动经验 */
  dailyExpStatus?: Ref<DailyExpStatus | null>;
  /** 传了就同步丁尼余额（/level 页顶部那个数字） */
  dennyBalance?: Ref<number>;
}): void {
  if (!import.meta.client) return;

  useEventListener(window, "ik:check-in-done", (e: Event) => {
    const detail = (e as CustomEvent<CheckInDoneDetail>).detail;
    if (!detail) return;

    const status = refs.status.value;
    status.canCheckIn = false;
    // 0 = 这一项后端没给（老后端 / 事务后统计失败），别把页面上已有的数字抹成 0
    if (detail.totalDays > 0) status.totalDays = detail.totalDays;
    if (detail.consecutiveDays > 0) status.consecutiveDays = detail.consecutiveDays;
    if (detail.rank > 0) status.rank = detail.rank;

    if (refs.dennyBalance) refs.dennyBalance.value = detail.currentDenny;

    const daily = refs.dailyExpStatus?.value;
    if (daily) {
      daily.sources.checkIn = { done: true, exp: detail.reward };
      daily.todaySelfGained += detail.reward;
    }
  });
}
