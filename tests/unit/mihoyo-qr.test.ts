import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,QR") },
}));

import { useMihoyoQr, type MihoyoQrApi } from "~/composables/useMihoyoQr";
import type { MihoyoQrPollResult } from "~/composables/useApi";

type Poll = MihoyoQrPollResult;

const confirmedLogin = (): Poll => ({
  status: "confirmed",
  mode: "login",
  isNewUser: false,
  binding: null,
  auth: { token: "jwt-token", user: { username: "绳网用户0001" } as never },
});

let hidden = false;

/** 让 pollMihoyoQr 按脚本逐次返回；脚本用尽后重复最后一项 */
function scriptedApi(steps: Array<Poll | (() => Promise<Poll>)>) {
  const calls: string[] = [];
  let index = 0;
  const api: MihoyoQrApi = {
    createMihoyoQr: vi.fn(async (mode) => {
      calls.push(`create:${mode}`);
      return { qrUrl: `https://qr/${calls.length}`, ticket: `ticket-${calls.length}` };
    }),
    pollMihoyoQr: vi.fn(async (ticket) => {
      calls.push(`poll:${ticket}`);
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      return typeof step === "function" ? step() : step;
    }),
  };
  return { api, calls, pollCount: () => calls.filter((c) => c.startsWith("poll:")).length };
}

function mount<T>(factory: () => T) {
  const scope = effectScope();
  const result = scope.run(factory)!;
  return { ...result, dispose: () => scope.stop() };
}

