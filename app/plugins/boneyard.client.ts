import { configureBoneyard } from "boneyard-js/vue";
import "~/bones/registry";

/**
 * boneyard 骨架屏：骨架形状由 `npm run bones` 从真实页面截取，存在 app/bones。
 * 颜色与动效沿用站内原有骨架（#222 底色 + ik-bone-pulse，见 theme.css）。
 */
export default defineNuxtPlugin(() => {
  configureBoneyard({ color: "#222", animate: "solid", boneClass: "ik-bone" });
});
