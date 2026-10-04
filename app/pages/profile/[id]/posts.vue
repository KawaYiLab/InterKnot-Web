<script setup lang="ts">
import { useWindowSize } from "@vueuse/core";
import type { Post, Profile } from "~/types/entities";
import { useMessage } from "zenless-ui";
import { getCoverAspectRatio } from "~/utils/cover";
import { isNotFoundError, resolveErrorMessage } from "~/utils/api-error";
import {
  movePinned,
  pruneStalePinned,
  samePinned,
  togglePinned,
  type PinnedDraft,
} from "~/utils/pinned-selection";
import Sheet from "~/components/ui/sheet/Sheet.vue";
import SheetContent from "~/components/ui/sheet/SheetContent.vue";
import SheetDescription from "~/components/ui/sheet/SheetDescription.vue";
import SheetFooter from "~/components/ui/sheet/SheetFooter.vue";
import SheetHeader from "~/components/ui/sheet/SheetHeader.vue";
import SheetTitle from "~/components/ui/sheet/SheetTitle.vue";
import VirtualMasonry from "~/components/VirtualMasonry.vue";
import PostCard from "~/components/PostCard.vue";
import PostCardSkeleton from "~/components/PostCardSkeleton.vue";
import { generateSkeletons, estimateSkeletonHeight, type SkeletonItem } from "~/utils/skeleton";

const PAGE_SIZE = 20;
// 未自定义展示时，主页默认展示与本页同排序的前 6 篇（后端同为 updatedAt:desc）。
const DEFAULT_SHOWCASE_SIZE = 6;

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const postModal = usePostModal();
const message = useMessage();
const confirmDialog = useConfirmDialog();

const profileId = computed(() => String(route.params.id ?? ""));

const profile = ref<Profile | null>(null);
const list = shallowRef<Post[]>([]);
const total = ref<number | null>(null);
// undefined = 后端未返回（不显示标记）；null = 默认展示；string[] = 自定义展示
const pinnedIds = ref<string[] | null | undefined>(undefined);
const endCursor = ref("");
const hasNextPage = ref(true);
const loading = ref(true);
const loadingMore = ref(false);
const loadError = ref(false);
const seenIds = new Set<string>();
let requestVersion = 0;
let disposed = false;

const displayName = computed(() => profile.value?.name || profile.value?.login || "");
const heading = computed(() => (profile.value?.isSelf ? "我的全部委托" : `${displayName.value || "TA"} 的全部委托`));
const unavailableText = computed(() => {
  const p = profile.value;
  if (!p) return "";
  if (p.isHidden) return "该用户已隐藏个人资料";
  if (p.isBlockedByMe) return "你已拉黑该用户，内容不可见";
  if (p.hasBlockedMe) return "你已被该用户拉黑，内容不可见";
  return "";
});

const showcasedIds = computed<Set<string>>(() => {
  if (pinnedIds.value === undefined) return new Set();
  if (pinnedIds.value === null) {
    return new Set(list.value.slice(0, DEFAULT_SHOWCASE_SIZE).map((p) => p.id));
  }
  return new Set(pinnedIds.value);
});

// ── 展示委托编辑（仅本人）────────────────────────
// draft 为 null 表示默认展示；数组顺序即主页展示顺序。
const editing = ref(false);
const editLoading = ref(false);
const saving = ref(false);
const showcaseMax = ref(DEFAULT_SHOWCASE_SIZE);
const baseline = ref<PinnedDraft>(null);
const draft = ref<PinnedDraft>(null);
// 已选帖子可能还没滚动加载到列表里，已选栏用后端返回的卡片数据兜底。
const pinnedCards = shallowRef(new Map<string, { title: string; cover: string }>());

const draftCount = computed(() => (Array.isArray(draft.value) ? draft.value.length : 0));
const isFull = computed(() => Array.isArray(draft.value) && draft.value.length >= showcaseMax.value);
const isDirty = computed(() => !samePinned(baseline.value, draft.value));

const orderOf = (id: string): number => {
  if (!Array.isArray(draft.value)) return 0;
  return draft.value.indexOf(id) + 1;
};

const cardOf = (id: string) => {
  const post = list.value.find((p) => p.id === id);
  if (post) return { title: post.title, cover: post.cover || post.covers?.[0]?.url || "" };
  return pinnedCards.value.get(id) ?? null;
};

