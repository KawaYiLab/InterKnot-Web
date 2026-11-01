<script setup lang="ts">
import { useElementVisibility, useWindowSize } from "@vueuse/core";
import { useMessage } from "zenless-ui";
import type { AcceptableValue } from "reka-ui";
import { TabsIndicator, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { EyeIcon, HeartIcon, Squares2X2Icon, XMarkIcon } from "@heroicons/vue/24/outline";
import type { Category, Post, Tag } from "~/types/entities";
import type { PostSearchSort, SearchComment, SearchUser } from "~/composables/useApi";
import { resolveErrorMessage } from "~/utils/api-error";
import { getCoverAspectRatio } from "~/utils/cover";
import { estimatePostCardHeight } from "~/utils/post-card-height";
import { calculateSkeletonCount, estimateSkeletonHeight, generateSkeletons, type SkeletonItem } from "~/utils/skeleton";
import { toCardExcerpt } from "~/utils/card-excerpt";
import { excerptAround, splitHighlight } from "~/utils/highlight";
import { formatTime } from "~/utils/time";
import { pickFirstQuery } from "~/utils/query";
import VirtualMasonry from "~/components/VirtualMasonry.vue";
import PostCard from "~/components/PostCard.vue";
import PostCardSkeleton from "~/components/PostCardSkeleton.vue";
import Select from "~/components/ui/select/Select.vue";
import SelectContent from "~/components/ui/select/SelectContent.vue";
import SelectItem from "~/components/ui/select/SelectItem.vue";
import SelectSeparator from "~/components/ui/select/SelectSeparator.vue";
import SelectTrigger from "~/components/ui/select/SelectTrigger.vue";
import SelectValue from "~/components/ui/select/SelectValue.vue";

type SearchType = "post" | "user" | "comment";

const route = useRoute();
const router = useRouter();
const api = useApi();
const auth = useAuthStore();
const loginDialog = useLoginDialog();
const postModal = usePostModal();
const message = useMessage();
const { history, add: addHistory, remove: removeHistory, clear: clearHistory } = useSearchHistory();

const TYPES: { key: SearchType; label: string }[] = [
  { key: "post", label: "帖子" },
  { key: "user", label: "用户" },
  { key: "comment", label: "评论" },
];
const SORTS: { key: PostSearchSort; label: string }[] = [
  { key: "relevance", label: "综合" },
  { key: "latest", label: "最新" },
  { key: "hot", label: "最热" },
];
const ALL_CATEGORIES = "__all__";
const RELATED_USER_MAX = 6;
const USER_LIMIT = 20;

// ── 路由即状态：q / type / sort / category 都在 URL 里，刷新、分享、后退都能还原 ──
const keyword = computed(() => pickFirstQuery(route.query.q as string | string[] | undefined).trim());
const activeType = computed<SearchType>(() => {
  const t = pickFirstQuery(route.query.type as string | string[] | undefined);
  return t === "user" || t === "comment" ? t : "post";
});
const sort = computed<PostSearchSort>(() => {
  const s = pickFirstQuery(route.query.sort as string | string[] | undefined);
  return s === "latest" || s === "hot" ? s : "relevance";
});
const category = computed(() => pickFirstQuery(route.query.category as string | string[] | undefined));

useSeoMeta({
  title: () => (keyword.value ? `${keyword.value} - 搜索 - 绳网` : "搜索 - 绳网"),
});

const updateQuery = (patch: Record<string, string | undefined>) => {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...route.query, ...patch })) {
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === "string" && value) next[k] = value;
  }
  void router.replace({ path: "/search", query: next });
};

const setType = (value: string | number) => {
  const t = String(value) as SearchType;
  if (t === activeType.value) return;
  updateQuery({ type: t === "post" ? undefined : t });
};
const setSort = (value: PostSearchSort) => updateQuery({ sort: value === "relevance" ? undefined : value });
const setCategory = (value: AcceptableValue) => {
  const slug = value === ALL_CATEGORIES ? "" : String(value ?? "");
  updateQuery({ category: slug || undefined });
};
const searchFor = (q: string) => {
  addHistory(q);
  updateQuery({ q });
};

const categories = ref<Category[]>([]);
const categoryName = computed(() => categories.value.find((c) => c.slug === category.value)?.name ?? "分区");

// ── 帖子 ──
const posts = shallowRef<Post[]>([]);
const postsCursor = ref("");
const postsHasMore = ref(false);
const postsTotal = ref<number | null>(null);
const postsLoading = ref(false);
const postsLoadingMore = ref(false);
const postsError = ref("");
// 触底加载失败后不再自动重试（否则哨兵一直可见会无限重试），等用户点「重试」
const postsMoreFailed = ref(false);
let postsVersion = 0;

