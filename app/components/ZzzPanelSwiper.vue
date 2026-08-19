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
    dragFree: true,
    dragThreshold: 6,
  });
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

onBeforeUnmount(() => destroy());
</script>

<template>
  <div class="ik-zzz-swiper">
    <div ref="emblaRef" class="ik-zzz-swiper__viewport">
      <div class="ik-zzz-swiper__track">
        <div
          v-for="(avatar, index) in avatars"
          :key="avatar.id"
          class="ik-zzz-swiper__slide"
          :class="{ 'is-active': index === modelValue }"
        >
          <ZzzCharacterAvatar
            :avatar="avatar"
            :selected="index === modelValue"
            @click="emit('update:modelValue', index)"
          />
        </div>
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
}

.ik-zzz-swiper__slide {
  flex: 0 0 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  position: relative;
  z-index: 1;
}

.ik-zzz-swiper__slide:last-child {
  margin-right: 26px;
}

.ik-zzz-swiper__slide.is-active {
  z-index: 10;
}

@media (min-width: 1024px) {
  .ik-zzz-swiper__slide {
    flex-basis: 134px;
  }

  .ik-zzz-swiper__slide:last-child {
    margin-right: 40px;
  }
}
</style>
