<script setup lang="ts">
import PostOverlay from "~/components/PostOverlay.vue";
import GlobalMarqueeCanvas from "~/components/GlobalMarqueeCanvas.vue";
import { defineComponent, h, type Component, type Ref } from "vue";
import { isNavigationFailure, NavigationFailureType } from "vue-router";
import { overlayHistoryState } from "~/utils/overlay-history";
import { isSyncingModalBackground, registerKnockModalPopState, registerPostModalPopState } from "~/utils/post-modal-history";
import { onHistoryBranchDiscarded, trackHistoryBranches } from "~/utils/history-branches";

const auth = useAuthStore();
const router = useRouter();
const postModal = usePostModal();
const knockModal = useKnockKnockModal();
const loginDialog = useLoginDialog();
const benefitsModal = useBenefitsModal();
const checkInReminder = useCheckInReminder();
const gpuAccelerated = useGpuAccelerated();

// KeepAlive 的公开 include 按组件名回收；每条历史用独立名字，保留可达条目的实例。
const postEntryComponents = new Map<string, Component>();
const postEntryName = (key: string) => `PostOverlayEntry_${key}`;
const cachedPostEntryNames = computed(() => postModal.cachedEntryKeys.value.map(postEntryName));
watch(postModal.cachedEntryKeys, (keys) => {
  const retained = new Set(keys);
  for (const key of postEntryComponents.keys()) {
    if (!retained.has(key)) postEntryComponents.delete(key);
  }
}, { flush: "sync" });
const activePostEntryComponent = computed(() => {
  const key = postModal.entryKey.value;
  if (!key) return null;
  let component = postEntryComponents.get(key);
  if (!component) {
    component = defineComponent({
      name: postEntryName(key),
      inheritAttrs: false,
      props: {
        postId: { type: String, required: true },
        entryKey: { type: String, required: true },
      },
      setup: (props, { attrs }) => () => h(PostOverlay, { ...attrs, ...props }),
    });
    postEntryComponents.set(key, component);
  }
  return component;
});

if (import.meta.client) {
  const stopTrackingHistoryBranches = trackHistoryBranches(router.options.history);
  const stopDiscardingPostEntries = onHistoryBranchDiscarded(postModal.discardForwardEntries);
  auth.hydrateFromStorage();

  // 初始化账号缓存清理；安全信息、绑定和黑名单由账号页按需加载。
  useAccountData();

  // 检测到软件渲染（未启用 GPU 加速）时，提前给 html 加标记，
  // CSS 据此关闭全局跑马灯，避免 CPU 路径下全屏重绘造成滚动卡顿。
  if (!gpuAccelerated.value) {
    document.documentElement.classList.add("no-gpu");
  }

  const url = new URL(window.location.href);
  const fallbackPath = url.searchParams.get("p");
  if (fallbackPath) {
    url.searchParams.delete("p");
    window.history.replaceState(overlayHistoryState({}), "", url.toString());
    router.replace(decodeURIComponent(fallbackPath)).catch(() => undefined);
  }

  // 后端返回 EXAM_REQUIRED（未通过入站考试）时引导去考试页
  let lastExamRedirectAt = 0;
  window.addEventListener("exam:required", () => {
    const now = Date.now();
    if (now - lastExamRedirectAt < 3000) return;
    lastExamRedirectAt = now;
    if (router.currentRoute.value.path !== "/exam") {
      router.push("/exam").catch(() => undefined);
    }
  });

  const removePostHistoryHandler = registerPostModalPopState(postModal.handlePopState);
  const removeKnockHistoryHandler = registerKnockModalPopState(knockModal.handlePopState);

  // 真正的路由导航（包括 query 变化）退出浮层；浮层自己的 Back/Forward 不走这里。
  const removeRouteGuard = router.beforeResolve(() => {
    if (postModal.isOpen.value) postModal.teardown();
    if (knockModal.visible.value) knockModal.teardown();
  });
  // 浮层里的链接也可能指向背景页；这仍是一次页面访问，并应能后退回浮层。
  const removeDuplicateNavigationHandler = router.afterEach((to, _from, failure) => {
    if (!isSyncingModalBackground() && isNavigationFailure(failure, NavigationFailureType.duplicated) &&
        (postModal.isOpen.value || knockModal.visible.value)) {
      void router.push({ path: to.path, query: to.query, hash: to.hash, force: true });
    }
  });
  onBeforeUnmount(() => {
    stopTrackingHistoryBranches();
    stopDiscardingPostEntries();
    removePostHistoryHandler();
    removeKnockHistoryHandler();
    removeRouteGuard?.();
    removeDuplicateNavigationHandler();
  });
}

