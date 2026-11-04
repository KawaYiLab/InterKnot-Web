const IMAGE_HOST = "https://im.tiwat.cn";
const LEGACY_IMAGE_HOST_RE = /^https?:\/\/image\.tiwat\.cn/;
const LEGACY_THUMB_SUFFIX = "-small.webp";
const CDN_CGI_IMAGE_RE = /^https?:\/\/[^/]+\/cdn-cgi\/image\//;
const IMAGE_PROCESS_RE = /[?&]image_process=/;

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

function hasImageProcess(url: string): boolean {
  return IMAGE_PROCESS_RE.test(url);
}

function isAppImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "im.tiwat.cn" || host === "image.tiwat.cn";
  } catch {
    return false;
  }
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

function buildEsaImageUrl(canonicalUrl: string, process: string): string {
  const sep = canonicalUrl.includes("?") ? "&" : "?";
  return `${canonicalUrl}${sep}image_process=${process}`;
}

function replaceR2Width(url: string, width: number): string {
  const u = new URL(url);
  const prefix = "/cdn-cgi/image/";
  if (!u.pathname.startsWith(prefix)) return url;

  const rest = u.pathname.slice(prefix.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) return url;

  const options = rest.slice(0, slashIdx);
  const path = rest.slice(slashIdx);

  const opts = options
    .split(",")
    .filter((o) => !o.startsWith("width=") && o.trim());
  opts.unshift(`width=${width}`);

  u.pathname = `${prefix}${opts.join(",")}${path}`;
  return u.toString();
}

function removeR2Width(url: string): string {
  const u = new URL(url);
  const prefix = "/cdn-cgi/image/";
  if (!u.pathname.startsWith(prefix)) return url;

  const rest = u.pathname.slice(prefix.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) return url;

  const options = rest.slice(0, slashIdx);
  const path = rest.slice(slashIdx);

  const opts = options.split(",").filter((o) => !o.startsWith("width=") && o.trim());

  u.pathname = `${prefix}${opts.join(",")}${path}`;
  return u.toString();
}

function ensureEsaResizeWidth(url: string, width: number): string {
  const canonical = stripImageProcessQuery(url);
  return buildEsaImageUrl(canonical, `resize,w_${width}/format,webp/quality,q_80`);
}

function removeEsaWidth(url: string): string {
  const canonical = stripImageProcessQuery(url);
  return buildEsaImageUrl(canonical, "format,webp/quality,q_80");
}

function stripCdnCgiImagePath(url: string): string {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/cdn-cgi/image/")) {
      u.pathname = u.pathname.replace(/^\/cdn-cgi\/image\/[^/]+\//, "/");
      return u.toString();
    }
  } catch {
    // ignore malformed URLs
  }
  return url;
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
 * 把本站原图地址换成 Cloudflare 图片变换的原尺寸 WebP 地址。
 * 后端对超过 10MB 的图给的是这种缩略图（ESA 处理不了大图），前端沿用同一服务，
 * 之后 toThumbUrl / toNoResizeWebpUrl 只替换宽度，toCanonicalUrl 仍能还原原图。
 */
export function toCdnCgiImageUrl(url: string): string {
  const clean = migrateImageUrl(url);
  if (isCdnCgiImageUrl(clean) || !isAppImageHost(clean)) return clean;
  const u = new URL(stripImageProcessQuery(clean));
  u.pathname = `/cdn-cgi/image/format=webp,quality=80${u.pathname}`;
  return u.toString();
}

/**
 * 返回「无 ESA / R2 缩略图参数」的原图 URL，用于正文 / 详情大图。
 */
export function toCanonicalUrl(url: string | undefined): string {
  if (!url) return "";
  if (isInlineUrl(url)) return url;

  let clean = migrateImageUrl(url);
  clean = stripCdnCgiImagePath(clean);
  clean = stripImageProcessQuery(clean);
  return clean;
}

/**
 * 生成缩略图 URL：
 * - 若 url 已是 R2 /cdn-cgi/image 或 ESA image_process 缩略图，保持同一服务并替换宽度；
 * - 若 url 不是本站图片 CDN（如 Bilibili 等外部封面），原样返回；
 * - 否则回退到 ESA 参数（canonical 原图一般由后端包装过，前端不自行决定 R2）。
 */
export function toThumbUrl(url: string | undefined, width = 360): string {
  if (!url) return "";
  if (isInlineUrl(url)) return url;

  const clean = migrateImageUrl(url);

  if (isCdnCgiImageUrl(clean)) {
    return replaceR2Width(clean, width);
  }

  if (hasImageProcess(clean)) {
    return ensureEsaResizeWidth(clean, width);
  }

  // 外部封面图（如 Bilibili）不需要/不支持 ESA 处理，直接返回原图。
  if (!isAppImageHost(clean)) {
    return clean;
  }

  return buildEsaImageUrl(clean, `resize,w_${width}/format,webp/quality,q_80`);
}

/**
 * 瀑布流卡片封面缩略图：卡片宽约 170–330px，按屏幕倍率取 360 / 480 / 720 三档
 * （沿用既有档位，CDN 缓存能命中）。1x 屏取 720 等于多解码 4 倍像素，
 * 滚动时解码排队会出白块。委托弹窗的 blur-up 占位图复用同一 URL，直接命中卡片已加载的缓存。
 */
export function toCardCoverThumbUrl(url: string | undefined): string {
  return toThumbUrl(url, cardCoverThumbWidth());
}

function cardCoverThumbWidth(): number {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  if (dpr <= 1.2) return 360;
  if (dpr <= 1.6) return 480;
  return 720;
}

/** 卡片 / 列表里的小头像（显示 42px 左右）：128px 够 3x 屏，后端默认给的是 360px。 */
export function toAvatarThumbUrl(url: string | undefined): string {
  return toThumbUrl(url, 128);
}

/**
 * 保持原图尺寸，仅转换为 WebP 并压缩到 quality=80 的 URL。
 */
export function toNoResizeWebpUrl(url: string | undefined): string {
  if (!url) return "";
  if (isInlineUrl(url)) return url;

  const clean = migrateImageUrl(url);

  if (isCdnCgiImageUrl(clean)) {
    return removeR2Width(clean);
  }

  if (hasImageProcess(clean)) {
    return removeEsaWidth(clean);
  }

  return buildEsaImageUrl(clean, "format,webp/quality,q_80");
}
