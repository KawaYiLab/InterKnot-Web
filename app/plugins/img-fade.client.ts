/**
 * Global image fade-in plugin.
 *
 * All <img> (except PostCard covers which have their own system)
 * start at opacity 0 via CSS and get revealed with a 280ms transition
 * once they finish loading.
 *
 * To avoid every virtual-list remount replaying the fade-in, we keep a
 * per-URL cache: once a URL has been revealed, subsequent <img> elements
 * with the same resolved URL are shown immediately without the transition.
 */
export default defineNuxtPlugin(() => {
  const isSpaLoadingImg = (img: HTMLImageElement) =>
    Boolean(img.closest("#spa-loading-screen"));

  // PostCard covers manage their own loading state; skip them entirely.
  const isPostCardCover = (img: HTMLImageElement) =>
    img.classList.contains("ik-card__cover");

  const loadedSrcs = new Set<string>();

  const reveal = (img: HTMLImageElement) => {
    if (isSpaLoadingImg(img) || isPostCardCover(img)) return;

    const src = img.currentSrc || img.src;
    if (!src) {
      img.classList.add("ik-img-revealed");
      return;
    }

    // Already seen this URL: bypass the fade transition so that images
    // re-entering the viewport (e.g. upward scroll in virtual masonry)
    // do not trigger a 280ms opacity animation per element.
    if (loadedSrcs.has(src)) {
      const previousOpacity = img.style.opacity;
      const previousTransition = img.style.transition;
      img.style.opacity = "1";
      img.style.transition = "none";
      img.classList.add("ik-img-revealed");
      requestAnimationFrame(() => {
        img.style.opacity = previousOpacity;
        img.style.transition = previousTransition;
      });
      return;
    }

    loadedSrcs.add(src);
    img.classList.add("ik-img-revealed");
  };

  // Capture-phase delegation catches load/error on every <img>,
  // including dynamically added ones.
  document.addEventListener(
    "load",
    (e) => {
      if (e.target instanceof HTMLImageElement) reveal(e.target);
    },
    true,
  );

  document.addEventListener(
    "error",
    (e) => {
      if (e.target instanceof HTMLImageElement) reveal(e.target);
    },
    true,
  );

  // Reveal images already present and loaded (browser cache).
  for (const img of document.querySelectorAll<HTMLImageElement>("img")) {
    if (img.complete) reveal(img);
  }
});
