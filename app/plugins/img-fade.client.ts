/**
 * Global image fade-in plugin.
 *
 * All <img> (except PostCard covers which have their own system)
 * start at opacity 0 via CSS and get revealed with a 280ms transition
 * once they finish loading.
 */
export default defineNuxtPlugin(() => {
  const isSpaLoadingImg = (img: HTMLImageElement) =>
    Boolean(img.closest("#spa-loading-screen"));

  const reveal = (img: HTMLImageElement) => {
    if (isSpaLoadingImg(img)) return;
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
