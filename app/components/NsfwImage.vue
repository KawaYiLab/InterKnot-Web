<script setup lang="ts">
import { NoSymbolIcon } from "@heroicons/vue/24/outline";
import type { NsfwStatus } from "~/types/entities";

const props = withDefaults(
  defineProps<{
    src?: string;
    status?: NsfwStatus;
    alt?: string;
    imgClass?: string | Record<string, boolean> | (string | Record<string, boolean>)[];
    loading?: "eager" | "lazy";
    decoding?: "async" | "sync" | "auto";
    fetchpriority?: "high" | "low" | "auto";
    draggable?: boolean | "true" | "false";
    revealOnClick?: boolean;
  }>(),
  {
    status: "safe",
    revealOnClick: true,
    loading: "lazy",
    decoding: "async",
    fetchpriority: "auto",
    draggable: false,
  },
);

const emit = defineEmits<{
  load: [event: Event];
  error: [event: Event];
  click: [event: MouseEvent];
}>();

const imgRef = ref<HTMLImageElement | null>(null);
const revealed = ref(false);
const isSensitive = computed(() => props.status === "sensitive");
const showOverlay = computed(() => isSensitive.value && !revealed.value);
const draggableAttr = computed(() => String(props.draggable) as "true" | "false");

onMounted(() => {
  const img = imgRef.value;
  if (props.src && img && img.complete && img.naturalWidth > 0) {
    onLoad(new Event("load"));
  }
});

function onLoad(event: Event) {
  emit("load", event);
}

function onError(event: Event) {
  emit("error", event);
}

watch(
  () => props.src,
  () => {
    revealed.value = false;
  },
);

function reveal(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  revealed.value = true;
}

function onOverlayClick(event: MouseEvent) {
  // 首页等仅展示场景不响应揭示，让点击穿透给父级（如打开帖子）
  if (!props.revealOnClick) {
    return;
  }
  reveal(event);
}

function onRootClick(event: MouseEvent) {
  if (showOverlay.value) {
    return;
  }
  emit("click", event);
}
</script>

<template>
  <div
    v-if="src"
    class="nsfw-image"
    :class="{
      'nsfw-image--sensitive': isSensitive,
      'nsfw-image--revealed': revealed,
    }"
    @click="onRootClick"
  >
    <div class="nsfw-image__media">
      <img
        ref="imgRef"
        :src="src"
        :alt="alt || ''"
        class="nsfw-image__img"
        :class="imgClass"
        :loading="loading"
        :decoding="decoding"
        :fetchpriority="fetchpriority"
        :draggable="draggableAttr"
        @load="onLoad"
        @error="onError"
      />
    </div>
    <Transition name="nsfw-fade">
      <div
        v-if="showOverlay"
        class="nsfw-image__overlay"
        :class="{ 'nsfw-image__overlay--readonly': !revealOnClick }"
        aria-hidden="true"
        @click="onOverlayClick"
      >
        <div class="nsfw-image__warning">
          <NoSymbolIcon class="nsfw-image__icon" />
          <span class="nsfw-image__title">内容警告：敏感内容</span>
          <span class="nsfw-image__desc">绳网已将这个帖子标记为包含敏感内容。</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.nsfw-image {
  display: block;
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 100%;
}

.nsfw-image__media {
  width: 100%;
  height: 100%;
  transition: filter 200ms ease;
}

.nsfw-image__img {
  display: block;
  width: 100%;
  height: 100%;
}

.nsfw-image--sensitive:not(.nsfw-image--revealed) .nsfw-image__media {
  filter: blur(10px) brightness(0.92);
}

.nsfw-fade-enter-active,
.nsfw-fade-leave-active {
  transition: opacity 200ms ease;
}

.nsfw-fade-enter-from,
.nsfw-fade-leave-to {
  opacity: 0;
}

.nsfw-image__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  text-align: center;
  z-index: 1;
}

.nsfw-image__warning {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: 240px;
}

.nsfw-image__icon {
  width: 32px;
  height: 32px;
  margin-bottom: 6px;
}

.nsfw-image__title {
  font-size: 15px;
  font-weight: 800;
  line-height: 1.3;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}

.nsfw-image__desc {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  opacity: 0.9;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

.nsfw-image__overlay--readonly {
  pointer-events: none;
  cursor: default;
}
</style>
