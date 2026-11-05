// ThumbHash 解码：与 thumbhash 库（MIT，Evan Wallace）的 thumbHashToDataURL 输出逐字节一致，
// 只是把每个像素都要重算的十几次 cos 提成按行 / 按列的表，PNG 直接写进定长数组。
// 瀑布流每挂一张新卡片都要解一次，库的实现在 4 倍降速下约 1.5ms / 张。

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

function cosTable(size: number, n: number): Float64Array {
  const t = new Float64Array(size * n);
  for (let i = 0; i < size; i++) {
    for (let c = 0; c < n; c++) t[i * n + c] = Math.cos((Math.PI / size) * (i + 0.5) * c);
  }
  return t;
}

function decodeRGBA(hash: Uint8Array): { w: number; h: number; rgba: Uint8Array } {
  const { max, min, round } = Math;
  const header24 = hash[0]! | (hash[1]! << 8) | (hash[2]! << 16);
  const header16 = hash[3]! | (hash[4]! << 8);
  const lDc = (header24 & 63) / 63;
  const pDc = ((header24 >> 6) & 63) / 31.5 - 1;
  const qDc = ((header24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((header24 >> 18) & 31) / 31;
  const hasAlpha = header24 >> 23;
  const pScale = ((header16 >> 3) & 63) / 63;
  const qScale = ((header16 >> 9) & 63) / 63;
  const isLandscape = header16 >> 15;
  const lx = max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7);
  const ly = max(3, isLandscape ? header16 & 7 : hasAlpha ? 5 : 7);
  const aDc = hasAlpha ? (hash[5]! & 15) / 15 : 1;
  const aScale = (hash[5]! >> 4) / 15;

  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  const decodeChannel = (nx: number, ny: number, scale: number) => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
        ac.push((((hash[acStart + (acIndex >> 1)]! >> ((acIndex++ & 1) << 2)) & 15) / 7.5 - 1) * scale);
      }
    }
    return ac;
  };
  const lAc = decodeChannel(lx, ly, lScale);
  const pAc = decodeChannel(3, 3, pScale * 1.25);
  const qAc = decodeChannel(3, 3, qScale * 1.25);
  const aAc = hasAlpha ? decodeChannel(5, 5, aScale) : [];

  // 与库的 thumbHashToApproximateAspectRatio 相同
  const ratioLx = isLandscape ? (hasAlpha ? 5 : 7) : hash[3]! & 7;
  const ratioLy = isLandscape ? hash[3]! & 7 : hasAlpha ? 5 : 7;
  const ratio = ratioLx / ratioLy;
  const w = round(ratio > 1 ? 32 : 32 * ratio);
  const h = round(ratio > 1 ? 32 / ratio : 32);

  // DCT 可分离：先对每一列 x 算好「每个 cy 对应的横向求和」，每个像素只剩 ly 次乘加。
  const nx = max(lx, hasAlpha ? 5 : 3);
  const ny = max(ly, hasAlpha ? 5 : 3);
  const fxT = cosTable(w, nx);
  const fyT = cosTable(h, ny);
  const rowSums = (ac: number[], cxLimit: (cy: number) => number, rows: number) => {
    const out = new Float64Array(rows * w);
    for (let cy = 0, j = 0; cy < rows; cy++) {
      const n = cxLimit(cy);
      for (let cx = cy ? 0 : 1; cx < n; cx++, j++) {
        const coef = ac[j]!;
        for (let x = 0; x < w; x++) out[cy * w + x]! += coef * fxT[x * nx + cx]!;
      }
    }
    return out;
  };
  // L 的横向个数：满足 cx * ly < lx * (ly - cy) 的最大 cx + 1
  const lSums = rowSums(lAc, (cy) => Math.ceil((lx * (ly - cy)) / ly), ly);
  const pSums = rowSums(pAc, (cy) => 3 - cy, 3);
  const qSums = rowSums(qAc, (cy) => 3 - cy, 3);
  const aSums = hasAlpha ? rowSums(aAc, (cy) => 5 - cy, 5) : null;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0, i = 0; y < h; y++) {
    const fy = y * ny;
    for (let x = 0; x < w; x++, i += 4) {
      let l = lDc, p = pDc, q = qDc, a = aDc;
      for (let cy = 0; cy < ly; cy++) l += lSums[cy * w + x]! * fyT[fy + cy]! * 2;
      for (let cy = 0; cy < 3; cy++) {
        const f = fyT[fy + cy]! * 2;
        p += pSums[cy * w + x]! * f;
        q += qSums[cy * w + x]! * f;
      }
      if (aSums) for (let cy = 0; cy < 5; cy++) a += aSums[cy * w + x]! * fyT[fy + cy]! * 2;
      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;
      rgba[i] = max(0, 255 * min(1, r));
      rgba[i + 1] = max(0, 255 * min(1, g));
      rgba[i + 2] = max(0, 255 * min(1, b));
      rgba[i + 3] = max(0, 255 * min(1, a));
    }
  }
  return { w, h, rgba };
}

