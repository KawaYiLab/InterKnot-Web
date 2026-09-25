<script setup lang="ts">
import { useWindowSize } from "@vueuse/core";
import type { Post } from "~/types/entities";
import { getCoverAspectRatio } from "~/utils/cover";
import VirtualMasonry from "~/components/VirtualMasonry.vue";
import PostCard from "~/components/PostCard.vue";
import PostCardSkeleton from "~/components/PostCardSkeleton.vue";
import { generateSkeletons, estimateSkeletonHeight, type SkeletonItem } from "~/utils/skeleton";
import { useRecommendations } from "~/composables/useRecommendations";

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const postModal = usePostModal();

// Vue Router 已解码参数；再次解码会把 URL 中的字面百分号误解释为转义。
const slug = computed(() => String(route.params.slug ?? ""));

// 展示名：优先用已加载文章卡片上该标签的 name（更友好），否则回退 slug。
const displayName = ref("");
const heading = computed(() => displayName.value || slug.value);

useSeoMeta({
  title: () => `标签：${slug.value} - 绳网`,
  robots: "noindex, nofollow",
});

const list = shallowRef<Post[]>([]);
const recommendations = useRecommendations();
const sortMode = ref<"recommend" | "latest">("recommend");
const visibleList = computed(() => sortMode.value === "recommend"
  ? list.value.filter((post) => !recommendations.isDismissed(post.id)) : list.value);
const endCursor = ref("");
const hasNextPage = ref(true);
const loading = ref(true);
const loadingMore = ref(false);
const loadError = ref(false);
const seenIds = new Set<string>();
let requestVersion = 0;
let disposed = false;

const skeletonItems = ref<SkeletonItem[]>(generateSkeletons(8));
const masonryKeyMapper = (item: Post) => item.id;
const skeletonKeyMapper = (item: SkeletonItem) => item.id;

// 瀑布流列间距：与首页保持一致，移动端收窄。避免标签页卡片比首页更小更挤。
const initialWidth = typeof window !== "undefined" ? window.innerWidth : 0;
const { width: viewportWidth } = useWindowSize({ initialWidth });
const feedGap = computed(() => (viewportWidth.value && viewportWidth.value <= 768 ? 14 : 32));

/** 把新一页的文章去重后追加进列表，并尝试从中提取该标签的展示名。 */
function appendPosts(nodes: Post[]) {
  const added: Post[] = [];
  for (const post of nodes) {
    if (seenIds.has(post.id)) continue;
    seenIds.add(post.id);
    added.push(post);
    if (!displayName.value) {
      const matched = post.tags?.find((t) => t.slug === slug.value);
      if (matched?.name) displayName.value = matched.name;
    }
  }
  if (added.length) list.value = [...list.value, ...added];
}

async function loadFirstPage() {
  const version = ++requestVersion;
  loading.value = true;
  loadingMore.value = false;
  loadError.value = false;
  list.value = [];
  seenIds.clear();
  endCursor.value = "";
  hasNextPage.value = true;
  displayName.value = "";
  try {
    const page = await api.searchArticles("", "", "", "recommend", sortMode.value, slug.value);
    if (disposed || version !== requestVersion) return;
    appendPosts(page.nodes);
    endCursor.value = page.endCursor;
    hasNextPage.value = page.hasNextPage;
  } catch {
    if (!disposed && version === requestVersion) loadError.value = true;
  } finally {
    if (!disposed && version === requestVersion) loading.value = false;
  }
}

async function loadMore() {
  if (disposed || loadingMore.value || loading.value || !hasNextPage.value) return;
  const version = requestVersion;
  const cursor = endCursor.value;
  loadingMore.value = true;
  loadError.value = false;
  try {
    const page = await api.searchArticles("", cursor, "", "recommend", sortMode.value, slug.value);
    if (disposed || version !== requestVersion) return;
    // 防止异常分页元数据让可见哨兵反复请求同一页。
    if (page.hasNextPage && (!page.endCursor || page.endCursor === cursor)) {
      throw new Error("Tag pagination did not advance");
    }
    appendPosts(page.nodes);
    endCursor.value = page.endCursor;
    hasNextPage.value = page.hasNextPage;
  } catch {
    if (!disposed && version === requestVersion) loadError.value = true;
  } finally {
    if (!disposed && version === requestVersion) loadingMore.value = false;
  }
}

const goPost = (post: Post, event: MouseEvent) => {
  event.preventDefault();
  postModal.open(post.id, {
    coverAspectRatio: getCoverAspectRatio(post.coverWidth, post.coverHeight),
    preview: {
      title: post.title,
      author: post.author,
      createdAt: post.createdAt,
      publishedAt: post.publishedAt,
      firstPublishedAt: post.firstPublishedAt,
      category: post.category ?? null,
      cover: post.cover || undefined,
    },
  });
};

// 无限滚动哨兵
const loadMoreSentinelRef = ref<HTMLElement>();
let observer: IntersectionObserver | null = null;

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (!loadError.value && entries.some((e) => e.isIntersecting)) void loadMore();
    },
    { rootMargin: "360px 0px" },
  );
  void loadFirstPage();
});

