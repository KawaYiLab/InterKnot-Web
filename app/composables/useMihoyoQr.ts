import { computed, onScopeDispose, ref } from "vue";
import QRCode from "qrcode";
import type { MihoyoQrPollResult } from "~/composables/useApi";

export type MihoyoQrStatus =
  | "loading"
  | "waiting"
  | "scanned"
  | "retrying"
  | "confirmed"
  | "expired"
  | "cancelled"
  | "error";

export type MihoyoQrMode = "login" | "bind";

type ConfirmedResult<M extends MihoyoQrMode> = Extract<
  MihoyoQrPollResult,
  { status: "confirmed"; mode: M }
>;

/** 只取 useMihoyoQr 真正用到的两个方法，便于单测注入 */
export interface MihoyoQrApi {
  createMihoyoQr: (mode: MihoyoQrMode) => Promise<{ qrUrl: string; ticket: string }>;
  pollMihoyoQr: (ticket: string) => Promise<MihoyoQrPollResult>;
}

export interface UseMihoyoQrOptions<M extends MihoyoQrMode> {
  /** 会话模式：登录框传 login，设置页绑定传 bind */
  mode: M;
  /** 当前二维码弹窗是否仍处于活跃状态 */
  isActive: () => boolean;
  /** 二维码图片宽度 */
  width?: number;
  /** 最小轮询间隔（waiting 时），默认 1500ms */
  minInterval?: number;
  /** 最大轮询间隔（错误退避），默认 5000ms */
  maxInterval?: number;
  /** 已扫码后的轮询间隔，默认 3000ms */
  scannedInterval?: number;
  /** 页面不可见时的轮询间隔，默认 5000ms（浏览器还会进一步节流，但循环不会中断） */
  hiddenInterval?: number;
  /**
   * 连续失败多久才判定登录失败，默认 120000ms。
   * 不用「失败几次」计数：后端的 confirmed 结果在 Redis 里可重放，
   * 网络抖一下就放弃等于把已经成功的登录丢掉。
   */
  maxRetryMs?: number;
  /** 未扫码就过期时最多自动换码几次，默认 5 */
  maxAutoRefresh?: number;
  /** Confirmed 后的回调 */
  onConfirmed: (res: ConfirmedResult<M>) => void | Promise<void>;
  /** 创建二维码失败 / 轮询最终失败 / Confirmed 回调失败的回调 */
  onError?: (err: unknown) => void;
  /** 注入 API 客户端（默认取 useApi()），仅测试用 */
  api?: MihoyoQrApi;
}

const isDocumentHidden = () => typeof document !== "undefined" && document.hidden;

/** 4xx（除 429）是确定性失败，重试没有意义，直接把真实错误抛给用户 */
const isFatalStatus = (err: unknown) => {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 429;
};

