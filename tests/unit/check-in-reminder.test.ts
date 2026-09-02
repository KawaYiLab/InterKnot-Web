import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// evaluate() 会预热弹窗 chunk。真去编译那个 SFC 会连带拉进一堆 Nuxt 自动导入，
// 这里替换成空模块——预热本身不 await，也不影响任何断言。
vi.mock("~/components/CheckInReminderModal.vue", () => ({ default: {} }));

import {
  useCheckInReminder,
  type CheckInDoneDetail,
  type CheckInStatus,
  type ReminderDeps,
} from "~/composables/useCheckInReminder";
import type { Author } from "~/types/entities";

const OPEN_DELAY_MS = 800;
const USER: Author = { authorId: "author-1" } as Author;
const STAMP_KEY = "ik:checkin-reminder:author-1";

/** 服务端签到日；与「浏览器本地日」刻意不同，用来盯跨时区那条路径 */
const SERVER_DAY = "2026-09-03";

const status = (over: Partial<CheckInStatus> = {}): CheckInStatus =>
  ({
    canCheckIn: true,
    totalDays: 12,
    consecutiveDays: 4,
    rank: 0,
    checkInDay: SERVER_DAY,
    nextEligibleAt: null,
    currentDenny: 300,
    nextConsecutiveDays: 5,
    nextReward: 10,
    ...over,
  }) as CheckInStatus;

function makeDeps(over: {
  fetch?: () => Promise<CheckInStatus>;
  path?: string;
  auth?: Partial<ReminderDeps["auth"]>;
}) {
  const getCheckInStatus = vi.fn(over.fetch ?? (async () => status()));
  const auth: ReminderDeps["auth"] = {
    isLogin: true,
    needExam: false,
    user: USER,
    ...over.auth,
  };
  const deps: ReminderDeps = {
    api: { getCheckInStatus },
    router: { currentRoute: { value: { path: over.path ?? "/" } } },
    auth,
  };
  return { deps, auth, getCheckInStatus };
}

/** 跑完 evaluate 里那次 800ms 等待 */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(OPEN_DELAY_MS + 1);
};

let reminder: ReturnType<typeof useCheckInReminder>;

beforeEach(() => {
  vi.useFakeTimers();
  // 本地日固定在 09-02（16:00 本地，已过 4:00 边界），服务端日是 09-03 —— 两者不等
  vi.setSystemTime(new Date(2026, 8, 2, 16, 0, 0));
  localStorage.clear();
  reminder = useCheckInReminder();
  reminder.reset();
});

