<script setup lang="ts">
definePageMeta({ layout: false });

useSeoMeta({ title: "页面未找到 - 绳网" });
</script>

<template>
  <div class="ik-not-found">
    <img src="https://zzz.mihoyo.com/_nuxt/img/error-404.afeccea.png" alt="404" class="ik-not-found__img" />
    <div class="ik-not-found__title">页面似乎找不到了</div>
    <div class="ik-not-found__sub">Page not found</div>
    <NuxtLink to="/" class="ik-not-found__btn">回到首页</NuxtLink>
  </div>
</template>

<style scoped>
.ik-not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #efefef;
}

.ik-not-found__img {
  width: 160px;
}

.ik-not-found__title {
  font-size: 24px;
  font-weight: 600;
  color: #1d2129;
  margin: 24px 0 8px;
}

.ik-not-found__sub {
  font-size: 16px;
  color: #86909c;
}

.ik-not-found__btn {
  display: inline-block;
  margin-top: 24px;
  background: #000;
  color: #fff;
  border-radius: 20px;
  padding: 10px 32px;
  font-size: 16px;
  text-decoration: none;
  cursor: pointer;
}
</style>
