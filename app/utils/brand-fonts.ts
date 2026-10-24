/* ═══════════════════════════════════════════════════════════
   品牌字体 —— 印品鸿蒙体（还原游戏 / 云绝区零官网同款）
   ───────────────────────────────────────────────────────────
   两个物理文件放在 public/，与官网 (zzz.mihoyo.com/cloud-feat) 同源同名：
     zh-cn-light.ttf  → 正文 / 说明（细档）
     zh-cn-bold.ttf   → 标题 / 强调（粗档）

   官网的做法是两档并用、按元素分（它用 zh-cn-min-light / zh-cn-min-bold
   两个独立 family 切换）。这里合成同一 CSS family "InterKnot Sans"、靠
   font-weight 自动分流，复用项目里既有的字重语义、改动最小：
     weight 1–699  → 细档（body 400、medium 500、semibold 600 都落这里）
     weight 700–900 → 粗档（只有真正的标题级 700 / 800 / 900 落这里）
   浏览器据此各挑各的文件，绝不做 faux-bold 合成（这正是「全用细体时
   900 标题被强行加粗、字形变形」那种奇怪观感的根源）。

   ## 为什么分界点是 700 而不是 500
   印品鸿蒙体只有细 / 粗两个物理档，项目却按连续字重（400/500/600/700/900）
   设计。分界压到 500 会把一大票「中等强调」文本（敲敲消息气泡 600、各种
   semibold 标签）也推成标题级粗黑，满屏发胖。500 / 600 在官网的二元模型里
   本就属正文侧，所以只把 700+ 这种真·标题交给粗档；600 及以下留细档，
   同一文件渲染、不合成、不变形，层级改由字号与颜色承担。

   ## 加载策略：首屏加载完再注册，font-display: swap，不 preload
   两文件各约 1.8MB（TTF），是 App 打包一次即可、web 每次访问都要传的东西。
   web 优先用同名 .woff2（由 TTF 无损转换，各约 0.85–1MB），TTF 仅作兜底。
   swap = 先用系统字体立即渲染，字体到位后再替换，绝不阻塞首屏文字。
   刻意不 preload，也不写成全局 CSS 的 @font-face：后者在首次渲染文字时就会
   以最高优先级开始下载，和首屏委托封面抢带宽，弱网下 LCP 被拖慢十几秒。
   因此改用 FontFace API 延后注册：首页第一张首屏封面加载完成时（PostCard）
   触发；没有封面的页面由 plugins/fonts.client.ts 在 window load 后兜底触发。

   ## 版式偏移（CLS）
   swap 换字体时字宽改变，会让巨型背景跑马灯整片位移（Lighthouse 实测
   CLS 0.545，几乎全来自它）。所以跑马灯等 brandFontsReady 为 true 后才渲染
   文字，从一开始就用品牌字体排版；字体加载失败也会置 true，回退系统字体。

   ## 字符覆盖
   各约 6800 常用汉字（GB2312 量级）。用户生成内容里的生僻字 / emoji 会
   逐字回退到 fallback 栈的系统中文黑体，属预期行为。
   ═══════════════════════════════════════════════════════ */

import { ref } from "vue";

const FONT_FACES = [
  { file: "zh-cn-light", weight: "1 699" },
  { file: "zh-cn-bold", weight: "700 900" },
];

let registered = false;

/** 两档字体都已加载完成（或失败）。 */
export const brandFontsReady = ref(false);

export function loadBrandFonts() {
  if (registered) return;
  registered = true;
  if (typeof FontFace === "undefined") {
    brandFontsReady.value = true;
    return;
  }
  const faces = FONT_FACES.map(
    ({ file, weight }) =>
      new FontFace("InterKnot Sans", `url("/${file}.woff2") format("woff2"), url("/${file}.ttf") format("truetype")`, {
        weight,
        style: "normal",
        display: "swap",
      }),
  );
  for (const face of faces) document.fonts.add(face);
  Promise.allSettled(faces.map((face) => face.load())).then(() => {
    brandFontsReady.value = true;
  });
}
