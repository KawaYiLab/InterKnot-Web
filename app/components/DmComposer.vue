<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ArrowPathIcon, PhotoIcon, XMarkIcon } from "@heroicons/vue/24/outline";
import type { UploadTask } from "~/types/entities";
import InspiraShineBorder from "~/components/inspira/ShineBorder.vue";
import InspiraVanishCanvas from "~/components/inspira/VanishCanvas.vue";

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
  /** 输入框为空时轮播的占位文案（≥2 条才轮播，否则用 placeholder） */
  rotatingPlaceholders?: string[];
  sending: boolean;
  /** 处于编辑消息模式（决定输入框绑定 editingDraft 还是 draft） */
  editing: boolean;
  error: string | null;
  /** AI 流式生成中（且非编辑态）：发送按钮切换为「停止」 */
  streaming: boolean;
  stopping: boolean;
  /** AI 会话示例问题（空时不显示） */
  suggestions?: string[];
  /** 可以附图：显示附图按钮，支持粘贴图片 */
  canAttach?: boolean;
  /** 已选的附图（上传中 / 已上传 / 失败） */
  attachments?: UploadTask[];
}>();

const emit = defineEmits<{
  (e: "send"): void;
  (e: "stop"): void;
  (e: "cancel-edit"): void;
  /** 用户敲键盘：父级节流发送 typing 状态 */
  (e: "typing"): void;
  /** 点击示例问题区的刷新按钮 */
  (e: "refresh-suggestions"): void;
  /** 点附图按钮：打开图片弹窗（上传 / 我的图库） */
  (e: "open-picker"): void;
  /** 粘贴了图片 */
  (e: "attach", files: File[]): void;
  (e: "remove-attachment", index: number): void;
  (e: "retry-attachment", index: number): void;
}>();

const draft = defineModel<string>("draft", { default: "" });
const editingDraft = defineModel<string>("editingDraft", { default: "" });

const composerRef = ref<HTMLTextAreaElement | null>(null);
const vanishRef = ref<InstanceType<typeof InspiraVanishCanvas> | null>(null);

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

const attachmentsUploading = computed(() =>
  (props.attachments ?? []).some((t) => t.status === "pending" || t.status === "compressing" || t.status === "uploading"),
);
const hasReadyAttachments = computed(() =>
  (props.attachments ?? []).some((t) => t.status === "done"),
);

const sendDisabled = computed(
  () =>
    props.disabled ||
    props.sending ||
    (props.editing
      ? !editingDraft.value.trim()
      : attachmentsUploading.value || (!draft.value.trim() && !hasReadyAttachments.value)),
);

const showAttach = computed(() => !!props.canAttach && !props.editing);

/** 轮播占位（Inspira「Placeholders And Vanish Input」）：只在空输入、非编辑态时轮播 */
const PLACEHOLDER_INTERVAL_MS = 3000;
const placeholderIndex = ref(0);
const rotating = computed(
  () => (props.rotatingPlaceholders?.length ?? 0) > 1 && !props.editing && !props.disabled && !draft.value,
);
const rotatingText = computed(() => {
  const list = props.rotatingPlaceholders ?? [];
  return list.length ? list[placeholderIndex.value % list.length] : "";
});
let placeholderTimer: ReturnType<typeof setInterval> | null = null;
watch(
  rotating,
  (on) => {
    if (placeholderTimer) clearInterval(placeholderTimer);
    placeholderTimer = null;
    if (!on || !import.meta.client) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    placeholderTimer = setInterval(() => {
      placeholderIndex.value++;
    }, PLACEHOLDER_INTERVAL_MS);
  },
  { immediate: true },
);
watch(() => props.rotatingPlaceholders, () => {
  placeholderIndex.value = 0;
});
onBeforeUnmount(() => {
  if (placeholderTimer) clearInterval(placeholderTimer);
});

/** 发送：新消息的字先碎成粒子散掉（编辑保存不播） */
const send = () => {
  if (!sendDisabled.value && !props.editing && composerRef.value) vanishRef.value?.play(composerRef.value);
  emit("send");
};

/** 粘贴截图直接附图（只在可附图时拦截，文字照常粘贴） */
const onComposerPaste = (e: ClipboardEvent) => {
  if (!showAttach.value) return;
  const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  e.preventDefault();
  emit("attach", files);
};

const showSuggestions = computed(
  () =>
    props.suggestions &&
    props.suggestions.length > 0 &&
    !props.editing &&
    !props.streaming &&
    !draft.value.trim(),
);

