import type PhotoSwipe from "photoswipe";
import type { SlideData } from "photoswipe";
import { toThumbUrl } from "~/utils/image";

export interface GalleryImage {
  src: string;
  thumb?: string;
  width?: number;
  height?: number;
  /**
   * 页面上对应的那张缩略图：打开时从它放大出来，关闭时缩回它的位置。
   * 不给、已不在 DOM 里或滚出视口时退化为淡入淡出。
   * 缩略图会随画廊切换而重新渲染时（如封面轮播）传函数，关闭时再取。
   */
  element?: HTMLElement | null | (() => HTMLElement | null | undefined);
}

export interface OpenGalleryOptions {
  /** 画廊里切到第 index 张时回调（宿主可同步自己的轮播，让关闭动画缩回正确位置）。 */
  onChange?: (index: number) => void;
}

/** 没有宽高的图片（老数据）量不出尺寸前，先按缩略图比例和这个长边猜一个。 */
const FALLBACK_LONG_EDGE = 1600;
/** 打开时最多等这么久去量当前那张的真实尺寸，量不到就先用猜的，量到后再刷新。 */
const OPENING_MEASURE_WAIT_MS = 1500;

let modulePromise: Promise<typeof import("photoswipe").default> | null = null;

function ensureModule() {
  if (modulePromise) return modulePromise;
  modulePromise = Promise.all([
    import("photoswipe"),
    import("photoswipe/style.css" as string),
  ]).then(([mod]) => mod.default);
  return modulePromise;
}

// 模块级共享计数：任意一个画廊打开都会 +1。
// 用于让宿主组件（如委托弹窗）判断「当前是否有大图预览打开」，
// 避免 ESC 在关闭大图的同时把宿主弹窗也一起关掉。
const _openGalleryCount = ref(0);
export const isAnyGalleryOpen = computed(() => _openGalleryCount.value > 0);

type ThumbSource = GalleryImage["element"];
type GallerySlide = SlideData & { thumbEl?: ThumbSource };
type Size = { w: number; h: number };

const resolveThumb = (source: ThumbSource) => (typeof source === "function" ? source() : source) ?? null;

/** 加载一张图拿到天然尺寸（顺便进了浏览器缓存，画廊里再显示就不用重新下载）；失败给 null。 */
function measureImage(src: string): Promise<Size | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function guessSize(image: GalleryImage): Size {
  const el = resolveThumb(image.element);
  const ratio = el instanceof HTMLImageElement && el.naturalWidth ? el.naturalWidth / el.naturalHeight : 0;
  if (!ratio) return { w: FALLBACK_LONG_EDGE, h: FALLBACK_LONG_EDGE };
  return ratio >= 1
    ? { w: FALLBACK_LONG_EDGE, h: Math.round(FALLBACK_LONG_EDGE / ratio) }
    : { w: Math.round(FALLBACK_LONG_EDGE * ratio), h: FALLBACK_LONG_EDGE };
}

/**
 * 缩略图在屏幕上实际显示图片的那块区域。
 * object-fit: contain 的图（帖子封面）要扣掉留白，cover 的图（评论九宫格）交给裁切动画。
 */
function thumbBoundsOf(slide: GallerySlide) {
  const el = resolveThumb(slide.thumbEl);
  if (!el || !el.isConnected) return undefined;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return undefined;
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
    return undefined;
  }
  const iw = Number(slide.width) || rect.width;
  const ih = Number(slide.height) || rect.height;
  const fit = getComputedStyle(el).objectFit;

  if (fit === "cover") {
    const scale = Math.max(rect.width / iw, rect.height / ih);
    const offsetX = (rect.width - iw * scale) / 2;
    const offsetY = (rect.height - ih * scale) / 2;
    return {
      x: rect.left + offsetX,
      y: rect.top + offsetY,
      w: iw * scale,
      // 与 PhotoSwipe 内置 getCroppedBoundsByElement 的约定一致
      innerRect: { w: rect.width, h: rect.height, x: offsetX, y: offsetY },
    };
  }
  if (fit === "contain" || fit === "scale-down") {
    const scale = Math.min(rect.width / iw, rect.height / ih);
    return {
      x: rect.left + (rect.width - iw * scale) / 2,
      y: rect.top + (rect.height - ih * scale) / 2,
      w: iw * scale,
    };
  }
  return { x: rect.left, y: rect.top, w: rect.width };
}

function downloadName(src: string) {
  try {
    return decodeURIComponent(new URL(src, location.href).pathname.split("/").pop() || "image");
  } catch {
    return "image";
  }
}

