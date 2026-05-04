<script setup lang="ts">
import { useDebounceFn, useWindowSize } from "@vueuse/core";
import { useMessage } from "zenless-ui";
import type { Discussion } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import { getCoverAspectRatio } from "~/utils/cover";
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
const DISCUSSION_CARD_HORIZONTAL_CHROME = 24;
const DISCUSSION_CARD_FIXED_HEIGHT = 83;
const DISCUSSION_CARD_EXCERPT_LINE_HEIGHT = 21;
const DISCUSSION_CARD_MAX_EXCERPT_LINES = 2;

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


const getWeightedTextLength = (text: string) => {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    length += text.charCodeAt(i) <= 0xff ? 0.55 : 1;
  }
  return length;
};

const estimateExcerptLines = (discussion: Discussion, itemWidth: number) => {
  const text = discussion.bodyText || discussion.rawBodyText || "暂无摘要内容";
  const contentWidth = Math.max(1, itemWidth - DISCUSSION_CARD_HORIZONTAL_CHROME);
  const charsPerLine = Math.max(1, Math.floor(contentWidth / 15));
  return Math.min(
    DISCUSSION_CARD_MAX_EXCERPT_LINES,
    Math.max(1, Math.ceil(getWeightedTextLength(text) / charsPerLine)),
  );
};

const estimateDiscussionCardHeight = (discussion: Discussion, itemWidth: number) => {
  const coverHeight = itemWidth / getCoverAspectRatio(discussion.coverWidth, discussion.coverHeight);
  const excerptHeight =
    estimateExcerptLines(discussion, itemWidth) * DISCUSSION_CARD_EXCERPT_LINE_HEIGHT;

  return Math.ceil(coverHeight + DISCUSSION_CARD_FIXED_HEIGHT + excerptHeight);
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
pageDataLoading.claim();
const initialFetchPromise = fetchList(true).finally(() => pageDataLoading.finish());

onMounted(async () => {
  await initialFetchPromise;
  await nextTick();
  observeLoadMoreSentinel();
});

onBeforeUnmount(() => {
  loadMoreObserverRef.value?.disconnect();
  loadMoreObserverRef.value = null;
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
});
</script>

<template>
  <section class="container ik-home-container ik-stack">
    <!-- Refresh indicator (pull-to-refresh style) -->
    <Transition name="ik-refresh-indicator">
      <div v-if="refreshing" class="ik-refresh-indicator">
        <i class="z-icon-loading ik-refresh-spin" />
      </div>
    </Transition>

    <!-- 骨架屏：loading=true 且 list 为空时显示 -->
    <ClientOnly v-if="!list.length && loading">
      <div class="ik-skeleton-state" role="status" aria-live="polite" aria-busy="true">
        <span class="ik-sr-only">正在加载帖子...</span>
        <VirtualMasonry
          class="ik-masonry"
          :items="skeletonItems"
          :column-width="240"
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
      </div>
    </ClientOnly>

    <!-- 空状态：loading=false 且 list 为空时显示 -->
    <div v-else-if="!list.length && !loading" class="ik-empty">暂无相关帖子... [ o_x ]/</div>

    <!-- 实际内容：list 不为空时显示 -->
    <ClientOnly v-else>
      <VirtualMasonry
        class="ik-masonry"
        :items="list"
        :column-width="240"
        :gap="16"
        :min-columns="2"
        :max-columns="6"
        :buffer="2500"
        :estimated-height="300"
        :height-mapper="estimateDiscussionCardHeight"
        :key-mapper="masonryKeyMapper"
        :measure-items="false"
      >
        <template #default="{ item, index }">
          <DiscussionCard
            :class="{ 'ik-masonry-card-enter': shouldAnimateDiscussion(item.id) }"
            :discussion="item"
            :eager="index < 6"
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
    bottom: 16px;
  }
}
</style>
