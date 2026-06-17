<script setup lang="ts">
const props = defineProps<{ error: { statusCode: number; message?: string } }>();

const title = computed(() =>
  props.error.statusCode === 404 ? "页面似乎找不到了" : "出了点问题",
);
const sub = computed(() =>
  props.error.statusCode === 404
    ? (props.error.message || "Page not found")
    : (props.error.message || `Error ${props.error.statusCode}`),
);

const handleClear = () => clearError({ redirect: "/" });
</script>

<template>
  <div class="ik-error">
    <img src="https://zzz.mihoyo.com/_nuxt/img/error-404.afeccea.png" alt="error" class="ik-error__img" />
    <div class="ik-error__title">{{ title }}</div>
    <div class="ik-error__sub">{{ sub }}</div>
    <button class="ik-error__btn" @click="handleClear">回到首页</button>
  </div>
</template>

<style scoped>
.ik-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #efefef;
}

.ik-error__img {
  width: 160px;
}

.ik-error__title {
  font-size: 24px;
  font-weight: 600;
  color: #1d2129;
  margin: 24px 0 8px;
}

.ik-error__sub {
  font-size: 16px;
  color: #86909c;
}

.ik-error__btn {
  display: inline-block;
  margin-top: 24px;
  background: #000;
  color: #fff;
  border-radius: 20px;
  padding: 10px 32px;
  font-size: 16px;
  text-decoration: none;
  cursor: pointer;
  border: 0;
  appearance: none;
}
</style>
