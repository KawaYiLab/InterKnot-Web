<script lang="ts">
const DEFAULT_COVER_IMAGE = "/images/default-cover.webp";
const DEFAULT_AVATAR_IMAGE = "/images/default-avatar.webp";

// 跨实例缓存已经加载过的封面 URL。虚拟列表在上下滚动时会反复挂载/卸载
// PostCard，这个缓存能让“下滑时已经加载过”的封面在重新上翻进入视口时
// 直接显示，不再重播 opacity/scale 进场过渡。
const _loadedCoverUrls = new Set<string>();

function isCoverLoaded(src: string) {
  return _loadedCoverUrls.has(src);
}

function markCoverLoaded(src: string) {
  if (src) _loadedCoverUrls.add(src);
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { Post } from "~/types/entities";
import { FALLBACK_COVER_ASPECT_RATIO, getNormalizedCoverAspectRatio } from "~/utils/cover";
import { toThumbUrl } from "~/utils/image";
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
const gpuAccelerated = useGpuAccelerated();

const coverSrc = ref(DEFAULT_COVER_IMAGE);
// 初始状态优先从跨实例缓存读取：如果同一张封面已经在本页面加载过，
// 重新进入视口时不应再次展示 loading 态并重播过渡动画。
const coverImageLoaded = ref(isCoverLoaded(coverSrc.value));
const coverIsFallback = ref(false);
const avatarSrc = ref(DEFAULT_AVATAR_IMAGE);
const cardRef = ref<HTMLElement | null>(null);

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
    // 瀑布流卡片尺寸不大，使用缩略图避免在 CPU / 无 GPU 路径下解码和绘制超大原图。
    // 有 GPU 加速时用 720px 覆盖 2x–3x DPR；无 GPU 时降到 480px，优先保证解码和绘制帧率。
    const thumbWidth = gpuAccelerated.value ? 720 : 480;
    coverSrc.value = cover ? toThumbUrl(cover, thumbWidth) : DEFAULT_COVER_IMAGE;
    coverIsFallback.value = !cover;
    // 同一封面 URL 已加载过时，直接就绪，避免虚拟列表重挂载时重播过渡。
    coverImageLoaded.value = isCoverLoaded(coverSrc.value);
  },
  { immediate: true },
);



watch(
  () => [props.post.id, props.post.author?.avatar] as const,
  () => {
    avatarSrc.value = props.post.author?.avatar || DEFAULT_AVATAR_IMAGE;
  },
  { immediate: true },
);

const onCoverLoad = () => {
  coverImageLoaded.value = true;
  markCoverLoaded(coverSrc.value);
};

const onCoverError = () => {
  if (coverSrc.value === DEFAULT_COVER_IMAGE) {
    coverImageLoaded.value = true;
    markCoverLoaded(coverSrc.value);
    return;
  }

  coverSrc.value = DEFAULT_COVER_IMAGE;
  coverIsFallback.value = true;
  coverImageLoaded.value = true;
  markCoverLoaded(coverSrc.value);
};

const onAvatarError = () => {
  avatarSrc.value = DEFAULT_AVATAR_IMAGE;
};

const handleOpen = (e: MouseEvent) => {
  // 点击 NSFW 遮罩时只揭示，不打开帖子。
  if ((e.target as HTMLElement | null)?.closest?.(".nsfw-image__overlay")) {
    return;
  }
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
          <NsfwImage
            :src="coverSrc"
            :status="post.coverNsfwStatus"
            :alt="coverIsFallback ? 'default cover' : post.title"
            :img-class="['ik-card__cover', { 'ik-card__cover--fallback': coverIsFallback, 'ik-card__cover--loading': !coverReady }]"
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
  transition:
    transform 1.2s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 400ms ease;
  will-change: transform;
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
