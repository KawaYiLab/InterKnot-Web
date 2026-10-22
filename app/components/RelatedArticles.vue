<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from "vue";
import type { Post } from "~/types/entities";
import RelatedArticleRow from "./RelatedArticleRow.vue";
import Collapsible from "./ui/collapsible/Collapsible.vue";
import CollapsibleContent from "./ui/collapsible/CollapsibleContent.vue";
import CollapsibleTrigger from "./ui/collapsible/CollapsibleTrigger.vue";
const props = withDefaults(defineProps<{
  documentId?: string; active?: boolean; collapsible?: boolean;
}>(), { active: true, collapsible: false });
const emit = defineEmits<{ "open-post": [documentId: string] }>();
const api = useApi();
const auth = useAuthStore();
// 在首次默认收起时也提供稳定的无障碍关联目标。
const listId = useId();
const mounted = ref(false);
const posts = ref<Post[]>([]);
const expanded = ref(false);
const listExpanded = computed(() => !props.collapsible || expanded.value);
const seed = computed(() => typeof props.documentId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(props.documentId)
  ? props.documentId : "");
const shown = computed(() => posts.value.filter((post) => post.id !== seed.value).slice(0, 6));
// 展开选择属于当前委托；图库遮挡或布局切换不应清掉用户的选择。
watch([seed, () => auth.isLogin, () => auth.generation], () => {
  expanded.value = false;
}, { flush: "sync" });
onMounted(() => { mounted.value = true; });
watch([seed, () => auth.isLogin, () => props.active, mounted],
  async (_next, _previous, onCleanup) => {
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    posts.value = [];
    if (!mounted.value || !props.active || !seed.value) return;
    const result = await api.getSuggestedArticles(seed.value, 6).catch(() => []);
    if (cancelled) return;
    const seen = new Set<string>();
    posts.value = result.filter((post) => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
  }, { immediate: true });
function open(post: Post) {
  emit("open-post", post.id);
}
</script>

<template>
  <Collapsible
    v-if="shown.length && active"
    as="section"
    class="ik-related"
    aria-label="相关委托"
    :open="listExpanded"
    @update:open="expanded = $event"
  >
    <component
      :is="collapsible ? CollapsibleTrigger : 'div'"
      class="ik-related__heading"
      :class="{ 'ik-related__trigger': collapsible }"
      :type="collapsible ? 'button' : undefined"
      :aria-controls="collapsible ? listId : undefined"
    >
      <svg class="ik-related__sparkles" viewBox="0 0 563 541" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M253.547 16.7474C262.26 -3.29796 290.689 -3.29797 299.402 16.7474L369.756 178.602C372.485 184.88 377.669 189.765 384.099 192.116L545.781 251.23C567.668 259.232 567.668 290.187 545.781 298.19L383.78 357.421C377.538 359.703 372.462 364.377 369.673 370.409L299.167 522.916C290.223 542.261 262.726 542.261 253.783 522.916L183.171 370.181C180.445 364.284 175.53 359.679 169.467 357.343L15.5462 298.038C-5.80267 289.812 -5.80262 259.607 15.5463 251.382L169.153 192.197C175.402 189.79 180.423 184.976 183.093 178.835L253.547 16.7474Z" /><path d="M76.9415 8.24704C81.0653 -1.54063 94.9348 -1.54061 99.0585 8.24706L116.93 50.6637C118.283 53.8752 120.965 56.3398 124.279 57.4169L167.883 71.5875C178.938 75.1802 178.938 90.8198 167.883 94.4125L124.279 108.583C120.965 109.66 118.283 112.125 116.93 115.336L99.0586 157.753C94.9348 167.541 81.0652 167.541 76.9415 157.753L59.0703 115.336C57.7172 112.125 55.0349 109.66 51.7206 108.583L8.11678 94.4125C-2.93804 90.8198 -2.93804 75.1802 8.11678 71.5875L51.7206 57.4169C55.0348 56.3398 57.7172 53.8752 59.0703 50.6637L76.9415 8.24704Z" /></svg>
      相关委托
      <template v-if="collapsible">
        <span class="ik-related__count">（{{ shown.length }}）</span>
        <span class="ik-related__toggle">
          {{ expanded ? "收起" : "展开" }}
          <svg class="ik-related__chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </template>
    </component>
    <CollapsibleContent as-child force-mount>
      <ul :id="listId" class="ik-related__list" :hidden="listExpanded ? undefined : true" :inert="listExpanded ? undefined : true">
        <template v-if="listExpanded">
          <RelatedArticleRow v-for="post in shown" :key="post.id" :post="post" @open="open" />
        </template>
      </ul>
    </CollapsibleContent>
  </Collapsible>
</template>

<style scoped>
.ik-related { --related-text: #ededed; --related-card: #181818; --related-border: #303030; --related-divider: #2a2a2a; --related-accent: var(--ik-primary, #bfff09); --related-hover: #242424; --related-muted: #9a9a9a; --related-radius: 12px 12px 0 12px; margin-top: 24px; }
.ik-related__heading { display: flex; align-items: center; gap: 6px; margin-bottom: 0; padding-bottom: 10px; border-bottom: 1px solid var(--related-divider); font-size: 16px; line-height: 1.4; font-weight: 700; color: var(--related-text); }
.ik-related__trigger { width: 100%; min-height: 48px; padding: 0; border: 0; border-bottom: 1px solid var(--related-divider); background: transparent; font-family: inherit; text-align: left; cursor: pointer; }
.ik-related__trigger:focus-visible { outline: 2px solid var(--related-accent); outline-offset: 3px; border-radius: 4px; }
.ik-related__count { color: var(--related-muted); font-size: 12px; font-weight: 400; }
.ik-related__toggle { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; color: var(--related-muted); font-size: 12px; font-weight: 400; }
.ik-related__trigger:hover .ik-related__toggle, .ik-related__trigger:focus-visible .ik-related__toggle { color: var(--related-accent); }
.ik-related__chevron { width: 16px; height: 16px; color: var(--related-accent); }
.ik-related__trigger[data-state="open"] .ik-related__chevron { transform: rotate(180deg); }
.ik-related__sparkles { flex: none; width: 1em; height: 1em; fill: var(--related-accent); }
.ik-related__list { padding: 0; margin: 0; }
</style>
