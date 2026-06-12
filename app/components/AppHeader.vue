<script setup lang="ts">
import { useEventListener } from "@vueuse/core";
import { ChatBubbleOvalLeftEllipsisIcon } from "@heroicons/vue/24/solid";
import { LEVEL_THRESHOLDS, MAX_LEVEL } from "~/utils/level";
import type { SearchSuggestion } from "~/composables/useApi";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const loginDialog = useLoginDialog();
const knockKnockModal = useKnockKnockModal();
const { isActive: showProgress, progress: progressValue, isClaimed, start: startProgress, finish: finishProgress } = usePageDataLoading();

// 敲敲未读：登录态由 knock-auth-bridge 插件在登录后自动启动 stream + refresh，
// 所以此处只需要订阅 totalUnread 即可——未登录时一直为 0，不显示 badge。
const { totalUnread: knockUnread } = useDmConversations();
/** badge 文案：>99 显示 "99+"，否则原数字 */
const knockUnreadLabel = computed(() => {
  const n = knockUnread.value;
  if (n <= 0) return "";
  return n > 99 ? "99+" : String(n);
});

// Auto-hide header on mobile when scrolling down, reveal on scroll up.
// Only the CSS targets the mobile breakpoint; the JS state is harmless on
// desktop because `.is-hidden` has no effect there.
const SCROLL_TOP_BUFFER = 80;
const SCROLL_DELTA_THRESHOLD = 6;
const isHeaderHidden = ref(false);
let lastScrollY = import.meta.client ? window.scrollY : 0;

if (import.meta.client) {
  // scroll 事件每秒可触发几十次，直接在回调里翻转响应式 class 会让 header
  // 子树每次都重算样式（登录态 header 含等级条/丁尼/滚轮数字，子树更大更贵）。
  // 用 rAF 节流：一帧内只处理一次，把 isHeaderHidden 的更新对齐到渲染节奏。
  let scrollRAF: number | null = null;
  const updateHeaderVisibility = () => {
    scrollRAF = null;
    const currentY = window.scrollY;
    const delta = currentY - lastScrollY;
    if (currentY <= SCROLL_TOP_BUFFER) {
      isHeaderHidden.value = false;
    } else if (delta > SCROLL_DELTA_THRESHOLD) {
      isHeaderHidden.value = true;
    } else if (delta < -SCROLL_DELTA_THRESHOLD) {
      isHeaderHidden.value = false;
    }
    lastScrollY = currentY;
  };
  useEventListener(
    window,
    "scroll",
    () => {
      if (scrollRAF !== null) return;
      scrollRAF = requestAnimationFrame(updateHeaderVisibility);
    },
    { passive: true },
  );
  onBeforeUnmount(() => {
    if (scrollRAF !== null) cancelAnimationFrame(scrollRAF);
  });
}

let _autoFinishTimer: ReturnType<typeof setTimeout> | null = null;
router.beforeEach((to, from) => {
  if (to.path === from.path) return;
  if (_autoFinishTimer) { clearTimeout(_autoFinishTimer); _autoFinishTimer = null; }
  startProgress();
});
router.afterEach(() => {
  _autoFinishTimer = setTimeout(() => {
    if (!isClaimed.value && showProgress.value) finishProgress();
    _autoFinishTimer = null;
  }, 100);
});

type HeaderTabName = "home" | "notification" | "create" | "mine";

const activeTab = ref<HeaderTabName>("home");
const profileTabLabel = useState<string | null>("profileTabLabel", () => null);
const mineTabText = computed(() => {
  const label = profileTabLabel.value;
  if (!label) return "我的";
  return label.length > 3 ? `${label.slice(0, 4)}...` : label;
});

// 等级进度条数据
const userLevel = computed(() => auth.user?.level ?? 1);
const userExp = computed(() => auth.user?.exp ?? 0);
const userName = computed(() => auth.user?.name || "用户");
const userAvatar = computed(() => auth.user?.avatar || "/images/default-avatar.webp");

// 等级阈值表 - 与后端 server/src/utils/level.ts 保持一致

// 计算下一级所需的总经验值
const expForNextLevel = computed(() => {
  const level = userLevel.value;
  if (level >= MAX_LEVEL) return LEVEL_THRESHOLDS[MAX_LEVEL - 1];
  return LEVEL_THRESHOLDS[level] || 0;
});