const loadPosts = async (reset: boolean) => {
  const q = keyword.value;
  if (!q) return;
  if (!reset && (postsLoading.value || postsLoadingMore.value || !postsHasMore.value)) return;
  postsMoreFailed.value = false;
  const version = reset ? ++postsVersion : postsVersion;
  if (reset) {
    postsLoading.value = true;
    postsError.value = "";
  } else {
    postsLoadingMore.value = true;
  }
  try {
    const page = await api.searchPosts(q, {
      sort: sort.value,
      category: category.value,
      cursor: reset ? "" : postsCursor.value,
    });
    if (version !== postsVersion) return;
    if (reset) {
      posts.value = page.nodes;
      postsTotal.value = page.total;
    } else {
      const seen = new Set(posts.value.map((p) => p.id));
      posts.value = [...posts.value, ...page.nodes.filter((p) => !seen.has(p.id))];
    }
    postsCursor.value = page.endCursor;
    postsHasMore.value = page.hasNextPage;
  } catch (err) {
    if (version !== postsVersion) return;
    if (reset) postsError.value = resolveErrorMessage(err, "搜索失败了");
    else postsMoreFailed.value = true;
  } finally {
    if (version === postsVersion) {
      postsLoading.value = false;
      postsLoadingMore.value = false;
    }
  }
};

// ── 用户 ──
const users = ref<SearchUser[]>([]);
const usersLoading = ref(false);
const usersLoaded = ref(false);
const usersError = ref("");
let usersVersion = 0;

const loadUsers = async () => {
  const q = keyword.value;
  if (!q) return;
  const version = ++usersVersion;
  usersLoading.value = true;
  usersError.value = "";
  try {
    const list = await api.searchUsers(q);
    if (version !== usersVersion) return;
    users.value = list;
    usersLoaded.value = true;
  } catch (err) {
    if (version === usersVersion) usersError.value = resolveErrorMessage(err, "搜索失败了");
  } finally {
    if (version === usersVersion) usersLoading.value = false;
  }
};

// ── 评论 ──
const comments = shallowRef<SearchComment[]>([]);
const commentsCursor = ref("");
const commentsHasMore = ref(false);
const commentsTotal = ref<number | null>(null);
const commentsLoading = ref(false);
const commentsLoadingMore = ref(false);
const commentsError = ref("");
const commentsMoreFailed = ref(false);
let commentsVersion = 0;

const loadComments = async (reset: boolean) => {
  const q = keyword.value;
  if (!q) return;
  if (!reset && (commentsLoading.value || commentsLoadingMore.value || !commentsHasMore.value)) return;
  commentsMoreFailed.value = false;
  const version = reset ? ++commentsVersion : commentsVersion;
  if (reset) {
    commentsLoading.value = true;
    commentsError.value = "";
  } else {
    commentsLoadingMore.value = true;
  }
  try {
    const page = await api.searchComments(q, reset ? "" : commentsCursor.value);
    if (version !== commentsVersion) return;
    if (reset) {
      comments.value = page.nodes;
      commentsTotal.value = page.total;
    } else {
      const seen = new Set(comments.value.map((c) => c.id));
      comments.value = [...comments.value, ...page.nodes.filter((c) => !seen.has(c.id))];
    }
    commentsCursor.value = page.endCursor;
    commentsHasMore.value = page.hasNextPage;
  } catch (err) {
    if (version !== commentsVersion) return;
    if (reset) commentsError.value = resolveErrorMessage(err, "搜索失败了");
    else commentsMoreFailed.value = true;
  } finally {
    if (version === commentsVersion) {
      commentsLoading.value = false;
      commentsLoadingMore.value = false;
    }
  }
};

// ── 标签：命中的标签放在帖子结果上方，点了去标签页 ──
const tags = shallowRef<Tag[]>([]);
let tagsVersion = 0;
const loadTags = async () => {
  const q = keyword.value;
  const version = ++tagsVersion;
  try {
    const list = await api.suggestTags(q);
    if (version === tagsVersion) tags.value = list.slice(0, 6);
  } catch {
    if (version === tagsVersion) tags.value = [];
  }
};

// ── 没输入关键词时：热门帖子 ──
const hotPosts = shallowRef<Post[]>([]);
const hotLoading = ref(false);
const loadHot = async () => {
  if (hotPosts.value.length || hotLoading.value) return;
  hotLoading.value = true;
  try {
    const page = await api.searchArticles("", "", "", "all", "hot");
    hotPosts.value = page.nodes.slice(0, 10);
  } catch {
    // 热门只是锦上添花，失败就不显示
  } finally {
    hotLoading.value = false;
  }
};

