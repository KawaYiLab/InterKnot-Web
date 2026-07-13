const IMAGE_HOST = "https://im.tiwat.cn";
const LEGACY_IMAGE_HOST_RE = /^https?:\/\/image\.tiwat\.cn/;
const LEGACY_THUMB_SUFFIX = "-small.webp";
const WEBP_PROCESS = "format,webp/quality,q_80";

function getResizeProcess(width: number): string {
  return `image_process=resize,w_${width}/${WEBP_PROCESS}`;
}

function getNoResizeProcess(): string {
  return `image_process=${WEBP_PROCESS}`;
}

function stripImageProcess(url: string): string {
  if (!url.includes("image_process=")) return url;
  const parts = url.split("?");
  const path = parts[0] ?? "";
  if (parts.length <= 1) return url;
  const params = parts
    .slice(1)
    .join("?")
    .split("&")
    .filter((p) => !p.startsWith("image_process="));
  return params.length ? `${path}?${params.join("&")}` : path;
}

function isInlineUrl(url: string): boolean {
  return url.startsWith("blob:") || url.startsWith("data:");
}

function migrateImageUrl(url: string): string {
  if (isInlineUrl(url)) return url;

  const parts = url.split("?");
  let path = parts[0] ?? "";
  const rest = parts.slice(1);
  if (path.endsWith(LEGACY_THUMB_SUFFIX)) {
    path = path.slice(0, -LEGACY_THUMB_SUFFIX.length);
  }
  const query = rest.length ? `?${rest.join("?")}` : "";

  let clean = `${path}${query}`;
  clean = clean.replace(/^\/\/image\.tiwat\.cn/, IMAGE_HOST);
  clean = clean.replace(LEGACY_IMAGE_HOST_RE, IMAGE_HOST);

  if (clean.startsWith("//")) {
    clean = `https:${clean}`;
  }
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
    clean = clean.replace(/^\/+/, "");
    clean = `${IMAGE_HOST}/${clean}`;
  }

  return clean;
}

/**
 * 返回可直接展示或保存的媒体 URL：
 * - 重写旧域名 image.tiwat.cn 到 im.tiwat.cn
 * - 去掉旧七牛云的 -small.webp 后缀
 * - 相对路径补齐为图片 CDN 绝对 URL
 * - blob/data URL 原样返回
 */
export function toMediaUrl(url: string | undefined): string {
  if (!url) return "";
  if (isInlineUrl(url)) return url;
  return migrateImageUrl(url);
}

/**
 * 返回「无 image_process 缩略图参数」的原图 URL，用于正文 / 详情大图。
 */
export function toCanonicalUrl(url: string | undefined): string {
  if (!url) return "";
  if (isInlineUrl(url)) return url;
  return stripImageProcess(migrateImageUrl(url));
}

/**
 * 生成缩略图 URL：
 * - 本地 blob/data 预览不动
 * - 去掉旧七牛云的 -small.webp 后缀
 * - 将旧 image.tiwat.cn 域名迁移到新 R2 域名 im.tiwat.cn
 * - 避免重复追加 image_process
 */
export function toThumbUrl(url: string | undefined, width = 360): string {
  if (!url) return "";
  if (isInlineUrl(url)) return url;

  const clean = migrateImageUrl(url);
  if (clean.includes("image_process=")) return clean;

  const sep = clean.includes("?") ? "&" : "?";
  return `${clean}${sep}${getResizeProcess(width)}`;
}

/**
 * 保持原图尺寸，仅转换为 WebP 并压缩到 q_80 的 URL。
 * 名片等宽幅图片不适合缩略图时使用，避免被 resize 后模糊。
 */
export function toNoResizeWebpUrl(url: string | undefined): string {
  if (!url) return "";
  if (isInlineUrl(url)) return url;

  const clean = migrateImageUrl(url);
  if (clean.includes("image_process=")) return clean;

  const sep = clean.includes("?") ? "&" : "?";
  return `${clean}${sep}${getNoResizeProcess()}`;
}
