<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { Post } from "~/types/entities";
import { useRecommendations } from "~/composables/useRecommendations";
import RelatedArticleRow from "./RelatedArticleRow.vue";
const props = withDefaults(defineProps<{
  documentId?: string; seedIds?: string[]; excludeIds?: string[];
  surface?: "related" | "ai"; active?: boolean;
}>(), { surface: "related", active: true });
const emit = defineEmits<{ "open-post": [documentId: string] }>();
const api = useApi();
const auth = useAuthStore();
const recommendations = useRecommendations();
const mounted = ref(false);
const posts = ref<Post[]>([]);
const seeds = computed(() => [...new Set([props.documentId, ...(props.seedIds || [])]
  .filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id)))].slice(0, 2));
const shown = computed(() => {
  const excluded = new Set([...seeds.value, ...(props.excludeIds || [])]);
  return posts.value.filter((post) => !excluded.has(post.id) && !recommendations.isDismissed(post.id))
    .slice(0, props.surface === "ai" ? 5 : 6);
});
const heading = computed(() => (props.surface === "ai" ? "推荐阅读" : "相关委托"));
onMounted(() => { mounted.value = true; });
watch([() => seeds.value.join(","), () => props.surface, () => auth.token, () => props.active, mounted],
  async (_next, _previous, onCleanup) => {
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    posts.value = [];
    if (!mounted.value || !props.active || !seeds.value.length) return;
    const results = await Promise.allSettled(seeds.value.map((id) => api.getRelatedArticles(id, 6, props.surface)));
    if (cancelled) return;
    const seen = new Set<string>();
    const lists = results.map((result) => result.status === "fulfilled" ? result.value : []);
    const merged: Post[] = [];
    for (let index = 0; index < 6; index++) for (const list of lists) {
      const post = list[index];
      if (post && !seen.has(post.id)) { seen.add(post.id); merged.push(post); }
    }
    posts.value = merged;
  }, { immediate: true });
function open(post: Post) {
  recommendations.trackClick(post);
  emit("open-post", post.id);
}
</script>

<template>
  <section v-if="shown.length && active" class="ik-related" :class="{ 'ik-related--ai': surface === 'ai' }" :aria-label="heading">
    <div class="ik-related__heading"><span v-if="surface === 'ai'" class="ik-related__mark" aria-hidden="true"></span><svg v-else class="ik-related__sparkles" viewBox="0 0 563 541" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M253.547 16.7474C262.26 -3.29796 290.689 -3.29797 299.402 16.7474L369.756 178.602C372.485 184.88 377.669 189.765 384.099 192.116L545.781 251.23C567.668 259.232 567.668 290.187 545.781 298.19L383.78 357.421C377.538 359.703 372.462 364.377 369.673 370.409L299.167 522.916C290.223 542.261 262.726 542.261 253.783 522.916L183.171 370.181C180.445 364.284 175.53 359.679 169.467 357.343L15.5462 298.038C-5.80267 289.812 -5.80262 259.607 15.5463 251.382L169.153 192.197C175.402 189.79 180.423 184.976 183.093 178.835L253.547 16.7474Z" /><path d="M76.9415 8.24704C81.0653 -1.54063 94.9348 -1.54061 99.0585 8.24706L116.93 50.6637C118.283 53.8752 120.965 56.3398 124.279 57.4169L167.883 71.5875C178.938 75.1802 178.938 90.8198 167.883 94.4125L124.279 108.583C120.965 109.66 118.283 112.125 116.93 115.336L99.0586 157.753C94.9348 167.541 81.0652 167.541 76.9415 157.753L59.0703 115.336C57.7172 112.125 55.0349 109.66 51.7206 108.583L8.11678 94.4125C-2.93804 90.8198 -2.93804 75.1802 8.11678 71.5875L51.7206 57.4169C55.0348 56.3398 57.7172 53.8752 59.0703 50.6637L76.9415 8.24704Z" /></svg>{{ heading }}</div>
    <ul class="ik-related__list">
      <RelatedArticleRow v-for="post in shown" :key="post.id" :post="post" :active="active" :surface="surface" @open="open" />
    </ul>
  </section>
</template>

<style scoped>
.ik-related { --related-text: #ededed; --related-card: #181818; --related-border: #303030; --related-divider: #2a2a2a; --related-accent: var(--ik-primary, #bfff09); --related-hover: #242424; --related-muted: #9a9a9a; --related-radius: 12px 12px 0 12px; margin-top: 24px; }
.ik-related__heading { display: flex; align-items: center; gap: 6px; margin-bottom: 0; padding-bottom: 10px; border-bottom: 1px solid var(--related-divider); font-size: 16px; line-height: 1.4; font-weight: 700; color: var(--related-text); }
.ik-related__mark { width: 4px; height: 15px; background: var(--related-accent); transform: skew(-12deg); }
.ik-related__sparkles { flex: none; width: 1em; height: 1em; fill: var(--related-accent); }
.ik-related__list { padding: 0; margin: 0; }
.ik-related--ai { --related-text: #252525; --related-card: #fffdf2; --related-border: #dedbcf; --related-divider: #e6e2d5; --related-accent: #415db4; --related-hover: #f3f1e8; --related-muted: #777; --related-radius: 10px 0 10px 10px; margin-top: 0; padding: 8px 10px; border: 1px solid #dedbcf; border-radius: 12px; background: #fffdf2; }
.ik-related--ai .ik-related__heading { color: #666; margin-bottom: 4px; padding-bottom: 0; border-bottom: 0; font-size: 12px; }
.ik-related--ai .ik-related__mark { background: #b0b76e; }
</style>