// 哨兵在 ClientOnly/列表加载后才挂载；每页完成后重新观察也能填满较高视口。
watch(
  [loadMoreSentinelRef, loading, loadingMore, hasNextPage, loadError],
  () => {
    observer?.disconnect();
    if (loadMoreSentinelRef.value && !loading.value && !loadingMore.value && hasNextPage.value && !loadError.value) {
      observer?.observe(loadMoreSentinelRef.value);
    }
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  disposed = true;
  requestVersion++;
  observer?.disconnect();
  observer = null;
});

// 切换标签（同一页面路由参数变化）时重载
watch([slug, sortMode, () => auth.generation], () => {
  api.invalidateQueries(["articles", "search"]);
  void loadFirstPage();
}, { flush: "sync" });
watch(api.readStatusRevision, () => {
  list.value = api.mergeReadStatus(list.value);
});
</script>

<template>
  <section class="ik-tag-page">
    <header class="ik-tag-header">
      <h1 class="ik-tag-title">{{ heading }}</h1>
      <nav class="ik-tag-sort" aria-label="标签排序">
        <button type="button" :aria-pressed="sortMode === 'recommend'" @click="sortMode = 'recommend'">推荐</button>
        <button type="button" :aria-pressed="sortMode === 'latest'" @click="sortMode = 'latest'">最新</button>
      </nav>
    </header>

    <ClientOnly>
      <div v-if="loading" class="ik-list-state">
        <VirtualMasonry
          class="ik-masonry"
          :items="skeletonItems"
          :column-width="240"
          :gap="feedGap"
          :min-columns="2"
          :max-columns="5"
          :key-mapper="skeletonKeyMapper"
          :height-mapper="estimateSkeletonHeight"
          :measure-items="false"
        >
          <template #default="{ item }">
            <PostCardSkeleton :skeleton="item" />
          </template>
        </VirtualMasonry>
      </div>

      <div v-else-if="loadError && !list.length" class="ik-empty" role="alert">
        加载失败，请稍后重试
        <button type="button" class="ik-tag-retry" @click="loadFirstPage">重试</button>
      </div>

      <div v-else-if="!visibleList.length && !hasNextPage" class="ik-empty">该标签下暂无委托... [ o_x ]/</div>

      <div v-else class="ik-list-state">
        <VirtualMasonry
          class="ik-masonry"
          :items="visibleList"
          :column-width="240"
          :gap="feedGap"
          :min-columns="2"
          :max-columns="5"
          :estimated-height="300"
          :key-mapper="masonryKeyMapper"
        >
          <template #default="{ item, index, columnCount }">
            <PostCard
              :post="item"
              :recommendation-enabled="sortMode === 'recommend' && !postModal.isOpen.value"
              :eager="index < columnCount * 2"
              @open="goPost"
            />
          </template>
        </VirtualMasonry>

        <div ref="loadMoreSentinelRef" class="ik-load-more-sentinel">
          <button v-if="loadError" type="button" class="ik-tag-retry" @click="loadMore">加载失败，点击重试</button>
          <div v-else-if="loadingMore || !hasNextPage" class="ik-scroll-footer">
            <img v-if="loadingMore" class="ik-scroll-gif" src="/images/Bangboo.gif" alt="加载中" />
            <span v-else class="ik-meta">已经到底啦 [ O_X ] /</span>
          </div>
        </div>
      </div>
    </ClientOnly>
  </section>
</template>

<style scoped>
.ik-tag-sort { display: flex; gap: 8px; margin-top: 12px; }
.ik-tag-sort button {
  padding: 6px 14px; border: 1px solid #444; border-radius: 8px;
  color: #aaa; background: #222; font: inherit; cursor: pointer;
}
.ik-tag-sort button[aria-pressed="true"] { color: #161616; background: var(--ik-primary, #bfff09); border-color: transparent; }
/* 与首页 .ik-home-container 对齐，保证瀑布流宽度/列宽一致，避免卡片被压缩。 */
.ik-tag-page {
  width: min(1600px, calc(100% - 40px));
  margin: 0 auto;
  padding-top: 24px;
  padding-bottom: 48px;
}

.ik-tag-header {
  padding: 8px 4px 16px;
  border-bottom: 1px solid #1f1f1f;
  margin-bottom: 16px;
}

.ik-tag-title {
  font-size: 22px;
  font-weight: 900;
  color: #f0f0f0;
  letter-spacing: 0.4px;
  margin: 0;
  overflow-wrap: anywhere;
}

.ik-masonry {
  width: 100%;
}

.ik-empty {
  padding: 64px 16px;
  text-align: center;
  color: #777;
  font-size: 14px;
}

.ik-load-more-sentinel {
  width: 100%;
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ik-scroll-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.ik-scroll-gif {
  width: 48px;
  height: 48px;
}

.ik-meta {
  font-size: 13px;
  color: #666;
}

.ik-tag-retry {
  margin: 0 12px;
  border: 0;
  background: transparent;
  color: var(--ik-primary, #bfff09);
  cursor: pointer;
  font: inherit;
}

/* 断点与首页 .ik-home-container 一致 */
@media (max-width: 1400px) {
  .ik-tag-page {
    width: calc(100% - 32px);
  }
}

@media (max-width: 768px) {
  .ik-tag-page {
    width: calc(100% - 28px);
    padding-top: 16px;
  }
}
</style>
