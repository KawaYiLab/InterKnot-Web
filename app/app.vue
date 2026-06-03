<script setup lang="ts">
import PostOverlay from "~/components/PostOverlay.vue";
import { OVERLAY_KNOCK_KEY, OVERLAY_POST_KEY } from "~/utils/overlay-history";

const auth = useAuthStore();
const router = useRouter();
const postModal = usePostModal();
const knockModal = useKnockKnockModal();

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
  window.addEventListener("popstate", postModal.handlePopState);
  window.addEventListener("popstate", knockModal.handlePopState);

  // 路由变化时收起弹窗。同 path 仅 query 变化（history.back 去掉 ik_post）时
  // 只关帖子弹窗，勿误关仍带 ik_knock 的敲敲。
  router.beforeEach((to, from) => {
    if (to.path !== from.path) {
      if (postModal.isOpen.value) postModal.teardown();
      if (knockModal.visible.value) knockModal.teardown();
      return;
    }

    const hadPost = Boolean(from.query[OVERLAY_POST_KEY]);
    const hasPost = Boolean(to.query[OVERLAY_POST_KEY]);
    if (postModal.isOpen.value && hadPost && !hasPost) {
      postModal.teardown();
    }

    const hadKnock = Boolean(from.query[OVERLAY_KNOCK_KEY]);
    const hasKnock = Boolean(to.query[OVERLAY_KNOCK_KEY]);
    if (knockModal.visible.value && hadKnock && !hasKnock) {
      knockModal.teardown();
    }
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

const handleOverlayClose = () => {
  postModal.close();
};

// create 页有自带的移动端底部操作栏（发布 / 草稿），全局 MobileBottomNav 在此隐藏避免堆叠
const route = useRoute();
const showMobileBottomNav = computed(() => !route.path.startsWith("/create"));
</script>

<template>
  <div>
    <IkZzzMarquee class="ik-global-marquee" />
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
         注：必须用同步组件而非 LazyPostOverlay。<Transition> 包异步组件时，
         弱网下 chunk 加载延迟会让 enter 动画错过首帧 → 用户感知为闪烁。 -->
    <ClientOnly>
      <Teleport to="body">
        <Transition name="ik-overlay" appear @after-leave="postModal.clearAfterLeave()">
          <PostOverlay
            v-if="postModal.isOpen.value"
            :post-id="postModal.postId.value || ''"
            :cover-hint="postModal.coverHint.value"
            :preview="postModal.preview.value"
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

/* 全局背景跑马灯：固定定位覆盖整个视口 */
.ik-global-marquee {
  position: fixed !important;
  inset: 0;
  z-index: -9999;
}

/* 仅放大作为全屏背景的这一实例，弹窗内的保持默认尺寸 */
.ik-global-marquee :deep(.ik-zzz-marquee__band) {
  width: 260%;
  height: 260%;
  left: -80%;
  top: -80%;
  font-size: clamp(360px, 48vw, 640px);
}
</style>
