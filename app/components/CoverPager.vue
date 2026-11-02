<script setup lang="ts">
import { computed } from "vue";

/**
 * 多图切换器，照搬米游社绝区零百科首页轮播的 new-swiper-pagination：
 * 62×20 黑色胶囊，左右是原版箭头切图，中间是 Impact 斜体两位页码。
 * 到头后再点会绕回另一端，和原版的循环轮播一致。
 */
const props = defineProps<{
  /** 当前页，从 0 开始 */
  index: number;
  total: number;
}>();

const emit = defineEmits<{
  go: [index: number];
}>();

const label = computed(() => String(props.index + 1).padStart(2, "0"));
const prev = () => emit("go", (props.index - 1 + props.total) % props.total);
const next = () => emit("go", (props.index + 1) % props.total);
</script>

<template>
  <div class="ik-cover-pager" @click.stop>
    <button type="button" class="ik-cover-pager__btn ik-cover-pager__btn--prev" aria-label="上一张" @click="prev" />
    <span class="ik-cover-pager__num" :aria-label="`第 ${index + 1} 张，共 ${total} 张`">{{ label }}</span>
    <button type="button" class="ik-cover-pager__btn ik-cover-pager__btn--next" aria-label="下一张" @click="next" />
  </div>
</template>

<style scoped>
/* 原版用 Impact。Impact 是商业字体不能打包，系统自带就用系统的（Windows/macOS），
   否则用外形几乎一样的 Anton（OFL 授权，只截了 0-9，3.5KB）。 */
@font-face {
  font-family: "IK Pager Digits";
  src: local("Impact"), url("~/assets/fonts/anton-digits.woff2") format("woff2");
  unicode-range: U+0030-0039;
  font-display: block;
}

/* 尺寸和位置按原版渲染结果取值 */
.ik-cover-pager {
  position: absolute;
  right: 4px;
  bottom: 4px;
  z-index: 2;
  box-sizing: border-box;
  width: 62px;
  height: 20px;
  border: 0.588px solid #000;
  border-radius: 12.941px;
  background: #000;
  user-select: none;
  -webkit-user-select: none;
}

/* 桌面端帖子弹窗整体放大了 1.1 倍，这里缩回去，屏幕上保持原版的 62×20 */
@media (min-width: 1025px) {
  .ik-cover-pager {
    transform: scale(calc(1 / 1.1));
    transform-origin: right bottom;
  }
}

.ik-cover-pager__btn {
  position: absolute;
  top: 1.412px;
  width: 20px;
  height: 16px;
  padding: 0;
  border: none;
  background: center / cover no-repeat;
  cursor: var(--ik-cursor-pointer);
  -webkit-tap-highlight-color: transparent;
}

.ik-cover-pager__btn--prev {
  left: 1.412px;
  background-image: url("~/assets/images/cover-pager/left.png");
}

.ik-cover-pager__btn--next {
  left: 39.412px;
  background-image: url("~/assets/images/cover-pager/right.png");
}

@media (hover: hover) {
  .ik-cover-pager__btn--prev:hover {
    background-image: url("~/assets/images/cover-pager/left-hover.png");
  }

  .ik-cover-pager__btn--next:hover {
    background-image: url("~/assets/images/cover-pager/right-hover.png");
  }
}

.ik-cover-pager__btn--prev:active {
  background-image: url("~/assets/images/cover-pager/left-hover.png");
}

.ik-cover-pager__btn--next:active {
  background-image: url("~/assets/images/cover-pager/right-hover.png");
}

.ik-cover-pager__num {
  position: absolute;
  top: 0.412px;
  left: 20.412px;
  color: rgba(255, 255, 255, 0.48);
  font-family: "IK Pager Digits", impact, sans-serif;
  font-size: 14.118px;
  font-style: italic;
  font-weight: 400;
  line-height: 18.824px;
  white-space: nowrap;
  pointer-events: none;
}
</style>
