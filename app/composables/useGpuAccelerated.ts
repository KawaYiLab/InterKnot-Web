/**
 * useGpuAccelerated —— 检测当前浏览器是否在使用软件渲染（无硬件加速）。
 *
 * 主要用于在 Chrome 等浏览器被手动关闭「使用图形加速」后，自动降级/关闭
 * 全局背景跑马灯这类在 CPU 渲染路径下会变成全屏重绘瓶颈的视觉效果。
 *
 * 实现为模块级单例：只在客户端初始化一次，通过 WebGL debug renderer info
 * 读取渲染器名称；识别 SwiftShader / Software / Microsoft Basic Render Driver
 * 等常见软件渲染器。若扩展不可用或读取失败，默认按「有 GPU 加速」处理，
 * 避免误伤。
 */

const gpuAccelerated = ref(true);
let initialized = false;

function detectSoftwareRenderer(): boolean {
  if (typeof window === "undefined" || !window.document) return false;
  const canvas = document.createElement("canvas");
  const gl =
    (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
    (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
  if (!gl) return false;

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) return false;

  const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string | null;
  const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string | null;

  if (typeof renderer !== "string" || !renderer) return false;

  const combined = `${vendor || ""} ${renderer}`.toLowerCase();

  return (
    combined.includes("swiftshader") ||
    combined.includes("software") ||
    combined.includes("basic render") ||
    combined.includes("llvmpipe")
  );
}

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try {
    gpuAccelerated.value = !detectSoftwareRenderer();
  } catch {
    // 任何异常都按有 GPU 处理，避免误降级。
    gpuAccelerated.value = true;
  }
}

export function useGpuAccelerated() {
  if (import.meta.client) ensureInitialized();
  return readonly(gpuAccelerated);
}
