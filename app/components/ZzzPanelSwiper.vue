<script setup lang="ts">
import EmblaCarousel from "embla-carousel";
import type { EmblaCarouselType } from "embla-carousel";
import type { ZzzPanelAvatar } from "~/types/entities";

const props = defineProps<{
  avatars: ZzzPanelAvatar[];
  modelValue: number;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", index: number): void;
}>();

const emblaRef = shallowRef<HTMLElement | null>(null);
const emblaApi = shallowRef<EmblaCarouselType | undefined>();

const sync = () => {
  const api = emblaApi.value;
  if (!api) return;
  const index = api.selectedScrollSnap();
  emit("update:modelValue", index);
};

const destroy = () => {
  if (emblaApi.value) {
    emblaApi.value.destroy();
    emblaApi.value = undefined;
  }
};

const init = (el: HTMLElement) => {
  destroy();
  emblaApi.value = EmblaCarousel(el, {
    loop: false,
    align: "start",
    dragThreshold: 6,
    slidesToScroll: 1,
  });
  emblaApi.value.on("select", sync);
  emblaApi.value.on("reInit", sync);
  sync();
};

watch(
  () => props.avatars,
  () => {
    nextTick(() => {
      if (emblaRef.value) init(emblaRef.value);
    });
  },
  { immediate: true, deep: false },
);

watch(
  () => props.modelValue,
  (index) => {
    const api = emblaApi.value;
    if (!api) return;
    if (api.selectedScrollSnap() !== index) {
      api.scrollTo(index);
    }
  },
);

onBeforeUnmount(() => destroy());

const elementClasses: Record<string, string> = {
  physical: "is-physical",
  fire: "is-fire",
  ice: "is-ice",
  electric: "is-electric",
  ether: "is-ether",
};
</script>

<template>
  <div class="ik-zzz-swiper">
    <div ref="emblaRef" class="ik-zzz-swiper__viewport">
      <div class="ik-zzz-swiper__track">
        <button
          v-for="(avatar, index) in avatars"
          :key="avatar.id"
          type="button"
          class="ik-zzz-swiper__slide"
          :class="[elementClasses[avatar.element] || '', { 'is-active': index === modelValue }]"
          @click="emit('update:modelValue', index)"
        >
          <img
            :src="avatar.iconUrls.square || avatar.iconUrls.portrait || '/images/default-avatar.webp'"
            alt=""
            class="ik-zzz-swiper__img"
            loading="lazy"
            @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
          />
          <span class="ik-zzz-swiper__rarity">{{ avatar.rarityName }}</span>
          <span class="ik-zzz-swiper__level">Lv.{{ avatar.level }}</span>
          <span class="ik-zzz-swiper__name">{{ avatar.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ik-zzz-swiper {
  position: relative;
  width: 100%;
  padding: 8px 0;
}

.ik-zzz-swiper__viewport {
  overflow: hidden;
}

.ik-zzz-swiper__track {
  display: flex;
  gap: 12px;
}

.ik-zzz-swiper__slide {
  flex: 0 0 84px;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: rgba(18, 18, 20, 0.75);
  backdrop-filter: blur(10px);
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.ik-zzz-swiper__slide:active:not(.is-active) {
  transform: scale(0.96);
}

.ik-zzz-swiper__slide.is-active {
  border-color: currentColor;
  box-shadow: 0 0 0 2px currentColor;
  color: #fff;
}

.ik-zzz-swiper__slide.is-physical { color: #d1b3ff; }
.ik-zzz-swiper__slide.is-fire { color: #ff9e80; }
.ik-zzz-swiper__slide.is-ice { color: #80dfff; }
.ik-zzz-swiper__slide.is-electric { color: #c2ff80; }
.ik-zzz-swiper__slide.is-ether { color: #ff80d4; }

.ik-zzz-swiper__img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.3);
}

.ik-zzz-swiper__rarity {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 10px;
  font-weight: 800;
  color: #fbfe00;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}

.ik-zzz-swiper__level {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.ik-zzz-swiper__name {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
