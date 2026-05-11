import type { LightGallery } from "lightgallery/lightgallery";

let cssLoaded: Promise<void[]> | null = null;

function ensureCss() {
  if (cssLoaded) return cssLoaded;
  cssLoaded = Promise.all([
    import("lightgallery/css/lightgallery.css" as string),
    import("lightgallery/css/lg-zoom.css" as string),
    import("lightgallery/css/lg-thumbnail.css" as string),
    import("lightgallery/css/lg-fullscreen.css" as string),
    import("lightgallery/css/lg-rotate.css" as string),
    import("lightgallery/css/lg-autoplay.css" as string),
  ]);
  return cssLoaded;
}

export interface GalleryImage {
  src: string;
  thumb?: string;
  width?: number;
  height?: number;
}

let modulesPromise: Promise<any[]> | null = null;

function ensureModules() {
  if (modulesPromise) return modulesPromise;
  modulesPromise = Promise.all([
    import("lightgallery"),
    import("lightgallery/plugins/zoom"),
    import("lightgallery/plugins/thumbnail"),
    import("lightgallery/plugins/fullscreen"),
    import("lightgallery/plugins/rotate"),
    import("lightgallery/plugins/autoplay"),
    ensureCss(),
  ]);
  return modulesPromise;
}

export function useLightGallery() {
  let lgInstance: LightGallery | null = null;
  const isOpen = ref(false);
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
    ensureModules();
  }

  async function openGallery(images: GalleryImage[], index = 0) {
    if (!images.length) return;

    isLoading.value = true;
    loadingProgress.value = 10;
    _startTicking();

    const [
      { default: lightGallery },
      { default: lgZoom },
      { default: lgThumbnail },
      { default: lgFullscreen },
      { default: lgRotate },
      { default: lgAutoplay },
    ] = await ensureModules();
    _finishLoading();

    const container = document.createElement("div");
    document.body.appendChild(container);

    const multiImage = images.length > 1;

    lgInstance = lightGallery(container, {
      dynamic: true,
      dynamicEl: images.map((img) => ({
        src: img.src,
        thumb: img.thumb || img.src,
      })),
      plugins: [lgZoom, lgThumbnail, lgFullscreen, lgRotate, lgAutoplay],

      // 核心
      mode: "lg-fade",
      startClass: "lg-start-zoom",
      speed: 400,
      download: true,
      counter: multiImage,
      loop: multiImage,
      hideControlOnEnd: false,
      zoomFromOrigin: false,
      // 默认 fit-screen，避免大图（如 30MB+ 高分辨率原图）以原始像素铺到 DOM 引发 GPU 显存爆炸 / 主线程长任务卡顿
      // 用户仍可通过 + 按钮或滚轮缩放至原始尺寸查看细节
      actualSize: false,
      showZoomInOutIcons: true,
      addClass: "ik-lg",

      // 缩略图（多图时显示）
      thumbnail: multiImage,
      animateThumb: true,
      thumbWidth: 80,
      thumbHeight: "60px",
      thumbMargin: 6,

      // 全屏
      fullScreen: true,

      // 旋转
      rotateLeft: true,
      rotateRight: true,
      flipHorizontal: true,
      flipVertical: true,

      // 自动播放（多图时显示控件）
      autoplay: multiImage,
      autoplayControls: multiImage,
      autoplayFirstVideo: false,
      slideShowAutoplay: false,
      slideShowInterval: 4000,
      progressBar: true,
      forceSlideShowAutoplay: false,

      // 交互
      mousewheel: true,
      escKey: true,
      enableDrag: true,
      enableSwipe: true,
    });

    isOpen.value = true;

    container.addEventListener("lgAfterClose", () => {
      isOpen.value = false;
      // lgAfterClose 触发时 gallery 已关闭，只需清理引用和 DOM
      lgInstance = null;
      container.remove();
    });

    lgInstance!.openGallery(index);
  }

  function openImage(src: string) {
    return openGallery([{ src }], 0);
  }

  function destroy() {
    lgInstance?.destroy();
    lgInstance = null;
    isOpen.value = false;
  }

  return { isOpen: readonly(isOpen), isLoading: readonly(isLoading), loadingProgress: readonly(loadingProgress), openGallery, openImage, preload, destroy };
}