const CRC_TABLE = [
  0, 498536548, 997073096, 651767980, 1994146192, 1802195444, 1303535960,
  1342533948, -306674912, -267414716, -690576408, -882789492, -1687895376,
  -2032938284, -1609899400, -1111625188,
];

// 不压缩的 PNG（store 块），与库的 rgbaToDataURL 字节一致
function rgbaToPngDataUrl(w: number, h: number, rgba: Uint8Array): string {
  const row = w * 4 + 1;
  const idat = 6 + h * (5 + row);
  const total = 37 + idat + 20;
  const bytes = new Uint8Array(total);
  bytes.set([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0,
    w >> 8, w & 255, 0, 0, h >> 8, h & 255, 8, 6, 0, 0, 0, 0, 0, 0, 0,
    idat >>> 24, (idat >> 16) & 255, (idat >> 8) & 255, idat & 255,
    73, 68, 65, 84, 120, 1,
  ]);
  let k = 43;
  let a = 1, b = 0;
  for (let y = 0, i = 0, end = row - 1; y < h; y++, end += row - 1) {
    bytes[k++] = y + 1 < h ? 0 : 1;
    bytes[k++] = row & 255;
    bytes[k++] = row >> 8;
    bytes[k++] = ~row & 255;
    bytes[k++] = (row >> 8) ^ 255;
    bytes[k++] = 0;
    // Adler-32 的取模放到最后做：数据不到 4KB，中间值远小于 2^53，结果与逐字节取模相同
    for (b += a; i < end; i++) {
      const u = rgba[i]!;
      bytes[k++] = u;
      a += u;
      b += a;
    }
  }
  a %= 65521;
  b %= 65521;
  bytes.set([b >> 8, b & 255, a >> 8, a & 255, 0, 0, 0, 0, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130], k);
  for (const [start, endAt] of [[12, 29], [37, 41 + idat]] as const) {
    let c = ~0;
    for (let i = start; i < endAt; i++) {
      c ^= bytes[i]!;
      c = (c >>> 4) ^ CRC_TABLE[c & 15]!;
      c = (c >>> 4) ^ CRC_TABLE[c & 15]!;
    }
    c = ~c;
    let e = endAt;
    bytes[e++] = c >>> 24;
    bytes[e++] = (c >> 16) & 255;
    bytes[e++] = (c >> 8) & 255;
    bytes[e] = c & 255;
  }
  let bin = "";
  for (let i = 0; i < total; i += 0x2000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000) as unknown as number[]);
  }
  return `data:image/png;base64,${btoa(bin)}`;
}

/** base64 ThumbHash → 可直接当 background-image 的 data URL；无效输入返回空串。 */
export function thumbhashToDataUrl(hash: string | undefined): string {
  if (!hash) return "";
  const hit = cache.get(hash);
  if (hit !== undefined) return hit;
  let url = "";
  try {
    const bytes = base64ToBytes(hash);
    if (bytes.length >= 5) {
      const image = decodeRGBA(bytes);
      url = rgbaToPngDataUrl(image.w, image.h, image.rgba);
    }
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
