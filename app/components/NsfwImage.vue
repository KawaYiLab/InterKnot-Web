<script setup lang="ts">
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
    <div
      v-if="showOverlay"
      class="nsfw-image__overlay"
      aria-hidden="true"
      @click.stop="reveal"
    >
      <span class="nsfw-image__label">敏感内容 · 点击显示</span>
    </div>
  </div>
</template>

<style scoped>
.nsfw-image {
  display: block;
  position: relative;
  width: 100%;
  height: 100%;
}

.nsfw-image__img {
  display: block;
  width: 100%;
  height: 100%;
}

.nsfw-image--sensitive:not(.nsfw-image--revealed) .nsfw-image__img {
  filter: blur(24px) brightness(0.65);
  transform: scale(1.05);
}

.nsfw-image__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
  cursor: pointer;
  z-index: 1;
}

.nsfw-image__label {
  pointer-events: none;
  user-select: none;
}
</style>
