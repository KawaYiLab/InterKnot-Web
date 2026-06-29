import { describe, expect, it } from "vitest";
import type { ApiClientError } from "~/types/api";
import {
  isNotFoundError,
  normalizeApiError,
  resolveErrorMessage,
} from "~/utils/api-error";

function makeError(props: Partial<ApiClientError> & { message?: string }) {
  const e = new Error(props.message ?? "") as ApiClientError;
  Object.assign(e, props);
  return e;
}

describe("normalizeApiError", () => {
  it("Error 实例原样返回", () => {
    const e = new Error("boom");
    expect(normalizeApiError(e)).toBe(e);
  });

  it("非 Error 包装为未知异常", () => {
    expect(normalizeApiError("nope").message).toBe("未知请求异常");
    expect(normalizeApiError(undefined).message).toBe("未知请求异常");
  });
});

describe("isNotFoundError", () => {
  it("statusCode 404 为真", () => {
    expect(isNotFoundError(makeError({ statusCode: 404 }))).toBe(true);
  });

  it("其它状态码为假", () => {
    expect(isNotFoundError(makeError({ statusCode: 500 }))).toBe(false);
    expect(isNotFoundError(new Error("x"))).toBe(false);
  });
});

describe("resolveErrorMessage", () => {
  it("注册验证码冷却给出秒数提示", () => {
    const e = makeError({
      code: "REGISTER_CODE_COOLDOWN",
      details: { retryAfter: 30 },
    });
    expect(resolveErrorMessage(e)).toBe("发送太频繁，请 30 秒后再试");
  });

  it("验证码错误给出剩余次数提示", () => {
    const e = makeError({
      code: "REGISTER_CODE_INVALID",
      details: { attemptsRemaining: 2 },
    });
    expect(resolveErrorMessage(e)).toBe("验证码错误，还可尝试 2 次");
  });

  it("网络错误特征给出网络提示", () => {
    expect(resolveErrorMessage(makeError({ message: "Failed to fetch" }))).toBe(
      "网络异常，请稍后重试",
    );
  });

  it("优先展示后端业务文案", () => {
    const e = makeError({ message: "账号或密码错误", statusCode: 500 });
    expect(resolveErrorMessage(e)).toBe("账号或密码错误");
  });

  it("5xx 且无业务文案给通用提示", () => {
    expect(resolveErrorMessage(makeError({ statusCode: 503 }))).toBe(
      "服务器异常，请稍后重试",
    );
  });

  it("兜底使用 fallback", () => {
    expect(resolveErrorMessage(makeError({}), "自定义兜底")).toBe("自定义兜底");
  });
});