export function useImageGallery() {
  let pswp: PhotoSwipe | null = null;
  let _counted = false;
  const isOpen = ref(false);

  function _markOpen() {
    if (_counted) return;
    _counted = true;
    _openGalleryCount.value++;
  }

  function _markClosed() {
    if (!_counted) return;
    _counted = false;
    _openGalleryCount.value = Math.max(0, _openGalleryCount.value - 1);
  }

  const isLoading = ref(false);
  const loadingProgress = ref(0);
  let _tickInterval: ReturnType<typeof setInterval> | null = null;
  let _fadeTimer: ReturnType<typeof setTimeout> | null = null;

  function _clearLoadingTimers() {
    if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
    if (_fadeTimer) { clearTimeout(_fadeTimer); _fadeTimer = null; }
  }

  function _startTicking() {
    if (_tickInterval) return;
    _tickInterval = setInterval(() => {
      loadingProgress.value += (90 - loadingProgress.value) * 0.1;
    }, 150);
  }

  function _finishLoading() {
    _clearLoadingTimers();
    loadingProgress.value = 100;
    _fadeTimer = setTimeout(() => {
      isLoading.value = false;
      loadingProgress.value = 0;
    }, 350);
  }

  function preload() {
    void ensureModule();
  }

  async function openGallery(images: GalleryImage[], index = 0, options: OpenGalleryOptions = {}) {
    if (!images.length || pswp) return;

    isLoading.value = true;
    loadingProgress.value = 10;
    _startTicking();

    const startIndex = Math.min(Math.max(index, 0), images.length - 1);
    // 没有宽高的图片在后台量真实尺寸
    const probes = images.map((image) => (image.width && image.height ? null : measureImage(image.src)));
    const openingProbe = probes[startIndex];
    const [PhotoSwipeCtor, openingSize] = await Promise.all([
      ensureModule(),
      openingProbe
        ? Promise.race([openingProbe, new Promise<null>((r) => setTimeout(() => r(null), OPENING_MEASURE_WAIT_MS))])
        : null,
    ]);
    _finishLoading();

    const slides = images.map((image, i): GallerySlide => {
      const size: Size = image.width && image.height
        ? { w: image.width, h: image.height }
        : (i === startIndex && openingSize) || guessSize(image);
      return {
        src: image.src,
        msrc: image.thumb || toThumbUrl(image.src),
        width: size.w,
        height: size.h,
        alt: "",
        thumbEl: image.element ?? null,
      };
    });

    const multiImage = slides.length > 1;
    const instance = new PhotoSwipeCtor({
      dataSource: slides,
      index: startIndex,
      showHideAnimationType: "zoom",
      bgOpacity: 0.92,
      loop: multiImage,
      counter: multiImage,
      arrowPrev: multiImage,
      arrowNext: multiImage,
      // 桌面端滚轮直接缩放（默认要按住 Ctrl）
      wheelToZoom: true,
      // 默认 fit 屏幕；点击 / 双击放大到原图，最大 4 倍
      secondaryZoomLevel: 2,
      maxZoomLevel: 4,
      imageClickAction: "zoom-or-close",
      tapAction: "toggle-controls",
      doubleTapAction: "zoom",
      closeTitle: "关闭",
      zoomTitle: "缩放",
      arrowPrevTitle: "上一张",
      arrowNextTitle: "下一张",
      errorMsg: "图片加载失败",
      indexIndicatorSep: " / ",
      mainClass: "ik-pswp",
    });
    pswp = instance;

    // 取不到位置时返回 undefined，PhotoSwipe 会自动改用淡入淡出（类型声明没写出这一点）
    instance.addFilter(
      "thumbBounds",
      (bounds, itemData) => (thumbBoundsOf(itemData as GallerySlide) ?? bounds) as NonNullable<typeof bounds>,
    );

    // 下载按钮（移动端长按保存即可，只在桌面端显示）
    instance.on("uiRegister", () => {
      instance.ui?.registerElement({
        name: "download",
        order: 8,
        isButton: true,
        tagName: "a",
        title: "下载",
        html: {
          isCustomSVG: true,
          inner: '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
          outlineID: "pswp__icn-download",
        },
        onInit: (el, p) => {
          const link = el as HTMLAnchorElement;
          link.target = "_blank";
          link.rel = "noopener";
          const sync = () => {
            const src = String(p.currSlide?.data.src || "");
            link.href = src;
            link.download = downloadName(src);
          };
          p.on("change", sync);
          sync();
        },
      });
    });

    instance.on("change", () => options.onChange?.(instance.currIndex));

    // 用 destroy（关闭动画结束后）而不是 close 计数：ESC 关大图时宿主弹窗的 keydown
    // 还要能看到「画廊仍开着」，否则会被一起关掉。
    instance.on("destroy", () => {
      if (pswp === instance) pswp = null;
      isOpen.value = false;
      _markClosed();
    });

    isOpen.value = true;
    _markOpen();
    instance.init();

    // 量到真实尺寸后刷新对应那张（猜错的尺寸会影响缩放上限和关闭动画）
    probes.forEach((probe, i) => {
      void probe?.then((size) => {
        const data = slides[i];
        if (!size || pswp !== instance || !data) return;
        if (data.width === size.w && data.height === size.h) return;
        data.width = size.w;
        data.height = size.h;
        instance.refreshSlideContent(i);
      });
    });
  }

  function openImage(src: string, element?: HTMLElement | null) {
    return openGallery([{ src, element }], 0);
  }

  function destroy() {
    pswp?.destroy();
    pswp = null;
    isOpen.value = false;
    _markClosed();
  }

  return { isOpen: readonly(isOpen), isLoading: readonly(isLoading), loadingProgress: readonly(loadingProgress), openGallery, openImage, preload, destroy };
}