const slots = computed(() => {
  const ids = Array.isArray(draft.value) ? draft.value : [];
  return Array.from({ length: showcaseMax.value }, (_, index) => {
    const id = ids[index] ?? null;
    return { index, id, card: id ? cardOf(id) : null };
  });
});

// 选择在页面上进行（点卡片），核对顺序与保存在面板里进行；浮动胶囊连接两者。
const reviewOpen = ref(false);

async function startEditing() {
  if (editLoading.value || editing.value) return;
  editLoading.value = true;
  try {
    // 只需要当前配置与已选卡片，候选列表直接用本页已加载的委托。
    const result = await api.getPinnedArticles({ limit: 1 });
    const cards = new Map<string, { title: string; cover: string }>();
    for (const item of result.pinnedItems ?? []) {
      cards.set(item.documentId, { title: item.title, cover: item.cover?.url || "" });
    }
    pinnedCards.value = cards;
    showcaseMax.value = result.max || DEFAULT_SHOWCASE_SIZE;
    const known = result.pinnedItems ? new Set(cards.keys()) : undefined;
    // 已删除/撤回的已选帖子不再占名额，否则用户会被看不见的位置卡住。
    const base = pruneStalePinned(result.pinned, known);
    baseline.value = base;
    draft.value = base === null ? null : [...base];
    reviewOpen.value = false;
    editing.value = true;
  } catch (err) {
    message.error(resolveErrorMessage(err, "加载展示设置失败"));
  } finally {
    editLoading.value = false;
  }
}

const confirmDiscard = () => confirmDialog.open({
  title: "放弃调整",
  message: "展示顺序还没有保存，确定放弃吗？",
  confirmText: "放弃",
  danger: true,
});

async function cancelEditing() {
  if (saving.value) return;
  if (isDirty.value && !(await confirmDiscard())) return;
  reviewOpen.value = false;
  editing.value = false;
}

function toggleShowcase(id: string) {
  if (saving.value) return;
  const result = togglePinned(draft.value, id, showcaseMax.value);
  if (result.status === "full") {
    message.warning(`最多展示 ${showcaseMax.value} 篇，请先移除一篇`);
    return;
  }
  draft.value = result.draft;
}

function removeAt(index: number) {
  if (!Array.isArray(draft.value) || saving.value) return;
  draft.value = draft.value.filter((_, i) => i !== index);
}

function moveAt(index: number, delta: number) {
  if (!Array.isArray(draft.value) || saving.value) return;
  draft.value = movePinned(draft.value, index, delta);
}

function restoreDefault() {
  if (saving.value) return;
  draft.value = null;
}

async function saveShowcase() {
  if (saving.value || !isDirty.value) return;
  saving.value = true;
  try {
    const result = await api.updatePinnedArticles(draft.value);
    pinnedIds.value = result.pinned;
    baseline.value = result.pinned;
    draft.value = result.pinned === null ? null : [...result.pinned];
    reviewOpen.value = false;
    editing.value = false;
    message.success("主页展示已更新");
  } catch (err) {
    message.error(resolveErrorMessage(err, "保存失败"));
  } finally {
    saving.value = false;
  }
}

onBeforeRouteLeave(async () => {
  if (!editing.value || !isDirty.value) return true;
  return await confirmDiscard();
});

const skeletonItems = ref<SkeletonItem[]>(generateSkeletons(8));
const masonryKeyMapper = (item: Post) => item.id;
const skeletonKeyMapper = (item: SkeletonItem) => item.id;

const initialWidth = typeof window !== "undefined" ? window.innerWidth : 0;
const { width: viewportWidth } = useWindowSize({ initialWidth });
const feedGap = computed(() => (viewportWidth.value && viewportWidth.value <= 768 ? 14 : 32));
const sheetSide = computed(() => (viewportWidth.value && viewportWidth.value <= 768 ? "bottom" : "right"));

const profileTabLabel = useState<string | null>("profileTabLabel", () => null);

useSeoMeta({
  title: () => (displayName.value ? `${displayName.value}的全部委托 - 绳网` : "全部委托 - 绳网"),
  description: () => `查看 ${displayName.value || "用户"} 在绳网上发布的全部委托`,
});

