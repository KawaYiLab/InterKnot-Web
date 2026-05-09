<script setup lang="ts">
import { useDebounceFn, useWindowSize } from "@vueuse/core";
import { useMessage } from "zenless-ui";
import type { Discussion } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import {
  FALLBACK_COVER_ASPECT_RATIO,
  estimateTitleLineCount,
  getCoverAspectRatio,
  getNormalizedCoverAspectRatio,
} from "~/utils/cover";
import { calculateSkeletonCount, estimateSkeletonHeight, generateSkeletons, type SkeletonItem } from "~/utils/skeleton";
import { ArrowPathIcon } from "@heroicons/vue/24/outline";

const api = useApi();
const route = useRoute();
const discussionModal = useDiscussionModal();
const message = useMessage();
const pageDataLoading = usePageDataLoading();

useSeoMeta({
  title: "绳网",
  description: "绳网是一个游戏、技术交流平台，发现并分享有趣的内容。",
  ogTitle: "绳网",
  ogDescription: "绳网是一个游戏、技术交流平台，发现并分享有趣的内容。",
});

const scrollTarget = ref<HTMLElement>();
onMounted(() => {
  const el = document.documentElement;
  // z-backtop listens on target's "scroll" event and reads target.scrollTop
  // But document.documentElement may not fire "scroll" events in all browsers.
  // Bridge window scroll events to the element so z-backtop works correctly.
  window.addEventListener("scroll", () => {
    el.dispatchEvent(new Event("scroll"));
  });
  scrollTarget.value = el;
});

const LOAD_MORE_ROOT_MARGIN = "360px 0px";
const LOAD_MORE_COOLDOWN_MS = 1000;
// 固定部分（不含 title 高度）：
//   card padding(8) + body padding-bottom(12) + author-row min-height(32)
// + body gap(8) + title margin(8) = 68px
// title 高度按真实行数（1 或 2）动态加，与 DiscussionCard 实际渲染严格匹配，
// 避免 ResizeObserver 测量后触发 layout 重排引起的滚动跳动。
const DISCUSSION_CARD_FIXED_HEIGHT = 68;
const DISCUSSION_CARD_TITLE_FONT_SIZE = 17;
const DISCUSSION_CARD_TITLE_LINE_HEIGHT = 1.25;
// 卡片 body 横向内边距 = 8 * 2 = 16px，title 可用宽度 = itemWidth - 16
const DISCUSSION_CARD_BODY_PADDING_X = 16;

const query = ref(pickFirstQuery(route.query.q as string | string[] | undefined));
const loading = ref(false);
const loadingMore = ref(false);
const refreshing = ref(false);

const list = shallowRef<Discussion[]>([]);
const enterAnimationIds = shallowRef(new Set<string>());
const endCursor = ref("0");
const hasNextPage = ref(true);
const requestVersion = ref(0);
let seenIds = new Set<string>();
let lastFetchTime = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const loadMoreObserverRef = shallowRef<IntersectionObserver | null>(null);

const masonryKeyMapper = (discussion: Discussion) => discussion.id;
const skeletonKeyMapper = (item: SkeletonItem) => item.id;
const { width: viewportWidth } = useWindowSize({ initialWidth: 0 });


const estimateDiscussionCardHeight = (discussion: Discussion, itemWidth: number) => {
  // 无封面文章使用占位图原生比例，与卡片实际渲染保持一致
  const ratio = discussion.cover
    ? getNormalizedCoverAspectRatio(discussion.coverWidth, discussion.coverHeight)
    : FALLBACK_COVER_ASPECT_RATIO;
  const coverHeight = itemWidth / ratio;

  // 按 title 真实行数估算：避免短标题被强制占 2 行高度，又避免与实际渲染不一致引发滚动跳动
  const titleAvailWidth = Math.max(0, itemWidth - DISCUSSION_CARD_BODY_PADDING_X);
  const titleLines = estimateTitleLineCount(
    discussion.title,
    titleAvailWidth,
    DISCUSSION_CARD_TITLE_FONT_SIZE,
  );
  const titleHeight =
    DISCUSSION_CARD_TITLE_FONT_SIZE * DISCUSSION_CARD_TITLE_LINE_HEIGHT * titleLines;

  return Math.ceil(coverHeight + DISCUSSION_CARD_FIXED_HEIGHT + titleHeight);
};

