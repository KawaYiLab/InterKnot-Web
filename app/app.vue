<script setup lang="ts">
const auth = useAuthStore();
const router = useRouter();
const discussionModal = useDiscussionModal();
const knockModal = useKnockKnockModal();

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

  const url = new URL(window.location.href);
  const fallbackPath = url.searchParams.get("p");
  if (fallbackPath) {
    url.searchParams.delete("p");
    window.history.replaceState({}, "", url.toString());
    router.replace(decodeURIComponent(fallbackPath)).catch(() => undefined);
  }

  // 监听浏览器后退/前进：如果弹窗打开，关闭它
  window.addEventListener("popstate", discussionModal.handlePopState);
  window.addEventListener("popstate", knockModal.handlePopState);

  // 当发生真实路由导航时（例如点击 Header 链接），关闭弹窗
  router.beforeEach(() => {
    if (discussionModal.isOpen.value) {
      discussionModal.teardown();
    }
    if (knockModal.visible.value) {
      knockModal.teardown();
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
    <!-- backdrop-filter 合成层预热：1×1 不可见元素，让 GPU 在首屏就把
         模糊着色器编译好、合成层分配好。否则用户第一次打开弹窗再关闭时，
         合成层首次创建/销毁会多吃 1~3 帧 paint，表现为出场动画期间弹窗
         背后闪烁一下。常驻显存代价 ≈ 4 字节，可忽略。 -->
    <ClientOnly>
      <div aria-hidden="true" class="ik-backdrop-warmup"></div>
    </ClientOnly>

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

    <!-- 帖子详情弹窗（从首页点击卡片时弹出）
         注：必须用同步组件而非 LazyDiscussionOverlay。<Transition> 包异步组件时，
         弱网下 chunk 加载延迟会让 enter 动画错过首帧 → 用户感知为闪烁。 -->
    <ClientOnly>
      <Teleport to="body">
        <Transition name="ik-overlay" appear @after-leave="discussionModal.clearAfterLeave()">
          <DiscussionOverlay
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
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  /* 永久性 will-change 让浏览器把这个层一直保留在 GPU 上，
     与帖子弹窗共用 backdrop-filter 着色器管线 */
  will-change: backdrop-filter;
  contain: strict;
  z-index: -1;
}
</style>