function appendPosts(nodes: Post[]) {
  const added: Post[] = [];
  for (const post of nodes) {
    if (seenIds.has(post.id)) continue;
    seenIds.add(post.id);
    added.push(post);
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
  total.value = null;
  pinnedIds.value = undefined;
  editing.value = false;
  try {
    const p = await api.getProfile(profileId.value);
    if (disposed || version !== requestVersion) return;
    profile.value = p;
    profileTabLabel.value = p.isSelf ? null : (p.name || p.login || null);
    if (p.isHidden || p.isBlockedByMe || p.hasBlockedMe) {
      hasNextPage.value = false;
      return;
    }
    const page = await api.getProfileAllArticles(profileId.value, "", PAGE_SIZE);
    if (disposed || version !== requestVersion) return;
    appendPosts(page.nodes);
    endCursor.value = page.endCursor;
    hasNextPage.value = page.hasNextPage;
    total.value = typeof page.articleTotal === "number" ? page.articleTotal : null;
    pinnedIds.value = page.pinnedIds;
  } catch (err) {
    if (disposed || version !== requestVersion) return;
    if (isNotFoundError(err)) {
      showError({ statusCode: 404, message: "用户不存在" });
      return;
    }
    loadError.value = true;
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
    const page = await api.getProfileAllArticles(profileId.value, cursor, PAGE_SIZE);
    if (disposed || version !== requestVersion) return;
    // 防止异常分页元数据让可见哨兵反复请求同一页。
    if (page.hasNextPage && (!page.endCursor || page.endCursor === cursor)) {
      throw new Error("Profile pagination did not advance");
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
  profileTabLabel.value = null;
});

watch([profileId, () => auth.generation], () => {
  void loadFirstPage();
}, { flush: "sync" });
watch(api.readStatusRevision, () => {
  list.value = api.mergeReadStatus(list.value);
});
</script>

<template>
  <section class="ik-all-page" :class="{ 'ik-all-page--owner': profile?.isSelf }">
    <header class="ik-all-header">
      <div class="ik-all-header__main">
        <h1 class="ik-all-title">
          {{ heading }}
          <span v-if="total !== null" class="ik-all-count">({{ total }})</span>
        </h1>
        <!-- 编辑时只隐藏不移除：按钮比标题高，移除会让标题栏变矮、整页上跳 -->
        <z-button
          v-if="profile?.isSelf && list.length"
          class="ik-all-edit-btn"
          :class="{ 'ik-all-edit-btn--hidden': editing }"
          :aria-hidden="editing || undefined"
          :disabled="editLoading || editing"
          @click="startEditing"
        >{{ editLoading ? "加载中..." : "展示委托" }}</z-button>
      </div>
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

      <div v-else-if="unavailableText" class="ik-empty">{{ unavailableText }}</div>

      <div v-else-if="loadError && !list.length" class="ik-empty" role="alert">
        加载失败，请稍后重试
        <button type="button" class="ik-all-retry" @click="loadFirstPage">重试</button>
      </div>

      <div v-else-if="!list.length && !hasNextPage" class="ik-empty">还没有发布任何内容哦</div>

      <div v-else class="ik-list-state">
        <VirtualMasonry
          class="ik-masonry"
          :items="list"
          :column-width="240"
          :gap="feedGap"
          :min-columns="2"
          :max-columns="5"
          :estimated-height="300"
          :key-mapper="masonryKeyMapper"
        >
          <template #default="{ item, index, columnCount }">
            <div class="ik-all-card" :class="{ 'ik-all-card--showcased': !editing && showcasedIds.has(item.id) }">
              <PostCard
                :post="item"
                :eager="index < columnCount * 2"
                @open="goPost"
              />
              <Transition name="ik-fade">
                <span
                  v-if="!editing && showcasedIds.has(item.id)"
                  class="ik-all-card__badge"
                  :class="{ 'ik-all-card__badge--below-solved': !!item.solvedAt }"
                >展示中</span>
              </Transition>
              <!-- 调整展示时盖在卡片上：点击即按顺序选入/移出，不再打开委托 -->
              <Transition name="ik-fade">
                <button
                  v-if="editing"
                  type="button"
                  class="ik-all-card__picker"
                  :class="{
                    'ik-all-card__picker--active': orderOf(item.id) > 0,
                    'ik-all-card__picker--locked': isFull && orderOf(item.id) === 0,
                  }"
                  :aria-pressed="orderOf(item.id) > 0"
                  :aria-label="orderOf(item.id) > 0 ? `取消展示：${item.title}` : `加入展示：${item.title}`"
                  @click="toggleShowcase(item.id)"
                >
                  <span v-if="orderOf(item.id) > 0" class="ik-all-card__order">{{ orderOf(item.id) }}</span>
                </button>
              </Transition>
            </div>
          </template>
        </VirtualMasonry>

        <div ref="loadMoreSentinelRef" class="ik-load-more-sentinel">
          <button v-if="loadError" type="button" class="ik-all-retry" @click="loadMore">加载失败，点击重试</button>
          <div v-else-if="loadingMore || !hasNextPage" class="ik-scroll-footer">
            <img v-if="loadingMore" class="ik-scroll-gif" src="/images/Bangboo.gif" alt="加载中" />
            <span v-else class="ik-meta">已经到底啦 [ O_X ] /</span>
          </div>
        </div>
      </div>
    </ClientOnly>

    <!-- 编辑时的浮动胶囊：只占一行，选择过程中不挡列表；点「完成」进入面板核对顺序并保存 -->
    <Transition name="ik-pill">
    <div v-if="editing" class="ik-pill-wrap">
      <div class="ik-pill" role="toolbar" aria-label="展示委托">
        <button type="button" class="ik-pill__exit" aria-label="退出编辑" :disabled="saving" @click="cancelEditing">×</button>
        <div class="ik-pill__thumbs" aria-hidden="true">
          <span
            v-for="slot in slots"
            :key="slot.id ?? `empty-${slot.index}`"
            class="ik-pill__thumb"
            :class="{ 'ik-pill__thumb--empty': !slot.id }"
          >
            <img v-if="slot.id" :src="slot.card?.cover || '/images/default-cover.webp'" alt="" />
          </span>
        </div>
        <div class="ik-pill__text">
          <strong v-if="Array.isArray(draft)">已选 {{ draftCount }}/{{ showcaseMax }}</strong>
          <strong v-else>默认展示</strong>
        </div>
        <button type="button" class="ik-pill__done" :disabled="saving" @click="reviewOpen = true">完成</button>
      </div>
    </div>
    </Transition>

    <Sheet v-model:open="reviewOpen">
      <SheetContent :side="sheetSide">
        <SheetHeader>
          <SheetTitle>
            主页展示
            <span v-if="Array.isArray(draft)" class="ik-review__count">{{ draftCount }}/{{ showcaseMax }}</span>
          </SheetTitle>
        </SheetHeader>

        <div class="ik-review__body">
          <div v-if="!Array.isArray(draft)" class="ik-review__notice">
            正在展示你最新的 {{ showcaseMax }} 篇委托。
            点「继续选择」后即可自定义展示委托。
          </div>
          <ol v-else class="ik-review__list">
            <li
              v-for="slot in slots"
              :key="slot.id ?? `empty-${slot.index}`"
              class="ik-review__row"
              :class="{ 'ik-review__row--empty': !slot.id }"
            >
              <span class="ik-review__order">{{ slot.index + 1 }}</span>
              <template v-if="slot.id">
                <img
                  class="ik-review__thumb"
                  :src="slot.card?.cover || '/images/default-cover.webp'"
                  alt=""
                  @error="($event.target as HTMLImageElement).src = '/images/default-cover.webp'"
                />
                <span class="ik-review__title">{{ slot.card?.title || "（无标题）" }}</span>
                <div class="ik-review__actions">
                  <button
                    type="button"
                    aria-label="上移"
                    :disabled="saving || slot.index === 0"
                    @click="moveAt(slot.index, -1)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                  </button>
                  <button
                    type="button"
                    aria-label="下移"
                    :disabled="saving || slot.index >= draftCount - 1"
                    @click="moveAt(slot.index, 1)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  <button
                    type="button"
                    class="ik-review__remove"
                    aria-label="移除"
                    :disabled="saving"
                    @click="removeAt(slot.index)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              </template>
              <span v-else class="ik-review__placeholder">空位</span>
            </li>
          </ol>
        </div>

        <SheetFooter>
          <button
            v-if="Array.isArray(draft)"
            type="button"
            class="ik-review__link"
            :disabled="saving"
            @click="restoreDefault"
          >恢复默认</button>
          <z-button :disabled="saving" @click="reviewOpen = false">继续选择</z-button>
          <z-button
            :disabled="saving || !isDirty"
            :icon="isDirty ? { success: '#00cc0d' } : 'success'"
            @click="saveShowcase"
          >{{ saving ? "保存中..." : "保存" }}</z-button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </section>
</template>

<style scoped>
/* 与首页 / 标签页的容器宽度对齐，保证瀑布流列宽一致。 */
.ik-all-page {
  width: min(1600px, calc(100% - 40px));
  margin: 0 auto;
  padding-top: 24px;
  padding-bottom: 48px;
}

.ik-all-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 4px 16px;
  border-bottom: 1px solid #1f1f1f;
  margin-bottom: 16px;
}

