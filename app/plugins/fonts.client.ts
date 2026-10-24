import { loadBrandFonts } from "~/utils/brand-fonts";

/** 首屏封面（PostCard）会更早触发；这里只给没有封面的页面兜底，策略见 utils/brand-fonts.ts。 */
const FALLBACK_DELAY_MS = 3000;

export default defineNuxtPlugin(() => {
  const schedule = () => setTimeout(loadBrandFonts, FALLBACK_DELAY_MS);
  if (document.readyState === "complete") {
    schedule();
  } else {
    window.addEventListener("load", schedule, { once: true });
  }
});
