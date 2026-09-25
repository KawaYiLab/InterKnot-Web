<script setup lang="ts">
import { computed } from "vue";
import type { WorkflowPostRef } from "~/utils/workflow";
import RelatedArticles from "~/components/RelatedArticles.vue";

// Workflow references remain evidence. Only the separate reading suggestions use Gorse.
const props = defineProps<{ posts: WorkflowPostRef[]; citations?: WorkflowPostRef[] }>();
const emit = defineEmits<{ "open-post": [documentId: string] }>();
const refs = computed(() => [...(props.citations || []), ...props.posts]);
const seedIds = computed(() => [...new Set(refs.value.map((post) => post.documentId))].slice(0, 2));
const excludedIds = computed(() => refs.value.map((post) => post.documentId));
</script>

<template>
  <RelatedArticles :seed-ids="seedIds" :exclude-ids="excludedIds" surface="ai" @open-post="emit('open-post', $event)" />
</template>