.ik-all-header__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.ik-all-title {
  font-size: 22px;
  font-weight: 900;
  color: #f0f0f0;
  letter-spacing: 0.4px;
  margin: 0;
  overflow-wrap: anywhere;
}

.ik-all-count {
  margin-left: 4px;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.55);
}

.ik-all-card {
  position: relative;
}

/* 与 PostCard 的「已采纳」（.ik-card__solved）同款；两者同在右上角，已采纳时下移一行。 */
.ik-all-card__badge {
  position: absolute;
  top: 11px;
  right: 12px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: #16a34a;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
.ik-all-card__badge--below-solved {
  top: 41px;
}

/* 进出编辑态时卡片遮罩与「展示中」标识淡入淡出，时长与 Sheet 遮罩一致（入 200ms / 出 160ms）。
   选择器加上 .ik-all-card 提高优先级，覆盖 picker 自身的 hover 过渡声明。 */
.ik-all-card .ik-fade-enter-active {
  transition: opacity 200ms ease-out;
}
.ik-all-card .ik-fade-leave-active {
  transition: opacity 160ms ease-in;
}
.ik-all-card .ik-fade-enter-from,
.ik-all-card .ik-fade-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .ik-all-card .ik-fade-enter-active,
  .ik-all-card .ik-fade-leave-active {
    transition: none;
  }
}