const addEnterAnimations = (nodes: Discussion[]) => {
  if (!nodes.length) return;

  const nextIds = new Set(enterAnimationIds.value);
  for (const node of nodes) {
    if (node.id) nextIds.add(node.id);
  }
  enterAnimationIds.value = nextIds;
};

const shouldAnimateDiscussion = (discussionId: string) => {
  return enterAnimationIds.value.has(discussionId);
};

const finishEnterAnimation = (discussionId: string) => {
  if (!enterAnimationIds.value.has(discussionId)) return;

  const nextIds = new Set(enterAnimationIds.value);
  nextIds.delete(discussionId);
  enterAnimationIds.value = nextIds;
};

const skeletonCount = computed(() => {
  return calculateSkeletonCount(viewportWidth.value, import.meta.client);
});

const skeletonItems = computed(() => generateSkeletons(skeletonCount.value));

const toUniqueNodes = (nodes: Discussion[], reset: boolean): Discussion[] => {
  if (reset) {
    seenIds = new Set();
  }

  const unique: Discussion[] = [];
  for (const node of nodes) {
    if (!node.id || seenIds.has(node.id)) continue;
    seenIds.add(node.id);
    unique.push(node);
  }
  return unique;
};

const scrollToTopAfterReset = async (reset: boolean) => {
  await nextTick();
  if (reset && import.meta.client) {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
};

const fetchList = async (reset = false) => {
  if (loading.value || loadingMore.value) return;
  if (!hasNextPage.value && !reset) return;

  const shouldShowPageProgress = reset && !refreshing.value;
  if (shouldShowPageProgress) {
    if (!pageDataLoading.isActive.value) {
      pageDataLoading.start();
    }
    pageDataLoading.claim();
  }

  if (reset && !refreshing.value) {
    loading.value = true;
  } else if (!reset) {
    loadingMore.value = true;
  }

  const currentVersion = ++requestVersion.value;
  try {
    const page = await api.searchArticles(query.value.trim(), reset ? "0" : endCursor.value);
    if (currentVersion !== requestVersion.value) {
      return;
    }

    const uniqueNodes = toUniqueNodes(page.nodes, reset);

    if (reset) {
      enterAnimationIds.value = new Set();
      list.value = uniqueNodes;
    } else {
      addEnterAnimations(uniqueNodes);
      list.value = [...list.value, ...uniqueNodes];
    }

    endCursor.value = page.endCursor;
    hasNextPage.value = page.hasNextPage;

    await scrollToTopAfterReset(reset);
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取帖子失败"));
  } finally {
    loading.value = false;
    loadingMore.value = false;
    lastFetchTime = Date.now();
    if (shouldShowPageProgress) {
      pageDataLoading.finish();
    }
  }
};

const goDiscussion = (discussion: Discussion, event: MouseEvent) => {
  // 阻止 NuxtLink 默认导航，改为弹窗展示
  event.preventDefault();
  discussionModal.open(discussion.id, {
    coverAspectRatio: getCoverAspectRatio(discussion.coverWidth, discussion.coverHeight),
  });

  // 标记已读并更新本地列表状态
  if (!discussion.isRead) {
    const next = list.value.map((d) =>
      d.id === discussion.id ? { ...d, isRead: true } : d,
    );
    list.value = next;
  }
  api.markAsReadBatch([discussion.id]).catch(() => {});
};

const handleRefresh = async () => {
  if (refreshing.value || loading.value) return;
  refreshing.value = true;
  window.scrollTo({ top: 0, behavior: "instant" });
  // Minimum visible duration so the animation feels intentional
  const minDelay = new Promise((r) => setTimeout(r, 600));
  await fetchList(true);
  await minDelay;
  refreshing.value = false;
};

const doLoadMore = () => {
  if (loading.value || loadingMore.value || !hasNextPage.value) return;
  fetchList(false).catch(() => undefined);
};

const loadMoreFromObserver = () => {
  if (loading.value || loadingMore.value || !hasNextPage.value) return;

  const elapsed = Date.now() - lastFetchTime;
  if (elapsed < LOAD_MORE_COOLDOWN_MS) {
    if (!cooldownTimer) {
      cooldownTimer = setTimeout(() => {
        cooldownTimer = null;
        doLoadMore();
      }, LOAD_MORE_COOLDOWN_MS - elapsed);
    }
    return;
  }

  doLoadMore();
};

const observeLoadMoreSentinel = () => {
  if (!import.meta.client) return;

  loadMoreObserverRef.value?.disconnect();
  loadMoreObserverRef.value = null;

  const sentinel = loadMoreSentinelRef.value;
  if (!sentinel) return;

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMoreFromObserver();
      }
    },
    {
      root: null,
      rootMargin: LOAD_MORE_ROOT_MARGIN,
      threshold: 0,
    },
  );

  observer.observe(sentinel);
  loadMoreObserverRef.value = observer;
};

