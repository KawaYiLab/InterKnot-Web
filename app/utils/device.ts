export type DeviceType = "desktop" | "mobile" | "tablet" | "unknown";

export interface ParsedDeviceInfo {
  os: string;
  browser: string;
  deviceType: DeviceType;
  label: string;
  summary: string;
}

/**
 * 零依赖的轻量级 UserAgent 解析器。
 * 提取设备操作系统、浏览器品牌与设备形态（桌面/移动/平板），
 * 并生成类似 "Windows · Chrome"、"iOS · Safari" 的友好摘要。
 */
export function parseUserAgent(ua?: string | null): ParsedDeviceInfo {
  if (!ua || typeof ua !== "string" || !ua.trim()) {
    return {
      os: "未知系统",
      browser: "未知浏览器",
      deviceType: "unknown",
      label: "未知设备",
      summary: "未知设备",
    };
  }

  const raw = ua.trim();

  let os = "未知系统";
  let deviceType: DeviceType = "desktop";

  // 1. 操作系统与设备类型检测
  if (/windows/i.test(raw)) {
    os = "Windows";
    deviceType = "desktop";
  } else if (/ipad/i.test(raw)) {
    os = "iPadOS";
    deviceType = "tablet";
  } else if (/iphone|ipod/i.test(raw)) {
    os = "iOS";
    deviceType = "mobile";
  } else if (/macintosh|mac os x/i.test(raw)) {
    os = "macOS";
    deviceType = "desktop";
  } else if (/android/i.test(raw)) {
    os = "Android";
    deviceType = /tablet/i.test(raw) || !/mobile/i.test(raw) ? "tablet" : "mobile";
  } else if (/cros/i.test(raw)) {
    os = "Chrome OS";
    deviceType = "desktop";
  } else if (/harmonyos|harmony/i.test(raw)) {
    os = "HarmonyOS";
    deviceType = "mobile";
  } else if (/linux/i.test(raw)) {
    os = "Linux";
    deviceType = "desktop";
  } else if (/mobile/i.test(raw)) {
    deviceType = "mobile";
  } else {
    deviceType = "unknown";
  }

  // 2. 浏览器品牌检测（注意判定顺序：特定衍生浏览器优先匹配）
  let browser = "未知浏览器";
  if (/micromessenger/i.test(raw)) {
    browser = "微信内置";
  } else if (/edg([ea]|ios)?\//i.test(raw)) {
    browser = "Edge";
  } else if (/opr\/|opera/i.test(raw)) {
    browser = "Opera";
  } else if (/chrome|crios/i.test(raw)) {
    browser = "Chrome";
  } else if (/firefox|fxios/i.test(raw)) {
    browser = "Firefox";
  } else if (/safari/i.test(raw)) {
    browser = "Safari";
  } else if (/msie|trident/i.test(raw)) {
    browser = "Internet Explorer";
  }

  // 3. 生成人友好显示标签
  let label = "未知设备";
  if (os !== "未知系统" && browser !== "未知浏览器") {
    label = `${os} · ${browser}`;
  } else if (os !== "未知系统") {
    label = os;
  } else if (browser !== "未知浏览器") {
    label = browser;
  }

  return {
    os,
    browser,
    deviceType,
    label,
    summary: label,
  };
}
