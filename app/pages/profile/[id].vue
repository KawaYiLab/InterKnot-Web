<script setup lang="ts">
import { useMessage } from "zenless-ui";
import type { Comment, Discussion, Profile } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import { getCoverAspectRatio } from "~/utils/cover";
import { calculateSkeletonCount, estimateSkeletonHeight, generateSkeletons, type SkeletonItem } from "~/utils/skeleton";
import { formatTime } from "~/utils/time";
import { HandThumbUpIcon, DocumentTextIcon } from "@heroicons/vue/24/outline";
import { HandThumbUpIcon as HandThumbUpIconSolid } from "@heroicons/vue/24/solid";

const route = useRoute();
const api = useApi();
const discussionModal = useDiscussionModal();
const pageDataLoading = usePageDataLoading();
const message = useMessage();

const profile = ref<Profile | null>(null);
const loadError = ref(false);
const loading = ref(false);

const tab = ref<"articles" | "comments">("articles");

const articles = ref<Discussion[]>([]);
const articleCursor = ref("");
const articleHasNext = ref(true);
const articleLoading = ref(false);

const comments = ref<Comment[]>([]);
const commentCursor = ref("");
const commentHasNext = ref(true);
const commentLoading = ref(false);

const profileId = computed(() => String(route.params.id || ""));

const loadProfile = async () => {
  loading.value = true;
  loadError.value = false;
  try {
    profile.value = await api.getProfile(profileId.value);
  } catch (err) {
    loadError.value = true;
    message.error(resolveErrorMessage(err, "获取用户信息失败"));
  } finally {
    loading.value = false;
  }
};

const loadProfileArticles = async () => {
  if (articleLoading.value || !articleHasNext.value) return;
  articleLoading.value = true;
  try {
    const page = await api.getProfileArticles(profileId.value, articleCursor.value);
    articles.value.push(...page.nodes);
    articleCursor.value = page.endCursor;
    articleHasNext.value = page.hasNextPage;
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取用户帖子失败"));
  } finally {
    articleLoading.value = false;
  }
};

const loadProfileComments = async () => {
  if (commentLoading.value || !commentHasNext.value) return;
  commentLoading.value = true;
  try {
    const page = await api.getProfileComments(profileId.value, commentCursor.value);
    comments.value.push(...page.nodes);
    commentCursor.value = page.endCursor;
    commentHasNext.value = page.hasNextPage;
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取用户评论失败"));
  } finally {
    commentLoading.value = false;
  }
};

const formatNumber = (n: number) => {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};


const goArticle = (discussion: Discussion, event: MouseEvent) => {
  event.preventDefault();
  discussionModal.open(discussion.id, {
    coverAspectRatio: getCoverAspectRatio(discussion.coverWidth, discussion.coverHeight),
  });
};

const goCommentArticle = (articleId?: string) => {
  if (articleId) discussionModal.open(articleId);
};

const CARD_HORIZONTAL_CHROME = 24;
const CARD_FIXED_HEIGHT = 83;
const CARD_EXCERPT_LINE_HEIGHT = 21;
const CARD_MAX_EXCERPT_LINES = 2;

const masonryKeyMapper = (d: Discussion) => d.id;
const skeletonKeyMapper = (item: SkeletonItem) => item.id;

const skeletonItems = computed(() => generateSkeletons(calculateSkeletonCount(import.meta.client ? window.innerWidth : 0, import.meta.client)));

const getWeightedTextLength = (text: string) => {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    length += text.charCodeAt(i) <= 0xff ? 0.55 : 1;
  }
  return length;
};

const estimateCardHeight = (discussion: Discussion, itemWidth: number) => {
  const coverH = itemWidth / getCoverAspectRatio(discussion.coverWidth, discussion.coverHeight);
  const text = discussion.bodyText || discussion.rawBodyText || "暂无摘要内容";
  const contentW = Math.max(1, itemWidth - CARD_HORIZONTAL_CHROME);
  const charsPerLine = Math.max(1, Math.floor(contentW / 15));
  const excerptLines = Math.min(CARD_MAX_EXCERPT_LINES, Math.max(1, Math.ceil(getWeightedTextLength(text) / charsPerLine)));
  return Math.ceil(coverH + CARD_FIXED_HEIGHT + excerptLines * CARD_EXCERPT_LINE_HEIGHT);
};

