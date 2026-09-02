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
 *     受的（他确实还没签）。日戳里存的是**服务端**签到日，浏览器时区／时钟与服务端
 *     不一致时也判得准。
 *
 * 弹窗实体在 app.vue 中以 <LazyCheckInReminderModal> 挂载。
 */
import { ref } from "vue";
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

/**
 * 注入的依赖只声明 evaluate / stampToday 真正读到的那一小块（同 useMihoyoQr 的
 * MihoyoQrApi），而不是整个 useApi() / Router / auth store —— 单测里给个普通对象
 * 就能把闸门跑全。真实实现在结构上都满足。
 */
export interface ReminderDeps {
  api: { getCheckInStatus: () => Promise<CheckInStatus> };
  router: { currentRoute: { value: { path: string } } };
  auth: { isLogin: boolean; needExam: boolean; user: Author | null };
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
 *
 * 只用于「要不要发这个请求」的廉价预检，**不能**用来判断日戳是否命中：后端的
 * checkInDay 走服务端本地时区（formatLocalDate），浏览器不在同一时区（或时钟偏了）
 * 时两个日期字符串永远对不上。真正的判定一律拿服务端 checkInDay 比（见 evaluate），
 * 这里对不上最多多发一个 GET。
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

/**
 * 走完整条闸门；任一条不满足就安静地什么都不做。
 *
 * 不用额外判 import.meta.client：deps 只由 plugins/check-in-reminder.client.ts
 * 注入，服务端永远是 null，第一行就退了。
 */
async function evaluate(): Promise<void> {
  if (!deps || visible.value) return;

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
  // 本地日预检：同时区下能直接短路掉这个 GET；跨时区下对不上，交给下面的服务端日复核
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

  // 日戳一律以服务端签到日为准。留着 evaluatedForDay 不回滚：本次页面会话内
  // 已经问过一次了，跨时区时也别每次切回前台都再问一遍。
  const serverDay = fetched.checkInDay || day;

  if (!fetched.canCheckIn) {
    // 已经签过了：写死服务端日戳，之后连这个 GET 都省了
    writeStamp(userKey, serverDay);
    return;
  }

  // 今天没签，但这台机器上已经打扰过了（本地日与服务端日不同时预检漏掉的那种）
  if (readStamp(userKey) === serverDay) return;

  // 让这 800ms 顺手把弹窗 chunk 取回来。app.vue 用的是 <LazyCheckInReminderModal>，
  // 而 <Transition> 包异步组件时 chunk 到得比首帧晚会让入场动画整段错过
  // （同 app.vue 里 PostOverlay 那条注释）。与 Lazy 组件是同一个模块 id，Vite 命中
  // 同一份 chunk。不 await：预热只是让动画大概率跑起来，不该让一个卡住的 chunk
  // 请求把提醒本身也拖住 —— 那种情况下退回原样（动画略过）就好。
  void import("~/components/CheckInReminderModal.vue").catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, OPEN_DELAY_MS));

  // 等待期间可能已被登出，或用户自己开了别的弹窗——那就别横插一脚。
  // 这两条都不写日戳，所以也把 evaluatedForDay 放开：切回前台 / 关掉那个弹窗
  // 之后还能再评估一次，否则这一整个页面会话都静默丢掉了提醒。
  if (!auth.isLogin || !auth.user || visible.value || anotherOverlayOpen()) {
    evaluatedForDay = null;
    return;
  }

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
