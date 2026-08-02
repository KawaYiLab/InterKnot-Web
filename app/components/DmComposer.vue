<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { PaperAirplaneIcon, StopIcon } from "@heroicons/vue/24/solid";

/**
 * DM 输入区（Phase 4 拆分自 KnockKnockModal）：
 * 编辑横幅 / 错误提示 / 字数提示 / 自动增高 textarea / 发送·停止按钮。
 * 草稿走 v-model:draft / v-model:editing-draft 受控；发送、停止、
 * 取消编辑、typing 心跳全部 emit 回容器（数据仍由 useDmConversations 单源）。
 */
const props = defineProps<{
  /** pseudo:anonymous / pseudo:system 会话禁止发送 */
  disabled: boolean;
  placeholder: string;
  sending: boolean;
  /** 处于编辑消息模式（决定输入框绑定 editingDraft 还是 draft） */
  editing: boolean;
  error: string | null;
  /** AI 流式生成中（且非编辑态）：发送按钮切换为「停止」 */
  streaming: boolean;
  stopping: boolean;
}>();

const emit = defineEmits<{
  (e: "send"): void;
  (e: "stop"): void;
  (e: "cancel-edit"): void;
  /** 用户敲键盘：父级节流发送 typing 状态 */
  (e: "typing"): void;
}>();

const draft = defineModel<string>("draft", { default: "" });
const editingDraft = defineModel<string>("editingDraft", { default: "" });

const composerRef = ref<HTMLTextAreaElement | null>(null);

/**
 * 1.5 输入框自动增高：内容驱动高度，上限由 CSS max-height（min(40vh,320px)）
 * 约束。先归零再取 scrollHeight，删行时才能正确回缩。
 */
const autoGrowComposer = () => {
  const el = composerRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

// 程序化内容变更（发送清空 / 进入退出编辑态 / 切会话清空）后复位高度；
// 用户敲键盘走 @input 同步调用（避免 watch flush 慢一帧的抖动）
watch([draft, editingDraft, () => props.editing], () => {
  nextTick(autoGrowComposer);
});

/** 1.5 字数提示：仅 >3500 时显示 N/4000（maxlength=4000 与后端一致） */
const activeDraftLength = computed(() =>
  (props.editing ? editingDraft.value : draft.value).length,
);
const showCharCount = computed(() => activeDraftLength.value > 3500);

const sendDisabled = computed(
  () =>
    props.disabled ||
    props.sending ||
    (props.editing ? !editingDraft.value.trim() : !draft.value.trim()),
);

const onComposerInput = () => {
  autoGrowComposer();
  emit("typing");
};

/** Enter 发送，Shift+Enter 换行（与主流 IM 一致） */
const onComposerKeyDown = (e: KeyboardEvent) => {
  if (e.key !== "Enter") return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return; // 组合键允许换行
  e.preventDefault();
  emit("send");
};

/** 父级 beginEdit 时聚焦输入框 */
defineExpose({
  focus: () => composerRef.value?.focus(),
});
</script>

<template>
  <div class="ik-knock__composer">
    <div
      v-if="editing"
      class="ik-knock__composer-edit-banner"
    >
      <span>正在编辑消息</span>
      <button
        type="button"
        class="ik-knock__composer-edit-cancel"
        @click="emit('cancel-edit')"
      >
        取消
      </button>
    </div>
    <div
      v-if="error"
      class="ik-knock__composer-error"
      role="alert"
    >
      {{ error }}
    </div>
    <!-- 1.5 字数提示：>3500 才出现，避免日常干扰 -->
    <div
      v-if="showCharCount"
      class="ik-knock__composer-count"
      :class="{ 'is-danger': activeDraftLength >= 3950 }"
      aria-live="polite"
    >
      {{ activeDraftLength }}/4000
    </div>
    <div
      class="ik-knock__composer-row"
      :class="{ 'is-disabled': disabled }"
    >
      <textarea
        v-if="editing"
        ref="composerRef"
        v-model="editingDraft"
        class="ik-knock__composer-input"
        placeholder="编辑消息…"
        rows="1"
        maxlength="4000"
        :disabled="disabled"
        @keydown="onComposerKeyDown"
        @input="autoGrowComposer"
      />
      <textarea
        v-else
        ref="composerRef"
        v-model="draft"
        class="ik-knock__composer-input"
        :placeholder="placeholder"
        rows="1"
        maxlength="4000"
        :disabled="disabled"
        @keydown="onComposerKeyDown"
        @input="onComposerInput"
      />
      <button
        v-if="streaming && !editing"
        type="button"
        class="ik-knock__composer-send is-stop"
        :disabled="stopping"
        aria-label="停止生成"
        title="停止生成"
        @click="emit('stop')"
      >
        <StopIcon
          class="ik-knock__composer-send-icon"
          aria-hidden="true"
        />
      </button>
      <button
        v-else
        type="button"
        class="ik-knock__composer-send"
        :disabled="sendDisabled"
        :aria-label="editing ? '保存编辑' : '发送'"
        @click="emit('send')"
      >
        <PaperAirplaneIcon
          class="ik-knock__composer-send-icon"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.ik-knock__composer {
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 10px;
  border-top: 2px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-knock__composer-edit-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(251, 254, 0, 0.12);
  color: #fbfe00;
  font-size: 12px;
  font-weight: 700;
}

.ik-knock__composer-edit-cancel {
  border: 0;
  background: transparent;
  color: #fbfe00;
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
  padding: 0;
}

.ik-knock__composer-error {
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 80, 80, 0.15);
  color: #ff8080;
  font-size: 12px;
  font-weight: 600;
}