// 计算当前等级已积累的经验（当前总经验 - 当前等级所需的总经验）
const currentLevelExp = computed(() => {
  const totalExp = userExp.value;
  const currentLevelThreshold = LEVEL_THRESHOLDS[userLevel.value - 1] || 0;
  return totalExp - currentLevelThreshold;
});

// 计算当前等级升到下一级还需要的经验
const expNeededToNext = computed(() => {
  const level = userLevel.value;
  if (level >= MAX_LEVEL) return 0;
  const nextThreshold = LEVEL_THRESHOLDS[level] || 0;
  const currentThreshold = LEVEL_THRESHOLDS[level - 1] || 0;
  return nextThreshold - currentThreshold;
});

// 进度条百分比
const expProgressPercent = computed(() => {
  const level = userLevel.value;
  if (level >= MAX_LEVEL) return 100;
  const current = Math.max(0, currentLevelExp.value);
  const needed = expNeededToNext.value;
  if (needed <= 0) return 100;
  return Math.min(100, (current / needed) * 100);
});

// 丁尼货币系统 (自定义 Z-Button 按钮风格)
const api = useApi();
const dennyBalance = ref(0);

const fetchDennyBalance = async () => {
  if (!auth.isLogin) return;
  try {
    const data = await api.getMyDenny();
    dennyBalance.value = data.denny;
  } catch {
    // 忽略异常
  }
};

if (import.meta.client) {
  watch(
    () => auth.isLogin,
    (isLogin) => {
      if (isLogin) {
        void fetchDennyBalance();
      } else {
        dennyBalance.value = 0;
      }
    },
    { immediate: true },
  );

  useEventListener(window, "ik:home-refresh", fetchDennyBalance);
  useEventListener(window, "ik:denny-decrement", () => {
    if (dennyBalance.value > 0) {
      dennyBalance.value -= 1;
    }
  });
  useEventListener(window, "ik:denny-updated", (e: any) => {
    if (typeof e?.detail === "number") {
      dennyBalance.value = e.detail;
    } else {
      void fetchDennyBalance();
    }
  });
}

const searchKeyword = ref("");
const applyingSearch = ref(false);
const searchInputRef = ref<InstanceType<any>>();

// ── 实时搜索联想（Meilisearch 驱动）─────────────────────────
const postModal = usePostModal();
const SUGGEST_DEBOUNCE_MS = 200;
const suggestions = ref<SearchSuggestion[]>([]);
const suggestVisible = ref(false);
const searchFocused = ref(false);
const activeSuggestIndex = ref(-1);
let suggestTimer: ReturnType<typeof setTimeout> | null = null;
let suggestSeq = 0;

const suggestOpen = computed(
  () => suggestVisible.value && suggestions.value.length > 0 && !!searchKeyword.value.trim(),
);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 先整体转义再放行 <mark>：高亮由 v-html 渲染，但标题本身的任意 HTML 不可信。
const renderHighlight = (s: string) =>
  escapeHtml(s)
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");

const fetchSuggestions = async (keyword: string) => {
  const seq = ++suggestSeq;
  try {
    const list = await api.suggestArticles(keyword);
    if (seq !== suggestSeq) return; // 丢弃过期响应
    suggestions.value = list;
    activeSuggestIndex.value = -1;
    // 只在输入框聚焦时展示：路由同步 ?q= 等程序化赋值不应弹出下拉
    suggestVisible.value = searchFocused.value;
  } catch {
    if (seq === suggestSeq) suggestions.value = [];
  }
};

watch(searchKeyword, (next) => {
  const keyword = next.trim();
  if (suggestTimer) clearTimeout(suggestTimer);
  if (!keyword) {
    suggestSeq += 1;
    suggestions.value = [];
    activeSuggestIndex.value = -1;
    return;
  }
  suggestTimer = setTimeout(() => {
    suggestTimer = null;
    if (!searchFocused.value) {
      // 非用户输入（如路由同步 ?q=）：不请求联想，并清掉旧关键词的残留结果
      suggestions.value = [];
      activeSuggestIndex.value = -1;
      return;
    }
    void fetchSuggestions(keyword);
  }, SUGGEST_DEBOUNCE_MS);
});

const closeSuggest = () => {
  suggestVisible.value = false;
  activeSuggestIndex.value = -1;
};

