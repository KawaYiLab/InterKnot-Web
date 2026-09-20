<script setup lang="ts">
import type { Tag } from "~/types/entities";

const api = useApi();

useSeoMeta({
  title: "全部标签 - 绳网",
  robots: "noindex, nofollow",
});

const tags = ref<Tag[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    tags.value = await api.getTags(200);
  } catch {
    tags.value = [];
  } finally {
    loading.value = false;
  }
});

/** 中文 slug 需 encode 后进 URL，避免路由/服务端解析异常。 */
function tagLink(slug: string): string {
  return `/tags/${encodeURIComponent(slug)}`;
}
</script>

<template>
  <section class="ik-tags-index">
    <header class="ik-tags-header">
      <h1 class="ik-tags-title">全部标签</h1>
    </header>

    <div v-if="loading" class="ik-tags-loading">加载中…</div>
    <div v-else-if="!tags.length" class="ik-empty">还没有任何标签 [ o_x ]/</div>
    <div v-else class="ik-tags-cloud">
      <NuxtLink
        v-for="tag in tags"
        :key="tag.slug"
        :to="tagLink(tag.slug)"
        class="ik-tag-pill"
      >
        <span class="ik-tag-pill__name">#{{ tag.name }}</span>
        <span v-if="tag.count != null" class="ik-tag-pill__count">{{ tag.count }}</span>
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.ik-tags-index {
  max-width: 1080px;
  margin: 0 auto;
  padding: 16px 16px 48px;
}

.ik-tags-header {
  padding: 8px 4px 16px;
  border-bottom: 1px solid #1f1f1f;
  margin-bottom: 16px;
}

.ik-tags-title {
  font-size: 22px;
  font-weight: 900;
  color: #f0f0f0;
  letter-spacing: 0.4px;
  margin: 0;
}

.ik-tags-loading,
.ik-empty {
  padding: 48px 16px;
  text-align: center;
  color: #777;
  font-size: 14px;
}

.ik-tags-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.ik-tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 9999px;
  border: 2px solid #222;
  background: #1c1c1c;
  color: #fff;
  font-size: 14px;
  line-height: 1;
  text-decoration: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.ik-tag-pill:hover {
  border-color: var(--ik-primary, #bfff09);
  background: #232323;
}

.ik-tag-pill__name {
  overflow-wrap: anywhere;
}

.ik-tag-pill__count {
  font-size: 11px;
  font-weight: 700;
  color: #777;
}
</style>