const debouncedSearch = useDebounceFn(() => fetchList(true), 300);

watch(
  () => query.value,
  () => {
    debouncedSearch();
  },
);

watch(
  () => route.query.q,
  (nextQuery) => {
    const normalized = pickFirstQuery(nextQuery as string | string[] | undefined);
    if (normalized === query.value) return;
    query.value = normalized;
  },
);

watch(
  () => loadMoreSentinelRef.value,
  async () => {
    await nextTick();
    observeLoadMoreSentinel();
  },
  { flush: "post" },
);

// 在 setup 阶段提前发起首屏数据请求，不等 onMounted
const initialFetchPromise = fetchList(true);

// Triggered by MobileBottomNav when the user double-taps the active
// "推送" entry — mirrors the Flutter app's pull-to-refresh shortcut.
const onHomeRefreshEvent = () => {
  void handleRefresh();
};

onMounted(async () => {
  if (import.meta.client) {
    window.addEventListener("ik:home-refresh", onHomeRefreshEvent);
  }
  await initialFetchPromise;
  await nextTick();
  observeLoadMoreSentinel();
});

onBeforeUnmount(() => {
  if (import.meta.client) {
    window.removeEventListener("ik:home-refresh", onHomeRefreshEvent);
  }
  loadMoreObserverRef.value?.disconnect();
  loadMoreObserverRef.value = null;
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
});
</script>

<template>
  <section class="ik-home-container ik-stack">
    <!-- Refresh indicator (pull-to-refresh style) -->
    <Transition name="ik-refresh-indicator">
      <div v-if="refreshing" class="ik-refresh-indicator">
        <i class="z-icon-loading ik-refresh-spin" />
      </div>
    </Transition>

    <ClientOnly>
      <Transition name="ik-list-fade" mode="out-in">
        <!-- 骨架屏：loading=true 且 list 为空时显示 -->
        <div
          v-if="!list.length && loading"
          key="skeleton"
          class="ik-skeleton-state"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span class="ik-sr-only">正在加载帖子...</span>
          <VirtualMasonry
            class="ik-masonry"
            :items="skeletonItems"
            :column-width="240"
            :gap="32"
            :min-columns="2"
            :max-columns="5"
            :key-mapper="skeletonKeyMapper"
            :height-mapper="estimateSkeletonHeight"
            :measure-items="false"
          >
            <template #default="{ item }">
              <DiscussionCardSkeleton :skeleton="item" />
            </template>
          </VirtualMasonry>
        </div>

        <!-- 空状态：loading=false 且 list 为空时显示 -->
        <div v-else-if="!list.length && !loading" key="empty" class="ik-empty">暂无相关帖子... [ o_x ]/</div>

        <!-- 实际内容：list 不为空时显示 -->
        <div v-else key="list" class="ik-list-state">
          <VirtualMasonry
            class="ik-masonry"
            :items="list"
            :column-width="240"
            :gap="32"
            :min-columns="2"
            :max-columns="5"
            :buffer="1800"
            :estimated-height="300"
            :height-mapper="estimateDiscussionCardHeight"
            :key-mapper="masonryKeyMapper"
          >
            <template #default="{ item, index, columnCount }">
              <DiscussionCard
                :class="{ 'ik-masonry-card-enter': shouldAnimateDiscussion(item.id) }"
                :discussion="item"
                :eager="index < columnCount * 2"
                @open="goDiscussion"
                @animationend="finishEnterAnimation(item.id)"
                v-memo="[item.id, item.isRead, item.cover, shouldAnimateDiscussion(item.id)]"
              />
            </template>
          </VirtualMasonry>

          <div ref="loadMoreSentinelRef" class="ik-load-more-sentinel">
            <div v-if="loadingMore || !hasNextPage" class="ik-scroll-footer">
              <img v-if="loadingMore" class="ik-scroll-gif" src="/images/Bangboo.gif" alt="加载中" />
              <span v-else class="ik-meta">已经到底啦 [ O_X ] /</span>
            </div>
          </div>
        </div>
      </Transition>
    </ClientOnly>
    <!-- Refresh FAB -->
    <z-button
      circle
      class="ik-refresh-fab"
      :loading="refreshing"
      @click="handleRefresh"
    >
      <ArrowPathIcon v-if="!refreshing" style="width:1em;height:1em" />
    </z-button>
    <z-backtop :target="scrollTarget" :right="32" :bottom="95" />
  </section>
