<script setup lang="ts">
const auth = useAuthStore();
const router = useRouter();
const discussionModal = useDiscussionModal();

if (import.meta.client) {
  auth.hydrateFromStorage();

  // 背景图跟随鼠标轻微晃动
  const handleMouseMove = (e: MouseEvent) => {
    const x = (e.clientX / window.innerWidth - 0.5) * 30;
    const y = (e.clientY / window.innerHeight - 0.5) * 30;
    document.documentElement.style.setProperty('--bg-x', `${x}px`);
    document.documentElement.style.setProperty('--bg-y', `${y}px`);
  };
  window.addEventListener('mousemove', handleMouseMove);

  // 弱网优化：空闲时预取帖子弹窗 chunk，避免用户点击后还要下载组件 JS。
  const prefetchDiscussionOverlay = () => {
    void import("~/components/DiscussionOverlay.vue");
  };
  type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  };
  const ric = (window as IdleWindow).requestIdleCallback;
  if (typeof ric === "function") {
    ric(prefetchDiscussionOverlay, { timeout: 3000 });
  } else {
    setTimeout(prefetchDiscussionOverlay, 1500);
  }

  const url = new URL(window.location.href);
  const fallbackPath = url.searchParams.get("p");
  if (fallbackPath) {
    url.searchParams.delete("p");
    window.history.replaceState({}, "", url.toString());
    router.replace(decodeURIComponent(fallbackPath)).catch(() => undefined);
  }

  // 监听浏览器后退/前进：如果弹窗打开，关闭它
  window.addEventListener("popstate", discussionModal.handlePopState);

  // 当发生真实路由导航时（例如点击 Header 链接），关闭弹窗
  router.beforeEach(() => {
    if (discussionModal.isOpen.value) {
      discussionModal.teardown();
    }
  });
}

const handleOverlayClose = () => {
  discussionModal.close();
};

// create 页有自带的移动端底部操作栏（发布 / 草稿），全局 MobileBottomNav 在此隐藏避免堆叠
const route = useRoute();
const showMobileBottomNav = computed(() => !route.path.startsWith("/create"));
</script>

<template>
  <div>
    <AppHeader />
    <main class="ik-page">
      <NuxtPage />
    </main>
    <MobileBottomNav v-if="showMobileBottomNav" />

    <!-- 登录弹窗 -->
    <ClientOnly>
      <LazyLoginDialog />
    </ClientOnly>

    <!-- 确认弹窗 -->
    <ClientOnly>
      <LazyConfirmDialog />
    </ClientOnly>

    <!-- 敲敲弹窗（消息通知 / 私聊 / 群聊入口） -->
    <ClientOnly>
      <LazyKnockKnockModal />
    </ClientOnly>

    <!-- 帖子详情弹窗（从首页点击卡片时弹出） -->
    <ClientOnly>
      <Teleport to="body">
        <Transition name="ik-overlay" appear @after-leave="discussionModal.clearAfterLeave()">
          <LazyDiscussionOverlay
            v-if="discussionModal.isOpen.value"
            :discussion-id="discussionModal.discussionId.value || ''"
            :cover-hint="discussionModal.coverHint.value"
            :preview="discussionModal.preview.value"
            @close="handleOverlayClose"
          />
        </Transition>
      </Teleport>
    </ClientOnly>
  </div>
</template>
