// @nuxt/image 自定义 provider：七牛云（image.tiwat.cn）图片处理。
//
// 七牛「图片基本处理」fop 形如：
//   https://image.tiwat.cn/<key>?imageView2/2/w/640/format/webp/q/80
//   - mode 2：等比缩略、不裁剪（配合 CSS object-fit 即可）
//   - mode 1：限定宽高并裁剪填充（需同时给 w 和 h）
//
// 注意：仅对 image.tiwat.cn 资源拼接 fop；本地兜底图（/images/*.webp）
// 与其它来源一律原样返回，避免把 fop 拼到不支持处理的本地资源上。
//
// 该 fop 在七牛未开通图片处理 / ESA 未透传 query 时会被忽略并返回原图
// （已实测），因此本 provider 属于「优雅降级」——开通后自动生效，无需改前端。

interface QiniuModifiers {
  width?: number | string;
  height?: number | string;
  format?: string;
  quality?: number | string;
  fit?: string;
}

interface GetImageOptions {
  modifiers?: QiniuModifiers;
  baseURL?: string;
}

const QINIU_HOST = "image.tiwat.cn";
const DEFAULT_QUALITY = 80;

function toPositiveInt(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function getImage(src: string, { modifiers = {} }: GetImageOptions = {}) {
  // 非七牛资源（本地兜底图、第三方）原样返回。
  if (typeof src !== "string" || !src.includes(QINIU_HOST)) {
    return { url: src };
  }

  const width = toPositiveInt(modifiers.width);
  const height = toPositiveInt(modifiers.height);
  const quality = toPositiveInt(modifiers.quality) ?? DEFAULT_QUALITY;
  const { format, fit } = modifiers;

  // 同时有宽高且要求裁剪填充时用 mode 1，否则等比缩略 mode 2。
  const mode = fit === "cover" && width && height ? "1" : "2";
  const ops: string[] = ["imageView2", mode];
  if (width) ops.push("w", String(width));
  if (height) ops.push("h", String(height));
  if (format) ops.push("format", format);
  ops.push("q", String(quality));

  const fop = ops.join("/");
  const sep = src.includes("?") ? "&" : "?";
  return { url: `${src}${sep}${fop}` };
}

// @nuxt/image 期望 provider 默认导出可被运行时校验的 validateDomains 标记，
// 这里无需额外校验（域名白名单在 image.domains 配置）。
export const validateDomains = true;
