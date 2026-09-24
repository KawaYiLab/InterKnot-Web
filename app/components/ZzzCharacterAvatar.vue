<script setup lang="ts">
import type { ZzzPanelAvatar } from "~/types/entities";

const props = defineProps<{
  avatar: ZzzPanelAvatar;
  selected?: boolean;
}>();

const emit = defineEmits<{
  (e: "click"): void;
}>();

const fallbackOrder = computed(() => {
  const { select, portrait, square, circle } = props.avatar.iconUrls;
  return [select, portrait, square, circle].filter(Boolean);
});

const imgIndex = ref(0);
const imgSrc = computed(() => fallbackOrder.value[imgIndex.value] || "/images/default-avatar.webp");

const onError = () => {
  if (imgIndex.value < fallbackOrder.value.length - 1) {
    imgIndex.value += 1;
  }
};

const onClick = () => {
  emit("click");
};
</script>

<template>
  <button
    type="button"
    class="ik-zzz-avatar"
    :class="{ 'is-selected': props.selected }"
    @click="onClick"
  >
    <svg
      class="ik-zzz-avatar__bg"
      viewBox="0 0 1588 1340"
      aria-hidden="true"
    >
      <path
        class="ik-zzz-avatar__bg-fill"
        d="m0 0h1119l29 9 17 8 15 10 10 8 11 10 9 11 9 13 9 17 7 20 43 150 19 66 26 91 17 59 26 91 20 69 32 112 19 66 41 143 16 56 15 52 33 115 16 56 15 52 13 45 2 4v7h-1117l-25-7-19-8-18-11-15-12v-2l-4-2-11-12-11-16-9-17-11-33-15-53-32-112-19-66-20-70-21-73-50-175-23-80-16-56-31-108-64-224-15-52-34-119-8-27z"
      />
    </svg>

    <img
      :src="imgSrc"
      alt=""
      class="ik-zzz-avatar__img"
      draggable="false"
      loading="lazy"
      @error="onError"
    />

    <span class="ik-zzz-avatar__level">Lv.{{ avatar.level }}</span>
  </button>
</template>

<style scoped>
.ik-zzz-avatar {
  position: relative;
  flex: none;
  width: 94px;
  height: 80px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ik-primary);
  cursor: pointer;
  z-index: 1;
  -webkit-user-select: none;
  user-select: none;
  touch-action: pan-y;
}

.ik-zzz-avatar__bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.ik-zzz-avatar__bg-fill {
  fill: #000;
  transition: fill 0.15s ease;
}

.ik-zzz-avatar.is-selected .ik-zzz-avatar__bg-fill {
  fill: var(--ik-primary);
}

.ik-zzz-avatar.is-selected:active .ik-zzz-avatar__bg-fill {
  animation: ik-zzz-avatar-pulse 1.34s infinite;
}

@keyframes ik-zzz-avatar-pulse {
  0%,
  100% {
    fill: var(--ik-primary);
  }
  50% {
    fill: #9ccc00;
  }
}

.ik-zzz-avatar__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 4px;
  z-index: 2;
  pointer-events: none;
  -webkit-user-drag: none;
  -webkit-user-select: none;
  user-select: none;
}

.ik-zzz-avatar__level {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 3;
  font-size: 10px;
  font-weight: 800;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
  pointer-events: none;
}

@media (min-width: 1024px) {
  .ik-zzz-avatar {
    width: 172px;
    height: 146px;
  }

  .ik-zzz-avatar__img {
    padding: 6px;
  }

  .ik-zzz-avatar__level {
    right: 10px;
    bottom: 10px;
    font-size: 12px;
  }
}
</style>
