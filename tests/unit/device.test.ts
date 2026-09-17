import { describe, expect, it } from "vitest";
import { parseUserAgent } from "~/utils/device";

describe("parseUserAgent", () => {
  it("空值 / 非字符串返回未知默认值", () => {
    expect(parseUserAgent()).toEqual({
      os: "未知系统",
      browser: "未知浏览器",
      deviceType: "unknown",
      label: "未知设备",
      summary: "未知设备",
    });
    expect(parseUserAgent("")).toEqual({
      os: "未知系统",
      browser: "未知浏览器",
      deviceType: "unknown",
      label: "未知设备",
      summary: "未知设备",
    });
    expect(parseUserAgent("   ")).toEqual({
      os: "未知系统",
      browser: "未知浏览器",
      deviceType: "unknown",
      label: "未知设备",
      summary: "未知设备",
    });
  });

  it("解析 Windows + Chrome 桌面端", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const result = parseUserAgent(ua);
    expect(result.os).toBe("Windows");
    expect(result.browser).toBe("Chrome");
    expect(result.deviceType).toBe("desktop");
    expect(result.label).toBe("Windows · Chrome");
  });

  it("解析 macOS + Edge 桌面端", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    const result = parseUserAgent(ua);
    expect(result.os).toBe("macOS");
    expect(result.browser).toBe("Edge");
    expect(result.deviceType).toBe("desktop");
    expect(result.label).toBe("macOS · Edge");
  });

  it("解析 iPhone + Safari 移动端", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const result = parseUserAgent(ua);
    expect(result.os).toBe("iOS");
    expect(result.browser).toBe("Safari");
    expect(result.deviceType).toBe("mobile");
    expect(result.label).toBe("iOS · Safari");
  });

  it("解析 Android 手机端", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    const result = parseUserAgent(ua);
    expect(result.os).toBe("Android");
    expect(result.browser).toBe("Chrome");
    expect(result.deviceType).toBe("mobile");
    expect(result.label).toBe("Android · Chrome");
  });

  it("解析 iPad 平板端", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const result = parseUserAgent(ua);
    expect(result.os).toBe("iPadOS");
    expect(result.browser).toBe("Safari");
    expect(result.deviceType).toBe("tablet");
    expect(result.label).toBe("iPadOS · Safari");
  });

  it("解析 Android 平板端", () => {
    const ua = "Mozilla/5.0 (Linux; Android 13; SM-X906N Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/115.0.5790.166 Safari/537.36";
    const result = parseUserAgent(ua);
    expect(result.os).toBe("Android");
    expect(result.deviceType).toBe("tablet");
  });

  it("解析 微信内置浏览器", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; 22081212C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.40.2420";
    const result = parseUserAgent(ua);
    expect(result.browser).toBe("微信内置");
    expect(result.os).toBe("Android");
    expect(result.label).toBe("Android · 微信内置");
  });

  it("解析 Linux + Firefox 桌面端", () => {
    const ua = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";
    const result = parseUserAgent(ua);
    expect(result.os).toBe("Linux");
    expect(result.browser).toBe("Firefox");
    expect(result.deviceType).toBe("desktop");
    expect(result.label).toBe("Linux · Firefox");
  });
});
