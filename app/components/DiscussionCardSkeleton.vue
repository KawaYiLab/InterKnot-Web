<script setup lang="ts">
import type { SkeletonItem } from "~/utils/skeleton";

defineProps<{
  skeleton?: SkeletonItem;
}>();
</script>

<template>
  <article class="ik-card-skeleton" aria-hidden="true">
    <div class="ik-card-skeleton__link">
      <!-- 封面占位 -->
      <div class="ik-card-skeleton__cover-wrap">
        <div
          class="ik-card-skeleton__cover skeleton-pulse"
          :style="{ aspectRatio: String(skeleton?.coverAspectRatio || 1.576) }"
        ></div>
      </div>

      <!-- 内容占位 -->
      <div class="ik-card-skeleton__body">
        <!-- 头像和作者名 -->
        <div class="ik-card-skeleton__author-row">
          <div class="ik-card-skeleton__avatar skeleton-pulse"></div>
          <div class="ik-card-skeleton__author-block">
            <div
              class="ik-card-skeleton__author-name skeleton-pulse"
              :style="{ width: skeleton?.authorWidth || '60%' }"
            ></div>
            <div class="ik-card-skeleton__divider"></div>
          </div>
        </div>

        <!-- 标题占位（两行） -->
        <div class="ik-card-skeleton__title-group">
          <div
            class="ik-card-skeleton__title skeleton-pulse"
            :style="{ width: '100%' }"
          ></div>
          <div
            class="ik-card-skeleton__title skeleton-pulse"
            :style="{ width: skeleton?.titleWidth || '60%' }"
          ></div>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
/* 脉冲动画 */
@keyframes skeleton-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.skeleton-pulse {
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  background: var(--ik-discussion-card-placeholder-bg);
  border-radius: 4px;
}

/* 减少动画偏好设置支持 */
@media (prefers-reduced-motion: reduce) {
  .skeleton-pulse {
    animation: none;
    opacity: 0.7;
  }
}

/* 卡片容器 - 匹配 DiscussionCard 的圆角样式 */
.ik-card-skeleton {
  border-radius: var(--ik-discussion-card-radius);
  background: var(--ik-discussion-card-outer-bg);
  padding: var(--ik-discussion-card-padding);
  overflow: hidden;
  contain: layout style paint;
}

.ik-card-skeleton__link {
  display: block;
  border-radius: var(--ik-discussion-card-inner-radius);
  background: var(--ik-discussion-card-inner-bg);
  overflow: hidden;
}

/* 封面占位 - 宽高比 1.576 (643/408) */
.ik-card-skeleton__cover-wrap {
  position: relative;
  overflow: hidden;
}

.ik-card-skeleton__cover {
  width: 100%;
  background: var(--ik-discussion-card-placeholder-bg);
}

/* 内容区域 - 内边距 0 8px 12px，元素间距 8px */
.ik-card-skeleton__body {
  display: flex;
  flex-direction: column;
  gap: var(--ik-discussion-card-body-gap);
  padding: var(--ik-discussion-card-body-padding);
}

/* 头像和作者行 */
.ik-card-skeleton__author-row {
  position: relative;
  display: flex;
  align-items: flex-start;
}

/* 头像占位 - 圆形，54x54 像素，负上边距 -28px */
.ik-card-skeleton__avatar {
  position: relative;
  margin-top: var(--ik-discussion-card-avatar-offset);
  width: var(--ik-discussion-card-avatar-size);
  height: var(--ik-discussion-card-avatar-size);
  border-radius: 999px;
  background: var(--ik-discussion-card-placeholder-bg);
  flex-shrink: 0;
}

.ik-card-skeleton__author-block {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: var(--ik-discussion-card-author-min-height);
  padding-left: var(--ik-discussion-card-author-padding-left);
  margin-left: var(--ik-discussion-card-author-offset);
  width: var(--ik-discussion-card-author-block-width);
}

/* 作者名占位 */
.ik-card-skeleton__author-name {
  height: var(--ik-discussion-card-author-name-size);
  margin: 4px 0;
  background: var(--ik-discussion-card-placeholder-bg);
  border-radius: 4px;
}

.ik-card-skeleton__divider {
  width: 100%;
  height: 1px;
  background: var(--ik-discussion-card-divider-bg);
  margin-top: 4px;
}

/* 标题占位（两行） */
.ik-card-skeleton__title-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ik-card-skeleton__title {
  height: var(--ik-discussion-card-title-size);
  background: var(--ik-discussion-card-placeholder-bg);
  border-radius: 4px;
}
</style>
