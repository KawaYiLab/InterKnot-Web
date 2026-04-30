<script setup lang="ts">
const auth = useAuthStore();
const router = useRouter();
const discussionModal = useDiscussionModal();

if (import.meta.client) {
  auth.hydrateFromStorage();

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
</script>

<template>
  <div>
    <AppHeader />
    <main class="ik-page">
      <NuxtPage />
    </main>
    <MobileBottomNav />

    <!-- 登录弹窗 -->
    <ClientOnly>
      <LoginDialog />
    </ClientOnly>

    <!-- 确认弹窗 -->
    <ClientOnly>
      <ConfirmDialog />
    </ClientOnly>

    <!-- 帖子详情弹窗（从首页点击卡片时弹出） -->
    <ClientOnly>
      <Teleport to="body">
        <Transition name="ik-overlay" appear @after-leave="discussionModal.clearAfterLeave()">
          <DiscussionOverlay
            v-if="discussionModal.isOpen.value"
            :discussion-id="discussionModal.discussionId.value || ''"
            @close="handleOverlayClose"
          />
        </Transition>
      </Teleport>
    </ClientOnly>
  </div>
</template>
