<script lang="ts">
const DEFAULT_COVER_IMAGE = "/images/default-cover.webp";
const DEFAULT_AVATAR_IMAGE = "/images/default-avatar.webp";
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { Post } from "~/types/entities";
import { FALLBACK_COVER_ASPECT_RATIO, getNormalizedCoverAspectRatio } from "~/utils/cover";
import UserHoverCard from "./UserHoverCard.vue";

const { schedulePrefetch, cancelPrefetch } = usePostPrefetch();

const props = defineProps<{
  post: Post;
  eager?: boolean;
}>();

const emit = defineEmits<{
  open: [post: Post, event: MouseEvent];
}>();

const authorName = computed(() => props.post.author?.name || "未知作者");

// 悬浮卡仅在支持悬停的设备（桌面鼠标）才有意义；触屏上它本就不弹，却仍会
// 为每张卡片实例化多个 composable。用此开关在移动端彻底不挂载，省掉浪费。
const canHover = useHoverCapable();

const coverSrc = ref(DEFAULT_COVER_IMAGE);
const coverImageLoaded = ref(false);
const coverIsFallback = ref(false);
const avatarSrc = ref(DEFAULT_AVATAR_IMAGE);
const cardRef = ref<HTMLElement | null>(null);
const coverImgRef = ref<HTMLImageElement | null>(null);

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

const coverReady = computed(() => coverImageLoaded.value);

watch(
  () => [props.post.id, props.post.cover] as const,
  ([newId, newCover], oldValue) => {
    if (oldValue && newId === oldValue[0] && newCover === oldValue[1]) return;
    const cover = newCover?.trim();
    coverSrc.value = cover || DEFAULT_COVER_IMAGE;
    coverIsFallback.value = !cover;
    coverImageLoaded.value = false;
  },
  { immediate: true },
);

onMounted(() => {
  if (coverImgRef.value?.complete) {
    coverImageLoaded.value = true;
  }
});

watch(
  () => [props.post.id, props.post.author?.avatar] as const,
  () => {
    avatarSrc.value = props.post.author?.avatar || DEFAULT_AVATAR_IMAGE;
  },
  { immediate: true },
);

const onCoverLoad = () => {
  coverImageLoaded.value = true;
};

const onCoverError = () => {
  if (coverSrc.value === DEFAULT_COVER_IMAGE) {
    coverImageLoaded.value = true;
    return;
  }

  coverSrc.value = DEFAULT_COVER_IMAGE;
  coverIsFallback.value = true;
  coverImageLoaded.value = true;
};

const onAvatarError = () => {
  avatarSrc.value = DEFAULT_AVATAR_IMAGE;
};

const handleOpen = (e: MouseEvent) => {
  emit("open", props.post, e);
};
</script>