watch(
  () => tab.value,
  async (next) => {
    if (next === "articles" && !articles.value.length) {
      await loadProfileArticles();
    }
    if (next === "comments" && !comments.value.length) {
      await loadProfileComments();
    }
  },
);

onMounted(async () => {
  loading.value = true;
  loadError.value = false;
  pageDataLoading.claim();
  try {
    profile.value = await api.getProfile(profileId.value);
    await loadProfileArticles();
  } catch (err) {
    loadError.value = true;
    message.error(resolveErrorMessage(err, "获取用户信息失败"));
  } finally {
    loading.value = false;
    pageDataLoading.finish();
  }
});
</script>

<template>
  <section class="ik-profile container">
    <!-- Skeleton -->
    <div v-if="loading" class="ik-profile-skeleton" aria-busy="true">
      <!-- Header skeleton — matches .ik-profile-header (gap:28px, padding:32px 0) -->
      <div class="ik-profile-header">
        <div class="ik-profile-avatar">
          <div class="ik-skel ik-skel--circle" style="width:100%;height:100%"></div>
        </div>
        <!-- matches .ik-profile-info (flex col, gap:6px, padding-top:4px) -->
        <div class="ik-profile-info">
          <!-- name: font-size:26px, line-height:1.3 => ~34px -->
          <div class="ik-skel" style="width:180px;height:34px;border-radius:4px"></div>
          <!-- UID: font-size:13px, margin-top:2px (gap handles 6px but margin-top:2px on actual) -->
          <div class="ik-skel" style="width:100px;height:13px;border-radius:3px"></div>
          <!-- bio: margin:6px 0 0, font-size:14px, line-height:1.5 => ~21px -->
          <div class="ik-skel" style="width:240px;height:21px;border-radius:3px;margin-top:6px"></div>
          <!-- stats: margin-top:10px, gap:24px, items are inline-flex baseline -->
          <div style="display:flex;gap:24px;margin-top:10px">
            <div class="ik-skel" style="width:64px;height:20px;border-radius:3px"></div>
            <div class="ik-skel" style="width:80px;height:20px;border-radius:3px"></div>
            <div class="ik-skel" style="width:56px;height:20px;border-radius:3px"></div>
          </div>
        </div>
      </div>
      <!-- Tab bar skeleton — matches .ik-profile-tabs (centered, margin-top:8px, border-bottom) -->
      <div class="ik-profile-tabs" style="pointer-events:none">
        <div style="padding:14px 28px"><div class="ik-skel" style="width:56px;height:15px;border-radius:3px"></div></div>
        <div style="padding:14px 28px"><div class="ik-skel" style="width:56px;height:15px;border-radius:3px"></div></div>
      </div>
      <!-- Article grid skeleton — matches .ik-profile-content (padding-top:16px) -->
      <div style="padding-top:16px">
        <ClientOnly>
          <VirtualMasonry
            class="ik-profile-articles"
            :items="skeletonItems"
            :column-width="200"
            :gap="16"
            :min-columns="2"
            :max-columns="6"
            :key-mapper="skeletonKeyMapper"
            :height-mapper="estimateSkeletonHeight"
            :measure-items="false"
          >
            <template #default="{ item }">
              <DiscussionCardSkeleton :skeleton="item" />
            </template>
          </VirtualMasonry>
        </ClientOnly>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="loadError && !profile" class="ik-empty">加载失败，请刷新重试</div>

    <template v-else-if="profile">
      <div class="ik-profile-header">
        <div class="ik-profile-avatar">
          <img
            :src="profile.avatar || '/images/default-avatar.webp'"
            alt=""
            class="ik-profile-avatar__img"
            @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
          />
        </div>
        <div class="ik-profile-info">
          <h1 class="ik-profile-info__name">
            {{ profile.name || profile.login || "匿名用户" }}
            <span class="ik-profile-info__level">Lv.{{ profile.level || 1 }}</span>
          </h1>
          <span class="ik-profile-info__id">UID: {{ profile.uid }}</span>
          <p v-if="profile.bio" class="ik-profile-info__bio">{{ profile.bio }}</p>
          <p v-else class="ik-profile-info__bio ik-profile-info__bio--empty">这个人很神秘，什么都没有留下。</p>
          <div v-if="profile.stats" class="ik-profile-stats">
            <span class="ik-profile-stats__item">
              <span class="ik-profile-stats__value">{{ formatNumber(profile.stats.totalViews) }}</span>
              <span class="ik-profile-stats__label">浏览</span>
            </span>
            <span class="ik-profile-stats__item">
              <span class="ik-profile-stats__value">{{ formatNumber(profile.stats.totalComments) }}</span>
              <span class="ik-profile-stats__label">收到评论</span>
            </span>
            <span class="ik-profile-stats__item">
              <span class="ik-profile-stats__value">{{ formatNumber(profile.stats.totalLikes) }}</span>
              <span class="ik-profile-stats__label">获赞</span>
            </span>
          </div>
        </div>
      </div>

      <!-- ── Tab Bar ──────────────────────────── -->
      <div class="ik-profile-tabs">
        <button
          class="ik-profile-tab"
          :class="{ 'ik-profile-tab--active': tab === 'articles' }"
          @click="tab = 'articles'"
        >
          帖子
          <span v-if="profile.stats" class="ik-profile-tab__count">{{ profile.stats.articleCount }}</span>
        </button>
        <button
          class="ik-profile-tab"
          :class="{ 'ik-profile-tab--active': tab === 'comments' }"
          @click="tab = 'comments'"
        >
          评论
          <span v-if="profile.stats" class="ik-profile-tab__count">{{ profile.stats.commentCount }}</span>
        </button>
      </div>

      <!-- ── Tab Content ──────────────────────── -->
      <div class="ik-profile-content">
        <!-- Articles Tab -->
        <template v-if="tab === 'articles'">
          <div v-if="!articles.length && !articleLoading" class="ik-profile-empty">
            <svg class="ik-profile-empty__icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="1.5" />
              <circle cx="32" cy="26" r="8" stroke="currentColor" stroke-width="1.5" />
              <path d="M16 50c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="currentColor" stroke-width="1.5" />
            </svg>
            <span class="ik-profile-empty__text">还没有发布任何内容哦</span>
          </div>
          <ClientOnly v-else>
            <VirtualMasonry
              class="ik-profile-articles"
              :items="articles"
              :column-width="200"
              :gap="16"
              :min-columns="2"
              :max-columns="6"
              :buffer="2500"
              :estimated-height="300"
              :height-mapper="estimateCardHeight"
              :key-mapper="masonryKeyMapper"
              :measure-items="false"
            >
              <template #default="{ item, index }">
                <DiscussionCard
                  :discussion="item"
                  :eager="index < 6"
                  @open="goArticle"
                />
              </template>
            </VirtualMasonry>
          </ClientOnly>
          <div class="ik-profile-load-more">
            <z-button v-if="articleHasNext" :loading="articleLoading" @click="loadProfileArticles">
              加载更多
            </z-button>
            <span v-else-if="articles.length" class="ik-meta">已全部加载</span>
          </div>
        </template>

        <!-- Comments Tab -->
        <template v-else-if="tab === 'comments'">
          <div v-if="!comments.length && !commentLoading" class="ik-profile-empty">
            <svg class="ik-profile-empty__icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="1.5" />
              <circle cx="24" cy="32" r="2.5" fill="currentColor" />
              <circle cx="32" cy="32" r="2.5" fill="currentColor" />
              <circle cx="40" cy="32" r="2.5" fill="currentColor" />
            </svg>
            <span class="ik-profile-empty__text">还没有任何评论哦</span>
          </div>
          <div v-else class="ik-profile-comments">
            <div
              v-for="c in comments"
              :key="c.id"
              class="ik-pcomment"
              :class="{ 'ik-pcomment--clickable': !!c.articleId }"
              @click="goCommentArticle(c.articleId)"
            >
              <!-- Reply reference -->
              <div v-if="c.parentContent" class="ik-pcomment__ref">
                <span class="ik-pcomment__ref-label">回复 </span>
                <span class="ik-pcomment__ref-name">{{ c.parentAuthorName || "未知用户" }}</span>
                <p class="ik-pcomment__ref-text">{{ c.parentContent }}</p>
              </div>
              <!-- Comment body -->
              <p class="ik-pcomment__body">{{ c.content }}</p>
              <!-- Footer -->
              <div class="ik-pcomment__footer">
                <span class="ik-pcomment__time">{{ formatTime(c.createdAt) }}</span>
                <span class="ik-pcomment__spacer" />
                <HandThumbUpIconSolid
                  v-if="c.liked"
                  class="ik-pcomment__like-icon ik-pcomment__like-icon--active"
                  style="width:14px;height:14px"
                />
                <HandThumbUpIcon
                  v-else
                  class="ik-pcomment__like-icon"
                  style="width:14px;height:14px;color:#808080"
                />
                <span v-if="c.likesCount" class="ik-pcomment__like-count" :class="{ 'ik-pcomment__like-count--active': c.liked }">{{ c.likesCount }}</span>
              </div>
              <!-- Article reference -->
              <div v-if="c.articleTitle" class="ik-pcomment__article">
                <DocumentTextIcon style="width:14px;height:14px;color:#808080" />
                <span class="ik-pcomment__article-title">{{ c.articleTitle }}</span>
              </div>
            </div>
          </div>
          <div class="ik-profile-load-more">
            <z-button v-if="commentHasNext" :loading="commentLoading" @click="loadProfileComments">
              加载更多
            </z-button>
            <span v-else-if="comments.length" class="ik-meta">已全部加载</span>
          </div>
        </template>
      </div>

    </template>
  </section>
