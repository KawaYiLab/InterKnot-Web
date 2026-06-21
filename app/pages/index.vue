<script setup lang="ts">
import { useDebounceFn, useWindowSize, useMediaQuery } from "@vueuse/core";
import { useMessage } from "zenless-ui";
import type { ArticleFeed, Category, Post } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import {
  FALLBACK_COVER_ASPECT_RATIO,
  estimateTitleLineCount,
  getCoverAspectRatio,
  getNormalizedCoverAspectRatio,
} from "~/utils/cover";
import { calculateSkeletonCount, estimateSkeletonHeight, generateSkeletons, type SkeletonItem } from "~/utils/skeleton";
import { ArrowPathIcon } from "@heroicons/vue/24/outline";

// 静态导入核心瀑布流组件，防止下滑加载或冷启动时动态请求分包导致滚动卡顿
import VirtualMasonry from "~/components/VirtualMasonry.vue";
import PostCard from "~/components/PostCard.vue";
import PostCardSkeleton from "~/components/PostCardSkeleton.vue";

const api = useApi();
const homeStateCache = useHomeStateCache();
const pendingPost = usePendingPost();
const route = useRoute();
const postModal = usePostModal();
const message = useMessage();
const pageDataLoading = usePageDataLoading();
const auth = useAuthStore();
const loginDialog = useLoginDialog();

useSeoMeta({
  title: "绳网",
  description: "绳网是一个游戏、技术交流平台，发现并分享有趣的内容。",
  ogTitle: "绳网",
  ogDescription: "绳网是一个游戏、技术交流平台，发现并分享有趣的内容。",
});

const scrollTarget = ref<HTMLElement>();
// z-backtop listens on target's "scroll" event and reads target.scrollTop
// But document.documentElement may not fire "scroll" events in all browsers.
// Bridge window scroll events to the element so z-backtop works correctly.
// 记住函数引用 + 使用 passive，使浏览器可以乐观滚动；onBeforeUnmount 里清理
// 避免路由切走后仍在全局 dispatch 事件。
let scrollBridge: (() => void) | null = null;
let stopPendingWatch: (() => void) | null = null;
onMounted(() => {
  const el = document.documentElement;
  scrollBridge = () => {
    el.dispatchEvent(new Event("scroll"));
  };
  window.addEventListener("scroll", scrollBridge, { passive: true });
  scrollTarget.value = el;
});

const LOAD_MORE_ROOT_MARGIN = "360px 0px";
const LOAD_MORE_COOLDOWN_MS = 1000;
// 固定部分（不含 title 高度）：
//   card padding(8) + body padding-bottom(12) + author-row min-height(32)
// + body gap(8) + title margin(8) = 68px
// title 高度按真实行数（1 或 2）动态加，与 PostCard 实际渲染严格匹配，
// 避免 ResizeObserver 测量后触发 layout 重排引起的滚动跳动。
const POST_CARD_FIXED_HEIGHT = 68;
const POST_CARD_TITLE_FONT_SIZE = 17;
const POST_CARD_TITLE_LINE_HEIGHT = 1.25;
// 卡片 body 横向内边距 = 8 * 2 = 16px，title 可用宽度 = itemWidth - 16
const POST_CARD_BODY_PADDING_X = 16;

const query = ref(pickFirstQuery(route.query.q as string | string[] | undefined));
// 频道筛选：空串 = 全部（推荐流）。Tab 选中后随 list/缓存键一起隔离。
const categories = ref<Category[]>([]);
const selectedCategory = ref<string>("");

// feed 模式：推荐 / 关注（我关注的作者）/ 收藏（我的收藏）。
// 关注、收藏需登录；缓存键随 feed 一起隔离（见 useApi.searchArticles）。
const feedMode = ref<ArticleFeed>("recommend");
// 右侧仅展示「关注 / 收藏」两个特殊筛选；默认（推荐）态由左侧分类栏主导，
// 此时这两个按钮均不高亮。再次点击已激活的按钮即可切回推荐。
const feedTabs: { key: Exclude<ArticleFeed, "recommend">; label: string }[] = [
  { key: "following", label: "关注" },
  { key: "favorites", label: "收藏" },
];

const selectFeed = (mode: Exclude<ArticleFeed, "recommend">) => {
  // 点击已激活的 feed：切回推荐流。
  if (mode === feedMode.value) {
    feedMode.value = "recommend";
    return;
  }
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  // 关注/收藏是独立流，不与分类叠加：进入时清空已选分类，避免分类 tab 仍高亮
  // 且后端把 category 与 feed 过滤叠加导致结果是子集。
  selectedCategory.value = "";
  feedMode.value = mode;
};

/** 当前生效的搜索词：仅推荐流支持文本搜索，关注/收藏强制走列表流。 */
const activeQuery = () => (feedMode.value === "recommend" ? query.value.trim() : "");
const loading = ref(false);
const loadingMore = ref(false);
const refreshing = ref(false);

