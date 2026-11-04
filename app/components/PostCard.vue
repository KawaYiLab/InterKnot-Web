<script lang="ts">
const DEFAULT_COVER_IMAGE = "/images/default-cover.webp";
const DEFAULT_AVATAR_IMAGE = "/images/default-avatar.webp";
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Post } from "~/types/entities";
import { FALLBACK_COVER_ASPECT_RATIO, getNormalizedCoverAspectRatio } from "~/utils/cover";
import { loadBrandFonts } from "~/utils/brand-fonts";
import { toAvatarThumbUrl, toCardCoverThumbUrl } from "~/utils/image";
import { thumbhashToDataUrl } from "~/utils/thumbhash";
import { toCardExcerpt } from "~/utils/card-excerpt";
import { splitHighlight } from "~/utils/highlight";
import { isPlainLinkClick } from "~/utils/post-link";
import UserHoverCard from "./UserHoverCard.vue";

const { schedulePrefetch, cancelPrefetch } = usePostPrefetch();

const props = defineProps<{
  post: Post;
  eager?: boolean;
  highlighted?: boolean;
  /** 搜索词：标题里的命中部分高亮 */
  keyword?: string;
}>();

const emit = defineEmits<{
  open: [post: Post, event: MouseEvent];
}>();

const authorName = computed(() => props.post.author?.name || "未知作者");
const excerpt = computed(() => toCardExcerpt(props.post.bodyText));
const titleParts = computed(() => splitHighlight(props.post.title, props.keyword));

// 悬浮卡仅在支持悬停的设备（桌面鼠标）才有意义；触屏上它本就不弹，却仍会
// 为每张卡片实例化多个 composable。用此开关在移动端彻底不挂载，省掉浪费。
const canHover = useHoverCapable();
// 悬浮卡等鼠标第一次进作者栏才挂：每张卡常驻两个 UserHoverCard 实例，
// 虚拟列表滚动时成批挂载/卸载，是卡片最重的部分。
const hoverCardArmed = ref(false);
const armHoverCard = () => {
  if (canHover.value) hoverCardArmed.value = true;
};

const coverSrc = ref(DEFAULT_COVER_IMAGE);
const coverIsFallback = ref(false);
// 图片到之前用接口给的 ThumbHash 模糊图垫底，图到了直接盖上，不做淡入：
// 淡入期间每张图都是一个合成动画，滚动时几十张同时淡入会让每帧都重新分层。
const coverPlaceholder = computed(() => {
  const url = thumbhashToDataUrl(props.post.coverThumbhash);
  return url ? `url("${url}")` : undefined;
});
const avatarSrc = ref(DEFAULT_AVATAR_IMAGE);

const hasBackendCoverSize = computed(() =>
  typeof props.post.coverWidth === "number" &&
  typeof props.post.coverHeight === "number" &&
  props.post.coverWidth > 0 &&
  props.post.coverHeight > 0,
);

const coverAspectRatio = computed(() => {
  // 只要后端提供了原图尺寸，就始终按原比例占位；即便缩略图加载失败（如七牛云对 10MB+
  // 大图返回 "File too large"），也保持容器尺寸不变，避免瀑布流重排引发列表跳动。
  // 仅当后端完全没有尺寸信息时，才回落到默认占位图的原生比例。
  if (hasBackendCoverSize.value) {
    return getNormalizedCoverAspectRatio(
      props.post.coverWidth,
      props.post.coverHeight,
    );
  }
  return FALLBACK_COVER_ASPECT_RATIO;
});

watch(
  () => [props.post.id, props.post.cover] as const,
  ([newId, newCover], oldValue) => {
    if (oldValue && newId === oldValue[0] && newCover === oldValue[1]) return;
    const cover = newCover?.trim();
    // 按卡片显示宽度和屏幕倍率取缩略图，不多解码像素。
    coverSrc.value = cover ? toCardCoverThumbUrl(cover) : DEFAULT_COVER_IMAGE;
    coverIsFallback.value = !cover;
  },
  { immediate: true },
);



watch(
  () => [props.post.id, props.post.author?.avatar] as const,
  () => {
    const avatar = props.post.author?.avatar;
    avatarSrc.value = avatar ? toAvatarThumbUrl(avatar) : DEFAULT_AVATAR_IMAGE;
  },
  { immediate: true },
);

const onCoverLoad = () => {
  // 首屏封面到位后再拉品牌字体，避免两者抢带宽拖慢 LCP
  if (props.eager) loadBrandFonts();
};

const onCoverError = () => {
  if (props.eager) loadBrandFonts();
  if (coverSrc.value === DEFAULT_COVER_IMAGE) return;
  coverSrc.value = DEFAULT_COVER_IMAGE;
  coverIsFallback.value = true;
};

