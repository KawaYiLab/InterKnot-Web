<script setup lang="ts">
const auth = useAuthStore();
const loginDialog = useLoginDialog();

onMounted(() => {
  if (auth.isLogin) {
    const id = auth.user?.documentId || auth.user?.authorId;
    navigateTo(id ? `/profile/${id}` : "/", { replace: true });
  } else {
    loginDialog.open();
    navigateTo("/", { replace: true });
  }
});
</script>

<template>
  <div />
</template>