<template>
  <article
    ref="cardRef"
    class="ik-card"
    @click.capture="handleOpen"
    @mouseenter="schedulePrefetch(post.id)"
    @mouseleave="cancelPrefetch"
    @focusin="schedulePrefetch(post.id)"
    @focusout="cancelPrefetch"
  >
    <NuxtLink
      :to="`/post/${post.id}`"
      class="ik-card__link"
      no-prefetch
    >
      <div class="ik-card__cover-wrap">
        <div class="ik-card__cover-frame" :style="{ aspectRatio: String(coverAspectRatio) }">
          <img
            ref="coverImgRef"
            :src="coverSrc"
            :alt="coverIsFallback ? 'default cover' : post.title"
            class="ik-card__cover"
            :class="{
              'ik-card__cover--fallback': coverIsFallback,
              'ik-card__cover--loading': !coverReady,
            }"
            :loading="eager ? 'eager' : 'lazy'"
            decoding="async"
            :fetchpriority="eager ? 'high' : 'low'"
            @load="onCoverLoad"
            @error="onCoverError"
          />
        </div>
        <div class="ik-card__views">
          <svg
            class="ik-card__views-icon"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 5C6.7 5 3 10 2 12c1 2 4.7 7 10 7s9-5 10-7c-1-2-4.7-7-10-7Z"
              stroke="currentColor"
              stroke-width="1.8"
            />
            <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.8" />
          </svg>
          <span>{{ post.views || 0 }}</span>
        </div>
      </div>

      <div class="ik-card__body">
        <div class="ik-card__author-row">
          <UserHoverCard v-if="canHover" :author-id="post.author?.documentId">
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
          <div v-else class="ik-card__avatar-shell">
            <img
              :src="avatarSrc"
              :alt="authorName"
              class="ik-card__avatar-image"
              loading="lazy"
              decoding="async"
              @error="onAvatarError"
            />
          </div>
          <div class="ik-card__author-block">
            <UserHoverCard v-if="canHover" :author-id="post.author?.documentId">
              <p class="ik-card__author-name">{{ authorName }}</p>
            </UserHoverCard>
            <p v-else class="ik-card__author-name">{{ authorName }}</p>
            <div class="ik-card__author-divider" />
          </div>
        </div>

        <h3 class="ik-card__title" :class="{ 'ik-card__title--read': post.isRead }">
          <span v-if="post.category" class="ik-card__title-cat">[ {{ post.category.name }} ]</span>{{ post.title }}
        </h3>
      </div>
    </NuxtLink>
  </article>
</template>

<style scoped>
.ik-card {
  border-radius: var(--ik-post-card-radius);
  background: var(--ik-post-card-outer-bg);
  padding: var(--ik-post-card-padding);
  overflow: hidden;
  transition: background-color 180ms ease;
  contain: layout style paint;
}

.ik-card:hover {
  background: var(--ik-post-card-hover-bg);
}

.ik-card__link {
  display: block;
  border-radius: var(--ik-post-card-inner-radius);
  background: var(--ik-post-card-inner-bg);
  overflow: hidden;
  outline: none;
}

.ik-card__cover-wrap {
  position: relative;
  overflow: hidden;
}

.ik-card__cover-frame {
  width: 100%;
  background: var(--ik-post-card-cover-bg);
}

.ik-card__title-cat {
  margin-right: 4px;
}

.ik-card__cover {
  --ik-cover-scale: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
  transform: scale(var(--ik-cover-scale));
  /* 移动端瀑布流滚动时，大量封面图的 will-change + opacity 过渡会触发频繁 Layerize 与
     paint，实测导致主线程任务时间增加约 40%。触屏/窄屏不依赖 hover 放大，先禁用。
     桌面端在 @media 中恢复 transform 过渡与 will-change。 */
  transition: none;
  will-change: auto;
}

.ik-card:hover .ik-card__cover {
  --ik-cover-scale: 1.06;
}

.ik-card__cover--loading {
  --ik-cover-scale: 1.02;
  opacity: 0;
}

/* fallback 时 frame 已切换为占位图原生比例，
   占位图天然填满 frame，沿用 object-fit: cover 即可 */
.ik-card__cover--fallback {
  background: var(--ik-post-card-cover-bg);
}

@media (hover: hover) and (pointer: fine) and (min-width: 769px) {
  .ik-card__cover {
    transition:
      transform 1.2s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 400ms ease;
    will-change: transform;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-card__cover {
    transition: none;
  }
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

.ik-card__views-icon {
  width: var(--ik-post-card-views-icon-size);
  height: var(--ik-post-card-views-icon-size);
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.6))
          drop-shadow(0 1px 1px rgba(0, 0, 0, 0.7));
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

.ik-card__author-divider {
  width: 100%;
  height: 1px;
  background: var(--ik-post-card-divider-bg);
}

.ik-card__title {
  margin: 0;
  font-size: var(--ik-post-card-title-size);
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

.ik-card__title--read {
  color: var(--ik-post-card-title-read-color);
}

</style>