const onAvatarError = () => {
  avatarSrc.value = DEFAULT_AVATAR_IMAGE;
};

const handleOpen = (e: MouseEvent) => {
  if (!isPlainLinkClick(e)) return;
  emit("open", props.post, e);
};
</script>

<template>
  <article
    class="ik-card"
    :class="{ 'ik-card--updated': highlighted }"
    @click.capture="handleOpen"
    @mouseenter="schedulePrefetch(post.id)"
    @mouseleave="cancelPrefetch"
    @focusin="schedulePrefetch(post.id)"
    @focusout="cancelPrefetch"
  >
    <NuxtLink
      :to="postPath(post.id, post.postNo)"
      class="ik-card__link"
      no-prefetch
    >
      <div class="ik-card__cover-wrap">
        <div
          class="ik-card__cover-frame"
          :style="{ aspectRatio: String(coverAspectRatio), backgroundImage: coverPlaceholder }"
        >
          <img
            :src="coverSrc"
            :alt="coverIsFallback ? 'default cover' : post.title"
            :class="['ik-card__cover', { 'ik-card__cover--fallback': coverIsFallback }]"
            :loading="eager ? 'eager' : 'lazy'"
            decoding="async"
            :fetchpriority="eager ? 'high' : 'low'"
            referrerpolicy="no-referrer"
            @load="onCoverLoad"
            @error="onCoverError"
          />
        </div>
        <div class="ik-card__views">
          <span class="ik-card__views-icon" aria-hidden="true" />
          <span>{{ post.views || 0 }}</span>
        </div>
        <div v-if="post.solvedAt" class="ik-card__solved">已采纳</div>
      </div>

      <div class="ik-card__body">
        <div class="ik-card__author-row" @mouseenter="armHoverCard">
          <UserHoverCard
            v-if="hoverCardArmed"
            :author-id="post.author?.documentId"
            :member-no="post.author?.memberNo"
            open-if-hovered
          >
            <div class="ik-card__avatar-shell">
              <img
                :src="avatarSrc"
                :alt="authorName"
                class="ik-card__avatar-image"
                loading="lazy"
                decoding="async"
                @error="onAvatarError"
              />
            </div>
          </UserHoverCard>
          <div v-else class="ik-card__hover-slot">
            <div class="ik-card__avatar-shell">
              <img
                :src="avatarSrc"
                :alt="authorName"
                class="ik-card__avatar-image"
                loading="lazy"
                decoding="async"
                @error="onAvatarError"
              />
            </div>
          </div>
          <div class="ik-card__author-block">
            <UserHoverCard
              v-if="hoverCardArmed"
              :author-id="post.author?.documentId"
              :member-no="post.author?.memberNo"
              open-if-hovered
            >
              <p class="ik-card__author-name">{{ authorName }}</p>
            </UserHoverCard>
            <div v-else class="ik-card__hover-slot">
              <p class="ik-card__author-name">{{ authorName }}</p>
            </div>
          </div>
        </div>

        <h3 class="ik-card__title" :class="{ 'ik-card__title--read': post.isRead }">
          <template v-if="keyword"><template v-for="(part, i) in titleParts" :key="i"><mark v-if="part.hit" class="ik-card__hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></template>
          <template v-else>{{ post.title }}</template>
        </h3>
        <p v-if="excerpt" class="ik-card__excerpt">{{ excerpt }}</p>
      </div>
    </NuxtLink>
  </article>
</template>

<style scoped>
/* 裁剪只留 .ik-card__link 一层：每多一层圆角裁剪 / contain: paint，
   每张卡就多几个绘制块，滚动时逐帧重新分层的开销随之上涨。 */
.ik-card {
  position: relative;
  border-radius: var(--ik-post-card-radius);
  background: var(--ik-post-card-outer-bg);
  padding: var(--ik-post-card-padding);
  contain: layout style;
}

/* 新帖高亮的彩色外框画在内容「之上」，并向内多压 1px。
   若像以前那样改外层背景色，内层圆角裁剪的抗锯齿边缘会混入内层的深色背景
   （#222 / 封面底色），在彩框与封面之间留下一条暗线，小数像素布局和
   Windows 缩放下尤其明显。 */
.ik-card--updated::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
  box-shadow: inset 0 0 0 calc(var(--ik-post-card-padding) + 1px) var(--ik-post-card-updated-bg, var(--ik-primary));
  pointer-events: none;
  animation: ik-card-highlight-fade 3s ease-out forwards;
}

