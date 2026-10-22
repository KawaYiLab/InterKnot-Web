<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    /**
     * 暂停动画。用于全屏弹窗打开时暂停「被遮住的」全局跑马灯：它此刻完全
     * 不可见，却仍在动，且位于弹窗 backdrop-filter 模糊之后 —— 动画会迫使
     * 模糊每帧重算，纯属浪费。暂停后弹窗自己的那份跑马灯照常显示。
     */
    paused?: boolean;
  }>(),
  { paused: false },
);

/**
 * 单个平铺单元 = 一个词 + 词后留白。
 *
 * Web 的视觉重复周期本来就是「一个 INTERKNOT」，所以真正的轨道只需要
 * 覆盖「可视宽度 + 一个词」；具体用几份由 [tile].k 在运行时算。
 */
const LINE = "INTERKNOT";
const WORD = `${LINE} `;

/** 贴图就绪前的 DOM 兜底：2 个 span × 2 个词 = 4 个词，平移 -25% = 恰好一个词。 */
const DOM_LINE = WORD.repeat(2);

/** 三行的方向，与下方 keyframes 对应（第三行额外加相位差）。 */
const ROWS = ["ltr", "rtl", "ltr"] as const;

/** 等弹窗入场动画结束后再启动，避免与 blur/transform 争抢 GPU */
const MARQUEE_START_DELAY_MS = 250;

// ── 贴图烘焙参数（对齐 Android `IkZzzMarquee.kt` 的 TileScale / MaxTilePx） ──

/** 贴图相对真实尺寸的缩放。巨型字母在 7% 白下边缘软一点完全不可分辨。 */
const TILE_SCALE = 0.25;
/** 贴图宽度硬上限，把纹理尺寸握在手里而不是赌设备的 GPU 上限。 */
const MAX_TILE_PX = 2048;
/** 缓存槽位数。全局实例 + 弹窗实例通常只有 2 种字号。 */
const TILE_CACHE_LIMIT = 4;

/** 与 CSS `line-height: .74` 对齐；贴图高度按它算。 */
const ROW_HEIGHT_EM = 0.74;
/** 与 CSS `letter-spacing: -.04em` 对齐。 */
const LETTER_SPACING_EM = -0.04;
/** 与 CSS `padding-right: .15em` 对齐。 */
const TRAILING_PAD_EM = 0.15;

type TileArt = {
  url: string;
  wordWidth: number;
  rowHeight: number;
};

type Tile = TileArt & {
  /** 轨道要铺几个词：`k * wordWidth ≥ 可视宽度 + wordWidth`，保证平移期间不露缝。 */
  k: number;
};

const rootEl = ref<HTMLElement | null>(null);
const bandEl = ref<HTMLElement | null>(null);
const tile = ref<Tile | null>(null);

const running = ref(false);
let startTimer: ReturnType<typeof setTimeout> | null = null;

const isRunning = computed(() => running.value && !props.paused);

/**
 * 贴图轨道的内联样式：宽度、平铺图、平铺尺寸。
 * 宽度取 k 个词，keyframes 每次平移恰好一个词（-100% / k）。
 */
const tileStyle = computed(() => {
  const current = tile.value;
  if (!current) return undefined;
  return {
    width: `${current.wordWidth * current.k}px`,
    backgroundImage: `url(${current.url})`,
    backgroundSize: `${current.wordWidth}px 100%`,
  };
});

// ── 贴图缓存 ─────────────────────────────────────────────────────────
// 同一字号 / DPR / 颜色下，所有实例（全局底纹 + 每个弹窗）共享同一张图，
// 浏览器按 URL 只解码一次；这和 Android 的 TileCache 是同一个目的。
const tileArtCache = new Map<string, TileArt>();

function cacheGet(key: string): TileArt | null {
  const hit = tileArtCache.get(key);
  if (!hit) return null;
  // 刷新 LRU 顺序
  tileArtCache.delete(key);
  tileArtCache.set(key, hit);
  return hit;
}

function cachePut(key: string, art: TileArt) {
  tileArtCache.set(key, art);
  while (tileArtCache.size > TILE_CACHE_LIMIT) {
    const oldest = tileArtCache.keys().next().value;
    if (oldest === undefined) break;
    tileArtCache.delete(oldest);
  }
}