afterEach(() => {
  reminder.reset();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useCheckInReminder 闸门", () => {
  it("未签到时延迟 800ms 后弹出，并带上服务端状态", async () => {
    const { deps, getCheckInStatus } = makeDeps({});
    reminder.init(deps);

    const done = reminder.evaluate();
    expect(reminder.visible.value).toBe(false);

    await settle();
    await done;

    expect(getCheckInStatus).toHaveBeenCalledTimes(1);
    expect(reminder.visible.value).toBe(true);
    expect(reminder.status.value?.nextReward).toBe(10);
  });

  it("已签到时只写日戳、不弹窗", async () => {
    const { deps } = makeDeps({ fetch: async () => status({ canCheckIn: false }) });
    reminder.init(deps);

    await reminder.evaluate();

    expect(reminder.visible.value).toBe(false);
    expect(localStorage.getItem(STAMP_KEY)).toBe(SERVER_DAY);
  });

  it("close() 记的是服务端签到日，不是浏览器本地日", async () => {
    const { deps } = makeDeps({});
    reminder.init(deps);
    const done = reminder.evaluate();
    await settle();
    await done;

    reminder.close();

    expect(reminder.visible.value).toBe(false);
    expect(localStorage.getItem(STAMP_KEY)).toBe(SERVER_DAY);
  });

  it("关掉之后换个页面会话也不再弹——即便本地日与服务端日对不上", async () => {
    const { deps, getCheckInStatus } = makeDeps({});
    reminder.init(deps);
    const done = reminder.evaluate();
    await settle();
    await done;
    reminder.close();

    // reset() 等价于「重开一个页面会话」：清掉 evaluatedForDay，日戳留在 localStorage
    reminder.reset();
    const again = reminder.evaluate();
    await settle();
    await again;

    // 本地日（09-02）跟日戳（09-03）不等，所以这个 GET 省不掉；
    // 但拿到服务端日之后必须认出「今天已经打扰过了」，不能再弹一次。
    expect(getCheckInStatus).toHaveBeenCalledTimes(2);
    expect(reminder.visible.value).toBe(false);
  });

  it("日戳与本地日一致时连 GET 都不发", async () => {
    localStorage.setItem(STAMP_KEY, "2026-09-02");
    const { deps, getCheckInStatus } = makeDeps({});
    reminder.init(deps);

    await reminder.evaluate();

    expect(getCheckInStatus).not.toHaveBeenCalled();
    expect(reminder.visible.value).toBe(false);
  });

  it("未过入站考试 / 位于 /exam 时不打扰，也不发请求", async () => {
    const exam = makeDeps({ auth: { needExam: true } });
    reminder.init(exam.deps);
    await reminder.evaluate();
    expect(exam.getCheckInStatus).not.toHaveBeenCalled();

    reminder.reset();
    const onExamPage = makeDeps({ path: "/exam/intro" });
    reminder.init(onExamPage.deps);
    await reminder.evaluate();
    expect(onExamPage.getCheckInStatus).not.toHaveBeenCalled();
  });

  it("并发调用只拉一次状态（setSession 被连调两次的情形）", async () => {
    const { deps, getCheckInStatus } = makeDeps({});
    reminder.init(deps);

    const first = reminder.evaluate();
    const second = reminder.evaluate();
    await settle();
    await Promise.all([first, second]);

    expect(getCheckInStatus).toHaveBeenCalledTimes(1);
    expect(reminder.visible.value).toBe(true);
  });

  it("拉状态失败不算评估过，下次还能再试", async () => {
    let attempt = 0;
    const { deps, getCheckInStatus } = makeDeps({
      fetch: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("offline");
        return status();
      },
    });
    reminder.init(deps);

    await reminder.evaluate();
    expect(reminder.visible.value).toBe(false);

    const retry = reminder.evaluate();
    await settle();
    await retry;

    expect(getCheckInStatus).toHaveBeenCalledTimes(2);
    expect(reminder.visible.value).toBe(true);
  });
});

describe("useCheckInReminder 等待期间的退让", () => {
  it("等待期间页面上开了别的弹窗就让位，并且之后还能再评估一次", async () => {
    const { deps, getCheckInStatus } = makeDeps({});
    reminder.init(deps);

    const other = document.createElement("div");
    other.className = "ik-overlay";
    document.body.appendChild(other);

    const blocked = reminder.evaluate();
    await settle();
    await blocked;
    expect(reminder.visible.value).toBe(false);

    // 关掉那个弹窗再撞一次（visibilitychange / focus 都会走到这里）——
    // 让位那次没写日戳，所以不该把这一整个页面会话的提醒都吞掉。
    other.remove();
    const retry = reminder.evaluate();
    await settle();
    await retry;

    expect(getCheckInStatus).toHaveBeenCalledTimes(2);
    expect(reminder.visible.value).toBe(true);
  });

  it("等待期间被登出就不弹，也不留下日戳", async () => {
    const { deps, auth } = makeDeps({});
    reminder.init(deps);

    const pending = reminder.evaluate();
    auth.isLogin = false;
    auth.user = null;
    await settle();
    await pending;

    expect(reminder.visible.value).toBe(false);
    expect(localStorage.getItem(STAMP_KEY)).toBeNull();
  });
});

describe("notifyCheckedIn", () => {
  it("写日戳并广播 ik:check-in-done", async () => {
    const { deps } = makeDeps({});
    reminder.init(deps);
    const done = reminder.evaluate();
    await settle();
    await done;

    const seen: CheckInDoneDetail[] = [];
    const onDone = (e: Event) => seen.push((e as CustomEvent<CheckInDoneDetail>).detail);
    window.addEventListener("ik:check-in-done", onDone);

    reminder.notifyCheckedIn({
      totalDays: 13,
      consecutiveDays: 5,
      rank: 7,
      reward: 10,
      currentDenny: 310,
    });
    window.removeEventListener("ik:check-in-done", onDone);

    expect(localStorage.getItem(STAMP_KEY)).toBe(SERVER_DAY);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.rank).toBe(7);
    expect(seen[0]?.currentDenny).toBe(310);
  });
});
