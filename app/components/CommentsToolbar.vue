<script setup lang="ts">
import { ref } from "vue";
import type { CommentSort } from "~/composables/useApi";

/** 评论区顶部：最早 / 最新切换 + 跳到第几楼。帖子页与弹窗共用。 */
defineProps<{ disabled?: boolean }>();
const sort = defineModel<CommentSort>("sort", { required: true });
const emit = defineEmits<{ jump: [floor: number] }>();

const floorInput = ref("");

const submitJump = () => {
  const floor = Number.parseInt(floorInput.value.replace(/^#/, ""), 10);
  if (!Number.isFinite(floor) || floor < 1) return;
  emit("jump", floor);
  floorInput.value = "";
};
</script>

<template>
  <div class="ik-comments-toolbar">
    <z-radio-group v-model="sort" size="small" :disabled="disabled">
      <z-radio-button value="oldest">最早</z-radio-button>
      <z-radio-button value="newest">最新</z-radio-button>
    </z-radio-group>
    <form class="ik-comments-toolbar__jump" @submit.prevent="submitJump">
      <z-input
        v-model="floorInput"
        size="small"
        type="text"
        inputmode="numeric"
        maxlength="7"
        placeholder="# 楼层"
        class="ik-comments-toolbar__floor"
        :disabled="disabled"
      />
      <z-button size="small" native-type="submit" :disabled="disabled || !floorInput.trim()">跳转</z-button>
    </form>
  </div>
</template>

<style scoped>
.ik-comments-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 8px;
}

.ik-comments-toolbar__jump {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ik-comments-toolbar__jump .ik-comments-toolbar__floor {
  width: 96px;
}
</style>
