<script setup lang="ts">
import { useMessage } from "zenless-ui";
import type { BusinessCard, Discussion, Profile } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import { getCoverAspectRatio } from "~/utils/cover";

const route = useRoute();
const api = useApi();
const discussionModal = useDiscussionModal();
const pageDataLoading = usePageDataLoading();
const message = useMessage();

const profile = ref<Profile | null>(null);
const loadError = ref(false);
const loading = ref(false);
const showCardModal = ref(false);

const articles = ref<Discussion[]>([]);
const articleCursor = ref("");
const articleHasNext = ref(true);
const articleLoading = ref(false);

const profileId = computed(() => String(route.params.id || ""));

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

const onCardEquipped = (card: BusinessCard | null) => {
  if (profile.value) {
    profile.value = { ...profile.value, equippedCard: card ?? undefined };
  }
};

const copyUid = async () => {
  const uid = profile.value?.uid;
  if (uid == null) return;
  try {
    await navigator.clipboard.writeText(String(uid));
    message.success("UID 已复制");
  } catch {
    message.error("复制失败");
  }
};

const profileTitle = computed(() =>
  profile.value?.name ? `${profile.value.name}的主页 - 绳网` : "用户主页 - 绳网",
);
const profileDescription = computed(() =>
  profile.value?.bio || `查看 ${profile.value?.name || "用户"} 在绳网上的帖子和评论`,
);

useSeoMeta({
  title: profileTitle,
  description: profileDescription,
  ogTitle: profileTitle,
  ogDescription: profileDescription,
  ogImage: () => profile.value?.avatar || "/images/zzzicon_200x200.png",
});

// Lock page scroll while on this profile page
let _prevHtmlOverflow = "";
let _prevBodyOverflow = "";