export function useMihoyoQr<M extends MihoyoQrMode>(options: UseMihoyoQrOptions<M>) {
  const api: MihoyoQrApi = options.api ?? useApi();

  const qrStatus = ref<MihoyoQrStatus>("loading");
  const qrDataUrl = ref("");
  const qrNeedRefresh = computed(
    () =>
      qrStatus.value === "expired" ||
      qrStatus.value === "cancelled" ||
      qrStatus.value === "error",
  );

  const width = options.width ?? 200;
  const minInterval = options.minInterval ?? 1500;
  const maxInterval = options.maxInterval ?? 5000;
  const scannedInterval = options.scannedInterval ?? 3000;
  const hiddenInterval = options.hiddenInterval ?? 5000;
  const maxRetryMs = options.maxRetryMs ?? 120_000;
  const maxAutoRefresh = options.maxAutoRefresh ?? 5;

  /**
   * 每次换码递增。所有异步回包都要比对 generation：
   * 只有「二维码被换掉 / 主动停止」才会让旧回包失效，页面隐藏之类的状态变化不会——
   * 否则一次性的 confirmed 回包会被丢掉，而后端的 ticket 已经消费掉了。
   */
  let generation = 0;
  let ticket = "";
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveErrors = 0;
  let currentDelay = minInterval;
  /** 连续失败的起始时刻（0 表示当前没在失败） */
  let failingSince = 0;
  /** 上一次失败是否是确定性失败（4xx）：确定性失败没有重试价值 */
  let lastErrorFatal = false;
  /** 本轮是否已被扫过：已扫过就不要自动换码，免得用户正在 App 里确认 */
  let scannedSeen = false;
  let autoRefreshCount = 0;

  const clearTimer = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  /** 终止态：不再轮询，但保留 qrStatus 供 UI 展示 */
  const isTerminal = () =>
    qrStatus.value === "confirmed" ||
    qrStatus.value === "expired" ||
    qrStatus.value === "cancelled" ||
    qrStatus.value === "error";

  const stopQr = () => {
    generation += 1;
    clearTimer();
    qrDataUrl.value = "";
    ticket = "";
    scannedSeen = false;
  };

  /**
   * 安排下一次轮询。页面隐藏时只是放慢间隔而不是停掉循环：
   * 扫码流程必然要求用户切到米游社 App，一旦依赖 visibilitychange 才能恢复，
   * 事件没触发（iOS / 内置 WebView / 后台被冻结）就会永久卡住且没有任何提示。
   */
  const schedulePoll = (delay = currentDelay) => {
    if (!ticket || pollTimer || isTerminal()) return;
    const wait = isDocumentHidden() ? Math.max(delay, hiddenInterval) : delay;
    const gen = generation;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      if (gen !== generation) return;
      void doPoll();
    }, wait);
  };

  const beginQr = async (auto: boolean) => {
    stopQr();
    const gen = generation;
    qrStatus.value = "loading";
    consecutiveErrors = 0;
    failingSince = 0;
    lastErrorFatal = false;
    currentDelay = minInterval;
    if (!auto) autoRefreshCount = 0;

    try {
      const res = await api.createMihoyoQr(options.mode);
      if (gen !== generation || !options.isActive()) return;

      const dataUrl = await QRCode.toDataURL(res.qrUrl, { width, margin: 1 });
      if (gen !== generation || !options.isActive()) return;

      qrDataUrl.value = dataUrl;
      ticket = res.ticket;
      qrStatus.value = "waiting";
      schedulePoll(minInterval);
    } catch (err) {
      if (gen !== generation) return;
      qrStatus.value = "error";
      options.onError?.(err);
    }
  };

  /** 二维码过期后自动换一张（仅未扫码、弹窗仍打开、且次数没用完时） */
  const maybeAutoRefresh = () => {
    if (scannedSeen || autoRefreshCount >= maxAutoRefresh) return false;
    if (!options.isActive() || isDocumentHidden()) return false;
    autoRefreshCount += 1;
    void beginQr(true);
    return true;
  };

  const handleConfirmed = async (res: ConfirmedResult<M>) => {
    clearTimer();
    qrStatus.value = "confirmed";
    try {
      if (res.mode !== options.mode) {
        // 静默 return 会让界面永远停在「登录中…」，必须显式报错
        throw new Error(`二维码会话类型不匹配（期望 ${options.mode}，实际 ${res.mode}）`);
      }
      await options.onConfirmed(res);
    } catch (err) {
      qrStatus.value = "error";
      options.onError?.(err);
    }
  };

  const doPoll = async () => {
    if (!ticket) return;
    const gen = generation;
    const activeTicket = ticket;

    try {
      const res = await api.pollMihoyoQr(activeTicket);
      // 只有换码 / 主动停止才丢弃回包；页面隐藏不算
      if (gen !== generation) return;

      if (res.status === "confirmed") {
        await handleConfirmed(res as ConfirmedResult<M>);
        return;
      }

      consecutiveErrors = 0;
      failingSince = 0;

      if (res.status === "expired") {
        if (maybeAutoRefresh()) return;
        qrStatus.value = "expired";
        clearTimer();
        return;
      }
      if (res.status === "cancelled") {
        qrStatus.value = "cancelled";
        clearTimer();
        return;
      }

      if (res.status === "scanned") scannedSeen = true;
      qrStatus.value = res.status;
      currentDelay = res.status === "scanned" ? scannedInterval : minInterval;
      schedulePoll();
    } catch (err) {
      if (gen !== generation) return;

      if (isFatalStatus(err)) {
        lastErrorFatal = true;
        failingSince = 0;
        qrStatus.value = "error";
        clearTimer();
        options.onError?.(err);
        return;
      }

      lastErrorFatal = false;
      consecutiveErrors += 1;
      if (!failingSince) failingSince = Date.now();

      // 只有「用户正看着屏幕」且连续失败超过 maxRetryMs 才判定失败：
      // 后台标签页的定时器被浏览器节流，按次数或按后台时长放弃都会误杀；
      // 而 confirmed 结果在后端可重放，多试几次很可能就把登录接上了。
      const givingUp = !isDocumentHidden() && Date.now() - failingSince >= maxRetryMs;
      if (givingUp) {
        qrStatus.value = "error";
        clearTimer();
        options.onError?.(err);
        return;
      }

      qrStatus.value = "retrying";
      currentDelay = Math.min(maxInterval, minInterval * 2 ** Math.min(consecutiveErrors, 5));
      schedulePoll();
    }
  };

  /**
   * 回到前台 / 网络恢复：立刻补一次轮询（不等退避定时器），并在「未扫码就过期」时自动换码。
   * visibilitychange 之外还监听 focus / pageshow / online，因为移动端和内置 WebView 里
   * 前者经常不触发。
   */
  const handleResume = () => {
    if (isDocumentHidden() || !options.isActive()) return;
    if (qrStatus.value === "expired" && maybeAutoRefresh()) return;
    // 已经判定失败也给一次机会：只要不是确定性错误、ticket 还在，
    // 后端结果可重放，这一次很可能就把登录接上了
    if (qrStatus.value === "error" && !lastErrorFatal && ticket) {
      consecutiveErrors = 0;
      failingSince = 0;
      qrStatus.value = "retrying";
    }
    if (!ticket || isTerminal()) return;
    clearTimer();
    schedulePoll(0);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);
    window.addEventListener("online", handleResume);
    onScopeDispose(() => {
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("pageshow", handleResume);
      window.removeEventListener("online", handleResume);
      stopQr();
    });
  }

  return {
    qrStatus,
    qrDataUrl,
    qrNeedRefresh,
    /** 手动开始 / 刷新二维码（会重置自动换码计数） */
    startQr: () => beginQr(false),
    stopQr,
  };
}
