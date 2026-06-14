<template>
  <section class="ik-side-card">
    <h3 v-if="title" class="ik-side-card__title">{{ title }}</h3>
    <div class="ik-side-card__body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<style scoped>
/* 与 theme.css 的 .ik-panel 同款视觉，保持全站一致 */
.ik-side-card {
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #2d2d2d;
  background: linear-gradient(180deg, #212121 0%, #181818 100%);
}

.ik-side-card__title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 700;
  color: #ccc;
  text-transform: uppercase;
  letter-spacing: 1px;
}
</style>