@keyframes ik-card-highlight-fade {
  0% {
    opacity: 0;
    animation-timing-function: ease-out;
  }
  16% {
    opacity: 1;
    animation-timing-function: linear;
  }
  42% {
    opacity: 1;
    animation-timing-function: ease-out;
  }
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-card--updated::before {
    animation: none;
    opacity: 0;
  }
}

.ik-card__link {
  position: relative;
  z-index: 1;
  display: block;
  border-radius: var(--ik-post-card-inner-radius);
  background: var(--ik-post-card-inner-bg);
  overflow: hidden;
  outline: none;
}

.ik-card__cover-wrap {
  position: relative;
}

.ik-card__cover-frame {
  width: 100%;
  background-color: var(--ik-post-card-cover-bg);
  background-size: 100% 100%;
}

.ik-card__solved {
  position: absolute;
  top: 11px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: #15803d;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}

:deep(.ik-card__cover) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
}

/* fallback 时 frame 已切换为占位图原生比例，
   占位图天然填满 frame，沿用 object-fit: cover 即可 */
:deep(.ik-card__cover--fallback) {
  background: var(--ik-post-card-cover-bg);
}

.ik-card__views {
  position: absolute;
  top: 11px;
  left: 16px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #fff;
  font-size: var(--ik-post-card-views-font-size);
  font-weight: 700;
  text-shadow:
    0 0 4px rgba(0, 0, 0, 0.8),
    0 1px 2px rgba(0, 0, 0, 0.9);
}

/* 眼睛图标画成背景图：内联 SVG 每张卡要多 7 个节点（svg / g / path / circle），
   虚拟列表成批挂载时都要算样式、建布局对象。先画一圈半透明黑描边当阴影，
   比 filter: drop-shadow 便宜。 */
.ik-card__views-icon {
  display: block;
  flex: none;
  width: var(--ik-post-card-views-icon-size);
  height: var(--ik-post-card-views-icon-size);
  background: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'><g stroke='rgba(0,0,0,0.55)' stroke-width='3.6'><path d='M12 5C6.7 5 3 10 2 12c1 2 4.7 7 10 7s9-5 10-7c-1-2-4.7-7-10-7Z'/><circle cx='12' cy='12' r='3.2'/></g><g stroke='%23fff' stroke-width='1.8'><path d='M12 5C6.7 5 3 10 2 12c1 2 4.7 7 10 7s9-5 10-7c-1-2-4.7-7-10-7Z'/><circle cx='12' cy='12' r='3.2'/></g></svg>") center / 100% 100% no-repeat;
}

.ik-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--ik-post-card-body-gap);
  padding: var(--ik-post-card-body-padding);
}

.ik-card__author-row {
  position: relative;
  display: flex;
  align-items: flex-start;
}

.ik-card__avatar-shell {
  position: relative;
  margin-top: var(--ik-post-card-avatar-offset);
  width: var(--ik-post-card-avatar-size);
  height: var(--ik-post-card-avatar-size);
  padding: var(--ik-post-card-avatar-padding);
  border-radius: 999px;
  background: var(--ik-post-card-inner-bg);
}

.ik-card__hover-slot {
  display: inline-block;
}

.ik-card__avatar-image {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  object-fit: cover;
  background: var(--ik-post-card-avatar-bg);
}

.ik-card__author-block {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: var(--ik-post-card-author-min-height);
  padding-left: var(--ik-post-card-author-padding-left);
  margin-left: var(--ik-post-card-author-offset);
  width: var(--ik-post-card-author-block-width);
}

.ik-card__author-name {
  margin: 4px 0 4px;
  font-size: var(--ik-post-card-author-name-size);
  font-weight: 700;
  color: var(--ik-post-card-author-name-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 名字下面的分隔线用伪元素画，少一个节点 */
.ik-card__author-block::after {
  content: "";
  width: 100%;
  height: 1px;
  background: var(--ik-post-card-divider-bg);
}

.ik-card__title {
  margin: 0;
  font-size: var(--ik-post-card-title-size);
  /* h3 浏览器默认 700 会落到品牌粗档；瀑布流标题字号小（17px），
     粗档在小字号下发糊难认，显式降到 600 落细档，清晰。
     （详情页大标题字号大，仍用粗档，不受此影响。） */
  font-weight: 600;
  line-height: 1.25;
  color: var(--ik-post-card-title-color);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.ik-card__hit {
  background: transparent;
  color: var(--ik-primary, #fbfe00);
}

.ik-card__title--read {
  color: var(--ik-post-card-title-read-color);
}

/* 字号 / 行高改动需同步 utils/post-card-height.ts */
.ik-card__excerpt {
  margin: 0;
  font-size: 15px;
  line-height: 21px;
  color: var(--ik-post-card-excerpt-color);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

</style>
