import { onMounted, onUnmounted, computed, ref } from "vue";
import QRCode from "qrcode";
import type { MihoyoQrCreateResult, MihoyoQrPollResult } from "~/composables/useApi";

export type MihoyoQrStatus =
  | "loading"
  | "waiting"
  | "scanned"
  | "confirmed"
  | "expired"
  | "cancelled"
  | "error";

export interface UseMihoyoQrOptions {
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
  /** 连续错误多少次后把状态标为 error，默认 3 */
  maxErrors?: number;
  /** Confirmed 后的回调 */
  onConfirmed: (res: Extract<MihoyoQrPollResult, { status: "confirmed" }>) => void | Promise<void>;
  /** 创建二维码失败/轮询最终失败的回调 */
  onError?: (err: unknown) => void;
}

export function useMihoyoQr(options: UseMihoyoQrOptions) {
  const api = useApi();

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
  const maxErrors = options.maxErrors ?? 3;

  let ticket = "";
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  let consecutiveErrors = 0;
  let currentDelay = minInterval;

  const stopQr = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    polling = false;
    qrDataUrl.value = "";
    ticket = "";
  };

  const schedulePoll = () => {
    if (!polling || pollTimer) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void doPoll();
    }, currentDelay);
  };

  const startQr = async () => {
    stopQr();
    qrStatus.value = "loading";
    consecutiveErrors = 0;
    currentDelay = minInterval;

    try {
      const res = await api.createMihoyoQr();
      if (!options.isActive()) return;

      qrDataUrl.value = await QRCode.toDataURL(res.qrUrl, { width, margin: 1 });
      if (!options.isActive()) return;

      ticket = res.ticket;
      qrStatus.value = "waiting";
      polling = true;
      schedulePoll();
    } catch (err) {
      qrStatus.value = "error";
      options.onError?.(err);
    }
  };

  const doPoll = async () => {
    if (!polling || !ticket) return;

    try {
      const res = await api.pollMihoyoQr(ticket);
      if (!polling) return;

      if (res.status !== "confirmed") {
        consecutiveErrors = 0;

        if (res.status === "expired" || res.status === "cancelled") {
          polling = false;
          qrStatus.value = res.status;
          return;
        }

        qrStatus.value = res.status;
        if (res.status === "scanned") {
          currentDelay = Math.max(currentDelay, scannedInterval);
        } else {
          currentDelay = minInterval;
        }
        schedulePoll();
        return;
      }

      // Confirmed
      polling = false;
      qrStatus.value = "confirmed";
      await options.onConfirmed(res as Extract<MihoyoQrPollResult, { status: "confirmed" }>);
    } catch (err) {
      consecutiveErrors += 1;
      if (consecutiveErrors > maxErrors) {
        polling = false;
        qrStatus.value = "error";
        options.onError?.(err);
        return;
      }
      currentDelay = Math.min(maxInterval, minInterval * 2 ** consecutiveErrors);
      schedulePoll();
    }
  };

  const handleVisibility = () => {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      polling = false;
      return;
    }
    if (
      ticket &&
      qrStatus.value !== "confirmed" &&
      qrStatus.value !== "expired" &&
      qrStatus.value !== "cancelled" &&
      qrStatus.value !== "error"
    ) {
      polling = true;
      schedulePoll();
    }
  };

  onMounted(() => {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }
  });

  onUnmounted(() => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibility);
    }
    stopQr();
  });

  return {
    qrStatus,
    qrDataUrl,
    qrNeedRefresh,
    startQr,
    stopQr,
  };
}