/* ── 调整展示：卡片选择层 ─────────────────────── */
.ik-all-card__picker {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  /* 与 PostCard 悬停框同理：盖满外框并向内多压 1px，否则会露出一圈暗线。 */
  border: calc(var(--ik-post-card-padding, 4px) + 1px) solid transparent;
  border-radius: var(--ik-post-card-radius);
  background: rgba(0, 0, 0, 0.25);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}
.ik-all-card__picker:hover {
  border-color: rgba(251, 254, 0, 0.6);
  background: rgba(0, 0, 0, 0.1);
}
.ik-all-card__picker--active,
.ik-all-card__picker--active:hover {
  border-color: #fbfe00;
  background: rgba(251, 254, 0, 0.08);
}
/* 选满后未选卡片变暗，仍可点击以获得提示。 */
.ik-all-card__picker--locked,
.ik-all-card__picker--locked:hover {
  border-color: transparent;
  background: rgba(0, 0, 0, 0.6);
}
.ik-all-card__order {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #fbfe00;
  color: #000;
  font-size: 26px;
  font-weight: 900;
  line-height: 52px;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
}

/* ── 展示委托：浮动胶囊 ───────────────────────── */
/* 本人页面常驻给胶囊留出的底部空间：若只在编辑时加，滚到底部再退出会因内容变短而下跳。 */
.ik-all-page--owner {
  padding-bottom: 120px;
}
.ik-all-edit-btn--hidden {
  visibility: hidden;
}
.ik-pill-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 24px;
  z-index: 40;
  display: flex;
  justify-content: center;
  padding: 0 12px;
  pointer-events: none;
}
.ik-pill {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  padding: 8px 8px 8px 10px;
  border: 2px solid #2d2c2d;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.92);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  pointer-events: auto;
}
.ik-pill-enter-active .ik-pill {
  transition: opacity 240ms cubic-bezier(0.22, 1, 0.36, 1), transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ik-pill-leave-active .ik-pill {
  transition: opacity 180ms ease-in, transform 180ms ease-in;
}
/* Transition 以外层 wrap 的 transitionend 为准，wrap 本身不动画，需给它同样时长 */
.ik-pill-enter-active {
  transition: opacity 240ms;
}
.ik-pill-leave-active {
  transition: opacity 180ms;
}
.ik-pill-enter-from .ik-pill,
.ik-pill-leave-to .ik-pill {
  opacity: 0;
  transform: translateY(16px);
}
@media (prefers-reduced-motion: reduce) {
  .ik-pill-enter-active .ik-pill,
  .ik-pill-leave-active .ik-pill {
    transition: none;
  }
}
.ik-pill__exit {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #1f1f1f;
  color: rgba(255, 255, 255, 0.8);
  font-size: 18px;
  line-height: 32px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.ik-pill__exit:hover:not(:disabled) {
  background: #c01c00;
  color: #fff;
}
.ik-pill__thumbs {
  display: flex;
  gap: 4px;
}
.ik-pill__thumb {
  width: 34px;
  height: 22px;
  overflow: hidden;
  border-radius: 5px;
}
.ik-pill__thumb--empty {
  box-sizing: border-box;
  border: 1.5px dashed #3a3a3a;
}
.ik-pill__thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ik-pill__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}
.ik-pill__text strong {
  color: #fff;
  font-size: 14px;
  white-space: nowrap;
}
.ik-pill__done {
  flex-shrink: 0;
  height: 36px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  background: #fbfe00;
  color: #000;
  font: inherit;
  font-size: 14px;
  font-weight: 900;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.15s ease;
}
.ik-pill__done:hover:not(:disabled) {
  box-shadow: 0 0 12px rgba(251, 254, 0, 0.45);
}
.ik-pill__done:active:not(:disabled) {
  transform: scale(0.96);
}
.ik-pill__exit:disabled,
.ik-pill__done:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ── 展示委托：核对面板（Sheet 内容） ─────────── */
.ik-review__count {
  margin-left: 6px;
  color: #fbfe00;
  font-size: 15px;
}
.ik-review__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 20px;
}
.ik-review__notice {
  padding: 14px 16px;
  border-radius: 14px;
  background: #1a1a1a;
  color: rgba(255, 255, 255, 0.75);
  font-size: 13px;
  line-height: 1.6;
}
.ik-review__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ik-review__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 60px;
  padding: 8px 10px;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  background: #1a1a1a;
}
.ik-review__row--empty {
  border-style: dashed;
  background: transparent;
}
.ik-review__order {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #fbfe00;
  color: #000;
  font-size: 13px;
  font-weight: 900;
  line-height: 24px;
  text-align: center;
}
.ik-review__row--empty .ik-review__order {
  background: #262626;
  color: rgba(255, 255, 255, 0.4);
}
.ik-review__thumb {
  flex-shrink: 0;
  width: 72px;
  height: 42px;
  border-radius: 6px;
  object-fit: cover;
  background: #0f0f0f;
}
.ik-review__title {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  overflow: hidden;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.ik-review__placeholder {
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
}
.ik-review__actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}
.ik-review__actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: #262626;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.ik-review__actions svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ik-review__actions button:hover:not(:disabled) {
  background: #fbfe00;
  color: #000;
}
.ik-review__actions .ik-review__remove:hover:not(:disabled) {
  background: #c01c00;
  color: #fff;
}
.ik-review__actions button:disabled {
  opacity: 0.3;
  cursor: default;
}
.ik-review__link {
  margin-right: auto;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.ik-review__link:hover:not(:disabled) {
  color: #ff6b57;
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

.ik-all-retry {
  margin: 0 12px;
  border: 0;
  background: transparent;
  color: var(--ik-primary, #bfff09);
  cursor: pointer;
  font: inherit;
}

@media (max-width: 1400px) {
  .ik-all-page {
    width: calc(100% - 32px);
  }
}

/* 与 MobileBottomNav 的显示断点一致：胶囊浮在底部导航之上。 */
@media (max-width: 1100px) {
  .ik-pill-wrap {
    bottom: calc(58px + env(safe-area-inset-bottom, 0px) + 12px);
  }
  .ik-all-page--owner {
    padding-bottom: 150px;
  }
}

@media (max-width: 768px) {
  .ik-all-page {
    width: calc(100% - 28px);
    padding-top: 16px;
  }
  .ik-all-title {
    font-size: 18px;
  }
  /* 窄屏只留进度文字，缩略图由面板展示。 */
  .ik-pill__thumbs {
    display: none;
  }
  .ik-all-card__order {
    width: 40px;
    height: 40px;
    font-size: 20px;
    line-height: 40px;
  }
}
</style>
