<script setup lang="ts">
import { useElementVisibility, useWindowSize } from "@vueuse/core";
import { useMessage } from "zenless-ui";
import type { AcceptableValue } from "reka-ui";
import { TabsContent, TabsIndicator, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { ArrowUpRightIcon, ChatBubbleLeftRightIcon, CheckIcon, EyeIcon, HeartIcon, PlusIcon, Squares2X2Icon, XMarkIcon } from "@heroicons/vue/24/outline";
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
import PlaceholdersInput from "~/components/inspira/PlaceholdersInput.vue";
import CardSpotlight from "~/components/inspira/CardSpotlight.vue";

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
  input.value = q;
  updateQuery({ q });
};

// ── 页面自己的大搜索框：边输边搜（防抖），回车立即生效 ──
const PLACEHOLDERS = ["搜帖子标题和正文", "搜用户名", "搜评论里说过的话", "搜标签，比如 邦布"];
const LIVE_DEBOUNCE_MS = 300;
const inputRef = ref<InstanceType<typeof PlaceholdersInput> | null>(null);
const input = ref(keyword.value);
const inputFocused = ref(false);
let liveTimer: ReturnType<typeof setTimeout> | null = null;

const cancelLiveSearch = () => {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = null;
};

const commitInput = () => {
  cancelLiveSearch();
  if (postModal.isOpen.value) return;
  const q = input.value.trim();
  if (q === keyword.value) return;
  // 清空时连同 Tab / 排序一起清掉，回到初始状态
  if (!q) void router.replace({ path: "/search", query: {} });
  else updateQuery({ q });
};

watch(input, (value) => {
  cancelLiveSearch();
  if (postModal.isOpen.value || value.trim() === keyword.value) return;
  liveTimer = setTimeout(commitInput, LIVE_DEBOUNCE_MS);
});

const onInputSubmit = () => {
  commitInput();
  addHistory(input.value);
  // 收起手机键盘
  inputRef.value?.blur();
};

// 路由变了（后退、点历史）就回填输入框；用户正在输入时以输入框为准
watch(keyword, (q) => {
  if (!inputFocused.value && input.value.trim() !== q) input.value = q;
});

onBeforeUnmount(() => {
  if (liveTimer) clearTimeout(liveTimer);
});

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
  // 空搜索页：直接把光标放进搜索框
  if (!keyword.value) nextTick(() => inputRef.value?.focus());
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
const prepareResultOpen = (event?: MouseEvent) => {
  if (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    event.preventDefault();
  }
  // 打开的是当前结果，不让尚未提交的输入在浮层打开后改写历史。
  cancelLiveSearch();
  input.value = keyword.value;
  addHistory(keyword.value);
  return true;
};