const resetResults = () => {
  postsVersion++;
  usersVersion++;
  commentsVersion++;
  tagsVersion++;
  posts.value = [];
  postsTotal.value = null;
  postsHasMore.value = false;
  postsError.value = "";
  postsMoreFailed.value = false;
  users.value = [];
  usersLoaded.value = false;
  usersError.value = "";
  comments.value = [];
  commentsTotal.value = null;
  commentsHasMore.value = false;
  commentsError.value = "";
  commentsMoreFailed.value = false;
  tags.value = [];
};

watch(
  keyword,
  (q) => {
    resetResults();
    if (import.meta.client) window.scrollTo({ top: 0 });
    if (!q) {
      void loadHot();
      return;
    }
    // 三类结果一起拉：切 Tab 不用再等，Tab 上也能直接显示数量
    void loadPosts(true);
    void loadUsers();
    void loadComments(true);
    void loadTags();
  },
  { immediate: true },
);

watch([sort, category], () => {
  if (!keyword.value) return;
  if (import.meta.client) window.scrollTo({ top: 0 });
  void loadPosts(true);
});

onMounted(() => {
  api.getCategories().then((list) => {
    categories.value = list;
  }).catch(() => undefined);
  // 空搜索页：直接把光标放进顶部搜索框
  if (!keyword.value) {
    nextTick(() => {
      document.querySelector<HTMLInputElement>(".ik-search-input input")?.focus();
    });
  }
});

// ── 触底加载 ──
const sentinelRef = ref<HTMLElement | null>(null);
const sentinelVisible = useElementVisibility(sentinelRef, { rootMargin: "0px 0px 600px 0px" });
watch(
  [sentinelVisible, activeType, postsLoading, postsLoadingMore, commentsLoading, commentsLoadingMore],
  () => {
    if (!sentinelVisible.value) return;
    if (activeType.value === "post" && !postsMoreFailed.value) void loadPosts(false);
    else if (activeType.value === "comment" && !commentsMoreFailed.value) void loadComments(false);
  },
);

// ── Tab 数量 ──
const formatCount = (n: number | null, cap = 999) => {
  if (n === null) return "";
  return n > cap ? `${cap}+` : String(n);
};
const typeCounts = computed<Record<SearchType, string>>(() => ({
  post: postsLoading.value ? "" : formatCount(postsTotal.value),
  user: usersLoading.value || !usersLoaded.value
    ? ""
    : users.value.length >= USER_LIMIT ? `${USER_LIMIT}+` : String(users.value.length),
  comment: commentsLoading.value ? "" : formatCount(commentsTotal.value),
}));

// ── 瀑布流（与首页同款） ──
const initialWidth = typeof window !== "undefined" ? window.innerWidth : 0;
const { width: viewportWidth } = useWindowSize({ initialWidth });
const feedGap = computed(() => (viewportWidth.value && viewportWidth.value <= 768 ? 14 : 32));
const skeletonItems = computed(() => generateSkeletons(calculateSkeletonCount(viewportWidth.value, import.meta.client)));
const postKey = (post: Post) => post.id;
const skeletonKey = (item: SkeletonItem) => item.id;

const relatedUsers = computed(() => users.value.slice(0, RELATED_USER_MAX));
const hasRelated = computed(() => relatedUsers.value.length > 0 || tags.value.length > 0);

// ── 打开结果 ──
const openPost = (post: Post, event?: MouseEvent) => {
  event?.preventDefault();
  addHistory(keyword.value);
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
  if (!post.isRead) api.markAsReadBatch([post.id]).catch(() => undefined);
};

const openHot = (post: Post) => {
  postModal.open(post.id, { preview: { title: post.title, author: post.author, cover: post.cover || undefined } });
};

const openComment = (c: SearchComment) => {
  addHistory(keyword.value);
  postModal.open(c.postId, { commentId: c.id, preview: { title: c.postTitle } });
};

// 弹窗关掉后把已读状态合并回列表（标题变灰），不在弹窗打开时重排瀑布流
watch(
  () => postModal.isOpen.value,
  (open) => {
    if (open) return;
    window.setTimeout(() => {
      if (postModal.isOpen.value) return;
      posts.value = api.mergeReadStatus(posts.value);
    }, 320);
  },
);

const profileLink = (id: string) => `/profile/${encodeURIComponent(id)}`;
const rememberKeyword = () => addHistory(keyword.value);

const isSelf = (u: SearchUser) => !!auth.user?.id && String(auth.user.id) === u.id;
const followPending = ref(new Set<string>());
const toggleFollow = async (u: SearchUser) => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  if (followPending.value.has(u.id)) return;
  followPending.value = new Set(followPending.value).add(u.id);
  try {
    const res = await api.toggleFollow(u.id, u.isFollowing);
    users.value = users.value.map((x) =>
      x.id === u.id ? { ...x, isFollowing: res.following, followerCount: res.followersCount } : x,
    );
  } catch (err) {
    message.error(resolveErrorMessage(err, "操作失败，请重试"));
  } finally {
    const next = new Set(followPending.value);
    next.delete(u.id);
    followPending.value = next;
  }
};