const applySuggestion = (text: string) => {
  draft.value = text;
  emit("send");
};

const onComposerInput = () => {
  autoGrowComposer();
  emit("typing");
};

/** Enter 发送，Shift+Enter 换行（与主流 IM 一致） */
const onComposerKeyDown = (e: KeyboardEvent) => {
  if (e.key !== "Enter") return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return; // 组合键允许换行
  e.preventDefault();
  send();
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
    <!-- AI 示例问题：空输入时展示，点击直接发送 -->
    <div
      v-if="showSuggestions"
      class="ik-knock__composer-suggestions"
    >
      <span class="ik-knock__composer-suggestions-label">大家都在问</span>
      <button
        type="button"
        class="ik-knock__composer-suggestions-refresh"
        aria-label="换一批"
        title="换一批"
        @click="emit('refresh-suggestions')"
      >
        <ArrowPathIcon class="ik-knock__composer-suggestions-refresh-icon" aria-hidden="true" />
      </button>
      <div class="ik-knock__composer-suggestions-chips">
        <button
          v-for="(q, idx) in suggestions"
          :key="idx"
          type="button"
          class="ik-knock__composer-suggestions-chip"
          @click="applySuggestion(q)"
        >
          {{ q }}
        </button>
      </div>
    </div>
    <!-- 附图预览：上传中显示进度，失败可点重试 -->
    <div
      v-if="showAttach && attachments?.length"
      class="ik-knock__composer-attachments"
    >
      <div
        v-for="(task, idx) in attachments"
        :key="task.localId"
        class="ik-knock__composer-attachment"
        :class="{ 'is-error': task.status === 'error' }"
      >
        <img :src="task.previewUrl" :alt="task.filename" class="ik-knock__composer-attachment-img" />
        <button
          v-if="task.status === 'error'"
          type="button"
          class="ik-knock__composer-attachment-state"
          :title="task.error || '上传失败'"
          @click="emit('retry-attachment', idx)"
        >
          重试
        </button>
        <span
          v-else-if="task.status !== 'done'"
          class="ik-knock__composer-attachment-state"
        >{{ Math.round(task.progress) }}%</span>
        <button
          type="button"
          class="ik-knock__composer-attachment-remove"
          aria-label="移除图片"
          @click="emit('remove-attachment', idx)"
        >
          <XMarkIcon class="ik-knock__composer-attachment-remove-icon" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div
      class="ik-knock__composer-row"
      :class="{ 'is-disabled': disabled }"
    >
      <InspiraShineBorder v-if="!disabled" class="ik-knock__composer-shine" :border-width="3" />
      <button
        v-if="showAttach"
        type="button"
        class="ik-knock__composer-attach"
        :disabled="disabled"
        aria-label="添加图片"
        title="添加图片"
        @click="emit('open-picker')"
      >
        <PhotoIcon class="ik-knock__composer-send-icon" aria-hidden="true" />
      </button>
      <div class="ik-knock__composer-field">
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
          :class="{ 'is-rotating': rotating }"
          :placeholder="rotating ? rotatingText : placeholder"
          rows="1"
          maxlength="4000"
          :disabled="disabled"
          @keydown="onComposerKeyDown"
          @input="onComposerInput"
          @paste="onComposerPaste"
        />
        <Transition name="ik-ph">
          <span
            v-if="rotating"
            :key="placeholderIndex"
            class="ik-knock__composer-placeholder"
            aria-hidden="true"
          >{{ rotatingText }}</span>
        </Transition>
        <InspiraVanishCanvas ref="vanishRef" />
      </div>
      <z-button
        v-if="streaming && !editing"
        class="ik-knock__composer-send"
        :disabled="stopping"
        aria-label="停止生成"
        title="停止生成"
        @click="emit('stop')"
      >
        停止
      </z-button>
      <z-button
        v-else
        class="ik-knock__composer-send"
        :disabled="sendDisabled"
        :aria-label="editing ? '保存编辑' : '发送'"
        @click="send"
      >
        {{ editing ? "保存" : "发送" }}
      </z-button>
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

/* 与顶栏 tab 条同款：深灰粗描边 + 黑底点阵，单行时是胶囊 */
.ik-knock__composer-row {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 4px;
  background: #050505 url("/images/tab-bg-point.webp") repeat;
  border-radius: 26px;
  border: 3px solid #313131;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.ik-knock__composer-row:focus-within {
  border-color: #fbfe00;
  box-shadow: 0 0 0 4px rgba(251, 254, 0, 0.12), 0 0 24px rgba(251, 254, 0, 0.12);
}

/* 流光边框叠在静态描边上；聚焦后描边已经是黄色，流光退场 */
.ik-knock__composer-shine {
  transition: opacity 200ms ease;
}

.ik-knock__composer-row:focus-within .ik-knock__composer-shine {
  opacity: 0;
}

.ik-knock__composer-field {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
}

/* pseudo:anonymous / pseudo:system 会话：输入框整体禁用态 */
.ik-knock__composer-row.is-disabled {
  background: #050505;
  border-color: #222;
  cursor: not-allowed;
}

.ik-knock__composer-row.is-disabled .ik-knock__composer-input {
  cursor: not-allowed;
  color: rgba(255, 255, 255, 0.35);
}

.ik-knock__composer-input {
  flex: 1;
  min-height: 40px;
  /* 1.5 自动增高上限：桌面 320px 封顶，小屏跟随视口 */
  max-height: min(40vh, 320px);
  padding: 9px 12px;
  border: 0;
  background: transparent;
  color: #fff;
  caret-color: #fbfe00;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  line-height: 1.45;
  resize: none;
  outline: none;
  overflow-y: auto;
}

.ik-knock__composer-input::placeholder {
  color: rgba(255, 255, 255, 0.32);
  font-weight: 500;
}

.ik-knock__composer-input::selection {
  background: #fbfe00;
  color: #000;
}

/* 轮播占位由下面的浮层来演，原生占位只留给读屏 */
.ik-knock__composer-input.is-rotating::placeholder {
  color: transparent;
}

.ik-knock__composer-placeholder {
  position: absolute;
  top: 9px;
  left: 12px;
  right: 12px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.32);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.45;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}