const openPost = (post: Post, event?: MouseEvent) => {
  if (!prepareResultOpen(event)) return;
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

const commentLink = (c: SearchComment) => `/post/${encodeURIComponent(c.postId)}?comment=${encodeURIComponent(c.id)}`;
const openComment = (c: SearchComment, event: MouseEvent) => {
  if (!prepareResultOpen(event)) return;
  postModal.open(c.postId, { commentId: c.id, preview: { title: c.postTitle, cover: c.postCover || undefined } });
};
const openCommentPost = (c: SearchComment, event: MouseEvent) => {
  if (!prepareResultOpen(event)) return;
  postModal.open(c.postId, { preview: { title: c.postTitle, cover: c.postCover || undefined } });
};

// 弹窗关掉后把已读状态合并回列表（标题变灰），不在弹窗打开时重排瀑布流
watch(
  () => postModal.isOpen.value,
  (open, _, onCleanup) => {
    if (open) return;
    const timer = window.setTimeout(() => {
      if (postModal.isOpen.value) return;
      posts.value = api.mergeReadStatus(posts.value);
    }, 320);
    onCleanup(() => window.clearTimeout(timer));
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
const onCoverError = (e: Event) => {
  const img = e.target as HTMLImageElement;
  if (!img.src.endsWith("/images/default-cover.webp")) img.src = "/images/default-cover.webp";
};

const retry = () => {
  if (activeType.value === "post") void loadPosts(true);
  else if (activeType.value === "user") void loadUsers();
  else void loadComments(true);
};
</script>

<template>
  <div class="ik-search-page" :class="{ 'is-idle': !keyword }">
  <div class="ik-search-backdrop" aria-hidden="true" />
  <section class="ik-search" :class="{ 'is-idle': !keyword }">
    <TabsRoot
      :model-value="activeType"
      activation-mode="manual"
      class="ik-search-root"
      @update:model-value="setType"
    >
      <!-- 搜索框 + 类型切换 -->
      <header class="ik-search-hero">
        <PlaceholdersInput
          ref="inputRef"
          v-model="input"
          class="ik-search-hero__input"
          :placeholders="PLACEHOLDERS"
          :aria-label="activeType === 'user' ? '搜索用户' : activeType === 'comment' ? '搜索评论' : '搜索帖子'"
          @submit="onInputSubmit"
          @focus="inputFocused = true"
          @blur="inputFocused = false"
        />
        <TabsList v-if="keyword" class="ik-seg ik-seg--lg" aria-label="搜索类型">
          <TabsIndicator class="ik-seg__indicator" />
          <TabsTrigger v-for="t in TYPES" :key="t.key" :value="t.key" as-child>
            <button type="button" class="ik-seg__item">
              {{ t.label }}
              <span v-if="typeCounts[t.key]" class="ik-seg__count">{{ typeCounts[t.key] }}</span>
            </button>
          </TabsTrigger>
        </TabsList>
      </header>

      <!-- 还没输入：最近搜索 + 大家在看 -->
      <div v-if="!keyword" class="ik-search-idle">
        <section v-if="history.length" class="ik-search-section">
          <header class="ik-search-section__head">
            <h2 class="ik-search-section__title">最近搜索</h2>
            <button type="button" class="ik-search-section__action" @click="clearHistory">清空</button>
          </header>
          <div class="ik-search-history">
            <span
              v-for="(item, i) in history"
              :key="item"
              class="ik-search-chip ik-reveal"
              :style="{ '--i': i }"
            >
              <button type="button" class="ik-search-chip__text" @click="searchFor(item)">{{ item }}</button>
              <button type="button" class="ik-search-chip__remove" :aria-label="`删除“${item}”`" @click="removeHistory(item)">
                <XMarkIcon aria-hidden="true" />
              </button>
            </span>
          </div>
        </section>

        <section class="ik-search-section">
          <header class="ik-search-section__head">
            <h2 class="ik-search-section__title">大家在看</h2>
          </header>
          <CardSpotlight class="ik-search-hot">
            <ol v-if="hotPosts.length" class="ik-search-hot__list">
              <li v-for="(p, i) in hotPosts" :key="p.id" class="ik-reveal" :style="{ '--i': i }">
                <a :href="`/post/${encodeURIComponent(p.id)}`" class="ik-search-hot__item" @click="openPost(p, $event)">
                  <span class="ik-search-hot__rank" :class="{ 'is-top': i < 3 }">{{ i + 1 }}</span>
                  <span class="ik-search-hot__title">{{ p.title }}</span>
                  <span class="ik-search-hot__views"><EyeIcon aria-hidden="true" />{{ p.views }}</span>
                </a>
              </li>
            </ol>
            <div v-else-if="hotLoading" class="ik-search-hot__list" aria-busy="true">
              <div v-for="i in 10" :key="i" class="ik-search-hot__item is-skel">
                <span class="ik-skel ik-skel--rank" />
                <span class="ik-skel ik-skel--line" :style="{ width: `${40 + ((i * 37) % 45)}%` }" />
              </div>
            </div>
          </CardSpotlight>
        </section>
      </div>

      <TabsContent v-else :value="activeType" class="ik-search-panel">
        <!-- 帖子 -->
        <template v-if="activeType === 'post'">
          <div class="ik-search-bar">
            <TabsRoot
              :model-value="sort"
              activation-mode="manual"
              @update:model-value="(v) => setSort(v as PostSearchSort)"
            >
              <TabsList class="ik-seg ik-seg--sm" aria-label="排序">
                <TabsIndicator class="ik-seg__indicator ik-seg__indicator--muted" />
                <TabsTrigger v-for="s in SORTS" :key="s.key" :value="s.key" as-child>
                  <button type="button" class="ik-seg__item">{{ s.label }}</button>
                </TabsTrigger>
              </TabsList>
            </TabsRoot>

            <Select :model-value="category || ALL_CATEGORIES" @update:model-value="setCategory">
              <div class="ik-category-track" :class="{ 'ik-category-track--active': !!category }">
                <SelectTrigger class="ik-category-trigger" aria-label="分区">
                  <Squares2X2Icon class="ik-category-trigger__icon" aria-hidden="true" />
                  <SelectValue class="ik-category-trigger__value">
                    <template v-if="category">{{ categoryName }}</template>
                    <template v-else>全部分区</template>
                  </SelectValue>
                </SelectTrigger>
              </div>
              <SelectContent class="ik-category-menu" align="end" :side-offset="8" :collision-padding="12">
                <SelectItem :value="ALL_CATEGORIES" class="ik-category-menu__item">全部分区</SelectItem>
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

          <div v-if="hasRelated" class="ik-search-related">
            <NuxtLink
              v-for="(u, i) in relatedUsers"
              :key="u.id"
              :to="profileLink(u.id)"
              class="ik-related ik-related--user ik-reveal"
              :style="{ '--i': i }"
              @click="rememberKeyword"
            >
              <img :src="u.avatar || '/images/default-avatar.webp'" alt="" class="ik-related__avatar" loading="lazy" @error="onAvatarError" />
              <span class="ik-related__name">
                <template v-for="(part, j) in splitHighlight(u.name, keyword)" :key="j"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
              </span>
            </NuxtLink>
            <button
              v-if="users.length > RELATED_USER_MAX"
              type="button"
              class="ik-related ik-related--more"
              @click="setType('user')"
            >全部用户</button>
            <span v-if="relatedUsers.length && tags.length" class="ik-search-related__gap" aria-hidden="true" />
            <NuxtLink
              v-for="(t, i) in tags"
              :key="t.slug"
              :to="`/tags/${encodeURIComponent(t.slug)}`"
              class="ik-related ik-related--tag ik-reveal"
              :style="{ '--i': relatedUsers.length + i }"
              @click="rememberKeyword"
            >#{{ t.name }}</NuxtLink>
          </div>

          <ClientOnly>
            <div v-if="postsLoading && !posts.length" aria-busy="true">
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
        <div v-else-if="activeType === 'user'" class="ik-search-results">
          <div v-if="usersLoading && !users.length" class="ik-search-grid ik-search-grid--users" aria-busy="true" aria-label="正在搜索用户">
            <div v-for="i in 6" :key="i" class="ik-user is-skel">
              <div class="ik-user__link">
                <span class="ik-skel ik-skel--avatar" />
                <div class="ik-user__main">
                  <span class="ik-skel ik-skel--line" style="width: 48%" />
                  <span class="ik-skel ik-skel--line" style="width: 88%" />
                  <span class="ik-skel ik-skel--line" style="width: 60%" />
                </div>
              </div>
              <div class="ik-user__footer">
                <span class="ik-skel ik-skel--button" />
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

          <ul v-else class="ik-search-grid ik-search-grid--users">
            <li v-for="u in users" :key="u.id" class="ik-user">
              <NuxtLink :to="profileLink(u.id)" class="ik-user__link" @click="rememberKeyword">
                <img :src="u.avatar || '/images/default-avatar.webp'" alt="" class="ik-user__avatar" loading="lazy" @error="onAvatarError" />
                <div class="ik-user__main">
                  <div class="ik-user__name-row">
                    <h2 class="ik-user__name" :title="u.name">
                      <template v-for="(part, j) in splitHighlight(u.name, keyword)" :key="j"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
                    </h2>
                    <span class="ik-user__level">Lv.{{ u.level }}</span>
                  </div>
                  <p class="ik-user__summary">
                    <span class="ik-user__meta">{{ u.followerCount.toLocaleString('zh-CN') }} 粉丝</span>
                    <span v-if="u.bio" class="ik-user__bio">{{ u.bio }}</span>
                  </p>
                </div>
              </NuxtLink>
              <div class="ik-user__footer">
                <button
                  v-if="!isSelf(u)"
                  type="button"
                  class="ik-user__follow"
                  :class="{ 'is-following': u.isFollowing }"
                  :disabled="followPending.has(u.id)"
                  :aria-busy="followPending.has(u.id)"
                  :aria-pressed="u.isFollowing"
                  :aria-label="`${u.isFollowing ? '取消关注' : '关注'}${u.name}`"
                  @click="toggleFollow(u)"
                >
                  <span v-if="followPending.has(u.id)" class="ik-user__spinner" aria-hidden="true" />
                  <CheckIcon v-else-if="u.isFollowing" aria-hidden="true" />
                  <PlusIcon v-else aria-hidden="true" />
                  {{ u.isFollowing ? '已关注' : '关注' }}
                </button>
              </div>
            </li>
          </ul>
        </div>

        <!-- 评论 -->
        <div v-else class="ik-search-results">
          <div v-if="commentsLoading && !comments.length" class="ik-search-comments" aria-busy="true" aria-label="正在搜索评论">
            <div v-for="i in 4" :key="i" class="ik-comment-card is-skel">
              <div class="ik-comment__identity">
                <span class="ik-skel ik-skel--avatar-sm" />
                <span class="ik-skel ik-skel--line" style="width: 80px" />
              </div>
              <div class="ik-comment__content">
                <span class="ik-skel ik-skel--line" style="width: 92%" />
                <span class="ik-skel ik-skel--line" style="width: 80%" />
                <span class="ik-skel ik-skel--line" style="width: 54%" />
              </div>
              <span class="ik-skel ik-skel--source" />
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
              <li v-for="c in comments" :key="c.id" class="ik-comment-card">
                <div class="ik-comment__head">
                  <NuxtLink
                    v-if="!c.isAnonymous && c.author.documentId"
                    :to="profileLink(c.author.documentId)"
                    class="ik-comment__identity"
                    @click="rememberKeyword"
                  >
                    <img :src="c.author.avatar || '/images/default-avatar.webp'" alt="" class="ik-comment__avatar" loading="lazy" @error="onAvatarError" />
                    <span class="ik-comment__byline">
                      <span class="ik-comment__author">{{ c.author.name || '匿名用户' }}</span>
                      <time class="ik-comment__time" :datetime="c.createdAt">{{ formatTime(c.createdAt) }}</time>
                    </span>
                  </NuxtLink>
                  <span v-else class="ik-comment__identity">
                    <img :src="!c.isAnonymous && c.author.avatar || '/images/default-avatar.webp'" alt="" class="ik-comment__avatar" loading="lazy" @error="onAvatarError" />
                    <span class="ik-comment__byline">
                      <span class="ik-comment__author">{{ c.isAnonymous ? '匿名用户' : c.author.name || '匿名用户' }}</span>
                      <time class="ik-comment__time" :datetime="c.createdAt">{{ formatTime(c.createdAt) }}</time>
                    </span>
                  </span>
                </div>
                <a :href="commentLink(c)" class="ik-comment__content" @click="openComment(c, $event)">
                  <p class="ik-comment__body">
                    <template v-for="(part, j) in splitHighlight(commentText(c), keyword)" :key="j"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
                  </p>
                  <span v-if="c.likeCount" class="ik-comment__likes" :aria-label="`${c.likeCount} 个赞`"><HeartIcon aria-hidden="true" />{{ c.likeCount }}</span>
                </a>
                <a
                  :href="`/post/${encodeURIComponent(c.postId)}`"
                  class="ik-comment__post"
                  :aria-label="`查看原帖：${c.postTitle}`"
                  @click="openCommentPost(c, $event)"
                >
                  <img v-if="c.postCover" :src="c.postCover" alt="" class="ik-comment__cover" loading="lazy" @error="onCoverError" />
                  <span v-else class="ik-comment__cover-placeholder" aria-hidden="true"><ChatBubbleLeftRightIcon /></span>
                  <span class="ik-comment__post-title">{{ c.postTitle }}</span>
                  <ArrowUpRightIcon class="ik-comment__post-arrow" aria-hidden="true" />
                </a>
              </li>
            </ul>
            <div class="ik-search-footer">
              <img v-if="commentsLoadingMore" class="ik-search-footer__gif" src="/images/Bangboo.gif" alt="加载中" />
              <z-button v-else-if="commentsMoreFailed" @click="loadComments(false)">加载失败，重试</z-button>
              <span v-else-if="!commentsHasMore">已经到底啦</span>
            </div>
          </template>
        </div>

        <div ref="sentinelRef" class="ik-search-sentinel" aria-hidden="true" />
      </TabsContent>
    </TabsRoot>
  </section>
  </div>
</template>

<style scoped>
/* 搜索框背后的素材图：铺满整宽，往下渐隐进黑底 */
.ik-search-page {
  position: relative;
  isolation: isolate;
  min-height: calc(100dvh - 80px);
  background: #000;
}

.ik-search-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 0;
  height: 280px;
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.15) 45%, rgba(0, 0, 0, 0.85) 100%),
    url("/images/search-hero-bg.webp") center 38% / cover no-repeat;
  -webkit-mask-image: linear-gradient(180deg, #000 55%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 55%, transparent 100%);
  opacity: 0.9;
  pointer-events: none;
}

.ik-search-page.is-idle .ik-search-backdrop {
  height: 620px;
}

/* 间距节奏：4 / 8 / 12 / 16 / 24 / 32 / 48 */
.ik-search {
  position: relative;
  z-index: 1;
  width: min(1680px, calc(100% - 96px));
  margin: 0 auto;
  padding: 40px 0 64px;
  min-height: 70vh;
}

.ik-search.is-idle {
  padding-top: 72px;
}

mark {
  background: transparent;
  color: var(--ik-primary, #bfff09);
}

/* ── 搜索框 + 类型切换 ── */
.ik-search-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  margin-bottom: 40px;
}

.ik-search.is-idle .ik-search-hero {
  margin-bottom: 48px;
}

.ik-search-hero__input {
  max-width: 680px;
}

/* 分段切换（reka Tabs + 滑块），大号用于类型，小号用于排序 */
.ik-seg {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: #121212;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
  user-select: none;
}

.ik-seg__indicator {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  z-index: 1;
  width: var(--reka-tabs-indicator-size);
  transform: translateX(var(--reka-tabs-indicator-position));
  border-radius: 999px;
  background: var(--ik-primary, #bfff09);
  box-shadow: 0 0 16px rgba(191, 255, 9, 0.3);
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

.ik-seg__indicator--muted {
  background: #2c2c2c;
  box-shadow: none;
}

.ik-seg__item {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-family: inherit;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease, transform 0.1s ease;
}

.ik-seg__item:hover {
  color: #fff;
}

.ik-seg__item:active {
  transform: scale(0.97);
}

.ik-seg--lg {
  align-self: stretch;
  gap: 40px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid #303030;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.ik-seg--lg .ik-seg__indicator {
  top: auto;
  bottom: -1px;
  width: 32px;
  height: 3px;
  border-radius: 3px;
  box-shadow: none;
}

.ik-seg--lg .ik-seg__item {
  min-width: 0;
  height: 52px;
  padding: 0 0 8px;
  border-radius: 0;
  font-size: 17px;
}

.ik-seg--lg .ik-seg__item[data-state="active"] {
  color: var(--ik-primary);
  font-weight: 700;
}

.ik-seg--sm {
  padding: 3px;
}

.ik-seg--sm .ik-seg__indicator {
  top: 3px;
  bottom: 3px;
}

.ik-seg--sm .ik-seg__item {
  height: 30px;
  padding: 0 16px;
  font-size: 13px;
}

.ik-seg--sm .ik-seg__item[data-state="active"] {
  color: #fff;
  font-weight: 600;
}

.ik-seg__count {
  padding: 3px 6px;
  border-radius: 8px;
  background: #202020;
  color: #b5b5b5;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* ── 空搜索 ── */
.ik-search-idle {
  display: flex;
  flex-direction: column;
  gap: 40px;
  max-width: 880px;
  margin: 0 auto;
}

.ik-search-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 0 4px;
}

.ik-search-section__title {
  margin: 0;
  color: rgba(255, 255, 255, 0.92);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.ik-search-section__action {
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.ik-search-section__action:hover {
  color: var(--ik-primary, #bfff09);
}

.ik-search-history {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.ik-search-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  height: 38px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: #151515;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.ik-search-chip:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: #1b1b1b;
}

.ik-search-chip__text {
  min-width: 0;
  height: 100%;
  padding: 0 6px 0 16px;
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
  align-items: center;
  height: 100%;
  padding: 0 12px 0 4px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: color 0.15s ease;
}

.ik-search-chip__remove:hover {
  color: #fff;
}

.ik-search-chip__remove svg {
  width: 14px;
  height: 14px;
}

.ik-search-hot {
  padding: 12px;
}

.ik-search-hot__list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ik-search-hot__item {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 52px;
  padding: 0 14px;
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.88);
  text-decoration: none;
  transition: background-color 0.15s ease;
}

a.ik-search-hot__item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.ik-search-hot__rank {
  flex: 0 0 24px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 17px;
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
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-search-hot__views {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.35);
  font-size: 12px;
  font-feature-settings: "tnum";
}

.ik-search-hot__views svg {
  width: 14px;
  height: 14px;
}

/* ── 帖子：排序 / 分区 / 相关 ── */
.ik-search-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.ik-category-track {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: #121212;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
  user-select: none;
}

.ik-category-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 30px;
  padding: 0 12px 0 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-family: inherit;
  font-size: 13px;
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
  color: #000;
  font-weight: 700;
}

.ik-category-trigger__icon {
  width: 14px;
  height: 14px;
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

.ik-search-related {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
  overflow-x: auto;
  scrollbar-width: none;
}

.ik-search-related::-webkit-scrollbar {
  display: none;
}

.ik-search-related__gap {
  flex: 0 0 1px;
  align-self: stretch;
  margin: 8px 6px;
  background: rgba(255, 255, 255, 0.1);
}

.ik-related {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: #151515;
  color: rgba(255, 255, 255, 0.88);
  font: inherit;
  font-size: 14px;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}

.ik-related:hover {
  border-color: rgba(255, 255, 255, 0.22);
  background: #1c1c1c;
  transform: translateY(-1px);
}

.ik-related--user {
  gap: 10px;
  padding: 0 16px 0 5px;
}

.ik-related__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  background: #2a2a2a;
}

.ik-related__name {
  max-width: 10em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-related--more {
  padding: 0 16px;
  color: rgba(255, 255, 255, 0.5);
}

.ik-related--tag {
  padding: 0 16px;
  color: var(--ik-primary, #bfff09);
}

/* ── 帖子瀑布流 ── */
.ik-masonry.is-stale {
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

/* ── 用户结果 / 评论阅读列表 ── */
.ik-search-results {
  width: 100%;
  margin: 0 auto;
}

.ik-search-grid {
  display: grid;
  gap: 52px 48px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ik-search-grid--users {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.ik-user {
  position: relative;
  min-width: 0;
  min-height: 104px;
  padding-left: 104px;
}

.ik-user__link {
  display: block;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.ik-user__avatar,
.ik-user .ik-skel--avatar {
  position: absolute;
  top: 2px;
  left: 0;
  width: 84px;
  height: 84px;
  border: 1px solid #383838;
  border-radius: 50%;
  object-fit: cover;
  background: #252525;
}

.ik-user__main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ik-user__name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ik-user__name {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: #f4f4f4;
  font-size: clamp(18px, 1.4vw, 22px);
  font-weight: 700;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-user__level {
  flex: 0 0 auto;
  padding: 2px 5px;
  border: 1px solid #3b4430;
  border-radius: 3px;
  color: #bad396;
  font-size: 11px;
  font-weight: 700;
  font-style: italic;
  line-height: 1.2;
}

.ik-user__summary {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
  margin: 0;
  color: #a6a6a6;
  font-size: 13px;
  line-height: 1.6;
}

.ik-user__meta {
  flex: 0 0 auto;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ik-user__bio {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-user__footer {
  display: flex;
  align-items: center;
  min-height: 34px;
  margin-top: 10px;
}

.ik-user__follow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 100px;
  height: 34px;
  padding: 0 16px;
  border: 1px solid var(--ik-primary);
  border-radius: 8px;
  background: var(--ik-primary);
  color: #000;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.ik-user__follow svg {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

.ik-user__follow.is-following {
  border-color: #454545;
  background: transparent;
  color: #b5b5b5;
}

.ik-user__follow:not(:disabled):hover {
  border-color: #d2ff59;
  background: #d2ff59;
  color: #000;
}

.ik-user__follow.is-following:not(:disabled):hover {
  border-color: #8a8a8a;
  background: #202020;
  color: #f4f4f4;
}

.ik-user__follow:disabled {
  opacity: 0.7;
}

.ik-user__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: ik-follow-spin 0.8s linear infinite;
}

@keyframes ik-follow-spin {
  to { transform: rotate(360deg); }
}

.ik-search-comments {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ik-comment-card {
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr) 280px;
  align-items: start;
  gap: 32px;
  min-height: 164px;
  padding: 28px 0;
}

.ik-comment-card:first-child {
  padding-top: 0;
}

.ik-comment-card + .ik-comment-card {
  border-top: 1px solid #292929;
}

.ik-comment__head,
.ik-comment__byline {
  min-width: 0;
}

.ik-comment__identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.ik-comment__avatar {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 50%;
  object-fit: cover;
  background: #2a2a2a;
}

.ik-comment__byline {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-comment__author {
  display: -webkit-box;
  overflow: hidden;
  color: #e8e8e8;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

a.ik-comment__identity:hover .ik-comment__author {
  color: var(--ik-primary);
}

.ik-comment__time {
  color: #a6a6a6;
  font-size: 13px;
  line-height: 1.4;
}

.ik-comment__content {
  display: flex;
  flex-direction: column;
  align-self: stretch;
  justify-content: space-between;
  gap: 18px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.ik-comment__body {
  display: -webkit-box;
  max-width: 72ch;
  margin: 0;
  overflow: hidden;
  color: #e8e8e8;
  font-size: 18px;
  line-height: 1.85;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
}

.ik-comment__content:hover .ik-comment__body {
  color: #fff;
}

.ik-comment__likes {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  color: #a6a6a6;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.ik-comment__likes svg {
  width: 16px;
  height: 16px;
}

.ik-comment__post {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 16px;
  align-items: center;
  align-self: center;
  gap: 12px;
  min-width: 0;
  padding: 10px;
  border: 1px solid #303030;
  border-radius: 12px;
  background: #202020;
  transition: border-color 0.15s ease;
}

.ik-comment__post:hover {
  border-color: #686868;
}

.ik-comment__cover,
.ik-comment__cover-placeholder {
  width: 64px;
  height: 64px;
  border-radius: 7px;
  object-fit: cover;
  background: #2a2a2a;
}

.ik-comment__cover-placeholder {
  display: grid;
  place-items: center;
  color: #9a9a9a;
}

.ik-comment__cover-placeholder svg {
  width: 26px;
  height: 26px;
}

.ik-comment__post-title {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  color: #c2c2c2;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
}

.ik-comment__post-arrow {
  width: 16px;
  height: 16px;
  color: #9a9a9a;
}

.ik-comment__post:hover .ik-comment__post-arrow {
  color: var(--ik-primary);
}

.ik-search :is(a, button, [role="tabpanel"]):focus-visible {
  outline: 2px solid var(--ik-primary);
  outline-offset: 4px;
}

@media (max-width: 1200px) {
  .ik-comment-card {
    grid-template-columns: minmax(0, 1fr) 250px;
    gap: 20px 28px;
    padding: 28px 0;
  }

  .ik-comment__head {
    grid-column: 1;
    grid-row: 1;
  }

  .ik-comment__content {
    grid-column: 1;
    grid-row: 2;
  }

  .ik-comment__post,
  .ik-skel--source {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
}

@media (max-width: 1280px) {
  .ik-search-grid--users {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 44px 36px;
  }
}

/* ── 底部 / 空 / 出错 ── */
.ik-search-footer {
  display: flex;
  justify-content: center;
  padding: 32px 0 8px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
}

.ik-search-footer__gif {
  width: 56px;
}

.ik-search-sentinel {
  height: 1px;
}

.ik-search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 16px 80px;
  text-align: center;
}

.ik-search-empty__art {
  width: 88px;
  margin-bottom: 4px;
  opacity: 0.85;
}

.ik-search-empty__title {
  margin: 0;
  color: rgba(255, 255, 255, 0.88);
  font-size: 17px;
  font-weight: 600;
}

.ik-search-empty__hint {
  margin: 0;
  color: rgba(255, 255, 255, 0.42);
  font-size: 13px;
}

.ik-search-empty__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}

.ik-search-empty__actions:empty {
  display: none;
}

/* ── 入场：移植 Inspira「Blur Reveal」的模糊上浮，按序错开 ── */
@keyframes ik-reveal {
  from {
    opacity: 0;
    filter: blur(8px);
    transform: translateY(10px);
  }
}

.ik-reveal {
  animation: ik-reveal 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(min(var(--i, 0), 12) * 35ms);
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
  width: 24px;
  height: 18px;
  flex: 0 0 24px;
}

.ik-skel--avatar {
  width: 80px;
  height: 80px;
  flex: 0 0 80px;
  border-radius: 50%;
}

.ik-skel--avatar-sm {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 50%;
}

.ik-skel--button {
  width: 100px;
  height: 34px;
  border-radius: 8px;
}

.ik-skel--source {
  align-self: center;
  height: 86px;
  border-radius: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .ik-skel,
  .ik-reveal,
  .ik-user__spinner {
    animation: none;
  }

  .ik-user__follow,
  .ik-comment__post {
    transition: none;
  }
}

@media (max-width: 768px) {
  .ik-search-page {
    min-height: calc(100dvh - 66px);
  }

  .ik-search-backdrop {
    height: 200px;
    background-image:
      linear-gradient(180deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.15) 45%, rgba(0, 0, 0, 0.85) 100%),
      url("/images/search-hero-bg-sm.webp");
  }

  .ik-search-page.is-idle .ik-search-backdrop {
    height: 360px;
  }

  .ik-search {
    width: calc(100% - 32px);
    padding: 16px 0 40px;
  }

  .ik-search.is-idle {
    padding-top: 20px;
  }

  .ik-search-hero {
    gap: 16px;
    margin-bottom: 24px;
  }

  .ik-search.is-idle .ik-search-hero {
    margin-bottom: 32px;
  }

  .ik-seg--lg {
    width: 100%;
    gap: 24px;
  }

  .ik-seg--lg .ik-seg__item {
    flex: 0 0 auto;
    min-width: 0;
    height: 42px;
    padding: 0 0 8px;
    font-size: 15px;
  }

  .ik-seg--sm .ik-seg__item {
    padding: 0 12px;
  }

  .ik-search-idle {
    gap: 32px;
  }

  .ik-search-hot {
    padding: 6px;
  }

  .ik-search-hot__list {
    grid-template-columns: minmax(0, 1fr);
  }

  .ik-search-hot__item {
    min-height: 48px;
    padding: 0 10px;
  }

  .ik-search-bar {
    margin-bottom: 16px;
  }

  .ik-search-related {
    margin: 0 -16px 20px;
    padding: 0 16px;
  }

  .ik-search-grid--users {
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
  }

  .ik-user {
    min-height: 100px;
    padding-left: 80px;
  }

  .ik-user__avatar,
  .ik-user .ik-skel--avatar {
    width: 64px;
    height: 64px;
  }

  .ik-user__name {
    font-size: 18px;
  }

  .ik-user__follow {
    min-width: 96px;
    height: 40px;
    padding: 0 14px;
  }

  .ik-comment-card {
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
    padding: 24px 0;
  }

  .ik-comment__head,
  .ik-comment__content,
  .ik-comment__post,
  .ik-skel--source {
    grid-column: auto;
    grid-row: auto;
  }

  .ik-comment__avatar,
  .ik-skel--avatar-sm {
    width: 36px;
    height: 36px;
    flex-basis: 36px;
  }

  .ik-comment__byline {
    gap: 3px;
  }

  .ik-comment__author {
    font-size: 14px;
  }

  .ik-comment__time {
    font-size: 12px;
  }

  .ik-comment__body {
    font-size: 16px;
    line-height: 1.8;
  }

  .ik-comment__content {
    gap: 12px;
  }

  .ik-comment__post {
    grid-template-columns: 44px minmax(0, 1fr) 16px;
    gap: 10px;
    padding: 8px;
  }

  .ik-comment__cover,
  .ik-comment__cover-placeholder {
    width: 44px;
    height: 44px;
  }

  .ik-comment__post-title {
    font-size: 13px;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .ik-search-empty {
    padding: 48px 16px 64px;
  }
}
</style>