const commentText = (c: SearchComment) => excerptAround(toCardExcerpt(c.body), keyword.value, 140);

const onAvatarError = (e: Event) => {
  const img = e.target as HTMLImageElement;
  if (!img.src.endsWith("/images/default-avatar.webp")) img.src = "/images/default-avatar.webp";
};

const retry = () => {
  if (activeType.value === "post") void loadPosts(true);
  else if (activeType.value === "user") void loadUsers();
  else void loadComments(true);
};
</script>

<template>
  <section class="ik-search">
    <!-- 还没输入：最近搜索 + 大家在看 -->
    <div v-if="!keyword" class="ik-search-home">
      <section v-if="history.length" class="ik-search-block">
        <header class="ik-search-block__head">
          <h2 class="ik-search-block__title">最近搜索</h2>
          <button type="button" class="ik-search-block__action" @click="clearHistory">清空</button>
        </header>
        <div class="ik-search-history">
          <span v-for="item in history" :key="item" class="ik-search-chip">
            <button type="button" class="ik-search-chip__text" @click="searchFor(item)">{{ item }}</button>
            <button type="button" class="ik-search-chip__remove" :aria-label="`删除“${item}”`" @click="removeHistory(item)">
              <XMarkIcon aria-hidden="true" />
            </button>
          </span>
        </div>
      </section>

      <section class="ik-search-block">
        <header class="ik-search-block__head">
          <h2 class="ik-search-block__title">大家在看</h2>
        </header>
        <ol v-if="hotPosts.length" class="ik-search-hot">
          <li v-for="(p, i) in hotPosts" :key="p.id">
            <NuxtLink :to="`/post/${p.id}`" class="ik-search-hot__item" no-prefetch @click.prevent="openHot(p)">
              <span class="ik-search-hot__rank" :class="{ 'is-top': i < 3 }">{{ i + 1 }}</span>
              <span class="ik-search-hot__title">{{ p.title }}</span>
              <span class="ik-search-hot__views"><EyeIcon aria-hidden="true" />{{ p.views }}</span>
            </NuxtLink>
          </li>
        </ol>
        <div v-else-if="hotLoading" class="ik-search-hot" aria-busy="true">
          <div v-for="i in 10" :key="i" class="ik-search-hot__item ik-search-hot__item--skel">
            <span class="ik-skel ik-skel--rank" />
            <span class="ik-skel ik-skel--line" :style="{ width: `${40 + ((i * 37) % 45)}%` }" />
          </div>
        </div>
      </section>
    </div>

    <TabsRoot
      v-else
      :model-value="activeType"
      activation-mode="manual"
      class="ik-search-results"
      @update:model-value="setType"
    >
      <div class="ik-search-toolbar">
        <TabsList class="ik-stream-tabs" aria-label="搜索类型">
          <TabsIndicator class="ik-tabs-indicator" />
          <TabsTrigger v-for="t in TYPES" :key="t.key" :value="t.key" as-child>
            <button type="button" class="ik-stream-tab">
              {{ t.label }}
              <span v-if="typeCounts[t.key]" class="ik-stream-tab__count">{{ typeCounts[t.key] }}</span>
            </button>
          </TabsTrigger>
        </TabsList>

        <div v-if="activeType === 'post'" class="ik-search-filters">
          <div class="ik-search-sort" role="radiogroup" aria-label="排序">
            <button
              v-for="s in SORTS"
              :key="s.key"
              type="button"
              role="radio"
              class="ik-search-sort__item"
              :class="{ 'is-active': sort === s.key }"
              :aria-checked="sort === s.key"
              @click="setSort(s.key)"
            >{{ s.label }}</button>
          </div>

          <Select :model-value="category || ALL_CATEGORIES" @update:model-value="setCategory">
            <div class="ik-category-track" :class="{ 'ik-category-track--active': !!category }">
              <SelectTrigger class="ik-category-trigger" aria-label="分区">
                <Squares2X2Icon class="ik-category-trigger__icon" aria-hidden="true" />
                <SelectValue class="ik-category-trigger__value">
                  <template v-if="category">{{ categoryName }}</template>
                  <template v-else>全部</template>
                </SelectValue>
              </SelectTrigger>
            </div>
            <SelectContent class="ik-category-menu" align="end" :side-offset="8" :collision-padding="12">
              <SelectItem :value="ALL_CATEGORIES" class="ik-category-menu__item">全部</SelectItem>
              <template v-if="categories.length">
                <SelectSeparator class="ik-category-menu__separator" />
                <SelectItem
                  v-for="cat in categories"
                  :key="cat.slug"
                  :value="cat.slug"
                  class="ik-category-menu__item"
                >{{ cat.name }}</SelectItem>
              </template>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div role="tabpanel" class="ik-search-panel">
        <!-- 帖子 -->
        <template v-if="activeType === 'post'">
          <div v-if="hasRelated" class="ik-search-related">
            <NuxtLink
              v-for="u in relatedUsers"
              :key="u.id"
              :to="profileLink(u.id)"
              class="ik-related-user"
              @click="rememberKeyword"
            >
              <img :src="u.avatar || '/images/default-avatar.webp'" alt="" class="ik-related-user__avatar" loading="lazy" @error="onAvatarError" />
              <span class="ik-related-user__name">
                <template v-for="(part, i) in splitHighlight(u.name, keyword)" :key="i"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
              </span>
            </NuxtLink>
            <button
              v-if="users.length > RELATED_USER_MAX"
              type="button"
              class="ik-related-more"
              @click="setType('user')"
            >全部用户</button>
            <NuxtLink
              v-for="t in tags"
              :key="t.slug"
              :to="`/tags/${encodeURIComponent(t.slug)}`"
              class="ik-related-tag"
              @click="rememberKeyword"
            >#{{ t.name }}</NuxtLink>
          </div>

          <ClientOnly>
            <div v-if="postsLoading && !posts.length" class="ik-search-skeleton" aria-busy="true">
              <VirtualMasonry
                class="ik-masonry"
                :items="skeletonItems"
                :column-width="240"
                :gap="feedGap"
                :min-columns="2"
                :max-columns="5"
                :key-mapper="skeletonKey"
                :height-mapper="estimateSkeletonHeight"
                :measure-items="false"
              >
                <template #default="{ item }">
                  <PostCardSkeleton :skeleton="item" />
                </template>
              </VirtualMasonry>
            </div>

            <div v-else-if="postsError" class="ik-search-empty">
              <p class="ik-search-empty__title">{{ postsError }}</p>
              <z-button @click="retry">重试</z-button>
            </div>

            <div v-else-if="!posts.length" class="ik-search-empty">
              <img src="/images/Bangboo.gif" alt="" class="ik-search-empty__art" />
              <p class="ik-search-empty__title">没有找到相关帖子</p>
              <p class="ik-search-empty__hint">换个关键词试试</p>
              <div class="ik-search-empty__actions">
                <z-button v-if="category" @click="setCategory(ALL_CATEGORIES)">在全部分区里搜</z-button>
                <z-button v-if="users.length" @click="setType('user')">看看用户 {{ typeCounts.user }}</z-button>
                <z-button v-if="comments.length" @click="setType('comment')">看看评论 {{ typeCounts.comment }}</z-button>
              </div>
            </div>

            <template v-else>
              <VirtualMasonry
                class="ik-masonry"
                :class="{ 'is-stale': postsLoading }"
                :items="posts"
                :column-width="240"
                :gap="feedGap"
                :min-columns="2"
                :max-columns="5"
                :buffer="1800"
                :estimated-height="300"
                :height-mapper="estimatePostCardHeight"
                :key-mapper="postKey"
              >
                <template #default="{ item, index, columnCount }">
                  <PostCard
                    :post="item"
                    :keyword="keyword"
                    :eager="index < columnCount * 2"
                    @open="openPost"
                  />
                </template>
              </VirtualMasonry>
              <div class="ik-search-footer">
                <img v-if="postsLoadingMore" class="ik-search-footer__gif" src="/images/Bangboo.gif" alt="加载中" />
                <z-button v-else-if="postsMoreFailed" @click="loadPosts(false)">加载失败，重试</z-button>
                <span v-else-if="!postsHasMore">已经到底啦</span>
              </div>
            </template>
          </ClientOnly>
        </template>

        <!-- 用户 -->
        <template v-else-if="activeType === 'user'">
          <div v-if="usersLoading && !users.length" class="ik-search-users" aria-busy="true">
            <div v-for="i in 6" :key="i" class="ik-user-card ik-user-card--skel">
              <span class="ik-skel ik-skel--avatar" />
              <div class="ik-user-card__main">
                <span class="ik-skel ik-skel--line" style="width: 40%" />
                <span class="ik-skel ik-skel--line" style="width: 75%" />
              </div>
            </div>
          </div>

          <div v-else-if="usersError" class="ik-search-empty">
            <p class="ik-search-empty__title">{{ usersError }}</p>
            <z-button @click="retry">重试</z-button>
          </div>

          <div v-else-if="!users.length" class="ik-search-empty">
            <img src="/images/Bangboo.gif" alt="" class="ik-search-empty__art" />
            <p class="ik-search-empty__title">没有找到相关用户</p>
            <p class="ik-search-empty__hint">用户名要包含这几个字才能搜到</p>
          </div>

          <div v-else class="ik-search-users">
            <article v-for="u in users" :key="u.id" class="ik-user-card">
              <NuxtLink :to="profileLink(u.id)" class="ik-user-card__link" @click="rememberKeyword">
                <img :src="u.avatar || '/images/default-avatar.webp'" alt="" class="ik-user-card__avatar" loading="lazy" @error="onAvatarError" />
                <div class="ik-user-card__main">
                  <div class="ik-user-card__name-row">
                    <span class="ik-user-card__name">
                      <template v-for="(part, i) in splitHighlight(u.name, keyword)" :key="i"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
                    </span>
                    <span class="ik-user-card__level">Lv.{{ u.level }}</span>
                  </div>
                  <p v-if="u.bio" class="ik-user-card__bio">{{ u.bio }}</p>
                  <span class="ik-user-card__meta">{{ u.followerCount }} 粉丝</span>
                </div>
              </NuxtLink>
              <z-button
                v-if="!isSelf(u)"
                size="small"
                class="ik-user-card__follow"
                :class="{ 'is-following': u.isFollowing }"
                :loading="followPending.has(u.id)"
                @click="toggleFollow(u)"
              >{{ u.isFollowing ? "已关注" : "关注" }}</z-button>
            </article>
          </div>
        </template>

        <!-- 评论 -->
        <template v-else>
          <div v-if="commentsLoading && !comments.length" class="ik-search-comments" aria-busy="true">
            <div v-for="i in 6" :key="i" class="ik-comment-hit ik-comment-hit--skel">
              <div class="ik-comment-hit__head">
                <span class="ik-skel ik-skel--avatar-sm" />
                <span class="ik-skel ik-skel--line" style="width: 30%" />
              </div>
              <span class="ik-skel ik-skel--line" style="width: 92%" />
              <span class="ik-skel ik-skel--line" style="width: 64%" />
            </div>
          </div>

          <div v-else-if="commentsError" class="ik-search-empty">
            <p class="ik-search-empty__title">{{ commentsError }}</p>
            <z-button @click="retry">重试</z-button>
          </div>

          <div v-else-if="!comments.length" class="ik-search-empty">
            <img src="/images/Bangboo.gif" alt="" class="ik-search-empty__art" />
            <p class="ik-search-empty__title">没有找到相关评论</p>
            <p class="ik-search-empty__hint">换个关键词试试</p>
          </div>

          <template v-else>
            <ul class="ik-search-comments">
              <li v-for="c in comments" :key="c.id">
                <NuxtLink
                  :to="`/post/${c.postId}`"
                  class="ik-comment-hit"
                  no-prefetch
                  @click.prevent="openComment(c)"
                >
                  <div class="ik-comment-hit__head">
                    <img :src="c.author.avatar || '/images/default-avatar.webp'" alt="" class="ik-comment-hit__avatar" loading="lazy" @error="onAvatarError" />
                    <span class="ik-comment-hit__author">{{ c.author.name }}</span>
                    <span class="ik-comment-hit__time">{{ formatTime(c.createdAt) }}</span>
                    <span v-if="c.likeCount" class="ik-comment-hit__likes"><HeartIcon aria-hidden="true" />{{ c.likeCount }}</span>
                  </div>
                  <p class="ik-comment-hit__body">
                    <template v-for="(part, i) in splitHighlight(commentText(c), keyword)" :key="i"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
                  </p>
                  <div class="ik-comment-hit__post">
                    <img v-if="c.postCover" :src="c.postCover" alt="" class="ik-comment-hit__cover" loading="lazy" />
                    <span class="ik-comment-hit__post-title">{{ c.postTitle }}</span>
                  </div>
                </NuxtLink>
              </li>
            </ul>
            <div class="ik-search-footer">
              <img v-if="commentsLoadingMore" class="ik-search-footer__gif" src="/images/Bangboo.gif" alt="加载中" />
              <z-button v-else-if="commentsMoreFailed" @click="loadComments(false)">加载失败，重试</z-button>
              <span v-else-if="!commentsHasMore">已经到底啦</span>
            </div>
          </template>
        </template>

        <div ref="sentinelRef" class="ik-search-sentinel" aria-hidden="true" />
      </div>
    </TabsRoot>
  </section>
