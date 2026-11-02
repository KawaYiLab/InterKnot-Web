<script setup lang="ts">
const auth = useAuthStore();
const loginDialog = useLoginDialog();

onMounted(() => {
  if (auth.isLogin) {
    navigateTo(auth.profilePath || "/", { replace: true });
  } else {
    loginDialog.open();
    navigateTo("/", { replace: true });
  }
});
</script>

<template>
  <div />
</template>
