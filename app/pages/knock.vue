<script setup lang="ts">
/**
 * /knock 直接访问入口页
 *
 * 正常流程中，敲敲弹窗通过 history.pushState 在当前页追加 ik_knock query，
 * 此页面不会被 Vue Router 渲染。
 *
 * 当用户直接访问 /knock（如复制粘贴 URL），此页面将:
 * 1. 导航到首页 /
 * 2. 打开敲敲弹窗并恢复 URL 中的会话状态
 *
 * 兼容旧栈：从帖子弹窗 history.back() 落到 /knock 且敲敲仍打开时，
 * 仅 replace 回 /，避免再次 open() 或触发首页数据重拉。
 */
definePageMeta({ layout: false });

const route = useRoute();
const router = useRouter();
const knockModal = useKnockKnockModal();

if (import.meta.client) {
  if (knockModal.visible.value) {
    router.replace("/").catch(() => undefined);
  } else {
    const c =
      (route.query.c as string) ||
      (route.query.ik_knock_c as string) ||
      null;

    router.replace("/").then(() => {
      if (c) {
        knockModal.open({ dmConversationId: c });
      } else {
        knockModal.open();
      }
    }).catch(() => undefined);
  }
}
</script>

<template>
  <div />
</template>
