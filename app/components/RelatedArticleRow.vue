<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Post } from "~/types/entities";
import { formatTime, formatFullTime } from "~/utils/time";
import { useRecommendationImpression } from "~/composables/useRecommendations";

const DEFAULT_AVATAR_IMAGE = "/images/default-avatar.webp";

const props = withDefaults(defineProps<{ post: Post; active?: boolean; surface?: "related" | "ai" }>(), { active: true, surface: "related" });
const emit = defineEmits<{ open: [post: Post] }>();
const element = ref<HTMLElement | null>(null);
useRecommendationImpression(element, () => props.post, () => props.active);

const avatarSrc = ref(props.post.author?.avatar || DEFAULT_AVATAR_IMAGE);
watch(() => props.post.author?.avatar, (value) => { avatarSrc.value = value || DEFAULT_AVATAR_IMAGE; });
const onAvatarError = () => { avatarSrc.value = DEFAULT_AVATAR_IMAGE; };
// AI 面板保持精简不展示标签；相关委托最多显示 4 个，避免单行过挤。
const tags = computed(() => (props.surface === "ai" ? [] : (props.post.tags || []).slice(0, 4)));
// 优先展示最后活动时间（bumpedAt）；related 接口暂未下发时回落到发布时间。
const activeAt = computed(() => props.post.bumpedAt || props.post.publishedAt);
const timeText = computed(() => formatTime(activeAt.value ?? undefined));
const fullTime = computed(() => formatFullTime(activeAt.value ?? undefined));
// 大数字压缩成 Discourse 那样的 1.8k。
const compact = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`);
</script>

<template>
  <li ref="element" class="ik-related__row" :data-post-id="post.id">
    <button type="button" class="ik-related__link" @click="emit('open', post)">
      <span class="ik-related__title">{{ post.title || "（无标题）" }}</span>
      <span class="ik-related__meta">
        <span class="ik-related__by">
          <img class="ik-related__avatar" :src="avatarSrc" :alt="post.author?.name || '作者头像'" loading="lazy" decoding="async" @error="onAvatarError" />
          <span v-if="post.author?.name" class="ik-related__author">{{ post.author.name }}</span>
        </span>
        <span v-if="tags.length" class="ik-related__tags">
          <span v-for="tag in tags" :key="tag.slug" class="ik-related__tag">#{{ tag.name }}</span>
        </span>
        <span class="ik-related__stats">
          <span class="ik-related__stat" :title="`${post.views || 0} 次浏览`">
            <svg class="ik-related__stat-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M12 5C6.7 5 3 10 2 12c1 2 4.7 7 10 7s9-5 10-7c-1-2-4.7-7-10-7Z" stroke="currentColor" stroke-width="1.8" />
              <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.8" />
            </svg>{{ compact(post.views || 0) }}
          </span>
          <span class="ik-related__stat" :title="`${post.commentsCount || 0} 条评论`">
            <svg class="ik-related__stat-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            </svg>{{ compact(post.commentsCount || 0) }}
          </span>
          <span v-if="timeText" class="ik-related__stat ik-related__time" :title="fullTime">{{ timeText }}</span>
        </span>
      </span>
    </button>
  </li>
</template>

<style scoped>
.ik-related__row { list-style: none; min-width: 0; }
.ik-related__row + .ik-related__row .ik-related__link { border-top: 1px solid var(--related-divider, #2a2a2a); }
.ik-related__link { display: flex; flex-direction: column; gap: 8px; width: 100%; min-width: 0; padding: 12px 4px; background: transparent; border: 0; color: var(--related-text, #ededed); cursor: pointer; text-align: left; }
.ik-related__link:focus-visible { outline: 2px solid var(--related-accent, #bfff09); outline-offset: 2px; border-radius: 6px; }
.ik-related__title { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-size: 14px; line-height: 1.5; font-weight: 600; overflow-wrap: anywhere; transition: color .15s; }
.ik-related__link:hover .ik-related__title, .ik-related__link:focus-visible .ik-related__title { color: var(--related-accent, #bfff09); }
.ik-related__meta { display: flex; align-items: center; flex-wrap: wrap; column-gap: 14px; row-gap: 4px; color: var(--related-muted, #9a9a9a); font-size: 12px; line-height: 1.4; }
.ik-related__by { display: inline-flex; align-items: center; gap: 7px; min-width: 0; flex-shrink: 1; }
.ik-related__avatar { flex: none; width: 20px; height: 20px; border-radius: 50%; object-fit: cover; background: var(--related-card, #222); }
.ik-related__author { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ik-related__tags { display: inline-flex; flex-wrap: wrap; gap: 10px; min-width: 0; }
.ik-related__tag { white-space: nowrap; }
.ik-related__stats { display: inline-flex; align-items: center; gap: 12px; margin-left: auto; flex: none; }
.ik-related__stat { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.ik-related__stat-icon { width: 14px; height: 14px; }
</style>
