import { thumbHashToDataURL } from "thumbhash";

// 同一张封面在虚拟列表里会反复挂载，解码结果按 hash 缓存。
// 上限防止长时间刷首页时无限增长（每条约 1–2KB 的 PNG data URL）。
const MAX_ENTRIES = 600;
const cache = new Map<string, string>();

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** base64 ThumbHash → 可直接当 background-image 的 data URL；无效输入返回空串。 */
export function thumbhashToDataUrl(hash: string | undefined): string {
  if (!hash) return "";
  const hit = cache.get(hash);
  if (hit !== undefined) return hit;
  let url = "";
  try {
    url = thumbHashToDataURL(base64ToBytes(hash));
  } catch {
    url = "";
  }
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(hash, url);
  return url;
}
