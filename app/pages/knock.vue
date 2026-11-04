<script setup lang="ts">
/** 直达入口：先挂载首页作为背景，再按路径恢复敲敲。 */
definePageMeta({
  layout: false,
  path: "/knock/:tab(contacts|calls|groups)?/:conversationId?",
});

const knockModal = useKnockKnockModal();
onMounted(() => { void knockModal.openFromUrl(); });
</script>

<template>
  <div />
</template>
