/**
 * useCheckInReminder —— 登录后「今日未签到」提醒弹窗的单例状态。
 *
 * 触发时机刻意不挂在 LoginDialog 的登录成功回调上：那只覆盖「当场输密码登录」，
 * 会漏掉刷新页面 / 记住登录这个绝大多数场景。改为在 auth.user 由 null 变为有值时
 * 评估一次，同一个入口同时覆盖新登录与 hydrateFromStorage() 恢复会话。接线在
 * plugins/check-in-reminder.client.ts —— useApi / useRouter 依赖 Nuxt 上下文，
 * 由插件同步取好后注入，evaluate() 里不再碰这些 composable（它会在 DOM 事件回调
 * 和 await 之后运行，那时已经没有 Nuxt 上下文了）。
 *
 * 「同一天不再弹」由两道闸门分工把守：
 *   - 已经签到过 → 服务端 canCheckIn === false。清 localStorage、换设备、换浏览器
 *     都不会重复弹。
 *   - 今天没签但手动关掉了 → 本地日戳，仅本机生效；另一台设备上再轻推一次是可接
 *     受的（他确实还没签）。
 *
 * 弹窗实体在 app.vue 中以 <LazyCheckInReminderModal> 挂载。
 */
import type { Router } from "vue-router";
import type { Author } from "~/types/entities";

export type CheckInStatus = Awaited<
  ReturnType<ReturnType<typeof useApi>["getCheckInStatus"]>
>;

/** ik:check-in-done 事件的 detail：签到成功后广播给 /level、/profile 等已挂载的页面 */
export interface CheckInDoneDetail {
  totalDays: number;
  consecutiveDays: number;
  rank: number;
  /** 本次获得的绳网信用 */
  reward: number;
  /** 签到后的丁尼余额，省得页面再拉一次 /api/me/denny */
  currentDenny: number;
}

interface ReminderDeps {
  api: ReturnType<typeof useApi>;
  router: Router;
  auth: ReturnType<typeof useAuthStore>;
}

const STAMP_PREFIX = "ik:checkin-reminder:";
/** 让「登录成功」toast 与首屏瀑布流先落地，再弹提醒 */
const OPEN_DELAY_MS = 800;
/** 这些路由下不打扰：入站考试流程本身、以及登录页 */
const SKIP_PATHS = ["/exam", "/login"];

const visible = ref(false);
const status = ref<CheckInStatus | null>(null);

let deps: ReminderDeps | null = null;
/** 本次页面会话已评估过的签到日，防止 setSession 被调两次等情况重复触发 */
let evaluatedForDay: string | null = null;

/**
 * 客户端按 4:00 边界推算当前签到日（与后端 getCheckInDayInfo 同规则）。
 * 只用于「要不要发这个请求」的廉价预检——日戳写入取的是服务端返回的 checkInDay，
 * 所以客户端时钟偏差最多导致多发一个 GET 或提醒晚到一次，不会算错。
 */
function localCheckInDay(now = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** 与 auth store 的 persistUserId 用同一套 id 解析，保证日戳跟着账号走 */
function resolveUserKey(user: Author | null): string {
  if (!user) return "";
  return String(user.authorId || user.documentId || "");
}

function readStamp(userKey: string): string {
  try {
    return localStorage.getItem(`${STAMP_PREFIX}${userKey}`) || "";
  } catch {
    return "";
  }
}

function writeStamp(userKey: string, day: string): void {
  if (!userKey || !day) return;
  try {
    localStorage.setItem(`${STAMP_PREFIX}${userKey}`, day);
  } catch {
    // 隐私模式 / 配额超限：写不进去最多今天多弹一次，不值得打断流程
  }
}

/** 与 theme.css 里 body:has(.ik-overlay, .ik-img-overlay) 同一套判定：页面上已有弹窗 */
function anotherOverlayOpen(): boolean {
  return !!document.querySelector(".ik-overlay, .ik-img-overlay");
}

/** 走完整条闸门；任一条不满足就安静地什么都不做 */
async function evaluate(): Promise<void> {
  if (!import.meta.client || !deps || visible.value) return;

  const { api, router, auth } = deps;
  if (!auth.isLogin || !auth.user) return;
  // 后端 POST /api/check-in 挂了 require-exam-passed 中间件，未过入站考试的用户
  // 根本签不了，弹了也只能吃 403。
  if (auth.needExam) return;

  const path = router.currentRoute.value.path;
  if (SKIP_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return;

  const day = localCheckInDay();
  if (evaluatedForDay === day) return;

  const userKey = resolveUserKey(auth.user);
  if (!userKey || readStamp(userKey) === day) return;

  // 先占位再 await，避免 watcher 与 visibilitychange 并发时重复拉取
  evaluatedForDay = day;

  let fetched: CheckInStatus;
  try {
    fetched = await api.getCheckInStatus();
  } catch {
    // 网络失败不算评估过，下次切回前台还能再试
    evaluatedForDay = null;
    return;
  }

  if (!fetched.canCheckIn) {
    // 已经签过了：用服务端日戳写死，之后连这个 GET 都省了
    writeStamp(userKey, fetched.checkInDay || day);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, OPEN_DELAY_MS));

  // 等待期间可能已被登出，或用户自己开了别的弹窗——那就别横插一脚
  if (!auth.isLogin || !auth.user || visible.value) return;
  if (anotherOverlayOpen()) return;

  status.value = fetched;
  visible.value = true;
}

/** 记下「今天已经打扰过了」，优先用服务端日戳 */
function stampToday(): void {
  if (!deps) return;
  writeStamp(resolveUserKey(deps.auth.user), status.value?.checkInDay || localCheckInDay());
}

/** 关闭即视为今日不再提醒——这个弹窗只做一次轻推，不反复纠缠 */
function close(): void {
  visible.value = false;
  stampToday();
}

/** 签到成功：写日戳，并广播给已挂载的 /level、/profile 页同步为「已签到」 */
function notifyCheckedIn(detail: CheckInDoneDetail): void {
  stampToday();
  window.dispatchEvent(new CustomEvent<CheckInDoneDetail>("ik:check-in-done", { detail }));
}

function reset(): void {
  visible.value = false;
  status.value = null;
  evaluatedForDay = null;
}

export function useCheckInReminder() {
  return {
    visible,
    status,
    /** 由 plugins/check-in-reminder.client.ts 在 Nuxt 上下文内调用一次 */
    init: (value: ReminderDeps) => {
      deps = value;
    },
    evaluate,
    close,
    notifyCheckedIn,
    reset,
  };
}