</template>

<style scoped>
.ik-profile {
  padding-top: 40px;
  padding-bottom: 48px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Skeleton ─────────────────────────────────── */
@keyframes ik-skel-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.ik-skel {
  background: #222;
  animation: ik-skel-pulse 1.5s ease-in-out infinite;
}

.ik-skel--circle {
  border-radius: 999px;
}

@media (prefers-reduced-motion: reduce) {
  .ik-skel {
    animation: none;
    opacity: 0.6;
  }
}

.ik-profile-header {
  display: flex;
  align-items: flex-start;
  gap: 28px;
  padding: 32px 0;
}

/* Avatar */
.ik-profile-avatar {
  flex-shrink: 0;
  width: 96px;
  height: 96px;
  border-radius: 999px;
  border: 2px solid #3a3a3a;
  padding: 3px;
}

.ik-profile-avatar__img {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  object-fit: cover;
  background: #111;
}

/* Info */
.ik-profile-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}

.ik-profile-info__name {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  color: #fff;
  line-height: 1.3;
}

.ik-profile-info__id {
  font-size: 13px;
  color: #808080;
  margin-top: 2px;
}

.ik-profile-info__bio {
  margin: 6px 0 0;
  font-size: 14px;
  color: #b0b0b0;
  line-height: 1.5;
}