</template>

<style scoped>
.ik-search {
  position: relative;
  z-index: 1;
  width: min(1600px, calc(100% - 40px));
  margin: 0 auto;
  padding: 24px 0 48px;
  min-height: 60vh;
}

mark {
  background: transparent;
  color: var(--ik-primary, #bfff09);
}

/* ── 空搜索 ── */
.ik-search-home {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 880px;
  margin: 0 auto;
}

.ik-search-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.ik-search-block__title {
  margin: 0;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
}

.ik-search-block__action {
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.ik-search-block__action:hover {
  color: var(--ik-primary, #bfff09);
}

.ik-search-history {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ik-search-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: #161616;
  transition: border-color 0.15s ease;
}

.ik-search-chip:hover {
  border-color: rgba(255, 255, 255, 0.28);
}

.ik-search-chip__text {
  min-width: 0;
  padding: 7px 4px 7px 14px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font: inherit;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.ik-search-chip__remove {
  display: inline-flex;
  padding: 6px 10px 6px 4px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.35);
  cursor: pointer;
}

.ik-search-chip__remove:hover {
  color: #fff;
}

.ik-search-chip__remove svg {
  width: 14px;
  height: 14px;
}

.ik-search-hot {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 24px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ik-search-hot__item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 8px 10px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.88);
  text-decoration: none;
  transition: background-color 0.12s ease;
}

.ik-search-hot__item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.ik-search-hot__rank {
  flex: 0 0 22px;
  color: rgba(255, 255, 255, 0.35);
  font-size: 16px;
  font-weight: 800;
  font-style: italic;
  text-align: center;
  font-feature-settings: "tnum";
}

.ik-search-hot__rank.is-top {
  color: var(--ik-primary, #bfff09);
}

.ik-search-hot__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
}

.ik-search-hot__views {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  font-feature-settings: "tnum";
}

.ik-search-hot__views svg {
  width: 14px;
  height: 14px;
}

/* ── 工具栏 ── */
.ik-search-results {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ik-search-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.ik-stream-tabs {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 9999px;
  background: #141414;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
  user-select: none;
}

.ik-tabs-indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  width: var(--reka-tabs-indicator-size);
  transform: translateX(var(--reka-tabs-indicator-position));
  border-radius: 9999px;
  background: var(--ik-primary, #bfff09);
  box-shadow: 0 0 14px rgba(191, 255, 9, 0.35);
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), width 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
  z-index: 1;
}

.ik-stream-tab {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 18px;
  border: none;
  border-radius: 9999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease, transform 0.1s ease;
}

.ik-stream-tab:hover {
  color: #fff;
}

.ik-stream-tab:active {
  transform: scale(0.96);
}

.ik-stream-tab[data-state="active"] {
  color: #000;
  font-weight: 700;
}

.ik-stream-tab__count {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.55;
  font-feature-settings: "tnum";
}

.ik-search-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.ik-search-sort {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.ik-search-sort__item {
  position: relative;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.ik-search-sort__item:hover {
  color: #fff;
}

.ik-search-sort__item.is-active {
  color: #fff;
  font-weight: 700;
}

.ik-search-sort__item.is-active::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 2px;
  width: 14px;
  height: 3px;
  border-radius: 2px;
  background: var(--ik-primary, #bfff09);
  transform: translateX(-50%);
}

.ik-category-track {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 9999px;
  background: #141414;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
  user-select: none;
}

.ik-category-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 32px;
  padding: 0 12px 0 14px;
  border: none;
  border-radius: 9999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.ik-category-trigger:hover,
.ik-category-trigger[data-state="open"] {
  color: #fff;
}

.ik-category-track--active .ik-category-trigger {
  background: var(--ik-primary, #bfff09);
  box-shadow: 0 0 14px rgba(191, 255, 9, 0.35);
  color: #000;
  font-weight: 700;
}

.ik-category-trigger__icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  stroke-width: 2.2;
}

.ik-category-trigger__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.ik-category-trigger :deep([data-slot="select-icon"]) {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-left: 2px;
  stroke-width: 2.4;
  opacity: 0.6;
  transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
}

.ik-category-trigger[data-state="open"] :deep([data-slot="select-icon"]) {
  transform: rotate(180deg);
}

/* ── 相关用户 / 标签 ── */
.ik-search-related {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  overflow-x: auto;
  scrollbar-width: none;
}

.ik-search-related::-webkit-scrollbar {
  display: none;
}

.ik-related-user,
.ik-related-more,
.ik-related-tag {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: #161616;
  color: rgba(255, 255, 255, 0.88);
  font: inherit;
  font-size: 14px;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.ik-related-user:hover,
.ik-related-more:hover,
.ik-related-tag:hover {
  border-color: rgba(255, 255, 255, 0.3);
  background: #1d1d1d;
}

.ik-related-user {
  gap: 8px;
  padding: 0 14px 0 4px;
}

.ik-related-user__avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  background: #2a2a2a;
}

.ik-related-user__name {
  max-width: 10em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-related-more {
  padding: 0 14px;
  color: rgba(255, 255, 255, 0.55);
}

.ik-related-tag {
  padding: 0 14px;
  color: var(--ik-primary, #bfff09);
}

.ik-related-more + .ik-related-tag,
.ik-related-user + .ik-related-tag {
  margin-left: 8px;
}

/* ── 帖子 ── */
.ik-masonry.is-stale {
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

.ik-search-footer {
  display: flex;
  justify-content: center;
  padding: 24px 0 8px;
  color: rgba(255, 255, 255, 0.35);
  font-size: 13px;
}

.ik-search-footer__gif {
  width: 56px;
}

.ik-search-sentinel {
  height: 1px;
}

/* ── 空 / 出错 ── */
.ik-search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 72px 16px;
  text-align: center;
}

.ik-search-empty__art {
  width: 88px;
  opacity: 0.85;
}

.ik-search-empty__title {
  margin: 0;
  color: rgba(255, 255, 255, 0.85);
  font-size: 16px;
  font-weight: 600;
}

.ik-search-empty__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.ik-search-empty__actions:empty {
  display: none;
}

.ik-search-empty__hint {
  margin: 0 0 6px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 13px;
}

/* ── 用户 ── */
.ik-search-users {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.ik-user-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  background: #161616;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.ik-user-card:hover {
  border-color: rgba(255, 255, 255, 0.18);
  background: #1a1a1a;
}

.ik-user-card__link {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1 1 auto;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.ik-user-card__avatar {
  width: 52px;
  height: 52px;
  flex: 0 0 52px;
  border-radius: 50%;
  object-fit: cover;
  background: #2a2a2a;
}

.ik-user-card__main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
}

.ik-user-card__name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ik-user-card__name {
  min-width: 0;
  overflow: hidden;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-user-card__level {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  font-weight: 700;
  font-style: italic;
}

.ik-user-card__bio {
  margin: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-user-card__meta {
  color: rgba(255, 255, 255, 0.38);
  font-size: 12px;
  font-feature-settings: "tnum";
}

.ik-user-card__follow {
  flex: 0 0 auto;
}

.ik-user-card__follow.is-following {
  opacity: 0.6;
}

/* ── 评论 ── */
.ik-search-comments {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ik-comment-hit {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  padding: 14px 16px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  background: #161616;
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

a.ik-comment-hit:hover {
  border-color: rgba(255, 255, 255, 0.18);
  background: #1a1a1a;
}

.ik-comment-hit__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
}

.ik-comment-hit__avatar {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  border-radius: 50%;
  object-fit: cover;
  background: #2a2a2a;
}

.ik-comment-hit__author {
  min-width: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-comment-hit__time {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.38);
  font-size: 12px;
}

.ik-comment-hit__likes {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  font-feature-settings: "tnum";
}

.ik-comment-hit__likes svg {
  width: 14px;
  height: 14px;
}

.ik-comment-hit__body {
  display: -webkit-box;
  flex: 1 1 auto;
  margin: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.9);
  font-size: 15px;
  line-height: 1.6;
  word-break: break-word;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
}

.ik-comment-hit__post {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}

.ik-comment-hit__cover {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border-radius: 6px;
  object-fit: cover;
  background: #2a2a2a;
}

.ik-comment-hit__post-title {
  min-width: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 骨架 ── */
@keyframes ik-skel-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.ik-skel {
  display: block;
  border-radius: 6px;
  background: #222;
  animation: ik-skel-pulse 1.5s ease-in-out infinite;
}

.ik-skel--line {
  height: 14px;
}

.ik-skel--rank {
  width: 22px;
  height: 18px;
  flex: 0 0 22px;
}

.ik-skel--avatar {
  width: 52px;
  height: 52px;
  flex: 0 0 52px;
  border-radius: 50%;
}

.ik-skel--avatar-sm {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  border-radius: 50%;
}

.ik-user-card--skel .ik-user-card__main {
  gap: 10px;
}

.ik-search-hot__item--skel:hover {
  background: transparent;
}

@media (prefers-reduced-motion: reduce) {
  .ik-skel {
    animation: none;
  }
}

@media (max-width: 768px) {
  .ik-search {
    width: calc(100% - 28px);
    padding-top: 14px;
  }

  .ik-search-home {
    gap: 22px;
  }

  .ik-search-hot {
    grid-template-columns: minmax(0, 1fr);
  }

  .ik-search-results {
    gap: 12px;
  }

  .ik-search-toolbar {
    gap: 10px;
  }

  .ik-stream-tabs {
    flex: 1 1 100%;
  }

  .ik-stream-tab {
    flex: 1 1 0;
    height: 32px;
    padding: 0 10px;
  }

  .ik-search-filters {
    flex: 1 1 100%;
    justify-content: space-between;
  }

  .ik-search-sort__item {
    padding: 0 8px;
  }

  .ik-category-trigger {
    height: 28px;
    padding: 0 10px 0 12px;
    font-size: 13px;
  }

  .ik-search-related {
    margin: 0 -14px 12px;
    padding: 0 14px;
  }

  .ik-search-users,
  .ik-search-comments {
    grid-template-columns: minmax(0, 1fr);
  }

  .ik-user-card {
    padding: 12px 14px;
  }

  .ik-search-empty {
    padding: 56px 16px;
  }
}
</style>
