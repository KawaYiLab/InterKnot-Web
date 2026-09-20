<script setup lang="ts">
import type { Post } from "~/types/entities";
import { getCoverAspectRatio } from "~/utils/cover";
import VirtualMasonry from "~/components/VirtualMasonry.vue";
import PostCard from "~/components/PostCard.vue";
import PostCardSkeleton from "~/components/PostCardSkeleton.vue";
import { generateSkeletons, estimateSkeletonHeight, type SkeletonItem } from "~/utils/skeleton";

const route = useRoute();
const api = useApi();
const postModal = usePostModal();

// slug 可能含中文/符号，路由参数已是解码态，这里再兜一次 decode 容错。
const slug = computed(() => {
  const raw = String(route.params.slug ?? "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
});

// 展示名：优先用已加载文章卡片上该标签的 name（更友好），否则回退 slug。
const displayName = ref("");
const heading = computed(() => `#${displayName.value || slug.value}`);

useSeoMeta({
  title: () => `标签：${slug.value} - 绳网`,
  robots: "noindex, nofollow",
});

const list = ref<Post[]>([]);
const endCursor = ref("");
const hasNextPage = ref(true);
const loading = ref(true);
const loadingMore = ref(false);
const seenIds = new Set<string>();

const skeletonItems = ref<SkeletonItem[]>(generateSkeletons(8));
const masonryKeyMapper = (item: Post) => item.id;
const skeletonKeyMapper = (item: SkeletonItem) => item.id;

/** 把新一页的文章去重后追加进列表，并尝试从中提取该标签的展示名。 */
function appendPosts(nodes: Post[]) {
  for (const post of nodes) {
    if (seenIds.has(post.id)) continue;
    seenIds.add(post.id);
    list.value.push(post);
    if (!displayName.value) {
      const matched = post.tags?.find((t) => t.slug === slug.value);
      if (matched?.name) displayName.value = matched.name;
    }
  }
}

async function loadFirstPage() {
  loading.value = true;
  list.value = [];
  seenIds.clear();
  endCursor.value = "";
  hasNextPage.value = true;
  displayName.value = "";
  try {
    const page = await api.searchArticles("", "", "", "recommend", "latest", slug.value);
    appendPosts(page.nodes);
    endCursor.value = page.endCursor;
    hasNextPage.value = page.hasNextPage;
  } catch {
    hasNextPage.value = false;
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (loadingMore.value || loading.value || !hasNextPage.value) return;
  loadingMore.value = true;
  try {
    const page = await api.searchArticles("", endCursor.value, "", "recommend", "latest", slug.value);
    appendPosts(page.nodes);
    endCursor.value = page.endCursor;
    hasNextPage.value = page.hasNextPage;
  } catch {
    hasNextPage.value = false;
  } finally {
    loadingMore.value = false;
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
  loadFirstPage();
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    { rootMargin: "360px 0px" },
  );
  if (loadMoreSentinelRef.value) observer.observe(loadMoreSentinelRef.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

// 切换标签（同一页面路由参数变化）时重载
watch(slug, () => {
  loadFirstPage();
});
</script>

<template>
  <section class="ik-tag-page">
    <header class="ik-tag-header">
      <h1 class="ik-tag-title">{{ heading }}</h1>
      <NuxtLink to="/tags" class="ik-tag-all-link">全部标签</NuxtLink>
    </header>

    <ClientOnly>
      <div v-if="loading" class="ik-list-state">
        <VirtualMasonry
          class="ik-masonry"
          :items="skeletonItems"
          :column-width="240"
          :gap="12"
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

      <div v-else-if="!list.length" class="ik-empty">该标签下暂无委托... [ o_x ]/</div>

      <div v-else class="ik-list-state">
        <VirtualMasonry
          class="ik-masonry"
          :items="list"
          :column-width="240"
          :gap="12"
          :min-columns="2"
          :max-columns="5"
          :estimated-height="300"
          :key-mapper="masonryKeyMapper"
        >
          <template #default="{ item, index, columnCount }">
            <PostCard
              :post="item"
              :eager="index < columnCount * 2"
              @open="goPost"
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
    </ClientOnly>
  </section>
</template>

<style scoped>
.ik-tag-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 16px 16px 48px;
}

.ik-tag-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
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

.ik-tag-all-link {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--ik-primary, #bfff09);
  text-decoration: none;
}

.ik-tag-all-link:hover {
  text-decoration: underline;
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
</style>