.ik-profile-info__bio--empty {
  color: #606060;
  font-style: italic;
}

/* Level badge (superscript beside name) */
.ik-profile-info__level {
  display: inline-block;
  vertical-align: super;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #d7ff00;
  font-size: 11px;
  font-weight: 800;
  font-style: italic;
  color: #000;
  line-height: 1.4;
}

.ik-profile-stats {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 10px;
}

.ik-profile-stats__item {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.ik-profile-stats__value {
  font-size: 16px;
  font-weight: 800;
  color: #fff;
}

.ik-profile-stats__label {
  font-size: 13px;
  color: #808080;
}

.ik-profile-tabs {
  display: flex;
  justify-content: center;
  gap: 0;
  border-bottom: 1px solid #2a2a2a;
  margin-top: 8px;
}

.ik-profile-tab {
  position: relative;
  padding: 14px 28px;
  border: none;
  background: transparent;
  color: #808080;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: color 150ms ease;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.ik-profile-tab:hover {
  color: #c0c0c0;
}

.ik-profile-tab--active {
  color: #fff;
}

.ik-profile-tab--active::after {
  content: "";
  position: absolute;
  bottom: -1px;
  left: 50%;
  transform: translateX(-50%);
  width: 28px;
  height: 3px;
  border-radius: 2px;
  background: #d7ff00;
}

.ik-profile-tab__count {
  font-size: 12px;
  opacity: 0.7;
}

/* ── Content Area ─────────────────────────────── */
.ik-profile-content {
  min-height: 200px;
  padding-top: 16px;
}

.ik-profile-articles {
  width: 100%;
}

.ik-profile-load-more {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}

.ik-profile-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 80px 0;
  color: #555;
}

