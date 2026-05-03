<script lang="ts">
const DEFAULT_COVER_IMAGE = "/images/default-cover.webp";
const DEFAULT_AVATAR_IMAGE = "/images/default-avatar.webp";
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { Discussion } from "~/types/entities";
import { getCoverAspectRatio } from "~/utils/cover";

const props = defineProps<{
  discussion: Discussion;
  eager?: boolean;
}>();

const emit = defineEmits<{
  open: [discussion: Discussion, event: MouseEvent];
}>();

const authorName = computed(() => props.discussion.author?.name || "未知作者");
const excerpt = computed(
  () => props.discussion.bodyText || props.discussion.rawBodyText || "暂无摘要内容",
);
const coverAspectRatio = computed(() =>
  getCoverAspectRatio(props.discussion.coverWidth, props.discussion.coverHeight),
);

const coverSrc = ref(DEFAULT_COVER_IMAGE);
const coverImageLoaded = ref(false);
const coverIsFallback = ref(false);
const avatarSrc = ref(DEFAULT_AVATAR_IMAGE);
const cardRef = ref<HTMLElement | null>(null);
const coverImgRef = ref<HTMLImageElement | null>(null);

const coverReady = computed(() => coverImageLoaded.value);

watch(
  () => [props.discussion.id, props.discussion.cover] as const,
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
  () => [props.discussion.id, props.discussion.author?.avatar] as const,
  () => {
    avatarSrc.value = props.discussion.author?.avatar || DEFAULT_AVATAR_IMAGE;
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
  emit("open", props.discussion, e);
};

</script>

<template>
  <article ref="cardRef" class="ik-card" @click.capture="handleOpen">
    <NuxtLink
      :to="`/discussion/${discussion.id}`"
      class="ik-card__link"
      no-prefetch
    >
      <div class="ik-card__cover-wrap">
        <div class="ik-card__cover-frame" :style="{ aspectRatio: String(coverAspectRatio) }">
          <img
            ref="coverImgRef"
            :src="coverSrc"
            :alt="coverIsFallback ? 'default cover' : discussion.title"
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
          <span>{{ discussion.views || 0 }}</span>
        </div>
      </div>

      <div class="ik-card__body">
        <div class="ik-card__author-row">
          <UserHoverCard :author-id="discussion.author?.documentId">
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
          <div class="ik-card__author-block">
            <UserHoverCard :author-id="discussion.author?.documentId">
              <p class="ik-card__author-name">{{ authorName }}</p>
            </UserHoverCard>
            <div class="ik-card__author-divider" />
          </div>
        </div>

        <h3 class="ik-card__title" :class="{ 'ik-card__title--read': discussion.isRead }">
          {{ discussion.title }}
        </h3>
        <p class="ik-card__excerpt">{{ excerpt }}</p>
      </div>
    </NuxtLink>
  </article>
</template>

<style scoped>
.ik-card {
  border-radius: var(--ik-discussion-card-radius);
  background: var(--ik-discussion-card-outer-bg);
  padding: var(--ik-discussion-card-padding);
  overflow: hidden;
  transition: background-color 180ms ease;
  contain: layout style paint;
}

.ik-card:hover {
  background: var(--ik-discussion-card-hover-bg);
}

.ik-card__link {
  display: block;
  border-radius: var(--ik-discussion-card-inner-radius);
  background: var(--ik-discussion-card-inner-bg);
  overflow: hidden;
  outline: none;
}

.ik-card__cover-wrap {
  position: relative;
  overflow: hidden;
}

.ik-card__cover-frame {
  width: 100%;
  background: var(--ik-discussion-card-cover-bg);
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
}

.ik-card:hover .ik-card__cover {
  --ik-cover-scale: 1.06;
  will-change: transform;
}

.ik-card__cover--loading {
  --ik-cover-scale: 1.02;
  opacity: 0;
}

.ik-card__cover--fallback {
  background: var(--ik-discussion-card-cover-bg);
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
  font-size: var(--ik-discussion-card-views-font-size);
  font-weight: 700;
  text-shadow: 
    0 0 4px rgba(0, 0, 0, 0.8),
    0 1px 2px rgba(0, 0, 0, 0.9);
}

.ik-card__views-icon {
  width: var(--ik-discussion-card-views-icon-size);
  height: var(--ik-discussion-card-views-icon-size);
}

.ik-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--ik-discussion-card-body-gap);
  padding: var(--ik-discussion-card-body-padding);
}

.ik-card__author-row {
  position: relative;
  display: flex;
  align-items: flex-start;
}

.ik-card__avatar-shell {
  position: relative;
  margin-top: var(--ik-discussion-card-avatar-offset);
  width: var(--ik-discussion-card-avatar-size);
  height: var(--ik-discussion-card-avatar-size);
  padding: var(--ik-discussion-card-avatar-padding);
  border-radius: 999px;
  background: var(--ik-discussion-card-inner-bg);
}

.ik-card__avatar-image {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  object-fit: cover;
  background: var(--ik-discussion-card-avatar-bg);
}

.ik-card__author-block {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: var(--ik-discussion-card-author-min-height);
  padding-left: var(--ik-discussion-card-author-padding-left);
  margin-left: var(--ik-discussion-card-author-offset);
  width: var(--ik-discussion-card-author-block-width);
}

.ik-card__author-name {
  margin: 4px 0 4px;
  font-size: var(--ik-discussion-card-author-name-size);
  font-weight: 700;
  color: var(--ik-discussion-card-author-name-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-card__author-divider {
  width: 100%;
  height: 1px;
  background: var(--ik-discussion-card-divider-bg);
}

.ik-card__title {
  margin: 0;
  font-size: var(--ik-discussion-card-title-size);
  line-height: 1.25;
  color: var(--ik-discussion-card-title-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-card__title--read {
  color: var(--ik-discussion-card-title-read-color);
}

.ik-card__excerpt {
  margin: 0;
  color: var(--ik-discussion-card-excerpt-color);
  font-size: var(--ik-discussion-card-excerpt-size);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
</style>