.ik-ph-enter-active,
.ik-ph-leave-active {
  transition: opacity 300ms ease, transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.ik-ph-enter-from {
  opacity: 0;
  transform: translateY(60%);
}

.ik-ph-leave-to {
  opacity: 0;
  transform: translateY(-60%);
}

/* 发送 / 停止：zzzui 默认按钮 */
.ik-knock__composer-send {
  flex-shrink: 0;
}

.ik-knock__composer-send-icon {
  width: 18px;
  height: 18px;
}

/* 附图按钮：与发送钮同尺寸，弱化成描边色 */
.ik-knock__composer-attach {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: #1c1c1c;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease;
}

.ik-knock__composer-attach:hover:not(:disabled) {
  color: #fbfe00;
  background: #2a2a2a;
}

.ik-knock__composer-attach:disabled {
  color: rgba(255, 255, 255, 0.2);
  cursor: not-allowed;
}

.ik-knock__composer-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 4px;
}

.ik-knock__composer-attachment {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid rgba(255, 255, 255, 0.08);
}

.ik-knock__composer-attachment.is-error {
  border-color: #ff5a5a;
}

.ik-knock__composer-attachment-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ik-knock__composer-attachment-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: default;
}

button.ik-knock__composer-attachment-state {
  cursor: pointer;
  color: #ff8080;
}

.ik-knock__composer-attachment-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  cursor: pointer;
}

.ik-knock__composer-attachment-remove-icon {
  width: 14px;
  height: 14px;
}

/* AI 示例问题：仿 Akasha 大家都在问 */
.ik-knock__composer-suggestions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0 4px 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.ik-knock__composer-suggestions-label {
  font-weight: 500;
}

.ik-knock__composer-suggestions-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  padding: 0;
  transition: color 140ms ease, background 140ms ease;
}

.ik-knock__composer-suggestions-refresh:hover {
  color: #fbfe00;
  background: rgba(255, 255, 255, 0.06);
}

.ik-knock__composer-suggestions-refresh-icon {
  width: 14px;
  height: 14px;
}

.ik-knock__composer-suggestions-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.ik-knock__composer-suggestions-chip {
  flex-shrink: 0;
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.75);
  font-size: 12.5px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}

.ik-knock__composer-suggestions-chip:hover {
  background: rgba(251, 254, 0, 0.1);
  border-color: rgba(251, 254, 0, 0.35);
  color: #fbfe00;
}

@media (prefers-reduced-motion: reduce) {
  .ik-ph-enter-active,
  .ik-ph-leave-active {
    transition: none;
  }
}

@media (max-width: 768px) {
  /* 底部安全区留白，避免被 Home 条遮挡 */
  .ik-knock__composer {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
</style>
