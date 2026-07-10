const THUMB_PROCESS = "image_process=resize,w_360/format,webp/quality,q_80";
const LEGACY_IMAGE_HOST_RE = /^https?:\/\/image\.tiwat\.cn/;

/**
 * 生成缩略图 URL：
 * - 本地 blob/data 预览不动
 * - 去掉旧七牛云的 `-small.webp` 后缀
 * - 将旧 `image.tiwat.cn` 域名迁移到新 R2 域名 `im.tiwat.cn`
 * - 避免重复追加 `image_process`
 */
export function toThumbUrl(url: string | undefined): string {
  if (!url) return "";
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;

  let clean = url;
  if (clean.endsWith("-small.webp")) {
    clean = clean.slice(0, -"-small.webp".length);
  }

  clean = clean.replace(LEGACY_IMAGE_HOST_RE, "https://im.tiwat.cn");

  if (clean.includes("image_process=")) return clean;

  const sep = clean.includes("?") ? "&" : "?";
  return `${clean}${sep}${THUMB_PROCESS}`;
}
