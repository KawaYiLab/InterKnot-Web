<script setup lang="ts">
defineProps<{ up: boolean; down: boolean }>();
</script>

<template>
  <span class="ik-scroll-hint ik-scroll-hint--up" :class="{ 'is-visible': up }" aria-hidden="true"></span>
  <span class="ik-scroll-hint ik-scroll-hint--down" :class="{ 'is-visible': down }" aria-hidden="true"></span>
</template>

<style scoped>
/* 游戏里滚动区上下缘的白色小三角：还能往那个方向滚时才出现 */
.ik-scroll-hint {
  position: absolute;
  left: 50%;
  z-index: 3;
  width: 0;
  height: 0;
  border-left: 9px solid transparent;
  border-right: 9px solid transparent;
  opacity: 0;
  transform: translateX(-50%);
  pointer-events: none;
  transition: opacity 160ms ease;
}

.ik-scroll-hint--up {
  top: 4px;
  border-bottom: 9px solid #fff;
}

.ik-scroll-hint--down {
  bottom: 4px;
  border-top: 9px solid #fff;
}

.ik-scroll-hint.is-visible {
  opacity: 1;
}
</style>