const list = shallowRef<Post[]>([]);
const enterAnimationIds = shallowRef(new Set<string>());
const endCursor = ref("0");
const hasNextPage = ref(true);
const requestVersion = ref(0);
let seenIds = new Set<string>();
let lastFetchTime = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

// VirtualMasonry 模板引用，用于读取 expose 的 measuredHeights
const masonryRef = ref<{ measuredHeights: Map<string | number, number>; $el: HTMLElement } | null>(null);
// 从缓存恢复的已测量高度，传给 VirtualMasonry.initialHeights
const cachedMeasuredHeights = shallowRef<Map<string | number, number> | undefined>(undefined);

const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const loadMoreObserverRef = shallowRef<IntersectionObserver | null>(null);

// ── 后台轮询：检测有无新帖（仅在无搜索关键词时启用） ─────────
const NEW_ARTICLES_POLL_MS = 60_000;
const newArticleIds = shallowRef<string[]>([]);
const hasNewArticles = computed(() => newArticleIds.value.length > 0);
let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;

const masonryKeyMapper = (post: Post) => post.id;
const skeletonKeyMapper = (item: SkeletonItem) => item.id;
const { width: viewportWidth } = useWindowSize({ initialWidth: 0 });
const isMobile = useMediaQuery("(max-width: 768px)");

// 瀑布流列间距：移动端收窄，避免两列离得过远（与 .ik-home-container 的左右边距协调）
const feedGap = computed(() => (viewportWidth.value && viewportWidth.value <= 768 ? 14 : 32));


const estimatePostCardHeight = (post: Post, itemWidth: number) => {
  // 无封面文章使用占位图原生比例，与卡片实际渲染保持一致
  const ratio = post.cover
    ? getNormalizedCoverAspectRatio(post.coverWidth, post.coverHeight)
    : FALLBACK_COVER_ASPECT_RATIO;
  const coverHeight = itemWidth / ratio;

  // 按 title 真实行数估算：避免短标题被强制占 2 行高度，又避免与实际渲染不一致引发滚动跳动
  const titleAvailWidth = Math.max(0, itemWidth - POST_CARD_BODY_PADDING_X);
  const titleLines = estimateTitleLineCount(
    post.title,
    titleAvailWidth,
    POST_CARD_TITLE_FONT_SIZE,
  );
  const titleHeight =
    POST_CARD_TITLE_FONT_SIZE * POST_CARD_TITLE_LINE_HEIGHT * titleLines;

  return Math.ceil(coverHeight + POST_CARD_FIXED_HEIGHT + titleHeight);
};

// 动画时长（与 CSS .ik-masonry-card-enter 严格对应）
const CARD_ENTER_ANIMATION_MS = 360;
// 兜底清理延迟：略大于动画时长，避免清理过早误伤还在播放的动画
const CARD_ENTER_CLEANUP_MS = CARD_ENTER_ANIMATION_MS + 60;
// 错开入场最大延迟（ms），按列数分摊
const CARD_STAGGER_MAX_DELAY_MS = 120;

const addEnterAnimations = (nodes: Post[]) => {
  if (!nodes.length) return;

  const nextIds = new Set(enterAnimationIds.value);
  const addedIds: string[] = [];
  for (const node of nodes) {
    if (node.id) {
      nextIds.add(node.id);
      addedIds.push(node.id);
    }
  }
  enterAnimationIds.value = nextIds;

  // 兜底清理：虚拟化场景下，卡片在视口外被卸载时 `animationend` 不会触发，
  // 导致 id 残留在 enterAnimationIds 里——用户滚回去时该卡片会**再次**应用
  // ik-masonry-card-enter class，DOM 重挂时 CSS 动画又播一遍，造成"已经看过的
  // 卡片入场动画重播"的怪异观感。300ms 后强制清除这一批 id，让动画状态终止。
  // 走 finishEnterAnimation 复用 queueMicrotask 批量合并逻辑。
  if (import.meta.client) {
    setTimeout(() => {
      for (const id of addedIds) finishEnterAnimation(id);
    }, CARD_ENTER_CLEANUP_MS);
  }
};

const shouldAnimatePost = (postId: string) => {
  return enterAnimationIds.value.has(postId);
};

// 根据索引计算错开入场延迟，让卡片按列依次出现，减轻渲染压力
const getStaggerDelayStyle = (index: number, columnCount: number): Record<string, string> => {
  // 按列位置分配延迟：同一列的卡片依次出现，不同列之间错开
  const colIndex = index % Math.max(1, columnCount);
  const rowIndex = Math.floor(index / Math.max(1, columnCount));
  // 列间错开 + 行内微小错开
  const delay = (colIndex * 40 + rowIndex * 20) % CARD_STAGGER_MAX_DELAY_MS;
  return { animationDelay: `${delay}ms` };
};