const selectSuggestion = (s: SearchSuggestion) => {
  closeSuggest();
  postModal.open(s.documentId, { preview: { title: s.title } });
};

const moveSuggestIndex = (delta: number) => {
  if (!suggestOpen.value) return;
  const count = suggestions.value.length;
  if (count === 0) return;
  const next = activeSuggestIndex.value + delta;
  activeSuggestIndex.value = next < -1 ? count - 1 : next >= count ? -1 : next;
};

const handleSearchFocus = () => {
  searchFocused.value = true;
  if (suggestions.value.length > 0 && searchKeyword.value.trim()) {
    suggestVisible.value = true;
  }
};

const handleSearchBlur = () => {
  searchFocused.value = false;
  // 延迟关闭：让列表项的 mousedown/click 先于 blur 生效
  setTimeout(closeSuggest, 120);
};

const resolveActiveTab = (path: string): HeaderTabName => {
  if (path.startsWith("/profile")) {
    return "mine";
  }
  if (path.startsWith("/notification")) {
    return "notification";
  }
  if (path.startsWith("/create")) {
    return "create";
  }
  return "home";
};

const applySearch = async () => {
  if (applyingSearch.value) return;

  const keyword = searchKeyword.value.trim();
  const currentKeyword = pickFirstQuery(route.query.q as string | string[] | undefined).trim();
  const query = keyword ? { q: keyword } : {};

  if (route.path === "/" && keyword === currentKeyword) {
    return;
  }

  applyingSearch.value = true;
  if (route.path === "/") {
    try {
      await router.replace({ path: "/", query });
      return;
    } finally {
      applyingSearch.value = false;
    }
  }

  try {
    await router.push({ path: "/", query });
  } finally {
    applyingSearch.value = false;
  }
};

const handleSearchEnter = () => {
  const active = activeSuggestIndex.value;
  if (suggestOpen.value && active >= 0 && suggestions.value[active]) {
    selectSuggestion(suggestions.value[active]);
    return;
  }
  handleFullSearch();
};

// 显式全量搜索（搜索按钮 / 查看全部结果）：无视键盘选中的联想项
const handleFullSearch = () => {
  closeSuggest();
  applySearch().catch(() => undefined);
};

const handleSearchClear = () => {
  searchKeyword.value = "";
  nextTick(() => {
    const input = searchInputRef.value?.$el?.querySelector("input");
    if (input) input.value = "";
  });
};

const handleTabChange = async (next: string | number) => {
  const tab = String(next) as HeaderTabName;

  if (tab === "home") {
    await router.push("/");
    return;
  }

  if (tab === "notification") {
    if (!auth.isLogin) {
      loginDialog.open();
      activeTab.value = resolveActiveTab(route.path);
      return;
    }
    knockKnockModal.open();
    // 敲敲是弹窗而非独立路由，保持当前路由对应的 tab 视觉选中态
    activeTab.value = resolveActiveTab(route.path);
    return;
  }

  if (tab === "create") {
    if (!auth.isLogin) {
      loginDialog.open();
      activeTab.value = resolveActiveTab(route.path);
      return;
    }
    await router.push("/create");
    return;
  }

  if (auth.profilePath) {
    await router.push(auth.profilePath);
  } else {
    loginDialog.open();
  }
};

watch(
  () => route.fullPath,
  () => {
    activeTab.value = resolveActiveTab(route.path);
    searchKeyword.value = pickFirstQuery(route.query.q as string | string[] | undefined);
    // Reset auto-hide state on navigation so the header is visible on the
    // new page until the user scrolls down again.
    isHeaderHidden.value = false;
    lastScrollY = import.meta.client ? window.scrollY : 0;
  },
  { immediate: true },
);

</script>