.ik-profile-empty__icon {
  width: 64px;
  height: 64px;
}

.ik-profile-empty__text {
  font-size: 14px;
  color: #808080;
}

/* ── Comment Card (Profile) ───────────────────── */
.ik-profile-comments {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ik-pcomment {
  padding: 16px 0;
  border-bottom: 1px solid #2a2a2a;
}

.ik-pcomment--clickable {
  cursor: pointer;
  transition: background 150ms ease;
  padding: 16px 12px;
  margin: 0 -12px;
  border-radius: 8px;
}

.ik-pcomment--clickable:hover {
  background: rgba(255, 255, 255, 0.03);
}

/* Reply reference */
.ik-pcomment__ref {
  padding: 8px 10px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: #1a1a1a;
  border-left: 3px solid #333;
}

.ik-pcomment__ref-label {
  font-size: 12px;
  color: #808080;
}

.ik-pcomment__ref-name {
  font-size: 12px;
  color: #d7ff00;
  font-weight: 600;
}

.ik-pcomment__ref-text {
  margin: 4px 0 0;
  font-size: 12px;
  color: #999;
  line-height: 1.4;
}

/* Body */
.ik-pcomment__body {
  margin: 0;
  font-size: 15px;
  color: #e0e0e0;
  line-height: 1.65;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* Footer */
.ik-pcomment__footer {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
}

.ik-pcomment__time {
  font-size: 12px;
  color: #808080;
}

.ik-pcomment__spacer {
  flex: 1;
}

.ik-pcomment__like-icon {
  flex-shrink: 0;
}

.ik-pcomment__like-count {
  font-size: 12px;
  color: #808080;
  font-weight: 700;
}

.ik-pcomment__like-count--active {
  color: #d7ff00;
}

/* Article reference */
.ik-pcomment__article {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #222;
}

.ik-pcomment__article-title {
  font-size: 12px;
  color: #808080;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Mobile ───────────────────────────────────── */
@media (max-width: 768px) {
  .ik-profile {
    padding-top: 16px;
    padding-left: 16px;
    padding-right: 16px;
  }

  .ik-profile-header {
    gap: 16px;
    padding: 20px 0;
  }

  .ik-profile-avatar {
    width: 72px;
    height: 72px;
  }

  .ik-profile-info__name {
    font-size: 20px;
  }

  .ik-profile-stats {
    gap: 16px;
  }

  .ik-profile-stats__value {
    font-size: 15px;
  }

  .ik-profile-stats__label {
    font-size: 12px;
  }

  .ik-profile-tab {
    padding: 12px 20px;
    font-size: 14px;
  }

}

@media (max-width: 480px) {
  .ik-profile-header {
    gap: 14px;
  }

  .ik-profile-avatar {
    width: 60px;
    height: 60px;
  }

  .ik-profile-info__name {
    font-size: 18px;
  }

  .ik-profile-stats {
    gap: 12px;
    flex-wrap: wrap;
  }
}
</style>