// 一批新增卡片 240ms 内集中 animationend → 以前每次都 new Set(...) 拷贝，
// N 条同时结束 → O(N²) 拷贝。改用微任务批量合并：同一任务队内所有 finish
// 调用只触发一次 Set 重建 + 一次 reactive trigger。
let pendingFinish: Set<string> | null = null;
const finishEnterAnimation = (postId: string) => {
  if (!enterAnimationIds.value.has(postId)) return;
  if (!pendingFinish) {
    pendingFinish = new Set();
    queueMicrotask(() => {
      const ids = pendingFinish;
      pendingFinish = null;
      if (!ids || ids.size === 0) return;
      const next = new Set(enterAnimationIds.value);
      for (const id of ids) next.delete(id);
      enterAnimationIds.value = next;
    });
  }
  pendingFinish.add(postId);
};

const skeletonCount = computed(() => {
  return calculateSkeletonCount(viewportWidth.value, import.meta.client);
});

const skeletonItems = computed(() => generateSkeletons(skeletonCount.value));

const toUniqueNodes = (nodes: Post[], reset: boolean): Post[] => {
  if (reset) {
    seenIds = new Set();
  }

  const unique: Post[] = [];
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

// 已读态异步回填：searchArticles 现在不再 await /article-reads/batch，
// 卡片先渲染，已读 id 集合 resolve 后再以响应式方式（重建数组）合并进 list，
// v-memo 据此重算受影响卡片。仅在确有变化时重建，避免无谓的瀑布流重算。
const applyReadStatusReady = (ready: Promise<Set<string>> | undefined, version: number) => {
  if (!ready) return;
  void ready.then((readIds) => {
    // 切换分类/搜索词会自增 requestVersion；旧请求的已读结果不应再回填到新列表上。
    if (version !== requestVersion.value) return;
    if (!readIds || readIds.size === 0) return;
    let changed = false;
    const next = list.value.map((d) => {
      if (readIds.has(d.id) && !d.isRead) {
        changed = true;
        return { ...d, isRead: true };
      }
      return d;
    });
    if (changed) list.value = next;
  });
};

const fetchList = async (reset = false) => {
  if (loading.value || loadingMore.value) return;
  if (!hasNextPage.value && !reset) return;

  // 缓存命中预填：避免从其他页面切回首页时 skeleton → fade → list 双重过渡 440ms。
  // 同步把缓存数据填进 list，模板首帧就走 "list" 分支，跳过 <Transition> 切换。
  // 之后仍然 await searchArticles：fresh 时返回同引用无副作用；stale 时后台刷新替换。
  // 仅对 reset=true（首屏 / 切回 / 切搜索词）启用；refreshing 是用户明确下拉，不走捷径。
  let cacheHit = false;
  if (reset && !refreshing.value) {
    const cached = api.peekArticles(activeQuery(), "0", selectedCategory.value, feedMode.value);
    if (cached) {
      const uniqueNodes = toUniqueNodes(cached.nodes, true);
      enterAnimationIds.value = new Set();
      list.value = uniqueNodes;
      endCursor.value = cached.endCursor;
      hasNextPage.value = cached.hasNextPage;
      cacheHit = true;
    }
  }

  const shouldShowPageProgress = reset && !refreshing.value && !cacheHit;
  if (shouldShowPageProgress) {
    if (!pageDataLoading.isActive.value) {
      pageDataLoading.start();
    }
    pageDataLoading.claim();
  }

  // 缓存命中时不显 skeleton（loading 保持 false）；仅 cold load 才占位
  if (reset && !refreshing.value && !cacheHit) {
    loading.value = true;
  } else if (!reset) {
    loadingMore.value = true;
  }

  const currentVersion = ++requestVersion.value;
  try {
    const page = await api.searchArticles(
      activeQuery(),
      reset ? "0" : endCursor.value,
      selectedCategory.value,
      feedMode.value,
    );
    if (currentVersion !== requestVersion.value) {
      return;
    }

    const uniqueNodes = toUniqueNodes(page.nodes, reset);

    if (reset) {
      if (refreshing.value) {
        addEnterAnimations(uniqueNodes);
      } else {
        enterAnimationIds.value = new Set();
      }
      list.value = uniqueNodes;
    } else {
      addEnterAnimations(uniqueNodes);
      list.value = [...list.value, ...uniqueNodes];
    }

    endCursor.value = page.endCursor;
    hasNextPage.value = page.hasNextPage;

    // 已读态在卡片渲染后异步回填（不阻塞本次加载）；带上版本号，避免旧请求回填到新列表。
    applyReadStatusReady(page.readStatusReady, currentVersion);

    // 缓存命中路径下，scrollToTopAfterReset 不再需要（避免破坏用户期望的滚动位置）
    if (!cacheHit) await scrollToTopAfterReset(reset);
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

const goPost = (post: Post, event: MouseEvent) => {
  // 阻止 NuxtLink 默认导航，改为弹窗展示
  event.preventDefault();
  postModal.open(post.id, {
    coverAspectRatio: getCoverAspectRatio(post.coverWidth, post.coverHeight),
    preview: {
      title: post.title,
      author: post.author,
      createdAt: post.createdAt,
    },
  });

  // 标记已读：网络请求立即发出（不占主线程），但本地 list 的重建推迟到
  // 弹窗关闭之后——被点开的卡片在弹窗期间完全被遮住，用户看不到已读变化，
  // 而重建数组会触发瀑布流重算 + 可见卡片 patch，与 PostOverlay 的挂载、
  // 详情/评论数据回填渲染争抢主线程，正是「点开弹窗卡顿」的来源。
  if (post.isRead) return;
  const targetId = post.id;
  pendingReadIds.add(targetId);
  api.markAsReadBatch([targetId]).catch(() => {
    // 失败时若尚未回填，从 pending 移除即可；若已回填到 list，需回滚已读态
    if (pendingReadIds.delete(targetId)) return;
    list.value = list.value.map((d) =>
      d.id === targetId && d.isRead ? { ...d, isRead: false } : d,
    );
  });
};

// 弹窗期间累积的待回填已读 id；弹窗离场动画结束后一次性合并进 list
const pendingReadIds = new Set<string>();

const flushPendingReadIds = () => {
  if (pendingReadIds.size === 0) return;
  const ids = new Set(pendingReadIds);
  pendingReadIds.clear();
  let changed = false;
  const next = list.value.map((d) => {
    if (ids.has(d.id) && !d.isRead) {
      changed = true;
      return { ...d, isRead: true };
    }
    return d;
  });
  if (changed) list.value = next;
};

watch(
  () => postModal.isOpen.value,
  (open) => {
    if (open || !import.meta.client) return;
    // 等弹窗离场动画（~200ms）结束后再重建 list，避免卡到关闭动画
    window.setTimeout(flushPendingReadIds, 320);
  },
);

const handleRefresh = async () => {
  if (refreshing.value || loading.value) return;
  refreshing.value = true;
  window.scrollTo({ top: 0, behavior: "instant" });
  // Minimum visible duration so the animation feels intentional
  const minDelay = new Promise((r) => setTimeout(r, 600));
  // 用户明确下拉刷新：跳过 staleTime 缓存，强制重拉最新首页列表
  api.invalidateQueries(["articles", "search"]);
  await fetchList(true);
  // 刷新后清掉"新帖提示"
  newArticleIds.value = [];
  await minDelay;
  refreshing.value = false;
};

// ── 后台静默轮询：只比对最新一页第一条 id 与本地 list 的差集 ────
const pollLatestArticles = async () => {
  // 仅在推荐流（无搜索词、非关注/收藏）下做轮询
  if (feedMode.value !== "recommend") return;
  if (query.value.trim()) return;
  // 不与正在进行的请求/刷新冲突
  if (polling || loading.value || refreshing.value || loadingMore.value) return;
  if (import.meta.client && document.visibilityState !== "visible") return;
  // 列表还没加载出来时不必探测
  if (!list.value.length) return;

  polling = true;
  try {
    // 强制失效当前频道空搜索的第一页，让 fetchQuery 真正打到后端
    api.invalidateQueries(["articles", "search", "", selectedCategory.value]);
    const page = await api.searchArticles("", "", selectedCategory.value);
    if (!page.nodes.length) return;

    const knownIds = new Set(list.value.map((d) => d.id));
    const fresh: string[] = [];
    for (const node of page.nodes) {
      if (!node.id) continue;
      // 第一页中第一个已知 id 之前的都是"新增"
      if (knownIds.has(node.id)) break;
      fresh.push(node.id);
    }
    if (fresh.length) {
      // 取并集，避免短时间内多次轮询重复计数
      const merged = new Set<string>(newArticleIds.value);
      for (const id of fresh) merged.add(id);
      newArticleIds.value = Array.from(merged);
    }
  } catch {
    // 网络错误静默忽略：下次轮询再试
  } finally {
    polling = false;
  }
};

const startPolling = () => {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void pollLatestArticles();
  }, NEW_ARTICLES_POLL_MS);
};

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

// 用户点击"有 N 条新内容" → 顶部刷新
const applyNewArticles = () => {
  void handleRefresh();
};

// Tab 回到前台：立即跳一次轮询，让用户尽快看到提示
const onTabVisible = () => {
  void pollLatestArticles();
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
  (q) => {
    // 切换到搜索时清掉"新帖提示"，搜索流不轮询
    newArticleIds.value = [];
    // 输入搜索词时回到推荐流（关注/收藏不支持文本搜索）。
    // feedMode 变化会触发其 watcher 重拉，避免与 debouncedSearch 重复，这里提前 return。
    if (q.trim() && feedMode.value !== "recommend") {
      feedMode.value = "recommend";
      stopPolling();
      return;
    }
    debouncedSearch();
    // q 非空 ⇒ 进入搜索；空 ⇒ 回到推荐流（轮询照常运行）
    if (q.trim()) {
      stopPolling();
    } else {
      startPolling();
    }
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

const selectCategory = (slug: string) => {
  // 选分类即回到推荐流（关注/收藏是独立筛选，不与分类叠加）。
  if (feedMode.value !== "recommend") feedMode.value = "recommend";
  if (slug === selectedCategory.value) return;
  selectedCategory.value = slug;
};

// 缓存恢复时同步 feedMode 会触发下面的 watcher；用此标记跳过那次重拉。
let skipFeedWatch = false;

// 切换频道或 feed：清空"新帖提示"、重置分页并强制失效缓存后重拉首屏，
// 确保即使命中旧缓存也会真正打到后端、列表随频道/feed 刷新。
// 合并 feedMode + selectedCategory 为单个 watcher：切 feed 时常会同时改这两个值
// （见 selectFeed / selectCategory），合并后同一 flush 周期只触发一次，避免两个独立
// watcher 各自 ++requestVersion 互相作废导致 fetchList 提前 return、列表不刷新。
watch(
  () => [feedMode.value, selectedCategory.value] as const,
  () => {
    if (skipFeedWatch) {
      skipFeedWatch = false;
      return;
    }
    newArticleIds.value = [];
    endCursor.value = "0";
    hasNextPage.value = true;
    requestVersion.value++;
    api.invalidateQueries(["articles", "search"]);
    void fetchList(true);
  },
);

const loadCategories = async () => {
  try {
    const list = await api.getCategories();
    if (list.length) categories.value = list;
  } catch {
    // 频道列表拉取失败不影响推荐流浏览
  }
};
void loadCategories();

watch(
  () => loadMoreSentinelRef.value,
  async () => {
    await nextTick();
    observeLoadMoreSentinel();
  },
  { flush: "post" },
);

// ── 缓存恢复 / 首次加载 ─────────────────────────────
// scrollY 的恢复由 app/router.options.ts 的 scrollBehavior 在导航阶段统一处理，
// 此处只负责列表数据 + measuredHeights 的恢复。
const cached = homeStateCache.restore();
let initialFetchPromise: Promise<void>;

// 乐观插入：消费 /create 发布后塞入的 pending 队列，把刚发布的帖子
// unshift 到 list 头部并加入 seenIds，避免后续 fetch 返回相同 id 时被去重逻辑过滤掉。
// 搜索流 / 关注 / 收藏 feed 下不插入，避免污染这些列表（新帖既未被收藏也未必来自关注作者）。
// drain 仅在真正会写入 list 时调用，不能在冷启动 fetchList 之前就 drain——fetchList 会重置 seenIds 和 list。
const consumePendingPosts = () => {
  if (feedMode.value !== "recommend") return;
  if (query.value.trim()) return;
  if (!pendingPost.peek().length) return;
  const pending = pendingPost.drain();
  // 反转后再 unshift：保证 push 顺序最晚的帖子排在最顶部
  const fresh: Post[] = [];
  for (const post of pending) {
    if (!post.id || seenIds.has(post.id)) continue;
    seenIds.add(post.id);
    fresh.push(post);
  }
  if (!fresh.length) return;
  fresh.reverse();
  list.value = [...fresh, ...list.value];
};

if (cached && cached.query === query.value && cached.category === selectedCategory.value) {
  // 从缓存恢复：跳过网络请求，直接填充列表状态
  const restoredFeed = cached.feed ?? "recommend";
  if (restoredFeed !== feedMode.value) {
    skipFeedWatch = true;
    feedMode.value = restoredFeed;
  }
  list.value = cached.list;
  endCursor.value = cached.endCursor;
  hasNextPage.value = cached.hasNextPage;
  seenIds = cached.seenIds;
  cachedMeasuredHeights.value = cached.measuredHeights;
  // scrollY 由 router.options.ts 的 scrollBehavior 通过 consumeScrollY() 独立消费
  homeStateCache.clear();
  initialFetchPromise = Promise.resolve();
  // 缓存命中：list 已就绪，立即消费 pending 队列，首帧渲染即可看到刚发的帖子
  consumePendingPosts();
} else {
  homeStateCache.clear();
  // 在 setup 阶段提前发起首屏数据请求，不等 onMounted
  initialFetchPromise = fetchList(true);
  // 冷启动路径下，consumePendingPosts 推迟到 fetchList resolve 之后（onMounted 中），
  // 因为 fetchList 会重置 seenIds 和 list，提前 drain 会丢失数据。
}

// Triggered by MobileBottomNav when the user double-taps the active
// "推送" entry — mirrors the Flutter app's pull-to-refresh shortcut.
const onHomeRefreshEvent = () => {
  void handleRefresh();
};

// ── 移动端下拉刷新（touch-based pull-to-refresh） ─────────────
const PULL_THRESHOLD = 60;
const PULL_MAX = 120;
let pullStartY = 0;
let isPulling = false;
const pullDistance = ref(0);
const pullTriggered = ref(false);

const onTouchStart = (e: TouchEvent) => {
  if (!isMobile.value || refreshing.value || loading.value) return;
  if (window.scrollY > 5) return;
  const touch = e.touches[0];
  if (!touch) return;
  pullStartY = touch.clientY;
  isPulling = true;
};

const onTouchMove = (e: TouchEvent) => {
  if (!isPulling) return;
  const touch = e.touches[0];
  if (!touch) return;
  const deltaY = touch.clientY - pullStartY;
  if (deltaY < 0) {
    pullDistance.value = 0;
    return;
  }
  const dampened = Math.min(PULL_MAX, deltaY * 0.4);
  pullDistance.value = dampened;
  pullTriggered.value = dampened >= PULL_THRESHOLD;
};

const onTouchEnd = () => {
  if (!isPulling) return;
  isPulling = false;
  if (pullTriggered.value && !refreshing.value) {
    void handleRefresh();
  }
  pullDistance.value = 0;
  pullTriggered.value = false;
};

// 乐观删除：帖子详情页/弹窗删除成功后，从首页列表中移除
const onArticleDeleted = (e: Event) => {
  const deletedId = (e as CustomEvent<string>).detail;
  if (!deletedId) return;
  list.value = list.value.filter((d) => d.id !== deletedId);
  seenIds.delete(deletedId);
};

onMounted(async () => {
  if (import.meta.client) {
    window.addEventListener("ik:home-refresh", onHomeRefreshEvent);
    window.addEventListener("ik:tab-visible", onTabVisible);
    window.addEventListener("ik:article-deleted", onArticleDeleted);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
  }
  await initialFetchPromise;
  // 注册 pending 队列 watch（immediate=true）：
  //   - 冷启动：fetchList 刚填好 list，immediate 触发立即消费当前 pending；
  //   - 迟到 push：/create 的 fire-and-forget getPost 可能晚于此点解析，
  //     watch 会在 push 时再次触发消费，避免乐观帖子被丢；
  //   - 缓存命中路径下队列已在 setup 中 drain，immediate 触发是 no-op。
  stopPendingWatch = watch(
    pendingPost.queue,
    () => consumePendingPosts(),
    { immediate: true },
  );
  await nextTick();
  observeLoadMoreSentinel();

  // 滚动恢复由 app/router.options.ts 的 scrollBehavior 统一处理，
  // 此处无需手动 scrollTo——scrollBehavior 在导航到 / 时自动读取缓存的 scrollY。

  // 仅在推荐流下启动轮询；搜索状态由 watch(query) 控制
  if (!query.value.trim()) startPolling();
});

// ── 路由离开前：保存首页状态快照 ──────────────────────
// onBeforeRouteLeave 在路由变化前触发，此时 DOM 完整无损，window.scrollY 精确。
// 配合 measuredHeights 缓存，重建后布局像素级一致，scrollY 即可精确恢复。
onBeforeRouteLeave(() => {
  const heights = masonryRef.value?.measuredHeights;
  homeStateCache.save({
    list: list.value,
    endCursor: endCursor.value,
    hasNextPage: hasNextPage.value,
    query: query.value,
    category: selectedCategory.value,
    feed: feedMode.value,
    seenIds,
    measuredHeights: heights ? new Map(heights) : new Map(),
    scrollY: window.scrollY,
  });
});

onBeforeUnmount(() => {
  if (import.meta.client) {
    window.removeEventListener("ik:home-refresh", onHomeRefreshEvent);
    window.removeEventListener("ik:tab-visible", onTabVisible);
    window.removeEventListener("ik:article-deleted", onArticleDeleted);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    if (scrollBridge) {
      window.removeEventListener("scroll", scrollBridge);
      scrollBridge = null;
    }
  }
  if (stopPendingWatch) {
    stopPendingWatch();
    stopPendingWatch = null;
  }
  stopPolling();
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
    <!-- 45° 斜线纹理背景（与发帖页 / 入站考试页一致） -->
    <div class="ik-home-page__stripe" aria-hidden="true"></div>

    <!-- 顶部工具条：左侧频道分类，右侧 feed 切换（推荐/关注/收藏），两组错开。 -->
    <div class="ik-home-toolbar">
      <!-- 频道 Tab 条：按 order 展示，「全部」恒在最前。
           恒渲染（不随 categories 异步加载出现/消失），为分类栏预留固定高度，
           避免无缓存冷启动时频道列表后到导致下方内容跳动。 -->
      <nav class="ik-category-tabs" aria-label="帖子频道">
        <button
          type="button"
          class="ik-category-tab"
          :class="{ 'ik-category-tab--active': selectedCategory === '' }"
          @click="selectCategory('')"
        >
          全部
        </button>
        <button
          v-for="cat in categories"
          :key="cat.slug"
          type="button"
          class="ik-category-tab"
          :class="{ 'ik-category-tab--active': selectedCategory === cat.slug }"
          @click="selectCategory(cat.slug)"
        >
          {{ cat.name }}
        </button>

        <!-- feed 切换：关注 / 收藏，接在分类标签最后。未登录时引导登录；
             再次点击已激活项切回推荐。 -->
        <span class="ik-feed-sep" aria-hidden="true"></span>
        <button
          v-for="tab in feedTabs"
          :key="tab.key"
          type="button"
          class="ik-feed-tab"
          :class="{ 'ik-feed-tab--active': feedMode === tab.key }"
          @click="selectFeed(tab.key)"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <!-- 移动端下拉刷新指示器 -->
    <div
      v-if="pullDistance > 0 || refreshing"
      class="ik-pull-indicator"
      :style="{ opacity: refreshing ? 1 : Math.min(1, pullDistance / PULL_THRESHOLD), transform: `translateX(-50%) translateY(${refreshing ? 0 : pullDistance - PULL_THRESHOLD}px) rotate(${pullDistance * 3}deg)` }"
    >
      <i class="z-icon-loading ik-refresh-spin" />
    </div>

    <!-- Refresh indicator (pull-to-refresh style) -->
    <Transition name="ik-refresh-indicator">
      <div v-if="refreshing" class="ik-refresh-indicator ik-refresh-indicator--desktop">
        <i class="z-icon-loading ik-refresh-spin" />
      </div>
    </Transition>

    <!-- New articles toast: 后台轮询发现新帖时弹出 -->
    <Transition name="ik-new-articles-pill">
      <button
        v-if="hasNewArticles && !refreshing"
        class="ik-new-articles-pill"
        type="button"
        @click="applyNewArticles"
      >
        <ArrowPathIcon class="ik-new-articles-pill-icon" aria-hidden="true" />
        <span>有 {{ newArticleIds.length }} 条新内容，点击查看</span>
      </button>
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

        <!-- 空状态：loading=false 且 list 为空时显示 -->
        <div v-else-if="!list.length && !loading" key="empty" class="ik-empty">暂无相关帖子... [ o_x ]/</div>

        <!-- 实际内容：list 不为空时显示 -->
        <div v-else key="list" class="ik-list-state">
          <VirtualMasonry
            ref="masonryRef"
            class="ik-masonry"
            :items="list"
            :column-width="240"
            :gap="feedGap"
            :min-columns="2"
            :max-columns="5"
            :buffer="1800"
            :estimated-height="300"
            :height-mapper="estimatePostCardHeight"
            :key-mapper="masonryKeyMapper"
            :initial-heights="cachedMeasuredHeights"
          >
            <template #default="{ item, index, columnCount }">
              <PostCard
                :class="{ 'ik-masonry-card-enter': shouldAnimatePost(item.id) }"
                :style="shouldAnimatePost(item.id) ? getStaggerDelayStyle(index, columnCount) : undefined"
                :post="item"
                :eager="index < columnCount * 2"
                @open="goPost"
                @animationend="finishEnterAnimation(item.id)"
                v-memo="[item.id, item.isRead, item.cover, shouldAnimatePost(item.id)]"
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
    <!-- Refresh FAB (hidden on mobile) -->
    <z-button
      circle
      class="ik-refresh-fab"
      :loading="refreshing"
      @click="handleRefresh"
    >
      <ArrowPathIcon v-if="!refreshing" style="width:1em;height:1em" />
    </z-button>
    <z-backtop class="ik-backtop" :target="scrollTarget" :right="32" :bottom="95" />
  </section>
</template>

<style scoped>
.ik-home-container {
  position: relative;
  width: min(1600px, calc(100% - 40px));
  margin: 0 auto;
  padding-top: 24px;
  padding-bottom: 24px;
  overscroll-behavior-y: contain;
}

/* 45° 斜线纹理背景（与发帖页 / 入站考试页一致） */
.ik-home-page__stripe {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    40deg,
    transparent,
    transparent 3.5px,
    rgba(255, 255, 255, 0.09) 4.5px,
    rgba(255, 255, 255, 0.09) 7.5px,
    transparent 8.5px
  );
}

/* 内容层抬到斜纹之上（固定定位的刷新/回顶按钮本就在更高层级） */
.ik-home-toolbar,
.ik-skeleton-state,
.ik-empty,
.ik-list-state {
  position: relative;
  z-index: 1;
}

/* 顶部工具条：频道分类（可换行/横滑），末尾接 feed 切换。 */
.ik-home-toolbar {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.ik-category-tabs {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  /* 预留一行频道标签高度，避免频道列表异步到达时撑高导致下方瀑布流跳动 */
  min-height: 30px;
}

/* 分类与 feed 切换之间的竖向分隔线 */
.ik-feed-sep {
  flex: 0 0 auto;
  width: 1px;
  align-self: stretch;
  margin: 2px 2px;
  background: #333;
}

/* feed 切换标签（关注/收藏）：与频道标签同款胶囊，接在分类末尾。 */
.ik-feed-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 14px;
  border-radius: 9999px;
  border: 2px solid #222;
  background: #222222;
  color: #fff;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.ik-feed-tab--active {
  color: #222;
  background: var(--ik-primary, #BFFF09);
  border-color: var(--ik-primary, #BFFF09);
  font-weight: 700;
}

/* 与 z-tag 默认标签一致：深底 #1c1c1c + #222 描边、白字、胶囊圆角 */
.ik-category-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 16px;
  border-radius: 9999px;
  border: 2px solid #222;
  background: #222222;
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.ik-category-tab--active {
  color: #222;
  background: var(--ik-primary, #BFFF09);
  border-color: var(--ik-primary, #BFFF09);
  font-weight: 700;
}

@media (max-width: 768px) {
  .ik-home-toolbar {
    gap: 10px;
    margin-bottom: 12px;
  }

  .ik-category-tabs {
    gap: 8px;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    min-height: 28px;
  }

  .ik-category-tabs::-webkit-scrollbar {
    display: none;
  }

  .ik-category-tab {
    flex: 0 0 auto;
    height: 28px;
    padding: 0 14px;
    font-size: 13px;
  }

  .ik-feed-tab {
    height: 28px;
    padding: 0 12px;
    font-size: 13px;
  }
}

.ik-masonry {
  width: 100%;
}

.ik-masonry-card-enter {
  animation: ik-masonry-card-enter 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
  will-change: transform, opacity;
  backface-visibility: hidden;
}

@keyframes ik-masonry-card-enter {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.96);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
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
    width: calc(100% - 28px);
    padding-top: 16px;
    padding-bottom: 16px;
  }

  .ik-scroll-footer {
    flex-wrap: wrap;
  }
}
/* ── Refresh indicator (pull-to-refresh style) ── */
.ik-refresh-indicator {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translate(-50%, 0);
  z-index: 10;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 44px;
  background: transparent;
  border: none;
  color: #BFFF09;
  font-size: 24px;
  pointer-events: none;
}

.ik-refresh-spin {
  animation: ik-spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  will-change: transform;
}

@keyframes ik-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ik-refresh-indicator-enter-active {
  transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms ease;
}

.ik-refresh-indicator-leave-active {
  transition: transform 250ms cubic-bezier(0.55, 0, 1, 0.45), opacity 200ms ease;
}

.ik-refresh-indicator-enter-from,
.ik-refresh-indicator-leave-to {
  transform: translate(-50%, -15px);
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

/* 刷新按钮加载状态优化 */
.ik-refresh-fab :deep(.z-button__icon.is-loading) {
  will-change: transform;
}

/* Avoid overlap with the fixed MobileBottomNav (58px) — shown on screens ≤1100px */
@media (max-width: 1100px) {
  .ik-refresh-fab {
    right: 16px;
    bottom: calc(58px + 16px + env(safe-area-inset-bottom, 0px));
  }
  :deep(.z-backtop) {
    right: 16px !important;
    bottom: calc(58px + 16px + 56px + 12px + env(safe-area-inset-bottom, 0px)) !important;
  }
}

@media (max-width: 768px) {
  .ik-refresh-fab,
  .ik-backtop {
    display: none !important;
  }

  :deep(.z-backtop) {
    display: none !important;
  }

  .ik-refresh-indicator--desktop {
    display: none;
  }
}

.ik-pull-indicator {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(30, 30, 30, 0.9);
  color: #bfff09;
  font-size: 18px;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

@media (min-width: 769px) {
  .ik-pull-indicator {
    display: none;
  }
}

/* ── 新帖提示药丸按钮 ───────────────────────── */
.ik-new-articles-pill {
  position: fixed;
  top: calc(78px + 12px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border: none;
  border-radius: 999px;
  background: #BFFF09;
  color: #000;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  cursor: var(--ik-cursor-pointer);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(0, 0, 0, 0.6) inset;
  transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.ik-new-articles-pill:hover {
  background: #e8ff44;
  transform: translateX(-50%) translateY(-1px);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(0, 0, 0, 0.6) inset;
}

.ik-new-articles-pill:active {
  transform: translateX(-50%) translateY(0);
}

.ik-new-articles-pill-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2.5;
}

.ik-new-articles-pill-enter-active,
.ik-new-articles-pill-leave-active {
  transition: opacity 220ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.ik-new-articles-pill-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-12px);
}

.ik-new-articles-pill-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}

@media (max-width: 768px) {
  .ik-new-articles-pill {
    top: calc(78px + 8px);
    padding: 7px 14px;
    font-size: 13px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-new-articles-pill,
  .ik-new-articles-pill-enter-active,
  .ik-new-articles-pill-leave-active {
    transition: none;
  }
}
</style>