/* 1.5 字数提示（>3500 才显示；≥3950 转红） */
.ik-knock__composer-count {
  align-self: flex-end;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
}

.ik-knock__composer-count.is-danger {
  color: #ff8080;
}

.ik-knock__composer-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 14px;
  border: 2px solid rgba(255, 255, 255, 0.08);
  transition: border-color 140ms ease;
}

.ik-knock__composer-row:focus-within {
  border-color: #fbfe00;
}

/* pseudo:anonymous / pseudo:system 会话：输入框整体禁用态 */
.ik-knock__composer-row.is-disabled {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.05);
  cursor: not-allowed;
}

.ik-knock__composer-row.is-disabled .ik-knock__composer-input {
  cursor: not-allowed;
  color: rgba(255, 255, 255, 0.35);
}

.ik-knock__composer-input {
  flex: 1;
  min-height: 36px;
  /* 1.5 自动增高上限：桌面 320px 封顶，小屏跟随视口 */
  max-height: min(40vh, 320px);
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.45;
  resize: none;
  outline: none;
  overflow-y: auto;
}

.ik-knock__composer-input::placeholder {
  color: rgba(255, 255, 255, 0.32);
}

.ik-knock__composer-send {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: #fbfe00;
  color: #000;
  cursor: pointer;
  transition: background 140ms ease, transform 100ms ease, opacity 140ms ease;
}

.ik-knock__composer-send:hover:not(:disabled) {
  background: #e8eb00;
}

.ik-knock__composer-send:active:not(:disabled) {
  transform: scale(0.94);
}

.ik-knock__composer-send:disabled {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.3);
  cursor: not-allowed;
}

/* 2.1 停止生成：流式中发送按钮切换为红色停止钮 */
.ik-knock__composer-send.is-stop {
  background: #ff5a5a;
  color: #fff;
}

.ik-knock__composer-send.is-stop:hover:not(:disabled) {
  background: #e64545;
}

.ik-knock__composer-send.is-stop:disabled {
  background: rgba(255, 90, 90, 0.35);
  color: rgba(255, 255, 255, 0.6);
}

.ik-knock__composer-send-icon {
  width: 18px;
  height: 18px;
}

@media (max-width: 768px) {
  /* 底部安全区留白，避免被 Home 条遮挡 */
  .ik-knock__composer {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
</style>