// 页面可见性及窗口失焦检测，通过生命周期钩子管理以确保健壮性，防止 HMR 热更新导致内存泄漏
let handleVisibilityAndFocus: (() => void) | null = null;

onMounted(() => {
  if (import.meta.client) {
    handleVisibilityAndFocus = () => {
      const isFocused = document.visibilityState === "visible" && document.hasFocus();
      if (isFocused) {
        document.body.classList.remove("is-page-blurred");
      } else {
        document.body.classList.add("is-page-blurred");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityAndFocus);
    window.addEventListener("focus", handleVisibilityAndFocus);
    window.addEventListener("blur", handleVisibilityAndFocus);

    // 页面挂载时初始化状态
    handleVisibilityAndFocus();
  }
});

onBeforeUnmount(() => {
  if (import.meta.client && handleVisibilityAndFocus) {
    document.removeEventListener("visibilitychange", handleVisibilityAndFocus);
    window.removeEventListener("focus", handleVisibilityAndFocus);
    window.removeEventListener("blur", handleVisibilityAndFocus);
    document.body.classList.remove("is-page-blurred");
  }
});

// 登录 / 敲敲弹窗首次打开时才挂载：它们的 chunk（含 qrcode、markdown、DOMPurify）
// 不必在首屏下载执行、和委托列表抢带宽。挂载后保留，以便关闭时播放离场动画。
const mountOnceVisible = (visible: Ref<boolean>) => {
  const mounted = ref(visible.value);
  if (!mounted.value) {
    const stop = watch(visible, (v) => {
      if (!v) return;
      mounted.value = true;
      stop();
    });
  }
  return mounted;
};
const loginDialogMounted = mountOnceVisible(loginDialog.visible);
const knockModalMounted = mountOnceVisible(knockModal.visible);

const handleOverlayClose = () => {
  postModal.close();
};

// create 页有自带的移动端底部操作栏（发布 / 草稿），全局 MobileBottomNav 在此隐藏避免堆叠
const route = useRoute();
const showMobileBottomNav = computed(
  () => !route.path.startsWith("/create") && !route.path.startsWith("/post/"),
);

// canonical / og:url 只取路径，去掉查询参数与 hash，避免同一页面被当成多个地址收录。
const canonicalUrl = computed(() => absoluteSiteUrl(route.path));
useHead({ link: [{ rel: "canonical", href: canonicalUrl }] });
useSeoMeta({ ogUrl: canonicalUrl });

// 全屏弹窗（委托 / 敲敲）打开时，全局背景跑马灯被完全遮住但仍在动，且处于
// 弹窗 backdrop-filter 模糊之后 → 迫使模糊每帧重算。此时暂停它（弹窗自带的
// 那份跑马灯照常显示），缓解「点开弹窗卡顿」。
const overlayOpen = computed(
  () =>
    postModal.isOpen.value ||
    knockModal.visible.value ||
    benefitsModal.visible.value ||
    checkInReminder.visible.value,
);
</script>

<template>
  <div :inert="postModal.isOpen.value || undefined">
    <GlobalMarqueeCanvas v-if="gpuAccelerated" class="ik-global-marquee" :paused="overlayOpen" />
    <!-- backdrop-filter 合成层预热：1×1 不可见元素，让 GPU 在首屏就把
         模糊着色器编译好、合成层分配好。否则用户第一次打开弹窗再关闭时，
         合成层首次创建/销毁会多吃 1~3 帧 paint，表现为出场动画期间弹窗
         背后闪烁一下。常驻显存代价 ≈ 4 字节，可忽略。 -->
    <ClientOnly>
      <div aria-hidden="true" class="ik-backdrop-warmup"></div>
    </ClientOnly>

    <AppHeader />
    <SiteBanner />
    <main class="ik-page" tabindex="-1">
      <NuxtPage />
    </main>
    <MobileBottomNav v-if="showMobileBottomNav" />

    <!-- 登录弹窗 -->
    <ClientOnly>
      <LazyLoginDialog v-if="loginDialogMounted" />
    </ClientOnly>

    <!-- 确认弹窗 -->
    <ClientOnly>
      <LazyConfirmDialog />
    </ClientOnly>

    <!-- 创作权益弹窗 -->
    <ClientOnly>
      <Teleport to="body">
        <Transition name="ik-overlay" appear>
          <LazyBenefitsModal v-if="benefitsModal.visible.value" />
        </Transition>
      </Teleport>
    </ClientOnly>

    <!-- 登录后的今日签到提醒（触发闸门在 plugins/check-in-reminder.client.ts） -->
    <ClientOnly>
      <Teleport to="body">
        <Transition name="ik-overlay" appear>
          <LazyCheckInReminderModal v-if="checkInReminder.visible.value" />
        </Transition>
      </Teleport>
    </ClientOnly>

    <!-- 举报弹窗 -->
    <ClientOnly>
      <LazyReportModal />
    </ClientOnly>

    <!-- 敲敲弹窗（消息通知 / 私聊 / 群聊入口） -->
    <ClientOnly>
      <LazyKnockKnockModal v-if="knockModalMounted" />
    </ClientOnly>

    <!-- 委托详情弹窗（从首页点击卡片时弹出）
         注：必须用同步组件而非 LazyPostOverlay。<Transition> 包异步组件时，
         弱网下 chunk 加载延迟会让 enter 动画错过首帧 → 用户感知为闪烁。 -->
    <ClientOnly>
      <Teleport to="body">
        <Transition
          name="ik-overlay"
          :css="!postModal.switching.value"
          appear
          @after-enter="postModal.markEntered()"
          @after-leave="postModal.clearAfterLeave()"
        >
          <KeepAlive :include="cachedPostEntryNames">
            <component
              :is="activePostEntryComponent"
              v-if="postModal.isOpen.value"
              :key="postModal.entryKey.value || ''"
              :entry-key="postModal.entryKey.value || ''"
              :post-id="postModal.postId.value || ''"
              :cover-hint="postModal.coverHint.value"
              :preview="postModal.preview.value"
              :target-comment-id="postModal.targetCommentId.value"
              @close="handleOverlayClose"
            />
          </KeepAlive>
        </Transition>
      </Teleport>
    </ClientOnly>
  </div>
</template>

<style scoped>
/* backdrop-filter 合成层预热元素：
   - 必须真的有非零尺寸，否则浏览器会跳过合成层分配
   - 必须真的应用 backdrop-filter，触发着色器编译
   - opacity:0 + pointer-events:none 让用户感知不到 */
.ik-backdrop-warmup {
  position: fixed;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
  opacity: 0;
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  /* 永久性 will-change 让浏览器把这个层一直保留在 GPU 上，
     与委托弹窗共用 backdrop-filter 着色器管线 */
  will-change: backdrop-filter;
  contain: strict;
  z-index: -1;
}

/* 全局背景跑马灯：固定定位覆盖整个视口 */
.ik-global-marquee {
  position: fixed !important;
  inset: 0;
  z-index: -9999 !important;
}

</style>
