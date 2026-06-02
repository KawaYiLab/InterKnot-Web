<script setup lang="ts">
/**
 * /knock 直接访问入口页
 *
 * 正常流程中，敲敲弹窗通过 history.pushState 改变 URL 到 /knock，
 * 此页面不会被 Vue Router 渲染。
 *
 * 当用户直接访问 /knock（如复制粘贴 URL），此页面将:
 * 1. 导航到首页 /
 * 2. 打开敲敲弹窗并恢复 URL 中的会话状态
 */
definePageMeta({ layout: false });

const route = useRoute();
const router = useRouter();
const knockModal = useKnockKnockModal();

if (import.meta.client) {
  // 支持的 query：
  //   ?c=<conversationId>   → 定位到该 DM 会话
  const c = (route.query.c as string) || null;

  router.replace("/").then(() => {
    if (c) {
      knockModal.open({ dmConversationId: c });
    } else {
      knockModal.open();
    }
  }).catch(() => undefined);
}
</script>

<template>
  <div />
</template>