<template>
  <header class="ik-header" :class="{ 'is-hidden': isHeaderHidden, 'is-login': auth.isLogin }">
    <div class="ik-header__inner">
      <div class="ik-header__left">
        <!-- 等级进度条（登录后显示） -->
        <div v-if="auth.isLogin" class="ik-level-display" @click="navigateTo(auth.profilePath || '/profile')">
          <img :src="userAvatar" alt="avatar" class="ik-level-avatar" />
          <div class="ik-level-middle">
            <span class="ik-level-username">{{ userName }}</span>
            <div class="ik-level-progress-wrap">
              <div class="ik-level-progress-bg">
                <div class="ik-level-progress-fill" :style="{ width: `${expProgressPercent}%` }"></div>
                <span class="ik-level-progress-text">{{ Math.max(0, currentLevelExp) }}/{{ expNeededToNext }}</span>
              </div>
            </div>
          </div>
          <div class="ik-level-right">
            <span class="ik-level-number">{{ userLevel }}</span>
            <span class="ik-level-label">LEVEL</span>
          </div>
        </div>

        <!-- 丁尼显示（自定义 Z-Button 风格，登录后显示） -->
        <div v-if="auth.isLogin" class="ik-header-denny" @click="navigateTo(auth.profilePath || '/profile')" title="丁尼余额">
          <img alt="Dennies" src="/images/materials/dennies_v2.webp" class="ik-header-denny__img" draggable="false" />
          <div class="ik-header-denny__content">
            <IkRollingDigit :value="dennyBalance" :min-digits="8" :duration="800" pad-end />
          </div>
        </div>

        <!-- 品牌 Logo：桌面端仅未登录显示（登录时换成等级/丁尼）；移动端始终显示 -->
        <NuxtLink to="/" class="ik-brand" aria-label="Inter Knot 首页">
          <img src="/images/zzzicon.png" alt="Inter Knot" class="ik-brand__icon" draggable="false" />
          <strong class="ik-brand__title">INTER-KNOT</strong>
        </NuxtLink>
      </div>

      <div class="ik-header__middle">
        <div
          class="ik-search-shell"
          @focusin="handleSearchFocus"
          @focusout="handleSearchBlur"
          @keydown.down.prevent="moveSuggestIndex(1)"
          @keydown.up.prevent="moveSuggestIndex(-1)"
          @keydown.esc="closeSuggest"
        >
          <z-input
            ref="searchInputRef"
            v-model="searchKeyword"
            class="ik-search-input"
            placeholder="全站搜索"
            @keydown.enter.prevent="handleSearchEnter"
          >
            <template #suffix>
              <span v-if="searchKeyword" class="ik-search-clear" role="button" tabindex="-1" aria-label="清除" @mousedown.prevent="handleSearchClear">
                <i class="z-icon-error" />
              </span>
              <span class="ik-search-divider" />
              <button type="button" class="ik-search-action" aria-label="搜索" @click="handleFullSearch">
                <i class="z-icon-search" />
              </button>
            </template>
          </z-input>

          <!-- 实时联想下拉 -->
          <Transition name="ik-suggest">
            <div v-if="suggestOpen" class="ik-search-suggest" role="listbox">
              <button
                v-for="(s, i) in suggestions"
                :key="s.documentId"
                type="button"
                class="ik-search-suggest__item"
                :class="{ 'is-active': i === activeSuggestIndex }"
                role="option"
                :aria-selected="i === activeSuggestIndex"
                @mousedown.prevent
                @mousemove="activeSuggestIndex = i"
                @click="selectSuggestion(s)"
              >
                <span class="ik-search-suggest__title" v-html="renderHighlight(s.titleHighlighted)" />
                <span v-if="s.excerpt" class="ik-search-suggest__excerpt" v-html="renderHighlight(s.excerpt)" />
                <span class="ik-search-suggest__meta">
                  <span v-if="s.categoryName" class="ik-search-suggest__category">{{ s.categoryName }}</span>
                  <span class="ik-search-suggest__author">{{ s.isAnonymous ? "匿名" : (s.authorName || "") }}</span>
                </span>
              </button>
              <button
                type="button"
                class="ik-search-suggest__all"
                @mousedown.prevent
                @click="handleFullSearch"
              >
                查看“{{ searchKeyword.trim() }}”的全部结果
              </button>
            </div>
          </Transition>
        </div>
      </div>

      <div class="ik-header__right">
        <!-- 移动端：tabs 隐藏后，把「敲敲」入口放到搜索框右侧 -->
        <button
          type="button"
          class="ik-header__knock"
          :aria-label="knockUnread > 0 ? `敲敲，${knockUnread} 条未读` : '敲敲'"
          @click="handleTabChange('notification')"
        >
          <ChatBubbleOvalLeftEllipsisIcon class="ik-header__knock-icon" aria-hidden="true" />
          <span
            v-if="knockUnreadLabel"
            class="ik-header__knock-badge"
            aria-hidden="true"
          >{{ knockUnreadLabel }}</span>
        </button>

        <div class="ik-header-tabs" role="tablist" aria-label="顶部导航">
          <button
            type="button"
            role="tab"
            class="ik-header-tab ik-header-tab--first"
            :class="{ 'is-active': activeTab === 'home' }"
            :aria-selected="activeTab === 'home'"
            @click="handleTabChange('home')"
          >
            <svg class="ik-tab-highlight ik-tab-highlight--first" viewBox="0 0 110.7 42" aria-hidden="true">
              <path
                d="M 21 0 L 94.38 0 A 10 10 0 0 1 103.29 14.54 L 93.75 33.26 A 16 16 0 0 1 79.5 42 L 21 42 A 21 21 0 0 1 21 0 Z"
                fill="currentColor"
              />
            </svg>
            <span class="ik-header-tab__content">推荐</span>
          </button>

          <button
            type="button"
            role="tab"
            class="ik-header-tab ik-header-tab--middle"
            :class="{ 'is-active': activeTab === 'notification' }"
            :aria-selected="activeTab === 'notification'"
            :aria-label="knockUnread > 0 ? `敲敲，${knockUnread} 条未读` : '敲敲'"
            @click="handleTabChange('notification')"
          >
            <svg class="ik-tab-highlight ik-tab-highlight--middle" viewBox="0 0 121.4 42" aria-hidden="true">
              <path
                d="M 105.08 0 A 10 10 0 0 1 113.99 14.54 L 104.45 33.26 A 16 16 0 0 1 90.2 42 L 16.32 42 A 10 10 0 0 1 7.41 27.46 L 16.95 8.74 A 16 16 0 0 1 31.2 0 Z"
                fill="currentColor"
              />
            </svg>
            <span class="ik-header-tab__content">
              敲敲
              <span
                v-if="knockUnreadLabel"
                class="ik-header-tab__badge"
                aria-hidden="true"
              >{{ knockUnreadLabel }}</span>
            </span>
          </button>

          <button
            type="button"
            role="tab"
            class="ik-header-tab ik-header-tab--middle"
            :class="{ 'is-active': activeTab === 'create' }"
            :aria-selected="activeTab === 'create'"
            @click="handleTabChange('create')"
          >
            <svg class="ik-tab-highlight ik-tab-highlight--middle" viewBox="0 0 121.4 42" aria-hidden="true">
              <path
                d="M 105.08 0 A 10 10 0 0 1 113.99 14.54 L 104.45 33.26 A 16 16 0 0 1 90.2 42 L 16.32 42 A 10 10 0 0 1 7.41 27.46 L 16.95 8.74 A 16 16 0 0 1 31.2 0 Z"
                fill="currentColor"
              />
            </svg>
            <span class="ik-header-tab__content">委托</span>
          </button>

          <button
            type="button"
            role="tab"
            class="ik-header-tab ik-header-tab--last"
            :class="{ 'is-active': activeTab === 'mine' }"
            :aria-selected="activeTab === 'mine'"
            @click="handleTabChange('mine')"
          >
            <svg class="ik-tab-highlight ik-tab-highlight--last" viewBox="0 0 110.7 42" aria-hidden="true">
              <path
                d="M 89.7 0 A 21 21 0 0 1 89.7 42 L 13.05 42 A 8 8 0 0 1 5.93 30.37 L 16.95 8.74 A 16 16 0 0 1 31.2 0 Z"
                fill="currentColor"
              />
            </svg>
            <span class="ik-header-tab__content">{{ mineTabText }}</span>
          </button>
        </div>
      </div>
    </div>
    <div class="ik-header__progress" :class="{ 'is-active': showProgress }">
      <div class="ik-header__progress-bar" :style="{ width: `${progressValue}%` }" />
    </div>
  </header>
