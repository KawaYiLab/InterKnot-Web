<script setup lang="ts">
import { useMessage } from "zenless-ui";
import {
  HomeIcon as HomeOutlineIcon,
  UserIcon as UserOutlineIcon,
  ChatBubbleOvalLeftEllipsisIcon as KnockOutlineIcon,
} from "@heroicons/vue/24/outline";
import {
  HomeIcon as HomeSolidIcon,
  UserIcon as UserSolidIcon,
  ChatBubbleOvalLeftEllipsisIcon as KnockSolidIcon,
  PlusIcon,
} from "@heroicons/vue/24/solid";

const route = useRoute();
const auth = useAuthStore();
const loginDialog = useLoginDialog();
const message = useMessage();
const knockKnockModal = useKnockKnockModal();

// 敲敲未读：登录后由 knock-auth-bridge 插件自动启动 stream + refresh，
// 这里只订阅 totalUnread；未登录恒为 0，不显示 badge。
const { totalUnread: knockUnread } = useDmConversations();
const knockUnreadLabel = computed(() => {
  const n = knockUnread.value;
  if (n <= 0) return "";
  return n > 99 ? "99+" : String(n);
});

const isHome = computed(() => route.path === "/");
const isMine = computed(
  () => !!auth.profilePath && route.path === auth.profilePath,
);
const isKnock = computed(() => knockKnockModal.visible.value);

// Double-tap on the active "推送" entry refreshes the home feed,
// matching the Flutter app's behaviour.
const DOUBLE_TAP_MS = 300;
const lastHomeTap = ref<number | null>(null);

const handleHomeTap = async () => {
  const now = Date.now();
  const last = lastHomeTap.value;
  if (last !== null && now - last < DOUBLE_TAP_MS && isHome.value) {
    lastHomeTap.value = null;
    if (import.meta.client) {
      window.dispatchEvent(new CustomEvent("ik:home-refresh"));
      message({ message: "正在刷新帖子...", duration: 1000 });
    }
    return;
  }
  lastHomeTap.value = now;
  if (!isHome.value) {
    await navigateTo("/");
  }
};

const handleAccountClick = () => {
  if (auth.profilePath) {
    navigateTo(auth.profilePath);
  } else {
    loginDialog.open();
  }
};

const handleCreatePost = () => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  navigateTo("/create");
};

const handleKnock = () => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  knockKnockModal.open();
};
</script>

<template>
  <nav class="ik-mobile-nav" role="navigation" aria-label="主导航">
    <div class="ik-mobile-nav__side">
      <button
        type="button"
        class="ik-mobile-nav__item"
        :class="{ 'is-active': isHome }"
        :aria-current="isHome ? 'page' : undefined"
        aria-label="推送"
        @click="handleHomeTap"
      >
        <span class="ik-mobile-nav__inner">
          <component
            :is="isHome ? HomeSolidIcon : HomeOutlineIcon"
            class="ik-mobile-nav__icon"
            aria-hidden="true"
          />
          <span class="ik-mobile-nav__label">推送</span>
        </span>
      </button>

      <button
        type="button"
        class="ik-mobile-nav__item"
        :class="{ 'is-active': isKnock }"
        :aria-label="knockUnread > 0 ? `敲敲，${knockUnread} 条未读` : '敲敲'"
        @click="handleKnock"
      >
        <span class="ik-mobile-nav__inner">
          <span class="ik-mobile-nav__icon-wrap">
            <component
              :is="isKnock ? KnockSolidIcon : KnockOutlineIcon"
              class="ik-mobile-nav__icon"
              aria-hidden="true"
            />
            <span
              v-if="knockUnreadLabel"
              class="ik-mobile-nav__badge"
              aria-hidden="true"
            >{{ knockUnreadLabel }}</span>
          </span>
          <span class="ik-mobile-nav__label">敲敲</span>
        </span>
      </button>
    </div>

    <div class="ik-mobile-nav__create-wrap">
      <button
        type="button"
        class="ik-mobile-nav__create-btn"
        aria-label="发帖"
        @click="handleCreatePost"
      >
        <PlusIcon class="ik-mobile-nav__create-icon" aria-hidden="true" />
      </button>
    </div>

    <div class="ik-mobile-nav__side">
      <button
        type="button"
        class="ik-mobile-nav__item"
        :class="{ 'is-active': isMine }"
        :aria-current="isMine ? 'page' : undefined"
        aria-label="我的"
        @click="handleAccountClick"
      >
        <span class="ik-mobile-nav__inner">
          <component
            :is="isMine ? UserSolidIcon : UserOutlineIcon"
            class="ik-mobile-nav__icon"
            aria-hidden="true"
          />
          <span class="ik-mobile-nav__label">我的</span>
        </span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
/* ── Bar ───────────────────────────────────────────
   Match the Flutter version: solid #1A1A1A, 1px white12 top
   border, 58px content area + iOS safe-area inset. */
.ik-mobile-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: calc(58px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  display: none;
  align-items: stretch;
  justify-content: space-around;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  background: #1a1a1a;
  z-index: 30;
}

/* 与 AppHeader.vue tabs 隐藏断点（≤1100px）保持一致，
   保证中屏窗口下用户也能从底部访问主要导航。 */
@media (max-width: 1100px) {
  .ik-mobile-nav {
    display: flex;
  }
}

/* ── Side groups (left: 推送/敲敲, right: 我的) ──
   Equal-width halves keep the center 发帖 button horizontally centered. */
.ik-mobile-nav__side {
  flex: 1;
  display: flex;
  align-items: stretch;
  justify-content: space-around;
}

/* ── Side items (推送 / 敲敲 / 我的) ─────────────── */
.ik-mobile-nav__item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: #fff;
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

/* ── Knock unread badge ─────────────────────────── */
.ik-mobile-nav__icon-wrap {
  position: relative;
  display: inline-flex;
}

.ik-mobile-nav__badge {
  position: absolute;
  top: -5px;
  left: 100%;
  margin-left: -9px;
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
  box-shadow: 0 0 0 2px #1a1a1a;
  pointer-events: none;
  white-space: nowrap;
}

.ik-mobile-nav__inner {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  transform: scale(1);
  /* easeOutBack ≈ this cubic-bezier */
  transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ik-mobile-nav__item.is-active .ik-mobile-nav__inner {
  transform: scale(1.2);
}

.ik-mobile-nav__icon {
  width: 24px;
  height: 24px;
  display: block;
  /* Heroicons handle stroke/fill internally with currentColor */
}

.ik-mobile-nav__label {
  font-size: 12px;
  line-height: 1;
  color: #fff;
}

/* ── Center create button ──────────────────────── */
.ik-mobile-nav__create-wrap {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ik-mobile-nav__create-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #fbfe00;
  color: #000;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  animation: ik-mobile-nav-create-pulse 800ms linear infinite alternate;
  transition: transform 120ms ease;
}

.ik-mobile-nav__create-btn:active {
  transform: scale(0.94);
}

.ik-mobile-nav__create-icon {
  width: 24px;
  height: 24px;
  display: block;
  /* PlusIcon (24/solid) uses fill=currentColor; parent sets color: #000 */
}

@keyframes ik-mobile-nav-create-pulse {
  from {
    background-color: #fbfe00;
  }
  to {
    background-color: #dcfe00;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-mobile-nav__create-btn {
    animation: none;
  }
  .ik-mobile-nav__inner {
    transition: none;
  }
}
</style>
