<script setup lang="ts">
/**
 * 评论下方的表情回应条：
 * - 已有回应按 count 降序渲染成芯片，点击 toggle 我方回应
 * - 末尾「+」按钮打开 StickerPicker 追加新表情回应
 * 自管 API 调用，toggle 成功后用后端权威结果覆盖本地 reactions。
 */
import { ref } from "vue";
import { useMessage } from "zenless-ui";
import { FaceSmileIcon } from "@heroicons/vue/24/outline";
import type { CommentReaction } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import { useStickers } from "~/composables/useStickers";
import StickerPicker from "./StickerPicker.vue";

const props = defineProps<{
  commentId: string;
  reactions?: CommentReaction[];
}>();

const emit = defineEmits<{
  update: [reactions: CommentReaction[]];
}>();

const api = useApi();
const auth = useAuthStore();
const loginDialog = useLoginDialog();
const message = useMessage();
const { recordRecent } = useStickers();

const pickerOpen = ref(false);
const pending = ref(false);

const doToggle = async (stickerId: string) => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  if (pending.value || !props.commentId) return;
  pending.value = true;
  try {
    const next = await api.toggleCommentReaction(props.commentId, stickerId);
    emit("update", next);
  } catch (err) {
    message.error(resolveErrorMessage(err, "操作失败"));
  } finally {
    pending.value = false;
  }
};

const openPicker = () => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  pickerOpen.value = !pickerOpen.value;
};

const onPick = (sticker: { documentId: string }) => {
  pickerOpen.value = false;
  recordRecent(sticker.documentId);
  void doToggle(sticker.documentId);
};
</script>

<template>
  <div v-if="reactions?.length || auth.isLogin" class="ik-reaction-bar">
    <button
      v-for="reaction in reactions ?? []"
      :key="reaction.sticker"
      type="button"
      class="ik-reaction-bar__chip"
      :class="{ 'is-mine': reaction.reacted }"
      :disabled="pending"
      :title="reaction.name || undefined"
      @click="doToggle(reaction.sticker)"
    >
      <img :src="reaction.url" :alt="reaction.name || '表情'" draggable="false" />
      <span class="ik-reaction-bar__count">{{ reaction.count }}</span>
    </button>
    <div class="ik-reaction-bar__add-wrap">
      <button
        type="button"
        class="ik-reaction-bar__add"
        title="添加表情回应"
        @click.stop="openPicker"
      >
        <FaceSmileIcon class="ik-reaction-bar__add-icon" />
        <span v-if="!reactions?.length" class="ik-reaction-bar__add-label">回应</span>
      </button>
      <StickerPicker
        v-if="pickerOpen"
        class="ik-reaction-bar__picker"
        @select="onPick"
        @close="pickerOpen = false"
      />
    </div>
  </div>
</template>

<style scoped>
.ik-reaction-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.ik-reaction-bar__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease;
}

.ik-reaction-bar__chip:hover {
  border-color: rgba(255, 255, 255, 0.3);
}

.ik-reaction-bar__chip.is-mine {
  border-color: #bfff09;
  background: rgba(191, 255, 9, 0.12);
}

.ik-reaction-bar__chip img {
  width: 22px;
  height: 22px;
  object-fit: contain;
  user-select: none;
}

.ik-reaction-bar__count {
  font-size: 12px;
  color: #bbb;
  font-weight: 600;
}

.ik-reaction-bar__chip.is-mine .ik-reaction-bar__count {
  color: #bfff09;
}

.ik-reaction-bar__add-wrap {
  position: relative;
}

.ik-reaction-bar__add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: transparent;
  color: #666;
  font-size: 12px;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease;
}

.ik-reaction-bar__add:hover {
  color: #bbb;
  border-color: rgba(255, 255, 255, 0.35);
}

.ik-reaction-bar__add-icon {
  width: 16px;
  height: 16px;
}

.ik-reaction-bar__picker {
  bottom: calc(100% + 6px);
  left: 0;
}
</style>