onMounted(async () => {
  if (import.meta.client) {
    _prevHtmlOverflow = document.documentElement.style.overflow;
    _prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }

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

onBeforeUnmount(() => {
  if (import.meta.client) {
    document.documentElement.style.overflow = _prevHtmlOverflow;
    document.body.style.overflow = _prevBodyOverflow;
  }
});
</script>

<template>
  <section class="ik-profile">
    <!-- ══════════ Skeleton ══════════ -->
    <div v-if="loading" class="ik-profile" aria-busy="true">
      <div class="ik-frame">
        <div class="ik-frame__inner">
          <div class="ik-frame__body">
      <!-- Tab bar skeleton -->
      <div class="ik-tab-bar">
        <div class="ik-skel" style="width:140px;height:18px;border-radius:4px"></div>
        <div class="ik-skel" style="width:80px;height:36px;border-radius:999px"></div>
      </div>
      <!-- A-frame skeleton -->
      <div class="ik-aframe">
        <!-- Banner skeleton -->
        <div class="ik-banner-card">
          <div class="ik-banner ik-banner--skeleton">
            <div class="ik-banner__user">
              <div class="ik-skel ik-skel--circle" style="width:72px;height:72px"></div>
              <div style="display:flex;flex-direction:column;gap:10px">
                <div class="ik-skel" style="width:140px;height:24px;border-radius:6px"></div>
                <div class="ik-skel" style="width:100px;height:28px;border-radius:6px"></div>
              </div>
            </div>
          </div>
          <div class="ik-banner-footer">
            <div class="ik-skel" style="width:200px;height:16px;border-radius:4px"></div>
          </div>
        </div>
        <div class="ik-aframe__content">
          <!-- Cards skeleton -->
          <div class="ik-article-grid">
            <div v-for="n in 6" :key="n" class="ik-article-grid__item">
              <div class="ik-skel" style="width:100%;aspect-ratio:3/4;border-radius:12px"></div>
              <div class="ik-skel" style="width:60%;height:14px;border-radius:4px;margin:8px auto 0"></div>
            </div>
          </div>
        </div>
      </div>
          </div>
        </div>
      </div>
      <!-- Actions skeleton -->
      <div class="ik-bottom-actions">
        <div class="ik-skel" style="width:100px;height:44px;border-radius:999px" v-for="n in 4" :key="n"></div>
      </div>
    </div>

    <!-- ══════════ Error ══════════ -->
    <div v-else-if="loadError && !profile" class="ik-empty">加载失败，请刷新重试</div>

    <!-- ══════════ Main Content ══════════ -->
    <template v-else-if="profile">

      <!-- ── 大框 (Double-border frame) ────────── -->
      <div class="ik-frame">
        <div class="ik-frame__inner">
          <div class="ik-frame__body">

      <!-- ── Tab Bar (UID + 更多操作) ──────────── -->
      <div class="ik-tab-bar">
        <div class="ik-tab-bar__left">
          <span class="ik-tab-bar__label">UID:</span>
          <span class="ik-tab-bar__value">{{ profile.uid }}</span>
          <button class="ik-tab-bar__copy" aria-label="复制UID" @click="copyUid">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
        </div>
        <z-button v-if="profile.isSelf" @click="message.warning('功能即将开放')">更多操作</z-button>
      </div>

      <!-- ── A-Frame (包含名片 + 帖子) ────────── -->
      <div class="ik-aframe">

      <!-- ── Profile Banner Card (flush 贴合 A-frame 上边) ─── -->
      <div class="ik-banner-card">
        <div
          class="ik-banner"
          :style="profile.equippedCard?.image ? { backgroundImage: `url('${profile.equippedCard.image}')` } : undefined"
        >
          <!-- User info area (left aligned) -->
          <div class="ik-banner__user">
            <div class="ik-banner__avatar-wrap">
              <div class="ik-banner__avatar">
                <img
                  :src="profile.avatar || '/images/default-avatar.webp'"
                  alt=""
                  class="ik-banner__avatar-img"
                  @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                />
              </div>
              <span class="ik-banner__level">{{ profile.level || 1 }}</span>
            </div>
            <div class="ik-banner__info">
              <h1 class="ik-banner__name">{{ profile.name || profile.login || "匿名用户" }}</h1>
              <span v-if="profile.bio" class="ik-banner__title-tag">{{ profile.bio }}</span>
              <span v-else class="ik-banner__title-tag ik-banner__title-tag--empty">暂无称号</span>
            </div>
          </div>

          <!-- Stats text row -->
          <div v-if="profile.stats" class="ik-banner__stats">
            <span class="ik-stat">
              <span class="ik-stat__label">浏览</span>
              <span class="ik-stat__num">{{ formatNumber(profile.stats.totalViews) }}</span>
            </span>
            <span class="ik-stat__sep">-</span>
            <span class="ik-stat">
              <span class="ik-stat__label">评论</span>
              <span class="ik-stat__num">{{ formatNumber(profile.stats.totalComments) }}</span>
            </span>
            <span class="ik-stat__sep">-</span>
            <span class="ik-stat">
              <span class="ik-stat__label">点赞</span>
              <span class="ik-stat__num">{{ formatNumber(profile.stats.totalLikes) }}</span>
            </span>
          </div>

        </div>

        <!-- Footer: signature -->
        <z-pattern type="squares" class="ik-banner-footer">
          <p v-if="profile.bio" class="ik-banner-footer__sig">{{ profile.bio }}</p>
          <p v-else class="ik-banner-footer__sig ik-banner-footer__sig--empty">这个人很神秘，什么都没有留下。</p>
        </z-pattern>
      </div>

      <!-- ── 下半 (帖子区域) ───────────────── -->
      <div class="ik-aframe__content">

      <!-- ── Article Grid ────────────────────────── -->
      <div class="ik-article-grid">
        <div v-if="!articles.length && !articleLoading" class="ik-article-grid__empty">
          还没有发布任何内容哦
        </div>
        <template v-else>
          <div
            v-for="(item, index) in articles"
            :key="item.id"
            class="ik-article-grid__item"
          >
            <DiscussionCard
              :discussion="item"
              :eager="index < 6"
              @open="goArticle"
            />
          </div>
        </template>
      </div>
      <!-- Load more -->
      <div v-if="articleHasNext && articles.length" class="ik-load-more-wrap">
        <button class="ik-load-more" :disabled="articleLoading" @click="loadProfileArticles">
          <span v-if="articleLoading"><i class="z-icon-loading ik-spin" /></span>
          <span v-else>加载更多</span>
        </button>
      </div>

      </div><!-- /.ik-aframe__content -->
      </div><!-- /.ik-aframe -->

          </div>
        </div>
      </div>

      <!-- ── Bottom Actions ──────────────────────── -->
      <div v-if="profile.isSelf" class="ik-bottom-actions">
        <z-button @click="message.warning('功能即将开放')">修改头像</z-button>
        <z-button @click="message.warning('功能即将开放')">修改称号</z-button>
        <z-button @click="message.warning('功能即将开放')">修改勋章</z-button>
        <z-button @click="showCardModal = true">修改名片</z-button>
      </div>

      <!-- 名片选择弹窗 -->
      <ClientOnly>
        <Teleport to="body">
          <Transition name="ik-overlay" appear @after-leave="showCardModal = false">
            <BusinessCardModal
              v-if="showCardModal"
              :profile="profile"
              @close="showCardModal = false"
              @equipped="onCardEquipped"
            />
          </Transition>
        </Teleport>
      </ClientOnly>

    </template>
  </section>
</template>

<style scoped>
.ik-profile {
  width: 100%;
  max-width: 1600px;
  margin: 0 auto;
  padding: 16px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: calc(100vh - 78px);
  min-height: 0;
  overflow: hidden;
}

/* ── 大框 (Double-border frame) ──────────────── */
.ik-frame {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px;
}
.ik-frame__inner {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: #000;
  border-radius: 22px;
  overflow: hidden;
}
.ik-frame__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
  padding: 0;
  gap: 0;
  border-radius: 20px;
  overflow: hidden;
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
.ik-skel--circle { border-radius: 999px; }
@media (prefers-reduced-motion: reduce) {
  .ik-skel { animation: none; opacity: 0.6; }
}

/* ── Tab Bar (UID + 更多操作) ─────────────── */
.ik-tab-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  min-height: 52px;
  flex-shrink: 0;
  border-radius: 0 0 16px 16px;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #161616 0%, #080808 100%);
}
.ik-tab-bar__left {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: #000;
  border-radius: 999px;
  font-weight: 700;
  font-size: 14px;
  color: #fff;
}
.ik-tab-bar__label { letter-spacing: 0.5px; }
.ik-tab-bar__value { font-family: monospace; }
.ik-tab-bar__copy {
  margin-left: 4px;
  color: rgba(255,255,255,0.5);
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  transition: color 0.2s;
}
.ik-tab-bar__copy:hover { color: #fff; }

/* ── A-Frame (透明定位包裹) ───────────────── */
.ik-aframe {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #010101 0%, #161616 100%);
}
.ik-aframe__content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ── Banner Card (与帖子卡片左右对齐) ──────── */
.ik-banner-card {
  background: transparent;
  padding: 0;
  margin: 12px 16px 0;
  overflow: hidden;
  border-radius: 14px;
}

.ik-banner {
  position: relative;
  border-radius: 0 0 14px 14px;
  overflow: hidden;
  background: #2a2d33 url("/images/banner.png") center/cover no-repeat;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 24px;
  padding: 32px 36px;
}
.ik-banner--skeleton {
  background: linear-gradient(135deg, #1a1a1a 0%, #222 50%, #1a1a1a 100%);
  border-color: #2a2a2a;
}

/* User info inside banner */
.ik-banner__user {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 20px;
}
.ik-banner__avatar-wrap {
  position: relative;
  flex-shrink: 0;
}
.ik-banner__avatar {
  width: 90px;
  height: 90px;
  border-radius: 999px;
  overflow: hidden;
  border: 4px solid #000;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  background: #000;
}
.ik-banner__avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ik-banner__level {
  position: absolute;
  top: -4px;
  left: -4px;
  min-width: 32px;
  height: 32px;
  border-radius: 999px;
  background: #000;
  border: 2px solid #000;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  line-height: 28px;
  text-align: center;
  padding: 0 6px;
}

.ik-banner__info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 6px;
}
.ik-banner__name {
  margin: 0;
  font-size: 30px;
  font-weight: 900;
  color: #fff;
  line-height: 1.1;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.4);
  letter-spacing: 0.5px;
}
.ik-banner__title-tag {
  display: inline-block;
  align-self: flex-start;
  padding: 5px 16px;
  border-radius: 999px;
  background: #000;
  box-shadow: inset 0 -2px 0 rgba(0,0,0,0.3), 0 2px 0 rgba(0,0,0,0.2);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.ik-banner__title-tag--empty {
  background: #000;
  box-shadow: none;
  color: rgba(255,255,255,0.6);
  font-style: italic;
}

/* Stat text row */
.ik-banner__stats {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  margin-top: auto;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.3px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
.ik-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.ik-stat__label {
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
}
.ik-stat__num {
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.ik-stat__sep {
  color: rgba(255, 255, 255, 0.5);
  font-weight: 700;
}

/* Banner footer */
.ik-banner-footer {
  padding: 8px 16px;
  border-bottom: 2px solid #000;
  border-radius: 0 0 14px 14px;
  overflow: hidden;
}
.ik-banner-footer__sig {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255,255,255,0.95);
  line-height: 1.5;
}
.ik-banner-footer__sig--empty {
  color: rgba(255,255,255,0.35);
  font-style: italic;
}

/* ── Article Grid ─────────────────────────────── */
.ik-article-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.ik-article-grid__empty {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  font-size: 14px;
  color: #555;
  border-radius: 16px;
  background: #0f0f0f;
  border: 1px solid #1f1f1f;
}
.ik-article-grid__item {
  border-radius: 16px;
  overflow: hidden;
}
.ik-article-grid__item :deep(.ik-card__cover-frame) {
  max-height: 260px;
}

/* Load more */
.ik-load-more-wrap {
  display: flex;
  justify-content: center;
}
.ik-load-more {
  padding: 10px 32px;
  border-radius: 999px;
  background: #0f0f0f;
  color: rgba(255,255,255,0.9);
  font-weight: 700;
  font-size: 14px;
  border: 1px solid #2a2a2a;
  cursor: pointer;
  transition: background 0.2s;
}
.ik-load-more:hover { background: #1a1a1a; }
.ik-load-more:disabled { opacity: 0.5; cursor: default; }

@keyframes ik-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.ik-spin {
  display: inline-block;
  animation: ik-spin 0.8s linear infinite;
}

/* ── Bottom Actions ───────────────────────────── */
.ik-bottom-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

/* ── Responsive ─────────────────────────────── */
@media (min-width: 640px) {
  .ik-article-grid { grid-template-columns: repeat(3, 1fr); }
  .ik-profile { padding: 20px 24px 32px; }
}
@media (min-width: 1024px) {
  .ik-article-grid { grid-template-columns: repeat(6, 1fr); }
}
@media (max-width: 639px) {
  .ik-profile { height: calc(100vh - 66px); }
  .ik-frame { border-radius: 12px; }
  .ik-frame__inner { border-radius: 12px; }
  .ik-frame__body { padding: 0; }
  .ik-tab-bar { padding: 8px 14px; min-height: 44px; }
  .ik-banner { min-height: 240px; padding: 22px 18px; }
  .ik-banner__avatar { width: 68px; height: 68px; border-width: 3px; }
  .ik-banner__level { min-width: 28px; height: 28px; font-size: 12px; line-height: 24px; }
  .ik-banner__name { font-size: 22px; }
  .ik-banner__title-tag { font-size: 13px; padding: 4px 12px; }
  .ik-banner__stats { font-size: 13px; gap: 8px; }
  .ik-aframe__content { padding: 10px; gap: 10px; }
  .ik-banner-card { margin: 0 10px; padding: 0; }
}
</style>