</template>

<style scoped>
.ik-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: #000;
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

/* Auto-hide on mobile while scrolling down. Desktop ignores `.is-hidden`. */
@media (max-width: 768px) {
  .ik-header.is-hidden {
    transform: translateY(-100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-header {
    transition: none;
  }
}

.ik-header__progress {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 3px;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
}

.ik-header__progress.is-active {
  opacity: 1;
}

.ik-header__progress-bar {
  height: 100%;
  background: #fbfe00;
  box-shadow: 0 0 8px rgba(251, 254, 0, 0.6);
  transition: width 0.2s ease;
}

.ik-header__inner {
  min-height: 78px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 32px;
}

.ik-header__left {
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
}

.ik-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

/* 桌面端登录后左侧改用等级条+丁尼，隐藏品牌 Logo（移动端会再覆盖回显示） */
.ik-header.is-login .ik-brand {
  display: none;
}

.ik-brand__icon {
  width: 46px;
  height: 46px;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

.ik-brand__title {
  color: #fff;
  font-size: 24px;
  line-height: 1;
  letter-spacing: -0.9px;
  font-weight: 900;
}

.ik-header__middle {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

.ik-search-shell {
  position: relative;
  width: clamp(400px, 30vw, 540px);
  max-width: 100%;
  min-width: 240px;
  display: flex;
  align-items: center;
}

.ik-search-suggest {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  padding: 6px;
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  max-height: min(60vh, 480px);
  overflow-y: auto;
}

.ik-search-suggest__item {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  appearance: none;
}

.ik-search-suggest__item.is-active,
.ik-search-suggest__item:hover {
  background: rgba(215, 255, 0, 0.1);
}

.ik-search-suggest__title {
  color: #e8e8e8;
  font-size: 14px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.ik-search-suggest__excerpt {
  color: #8a8a8a;
  font-size: 12px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.ik-search-suggest__title :deep(mark),
.ik-search-suggest__excerpt :deep(mark) {
  background: transparent;
  color: #fbfe00;
  font-weight: 600;
}

.ik-search-suggest__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #6f6f6f;
  font-size: 12px;
  line-height: 1.3;
}

.ik-search-suggest__category {
  color: #9db500;
}

.ik-search-suggest__all {
  margin-top: 4px;
  padding: 8px 10px;
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0 0 8px 8px;
  background: transparent;
  color: #fbfe00;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
  appearance: none;
}

.ik-search-suggest__all:hover {
  background: rgba(215, 255, 0, 0.1);
}

.ik-suggest-enter-active,
.ik-suggest-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.ik-suggest-enter-from,
.ik-suggest-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.ik-header__right {
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  justify-content: flex-end;
  align-items: center;
}

/* 移动端「敲敲」入口：桌面端用 tabs，不显示此按钮 */
.ik-header__knock {
  display: none;
  position: relative;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #fbfe00;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}

.ik-header__knock-icon {
  width: 26px;
  height: 26px;
}

.ik-header__knock-badge {
  position: absolute;
  top: -2px;
  left: 100%;
  margin-left: -14px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #ff3838;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 0 0 2px #000;
  pointer-events: none;
  white-space: nowrap;
}

.ik-search-input {
  flex: 1;
  min-width: 0;
}

.ik-search-input :deep(.z-input) {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1e1e1e;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.ik-search-input :deep(.z-input::after) {
  display: none;
}

.ik-search-input :deep(.z-input.is-focused) {
  border-color: rgba(215, 255, 0, 0.55);
  box-shadow: 0 0 0 2px rgba(215, 255, 0, 0.12);
}

.ik-search-input :deep(.z-input__inner) {
  height: 44px;
  padding: 0 16px;
  color: #e0e0e0;
}

.ik-search-input :deep(.z-input__inner::placeholder) {
  color: #808080;
}

.ik-search-input :deep(.z-input__suffix) {
  display: flex;
  align-items: center;
  gap: 0;
  padding-right: 6px;
}

.ik-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #666;
  font-size: 14px;
  cursor: pointer;
  border-radius: 50%;
  transition: color 0.15s ease, background 0.15s ease;
}

.ik-search-clear:hover {
  color: #ccc;
  background: rgba(255, 255, 255, 0.06);
}

.ik-search-divider {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.12);
  margin: 0 4px;
  flex-shrink: 0;
}

.ik-search-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #a0a0a0;
  font-size: 18px;
  cursor: pointer;
  padding: 0;
  appearance: none;
  transition: color 0.15s ease, background 0.15s ease;
}

.ik-search-action:hover {
  background: rgba(215, 255, 0, 0.15);
  color: #fbfe00;
}

.ik-search-action:active {
  background: rgba(215, 255, 0, 0.25);
  color: #fbfe00;
}

.ik-header-tabs {
  position: relative;
  display: flex;
  overflow: visible;
  border: 3px solid #313131;
  border-radius: 999px;
  background: #050505 url("/images/tab-bg-point.webp") repeat;
  box-shadow: none;
}

.ik-header-tab {
  position: relative;
  z-index: 0;
  width: 100px;
  height: 42px;
  padding: 0;
  overflow: visible;
  border: 0;
  appearance: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-family: inherit;
  font-size: 18px;
  font-weight: 700;
  font-style: italic;
  line-height: 1;
  text-align: center;
  user-select: none;
  transition: color 140ms ease;
}

.ik-header-tab:focus-visible {
  outline: 2px solid rgba(215, 255, 0, 0.7);
  outline-offset: 4px;
}

.ik-header-tab:active {
  color: #b8b8b8;
}

.ik-header-tab.is-active {
  color: #000;
}

.ik-header-tab__content {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* 敲敲未读 badge：贴在 tab 文字右上角。
   - 用 .ik-header-tab__content 作为定位上下文（z-index:2，恒在 tab-highlight 之上）
   - is-active 时 tab 文字变黑、底色为亮黄；badge 保持红底白字以维持可读性
   - 双位数 / "99+" 时自动变成胶囊形（min-width + padding） */
.ik-header-tab__badge {
  position: absolute;
  top: -3px;
  left: 100%;
  margin-left: -6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #ff3838;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  font-style: normal;
  letter-spacing: 0;
  line-height: 1;
  box-shadow: 0 0 0 2px #000;
  pointer-events: none;
  white-space: nowrap;
}

.ik-tab-highlight {
  position: absolute;
  top: 0;
  z-index: 1;
  height: 42px;
  color: #fbfe00;
  opacity: 0;
  pointer-events: none;
  transform: scale(1.1);
  transform-origin: center;
}

.ik-tab-highlight--first {
  left: 0;
  width: 110.7px;
}

.ik-tab-highlight--middle {
  left: -10.7px;
  width: 121.4px;
}

.ik-tab-highlight--last {
  right: 0;
  width: 110.7px;
}

.ik-header-tab.is-active .ik-tab-highlight {
  opacity: 1;
  animation:
    ik-tab-highlight-color 800ms linear infinite alternate,
    ik-tab-highlight-scale 700ms linear infinite;
}

@keyframes ik-tab-highlight-color {
  from {
    color: #fbfe00;
  }

  to {
    color: #dcfe00;
  }
}

@keyframes ik-tab-highlight-scale {
  0% {
    transform: scale(1.1);
    animation-timing-function: cubic-bezier(0.55, 0.055, 0.675, 0.19);
  }

  50% {
    transform: scale(1.25);
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }

  100% {
    transform: scale(1.1);
  }
}

@media (max-width: 1180px) {
  .ik-brand__title {
    font-size: 20px;
  }

  .ik-search-shell {
    width: clamp(280px, 28vw, 420px);
  }
}

/* 中屏拥挤区间：tabs 与搜索框抢空间会重叠，参考 Flutter isCompact 策略
   直接隐藏 tabs，让搜索框占据中部，导航交由 MobileBottomNav。 */
@media (max-width: 1100px) {
  .ik-header__middle {
    flex: 1 1 0;
    min-width: 0;
  }

  .ik-search-shell {
    max-width: 100%;
  }

  .ik-header-tabs {
    display: none;
  }

  /* tabs 隐藏后显示「敲敲」按钮，置于搜索框右侧 */
  .ik-header__right {
    gap: 8px;
  }

  .ik-header__knock {
    display: inline-flex;
  }
}

@media (max-width: 768px) {
  .ik-header__inner {
    min-height: 66px;
    padding: 6px 16px;
    gap: 8px;
  }

  .ik-brand__icon {
    width: 38px;
    height: 38px;
  }

  .ik-brand__title {
    display: none;
  }

  /* 左右列收缩为内容宽度：左侧只剩 logo，右侧 tabs 已隐藏，
     让中部搜索框吃满整行，消除居中后右侧的大片留白 */
  .ik-header__left {
    flex: 0 0 auto;
  }

  .ik-header__right {
    flex: 0 0 auto;
  }

  .ik-header__middle {
    flex: 1 1 auto;
    justify-content: stretch;
  }

  .ik-search-shell {
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }

  /* 更圆润紧凑的移动端搜索框 */
  .ik-search-input :deep(.z-input) {
    border-radius: 999px;
    background: #161616;
  }

  .ik-search-input :deep(.z-input__inner) {
    height: 42px;
    padding: 0 6px 0 18px;
    font-size: 15px;
  }

  .ik-search-input :deep(.z-input__suffix) {
    padding-right: 5px;
  }

  /* 去掉分隔线，搜索按钮做成醒目的圆形主色按钮 */
  .ik-search-divider {
    display: none;
  }

  .ik-search-action {
    width: 34px;
    height: 34px;
    background: rgba(215, 255, 0, 0.14);
    color: #fbfe00;
    font-size: 17px;
  }

  .ik-search-clear {
    width: 26px;
    height: 26px;
  }

  /* 移动端隐藏等级显示 */
  .ik-level-display {
    display: none;
  }

  /* 移动端无论登录与否都显示品牌 Logo */
  .ik-header.is-login .ik-brand {
    display: inline-flex;
  }
}

/* 等级进度条样式 */
.ik-level-display {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 12px;
  background: linear-gradient(135deg, #212121 0%, #141414 50%, #181818 100%);
  border-radius: 9999px;
  cursor: pointer;
  transition: background 0.2s ease;
  user-select: none;
  height: 42px;
  box-sizing: border-box;
}

.ik-level-display:hover {
  background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 50%, #202020 100%);
}

.ik-level-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  margin-left: -7px;
}

.ik-level-middle {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ik-level-username {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.ik-level-progress-wrap {
  width: 140px;
}

.ik-level-progress-bg {
  position: relative;
  width: 100%;
  height: 16px;
  background: #222222;
  border-radius: 9999px;
  overflow: hidden;
}

.ik-level-progress-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, #4661fd 0%, #10bff0 100%);
  border-radius: 9999px;
  transition: width 0.3s ease;
}

.ik-level-progress-text {
  position: absolute;
  top: 50%;
  left: 8px;
  transform: translateY(-50%);
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  z-index: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.ik-level-right {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
}

.ik-level-number {
  font-size: 24px;
  font-weight: 800;
  color: #fff;
  line-height: 1;
}

.ik-level-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1;
}

/* 丁尼显示组件：复刻 z-button--default round 样式 */
.ik-header-denny {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px 0 8px; /* 左右对调：左侧由于硬币左溢出改收窄至 8px，右侧文字收边放宽至 12px */
  background-color: #000;
  
  /* chessboard 棋盘格纹理背景 */
  background-image: linear-gradient(45deg, rgba(255, 255, 255, 0.06) 25%, transparent 25% 75%, rgba(255, 255, 255, 0.06) 75%),
                    linear-gradient(45deg, rgba(255, 255, 255, 0.06) 25%, transparent 25% 75%, rgba(255, 255, 255, 0.06) 75%);
  background-position: 0 0, 3px 3px;
  background-size: 6px 6px;
  background-repeat: repeat;

  border: 1px solid #000;
  border-radius: 9999px; /* round 药丸圆角 */
  cursor: pointer;
  user-select: none;
  position: relative;
  margin-left: 12px;
  transition: transform 0.1s ease;
}

/* 三层内阴影叠边实现 3D 浮雕质感 */
.ik-header-denny::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 0 0 3px #333, inset 0 0 0 4px #000;
  transition: box-shadow 0.15s ease;
}

.ik-header-denny:hover::after {
  /* Hover 态亮起内框：使用项目标准荧光黄绿品牌色 */
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.4), inset 0 0 0 3px var(--ik-primary), inset 0 0 0 4px #000;
}

.ik-header-denny:active {
  transform: scale(0.96); /* 点击反馈 */
}

.ik-header-denny__content {
  font-family: "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-feature-settings: "tnum"; /* 开启 OpenType Tabular Numbers 特征，使非等宽字体强制以等宽数字排列，防止宽度抖动 */
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 14px;
  display: flex;
  align-items: center;
  z-index: 1; /* 置于边框阴影之上 */
}

.ik-header-denny__img {
  width: 38px;
  height: 38px;
  object-fit: contain;
  display: block;
  z-index: 1; /* 置于边框阴影之上 */
  margin-left: -4px; /* 向左打破边界，在左侧营造 3D 越界感 */
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45)); /* 溢出落影 */
}

/* 响应式断点隐藏 */
@media (max-width: 1100px) {
  .ik-level-display,
  .ik-header-denny {
    display: none;
  }
}
</style>