</template>

<style scoped>
.ik-home-container {
  width: min(1600px, calc(100% - 40px));
  margin: 0 auto;
  padding-top: 24px;
  padding-bottom: 24px;
}

.ik-masonry {
  width: 100%;
}

.ik-masonry-card-enter {
  animation: ik-masonry-card-enter 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes ik-masonry-card-enter {
  from {
    opacity: 0;
    transform: translateY(18px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-masonry-card-enter {
    animation: none;
  }
}


.ik-skeleton-state {
  width: 100%;
}

/* 骨架屏 ↔ 真实列表 ↔ 空状态 之间的淡入淡出过渡 */
.ik-list-fade-enter-active,
.ik-list-fade-leave-active {
  transition: opacity 220ms ease;
}

.ik-list-fade-enter-from,
.ik-list-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ik-list-fade-enter-active,
  .ik-list-fade-leave-active {
    transition: none;
  }
}

.ik-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.ik-load-more-sentinel {
  width: 100%;
  min-height: 1px;
}

.ik-scroll-footer {
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 0;
}

.ik-scroll-gif {
  width: 80px;
  height: 80px;
  object-fit: contain;
}

@media (max-width: 1400px) {
  .ik-home-container {
    width: calc(100% - 32px);
  }
}

@media (max-width: 768px) {
  .ik-home-container {
    width: calc(100% - 20px);
    padding-top: 16px;
    padding-bottom: 16px;
  }

  .ik-scroll-footer {
    flex-wrap: wrap;
  }
}
/* ── Refresh indicator (pull-to-refresh style) ── */
.ik-refresh-indicator {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 56px;
  color: #d7ff00;
  font-size: 24px;
  overflow: hidden;
}

.ik-refresh-spin {
  animation: ik-spin 0.8s linear infinite;
}

@keyframes ik-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ik-refresh-indicator-enter-active {
  transition: height 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms ease;
}

.ik-refresh-indicator-leave-active {
  transition: height 250ms cubic-bezier(0.55, 0, 1, 0.45), opacity 200ms ease;
}

.ik-refresh-indicator-enter-from,
.ik-refresh-indicator-leave-to {
  height: 0;
  opacity: 0;
}

.ik-refresh-fab {
  position: fixed;
  right: 32px;
  bottom: 32px;
  z-index: 100;
  width: 28px !important;
  height: 28px !important;
  font-size: 22px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.ik-refresh-fab :deep(.z-button__content:empty) {
  display: none;
}

.ik-refresh-fab :deep(.z-button__icon) {
  left: 50% !important;
  top: 50% !important;
  transform: translate(-50%, -50%);
}

.ik-refresh-fab :deep(.z-button__icon.is-loading) {
  animation: ik-fab-spin 1.5s linear infinite;
}

@keyframes ik-fab-spin {
  from { transform: translate(-50%, -50%) rotate(0deg); }
  to { transform: translate(-50%, -50%) rotate(360deg); }
}

@media (max-width: 768px) {
  .ik-refresh-fab {
    right: 16px;
    /* Lift above the fixed MobileBottomNav (58px) plus iOS safe area */
    bottom: calc(58px + 16px + env(safe-area-inset-bottom, 0px));
  }
  /* Stack the back-to-top button above the refresh FAB (refresh ~28px tall +
     12px gap) and align right edges. Override z-backtop's inline bottom/right. */
  :deep(.z-backtop) {
    right: 16px !important;
    bottom: calc(58px + 16px + 56px + 12px + env(safe-area-inset-bottom, 0px)) !important;
  }
}
</style>
