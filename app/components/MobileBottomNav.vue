<script setup lang="ts">
const route = useRoute();
const auth = useAuthStore();
const loginDialog = useLoginDialog();
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
</script>

<template>
  <nav class="ik-mobile-nav">
    <NuxtLink
      to="/"
      class="ik-mobile-nav__item"
      :class="{ active: route.path === '/' }"
    >
      推送
    </NuxtLink>
    <button
      class="ik-mobile-nav__item ik-mobile-nav__item--create"
      @click="handleCreatePost"
    >
      <span class="ik-mobile-nav__create-icon">+</span>
      发帖
    </button>
    <button
      class="ik-mobile-nav__item"
      :class="{ active: route.path.startsWith('/profile') }"
      @click="handleAccountClick"
    >
      账号
    </button>
  </nav>
</template>

<style scoped>
.ik-mobile-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 58px;
  display: none;
  border-top: 1px solid #2d2d2d;
  background: rgba(17, 17, 17, 0.96);
  backdrop-filter: blur(8px);
  z-index: 30;
}

.ik-mobile-nav__item {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--ik-muted);
  font-size: 13px;
  border: none;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: none;
}

.ik-mobile-nav__item.active {
  color: var(--ik-primary);
  font-weight: 700;
}

.ik-mobile-nav__item--create {
  color: var(--ik-primary) !important;
  font-weight: 700;
  gap: 2px;
}

.ik-mobile-nav__create-icon {
  font-size: 18px;
  font-weight: 900;
  line-height: 1;
}

@media (max-width: 768px) {
  .ik-mobile-nav {
    display: flex;
  }
}
</style>