const setHidden = (value: boolean) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMihoyoQr", () => {
  it("走完 waiting → scanned → confirmed 并回调登录结果", async () => {
    const { api } = scriptedApi([
      { status: "waiting" },
      { status: "scanned" },
      confirmedLogin(),
    ]);
    const onConfirmed = vi.fn();
    const qr = mount(() =>
      useMihoyoQr({ mode: "login", isActive: () => true, api, onConfirmed }),
    );

    await qr.startQr();
    expect(qr.qrStatus.value).toBe("waiting");
    expect(qr.qrDataUrl.value).toBe("data:image/png;base64,QR");

    await vi.advanceTimersByTimeAsync(1500);
    expect(qr.qrStatus.value).toBe("waiting");

    await vi.advanceTimersByTimeAsync(1500);
    expect(qr.qrStatus.value).toBe("scanned");

    await vi.advanceTimersByTimeAsync(3000);
    expect(qr.qrStatus.value).toBe("confirmed");
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onConfirmed.mock.calls[0]![0].auth.token).toBe("jwt-token");

    qr.dispose();
  });

  it("页面隐藏时继续轮询，不依赖任何恢复事件", async () => {
    const { api, pollCount } = scriptedApi([{ status: "waiting" }]);
    const qr = mount(() =>
      useMihoyoQr({ mode: "login", isActive: () => true, api, onConfirmed: vi.fn() }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(1500);
    const before = pollCount();
    expect(before).toBeGreaterThan(0);

    setHidden(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(pollCount()).toBeGreaterThan(before);

    qr.dispose();
  });

  it("请求飞行途中页面被隐藏，confirmed 回包依然生效（不能丢 JWT）", async () => {
    let release: (() => void) | null = null;
    const { api } = scriptedApi([
      () =>
        new Promise<Poll>((resolve) => {
          release = () => resolve(confirmedLogin());
        }),
    ]);
    const onConfirmed = vi.fn();
    const qr = mount(() =>
      useMihoyoQr({ mode: "login", isActive: () => true, api, onConfirmed }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(1500);
    expect(release).not.toBeNull();

    // 用户切到米游社 App 确认，页面变为隐藏
    setHidden(true);
    release!();
    await vi.advanceTimersByTimeAsync(0);

    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(qr.qrStatus.value).toBe("confirmed");

    qr.dispose();
  });

  it("回到前台立刻补一次轮询，不等定时器", async () => {
    const { api, pollCount } = scriptedApi([{ status: "waiting" }]);
    const qr = mount(() =>
      useMihoyoQr({ mode: "login", isActive: () => true, api, onConfirmed: vi.fn() }),
    );

    await qr.startQr();
    setHidden(true);
    await vi.advanceTimersByTimeAsync(100);
    const before = pollCount();

    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(pollCount()).toBe(before + 1);

    qr.dispose();
  });

  it("mode 不匹配时报错，而不是静默停在「登录中…」", async () => {
    const { api } = scriptedApi([
      { status: "confirmed", mode: "bind", binding: null } as Poll,
    ]);
    const onConfirmed = vi.fn();
    const onError = vi.fn();
    const qr = mount(() =>
      useMihoyoQr({ mode: "login", isActive: () => true, api, onConfirmed, onError }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(1500);

    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(qr.qrStatus.value).toBe("error");

    qr.dispose();
  });

  it("4xx 业务错误立即暴露，不做无意义重试", async () => {
    const fatal = Object.assign(new Error("该账号已被封禁"), { statusCode: 403 });
    const api: MihoyoQrApi = {
      createMihoyoQr: vi.fn(async () => ({ qrUrl: "https://qr", ticket: "t" })),
      pollMihoyoQr: vi.fn(async () => {
        throw fatal;
      }),
    };
    const onError = vi.fn();
    const qr = mount(() =>
      useMihoyoQr({ mode: "login", isActive: () => true, api, onConfirmed: vi.fn(), onError }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(1500);

    expect(api.pollMihoyoQr).toHaveBeenCalledTimes(1);
    expect(qr.qrStatus.value).toBe("error");
    expect(onError).toHaveBeenCalledWith(fatal);

    qr.dispose();
  });

  it("网络抖动时持续重试并自愈，不会四次就判定失败", async () => {
    let failures = 8;
    const api: MihoyoQrApi = {
      createMihoyoQr: vi.fn(async () => ({ qrUrl: "https://qr", ticket: "t" })),
      pollMihoyoQr: vi.fn(async () => {
        if (failures > 0) {
          failures -= 1;
          throw Object.assign(new Error("boom"), { statusCode: 502 });
        }
        return confirmedLogin();
      }),
    };
    const onConfirmed = vi.fn();
    const onError = vi.fn();
    const qr = mount(() =>
      useMihoyoQr({ mode: "login", isActive: () => true, api, onConfirmed, onError }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(6000);
    // 旧实现在第 4 次失败就 error 了，这里必须还在重试
    expect(qr.qrStatus.value).toBe("retrying");
    expect(onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.pollMihoyoQr.mock.calls.length).toBeGreaterThan(8);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(qr.qrStatus.value).toBe("confirmed");
    expect(onError).not.toHaveBeenCalled();

    qr.dispose();
  });

  it("连续失败超过时限才判定失败", async () => {
    const api: MihoyoQrApi = {
      createMihoyoQr: vi.fn(async () => ({ qrUrl: "https://qr", ticket: "t" })),
      pollMihoyoQr: vi.fn(async () => {
        throw Object.assign(new Error("boom"), { statusCode: 502 });
      }),
    };
    const onError = vi.fn();
    const qr = mount(() =>
      useMihoyoQr({
        mode: "login",
        isActive: () => true,
        api,
        onConfirmed: vi.fn(),
        onError,
        maxRetryMs: 10_000,
      }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(8000);
    expect(qr.qrStatus.value).toBe("retrying");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(qr.qrStatus.value).toBe("error");
    expect(onError).toHaveBeenCalledTimes(1);

    qr.dispose();
  });

  it("判定失败后用户切回来仍能续上（后端结果可重放）", async () => {
    let broken = true;
    const api: MihoyoQrApi = {
      createMihoyoQr: vi.fn(async () => ({ qrUrl: "https://qr", ticket: "t" })),
      pollMihoyoQr: vi.fn(async () => {
        if (broken) throw Object.assign(new Error("offline"), { statusCode: 502 });
        return confirmedLogin();
      }),
    };
    const onConfirmed = vi.fn();
    const qr = mount(() =>
      useMihoyoQr({
        mode: "login",
        isActive: () => true,
        api,
        onConfirmed,
        onError: vi.fn(),
        maxRetryMs: 5000,
      }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(qr.qrStatus.value).toBe("error");

    // 网络恢复 + 用户切回前台
    broken = false;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(50);

    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(qr.qrStatus.value).toBe("confirmed");

    qr.dispose();
  });

  it("4xx 判定失败后不会因为切回前台反复重试", async () => {
    const api: MihoyoQrApi = {
      createMihoyoQr: vi.fn(async () => ({ qrUrl: "https://qr", ticket: "t" })),
      pollMihoyoQr: vi.fn(async () => {
        throw Object.assign(new Error("该账号已被封禁"), { statusCode: 403 });
      }),
    };
    const qr = mount(() =>
      useMihoyoQr({
        mode: "login",
        isActive: () => true,
        api,
        onConfirmed: vi.fn(),
        onError: vi.fn(),
      }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(1500);
    expect(qr.qrStatus.value).toBe("error");
    expect(api.pollMihoyoQr).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    setHidden(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.pollMihoyoQr).toHaveBeenCalledTimes(1);

    qr.dispose();
  });

  it("未扫码就过期时自动换码，且有次数上限", async () => {
    const { api, calls } = scriptedApi([{ status: "expired" }]);
    const qr = mount(() =>
      useMihoyoQr({
        mode: "login",
        isActive: () => true,
        api,
        onConfirmed: vi.fn(),
        maxAutoRefresh: 2,
      }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(calls.filter((c) => c === "create:login")).toHaveLength(3); // 首次 + 2 次自动
    expect(qr.qrStatus.value).toBe("expired");

    qr.dispose();
  });

  it("已扫码后过期不自动换码，避免打断 App 里的确认", async () => {
    const { api, calls } = scriptedApi([{ status: "scanned" }, { status: "expired" }]);
    const qr = mount(() =>
      useMihoyoQr({ mode: "login", isActive: () => true, api, onConfirmed: vi.fn() }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(1500);
    expect(qr.qrStatus.value).toBe("scanned");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(qr.qrStatus.value).toBe("expired");
    expect(calls.filter((c) => c === "create:login")).toHaveLength(1);

    qr.dispose();
  });

  it("stopQr 之后旧回包被丢弃", async () => {
    let release: (() => void) | null = null;
    const { api } = scriptedApi([
      () =>
        new Promise<Poll>((resolve) => {
          release = () => resolve(confirmedLogin());
        }),
    ]);
    const onConfirmed = vi.fn();
    const qr = mount(() =>
      useMihoyoQr({ mode: "login", isActive: () => true, api, onConfirmed }),
    );

    await qr.startQr();
    await vi.advanceTimersByTimeAsync(1500);
    qr.stopQr();
    release!();
    await vi.advanceTimersByTimeAsync(0);

    expect(onConfirmed).not.toHaveBeenCalled();

    qr.dispose();
  });
});
