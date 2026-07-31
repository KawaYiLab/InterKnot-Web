const IMAGE_HOST = "https://im.tiwat.cn";
const LEGACY_IMAGE_HOST_RE = /^https?:\/\/image\.tiwat\.cn/;
const LEGACY_THUMB_SUFFIX = "-small.webp";
const CDN_CGI_IMAGE_RE = /^https?:\/\/[^/]+\/cdn-cgi\/image\//;

const THUMB_OPTIONS = "format=webp,quality=80";

function getThumbOptions(width = 360): string {
  return `width=${width},${THUMB_OPTIONS}`;
}

function getNoResizeOptions(): string {
  return THUMB_OPTIONS;
}

function isInlineUrl(url: string): boolean {
  return url.startsWith("blob:") || url.startsWith("data:");
}

function stripLegacyThumbSuffix(url: string): string {
  if (!url.includes(LEGACY_THUMB_SUFFIX)) return url;
  const parts = url.split("?");
  const path = parts[0] ?? "";
  if (!path.endsWith(LEGACY_THUMB_SUFFIX)) return url;
  const newPath = path.slice(0, -LEGACY_THUMB_SUFFIX.length);
  return parts.length > 1 ? `${newPath}?${parts.slice(1).join("?")}` : newPath;
}

function stripImageProcessQuery(url: string): string {
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

function isCdnCgiImageUrl(url: string): boolean {
  return CDN_CGI_IMAGE_RE.test(url);
}

function migrateImageUrl(url: string): string {
  if (isInlineUrl(url)) return url;

  let clean = stripLegacyThumbSuffix(url);
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

function buildCdnCgiImageUrl(canonicalUrl: string, options: string): string {
  const u = new URL(canonicalUrl);
  u.pathname = `/cdn-cgi/image/${options}${u.pathname}`;
  return u.toString();
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
 * 返回「无 R2 图像转换参数」的原图 URL，用于正文 / 详情大图。
 */
export function toCanonicalUrl(url: string | undefined): string {
  if (!url) return "";
  if (isInlineUrl(url)) return url;

  let clean = migrateImageUrl(url);

  try {
    const u = new URL(clean);
    if (u.pathname.startsWith("/cdn-cgi/image/")) {
      u.pathname = u.pathname.replace(/^\/cdn-cgi\/image\/[^/]+\//, "/");
      clean = u.toString();
    }
  } catch {
    // ignore malformed URLs
  }

  clean = stripImageProcessQuery(clean);
  return clean;
}

/**
 * 生成缩略图 URL（R2 图像转换）：
 * - 本地 blob/data 预览不动
 * - 去掉旧七牛云的 -small.webp 后缀
 * - 将旧 image.tiwat.cn 域名迁移到新 R2 域名 im.tiwat.cn
 * - 避免重复追加 cdn-cgi/image 参数
 */
export function toThumbUrl(url: string | undefined, width = 360): string {
  if (!url) return "";
  if (isInlineUrl(url)) return url;

  let clean = migrateImageUrl(url);
  if (isCdnCgiImageUrl(clean)) return clean;

  clean = stripImageProcessQuery(clean);
  return buildCdnCgiImageUrl(clean, getThumbOptions(width));
}

/**
 * 保持原图尺寸，仅转换为 WebP 并压缩到 quality=80 的 URL。
 * 名片等宽幅图片不适合缩略图时使用，避免被 resize 后模糊。
 */
export function toNoResizeWebpUrl(url: string | undefined): string {
  if (!url) return "";
  if (isInlineUrl(url)) return url;

  let clean = migrateImageUrl(url);
  if (isCdnCgiImageUrl(clean)) return clean;

  clean = stripImageProcessQuery(clean);
  return buildCdnCgiImageUrl(clean, getNoResizeOptions());
}
