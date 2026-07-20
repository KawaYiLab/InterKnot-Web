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
  }>(),
  {
    status: "safe",
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
    <div v-if="showOverlay" class="nsfw-image__overlay" aria-hidden="true">
      <div class="nsfw-image__warning">
        <NoSymbolIcon class="nsfw-image__icon" />
        <span class="nsfw-image__title">内容警告：成人内容</span>
        <span class="nsfw-image__desc">系统已将这个帖子标记为包含成人内容。</span>
      </div>
      <button
        type="button"
        class="nsfw-image__show-btn"
        @click.stop="reveal"
      >
        显示
      </button>
    </div>
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

.nsfw-image__img {
  display: block;
  width: 100%;
  height: 100%;
}

.nsfw-image--sensitive:not(.nsfw-image--revealed) .nsfw-image__img {
  filter: blur(12px) brightness(0.9);
  transform: scale(1.05);
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
  font-size: 17px;
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

.nsfw-image__show-btn {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background-color 120ms ease;
}

.nsfw-image__show-btn:hover {
  background: rgba(255, 255, 255, 0.22);
}
</style>