/**
 * 把一个词烘焙成小尺寸 PNG：字号按 [TILE_SCALE] 降采样、宽度设硬上限，
 * 画进 canvas 后由 CSS `background-size` 放大回真实词宽。
 *
 * 只量一次、只画一次；之后每帧只是平移一张已解码的贴图，不再有任何字形
 * 栅格化或文本 shaping。
 */
function buildTileArt(
  fontSizePx: number,
  color: string,
  fontFamily: string,
  fontWeight: string,
  dpr: number,
): TileArt | null {
  if (typeof document === "undefined" || !(fontSizePx > 0)) return null;

  const key = `${fontSizePx}|${dpr}|${color}|${fontWeight}|${fontFamily}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const rowHeight = fontSizePx * ROW_HEIGHT_EM;
  const spacing = LETTER_SPACING_EM * fontSizePx;
  const padding = TRAILING_PAD_EM * fontSizePx;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const font = `${fontWeight} ${fontSizePx}px ${fontFamily}`;
  ctx.font = font;

  // letterSpacing 是较新的 canvas 能力（Safari 17.4+）。支持时整词一次绘制、
  // 保留字形之间的 kerning；不支持时逐字符累加，kerning 丢失但对 7% 底纹无感。
  const spacingCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  // 不用 `"letterSpacing" in ctx`：TS 会把它当成判别式收窄，把负分支推成 never。
  const supportsSpacing = "letterSpacing" in (ctx as object);
  if (supportsSpacing) spacingCtx.letterSpacing = `${spacing}px`;

  const spaceWidth = ctx.measureText(" ").width;
  let wordWidth: number;
  if (supportsSpacing) {
    wordWidth = ctx.measureText(LINE).width + spaceWidth + spacing + padding;
  } else {
    let advance = 0;
    for (const ch of LINE) advance += ctx.measureText(ch).width + spacing;
    wordWidth = advance + spaceWidth + spacing + padding;
  }
  if (!(wordWidth > 0) || !(rowHeight > 0)) return null;

  const scale = Math.min(TILE_SCALE, MAX_TILE_PX / (wordWidth * dpr));
  if (!(scale > 0)) return null;

  canvas.width = Math.max(1, Math.round(wordWidth * dpr * scale));
  canvas.height = Math.max(1, Math.round(rowHeight * dpr * scale));

  // 用画布的实际像素尺寸反算缩放，抹掉上面取整造成的比例误差 ——
  // 否则每次平铺都会积累几个像素的错位，接缝可见。
  ctx.setTransform(canvas.width / wordWidth, 0, 0, canvas.height / rowHeight, 0, 0);
  ctx.font = font;
  if (supportsSpacing) spacingCtx.letterSpacing = `${spacing}px`;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";

  // 墨迹在行带内垂直居中：全大写没有下伸部，按 font metrics 摆会整体偏低。
  const ink = ctx.measureText(LINE);
  const inkAscent = ink.actualBoundingBoxAscent || fontSizePx * 0.72;
  const inkDescent = ink.actualBoundingBoxDescent || 0;
  const baseline = (rowHeight - (inkAscent + inkDescent)) / 2 + inkAscent;

  if (supportsSpacing) {
    ctx.fillText(LINE, 0, baseline);
  } else {
    let x = 0;
    for (const ch of LINE) {
      ctx.fillText(ch, x, baseline);
      x += ctx.measureText(ch).width + spacing;
    }
  }

  const art: TileArt = { url: canvas.toDataURL("image/png"), wordWidth, rowHeight };
  cachePut(key, art);
  return art;
}

let rebuildRaf = 0;

function scheduleRebuild() {
  if (rebuildRaf || typeof window === "undefined") return;
  rebuildRaf = window.requestAnimationFrame(() => {
    rebuildRaf = 0;
    rebuild();
  });
}

/** 读取当前容器算出的字号 / 颜色 / 字体，重建或复用贴图，并算出轨道份数 k。 */
function rebuild() {
  const root = rootEl.value;
  const band = bandEl.value;
  if (!root || !band) return;

  const bandStyle = getComputedStyle(band);
  const fontSizePx = Number.parseFloat(bandStyle.fontSize);
  const row = band.querySelector<HTMLElement>(".ik-zzz-marquee__row");
  if (!row) return;

  const art = buildTileArt(
    fontSizePx,
    getComputedStyle(root).color,
    bandStyle.fontFamily,
    // 与 `.ik-zzz-marquee__text` 的 font-weight 保持一致；band 本身继承的是 400
    "800",
    Math.min(window.devicePixelRatio || 1, 3),
  );
  if (!art) return;

  // clientWidth 是布局宽度，不受弹窗入场时的 scale 动画影响（getBoundingClientRect 会）。
  // +2 吃掉整数取整，避免理论上留出亚像素缝。
  const visibleWidth = row.clientWidth + 2;
  const k = Math.max(2, Math.min(4, Math.ceil((visibleWidth + art.wordWidth) / art.wordWidth)));

  const current = tile.value;
  if (current && current.url === art.url && current.k === k) return;
  tile.value = { ...art, k };
}

let resizeObserver: ResizeObserver | null = null;

/**
 * 品牌字体是 1.8MB、`font-display: swap`。必须等字形真正可用再烘焙，
 * 否则贴图里会永久固化系统 fallback 的字形。
 */
async function waitForBrandFont() {
  try {
    await document.fonts?.load('800 16px "InterKnot Sans"');
    await document.fonts?.ready;
  } catch {
    // 加载失败：用 fallback 栈烘焙，视觉上仍是同一套降级逻辑
  }
}

onMounted(() => {
  startTimer = setTimeout(() => {
    running.value = true;
    startTimer = null;
  }, MARQUEE_START_DELAY_MS);

  if (rootEl.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(scheduleRebuild);
    resizeObserver.observe(rootEl.value);
  }

  void waitForBrandFont().then(() => {
    // 字体到位前 ResizeObserver 可能已经用 fallback 字形烘焙过一张贴图，
    // 而缓存键里没有「字体是否就绪」——不清掉的话会一直命中 fallback。
    tileArtCache.clear();
    scheduleRebuild();
  });
});

onBeforeUnmount(() => {
  if (startTimer !== null) {
    clearTimeout(startTimer);
    startTimer = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (rebuildRaf) {
    cancelAnimationFrame(rebuildRaf);
    rebuildRaf = 0;
  }
});
</script>

<template>
  <div ref="rootEl" class="ik-zzz-marquee" :class="{ 'is-running': isRunning }" aria-hidden="true">
    <div ref="bandEl" class="ik-zzz-marquee__band">
      <div
        v-for="(direction, index) in ROWS"
        :key="index"
        class="ik-zzz-marquee__row"
        :class="[
          `ik-zzz-marquee__row--${direction}`,
          {
            'ik-zzz-marquee__row--offset': index === 2,
            'ik-zzz-marquee__row--tiled': tile !== null,
          },
        ]"
      >
        <!-- 贴图就绪后：整个轨道只是一张平铺图，平移量 = 恰好一个词 -->
        <div
          v-if="tile"
          class="ik-zzz-marquee__track ik-zzz-marquee__track--tiled"
          :class="`ik-zzz-marquee__track--k${tile.k}`"
          :style="tileStyle"
        />
        <!-- 兜底：贴图未就绪（首帧、字体加载中、canvas 不可用）时用真实文字 -->
        <div v-else class="ik-zzz-marquee__track">
          <span class="ik-zzz-marquee__text">{{ DOM_LINE }}</span>
          <span class="ik-zzz-marquee__text">{{ DOM_LINE }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 轨道一次平移一个词：
   DOM 兜底版是 4 个词宽，-25% = 1 个词；
   贴图版是 k 个词宽，-100% / k = 1 个词。 */
@keyframes ik-zzz-marquee-ltr {
  from { transform: translate3d(-25%, 0, 0); }
  to { transform: translate3d(0, 0, 0); }
}

@keyframes ik-zzz-marquee-rtl {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(-25%, 0, 0); }
}

/* 贴图轨道：每个 keyframe 的位移都恰好等于一个词宽（-100% / k） */
@keyframes ik-zzz-marquee-tile-k2 {
  from { transform: translate3d(-50%, 0, 0); }
  to { transform: translate3d(0, 0, 0); }
}

@keyframes ik-zzz-marquee-tile-k3 {
  from { transform: translate3d(-33.3333%, 0, 0); }
  to { transform: translate3d(0, 0, 0); }
}

@keyframes ik-zzz-marquee-tile-k4 {
  from { transform: translate3d(-25%, 0, 0); }
  to { transform: translate3d(0, 0, 0); }
}

.ik-zzz-marquee {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  contain: strict;
  /* 让 cqh / cqmax 按本元素尺寸解析：全局实例是视口，弹窗实例是弹窗主体 */
  container-type: size;
  /* 贴图烘焙时从这里读颜色，改主题只需改这一处 */
  color: rgba(255, 255, 255, 0.07);
  /*
   * 屏幕高度上排得下几行。字号 = 100cqh / (rows × line-height)，
   * 于是「每屏几行」在所有尺寸下恒定，不会像 clamp 那样在某个区间里
   * 字号锁死、密度随视口高度漂移。
   * 桌面弹窗 3.25 行 ≈ 1080p 上原来的 400px；手机 2.9 行 ≈ 原来的 360px。
   */
  --ik-marquee-rows: 3.25;
}

.ik-zzz-marquee__band {
  position: absolute;
  /* 旋转后视口的外接正方形 ≈ hypot(w, h)，任何倾角都够，不必去赌 220% 这类百分比 */
  width: 141.5cqmax;
  height: 141.5cqmax;
  left: 50%;
  top: 50%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 0.006em;
  font-size: calc(100cqh / (var(--ik-marquee-rows) * 0.746));
  transform: translate(-50%, -50%) translateY(5cqh) rotate(-15deg);
}

.ik-zzz-marquee__row {
  flex: 0 0 auto;
  overflow: hidden;
  white-space: nowrap;
  font-size: inherit;
  line-height: 0.74;
}

/* 贴图版没有文字撑高，行高要显式给出来（与 line-height 一致） */
.ik-zzz-marquee__row--tiled {
  height: 0.74em;
}

.ik-zzz-marquee__track {
  display: inline-flex;
  flex-shrink: 0;
  animation-play-state: paused;
  backface-visibility: hidden;
}

.ik-zzz-marquee__row--ltr .ik-zzz-marquee__track {
  animation: ik-zzz-marquee-ltr 133.33s linear infinite;
}

.ik-zzz-marquee__row--rtl .ik-zzz-marquee__track {
  animation: ik-zzz-marquee-rtl 160s linear infinite;
}

/* 第三行错开半个词；原来的 -140s 在 400s / 3 词的节奏下等于 1.05 个词，
   取模后只剩 0.05 —— 第一、三行几乎同相，反而对齐成了机械网格。 */
.ik-zzz-marquee__row--offset .ik-zzz-marquee__track {
  animation-delay: -66.67s;
}

.ik-zzz-marquee__track--tiled {
  display: block;
  height: 100%;
  background-repeat: repeat-x;
  background-position: left top;
}

/* k = 轨道铺几个词。k 个词宽的轨道平移 -100%/k 恰好一个词，图案无缝。 */
.ik-zzz-marquee__track--tiled.ik-zzz-marquee__track--k2 {
  animation-name: ik-zzz-marquee-tile-k2;
}

.ik-zzz-marquee__track--tiled.ik-zzz-marquee__track--k3 {
  animation-name: ik-zzz-marquee-tile-k3;
}

.ik-zzz-marquee__track--tiled.ik-zzz-marquee__track--k4 {
  animation-name: ik-zzz-marquee-tile-k4;
}

/* 贴图 keyframes 统一写成「向右」（-100%/k → 0）：
   ltr 方向本身就是向右，正放；rtl 向左，反向播放。 */
.ik-zzz-marquee__row--ltr .ik-zzz-marquee__track--tiled {
  animation-direction: normal;
}

.ik-zzz-marquee__row--rtl .ik-zzz-marquee__track--tiled {
  animation-direction: reverse;
}

/* 只有真正在跑时才预留合成层：暂停 / reduced-motion / 无 GPU 下不必常驻显存 */
.ik-zzz-marquee.is-running .ik-zzz-marquee__track {
  will-change: transform;
  animation-play-state: running;
}

.ik-zzz-marquee__text {
  display: inline-block;
  padding-right: 0.15em;
  font-size: inherit;
  line-height: inherit;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-transform: uppercase;
  color: inherit;
  white-space: nowrap;
  user-select: none;
  text-rendering: optimizeSpeed;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

@media (prefers-reduced-motion: reduce) {
  /* 必须提高优先级：.ik-zzz-marquee__track--tiled.ik-zzz-marquee__track--k2
     是 (0,2,0)，光靠 .ik-zzz-marquee__track (0,1,0) 盖不住它的 animation-name。 */
  .ik-zzz-marquee .ik-zzz-marquee__track {
    animation: none !important;
  }
}

/* 移动端：只调密度，几何全部由上面的 cqh / cqmax 推导 */
@media (max-width: 1024px) {
  .ik-zzz-marquee {
    --ik-marquee-rows: 3.15;
  }
}
</style>
