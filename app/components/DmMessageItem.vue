<script setup lang="ts">
import { computed } from "vue";
import { DocumentTextIcon, ArrowPathIcon, ClipboardDocumentIcon, CheckIcon } from "@heroicons/vue/24/outline";
import type { DmMessage } from "~/types/entities";
import type { EnrichedMessage } from "~/utils/dm-view";
import { hasBubbleLinks, parseBubbleSegments } from "~/utils/dm-view";
import { formatTime, formatFullTime } from "~/utils/time";

/**
 * 单条 DM 消息（Phase 4 拆分自 KnockKnockModal）：
 * 时间分隔行 + system 分界 + 气泡（头像 / 正文 / 操作条 / 引用卡 /
 * AI 工作流时间线 / 推荐阅读）。纯展示组件——派生数据由父级
 * enrichedMessages 一次算好，交互全部 emit 回容器。
 */
const props = defineProps<{
  entry: EnrichedMessage;
  /** 刚复制成功的消息 documentId（操作条「已复制」反馈） */
  copiedId: string | null;
  /** 是否显示「重新生成」（仅会话最后一条 AI 回复且无流式进行中） */
  showRegenerate: boolean;
  regenerating: boolean;
  /** 会话内搜索：当前命中消息高亮 */
  searchHit?: boolean;
}>();

const emit = defineEmits<{
  (e: "contextmenu", evt: MouseEvent, msg: DmMessage): void;
  (e: "profile", url: string | null): void;
  (e: "open-post", documentId: string): void;
  (e: "bubble-link", href: string, evt: Event): void;
  (e: "copy", msg: DmMessage): void;
  (e: "regenerate", msg: DmMessage): void;
  (e: "quote-click", msg: DmMessage): void;
  /** 追问：Workflow/Citation/RelatedPosts 等卡片触发，回填到输入框 */
  (e: "follow-up", text: string): void;
}>();

/** 消息时间 hover 详情：气泡 title 显示完整时间戳 */
const fullTime = computed(() => formatFullTime(props.entry.msg.createdAt));

/** AI 长消息摘要：取首段前 80 字，作为引导语 */
const aiSummary = computed(() => {
  if (!props.entry.aiRich || typeof props.entry.rendered !== "string") return "";
  const text = props.entry.rendered.trim();
  if (!text) return "";
  // 取第一段（按换行或句号分割）
  const firstBlock = text.split(/\n{2,}|\n/).find((s) => s.trim()) ?? "";
  const firstSentence = firstBlock.split(/。/).find((s) => s.trim()) ?? firstBlock;
  const clean = firstSentence.trim().replace(/[#*`_\[\]()]/g, "");
  if (clean.length <= 60) return "";
  return clean.slice(0, 80) + (clean.length > 80 ? "…" : "");
});
</script>

<template>
  <!-- 时间分隔行：首条或与上条间隔 > 5min 时显示 -->
  <div
    v-if="entry.showTime"
    class="ik-knock__time-divider"
    :class="{ 'is-new': entry.isNew }"
  >
    {{ formatTime(entry.msg.createdAt) }}
  </div>
  <!-- system 分界（如「对话已重置」3.3.4）：居中提示，不渲染气泡 -->
  <div
    v-if="entry.msg.kind === 'system'"
    class="ik-knock__sys-divider"
    :data-mid="entry.msg.documentId"
  >
    <span>{{ entry.msg.content }}</span>
  </div>
  <div
    v-else
    class="ik-knock__msg"
    :class="{
      'is-new': entry.isNew,
      'is-mine': entry.isMine,
      'is-ai': entry.aiRich,
      'is-search-hit': !!searchHit,
    }"
    :data-mid="entry.msg.documentId"
    @contextmenu="emit('contextmenu', $event, entry.msg)"
  >
    <div
      class="ik-knock__msg-avatar"
      :class="{ 'is-clickable': entry.avatarClickable }"
      :role="entry.avatarClickable ? 'button' : undefined"
      :tabindex="entry.avatarClickable ? 0 : undefined"
      :aria-hidden="entry.avatarClickable ? undefined : 'true'"
      :aria-label="entry.avatarClickable ? `查看${entry.msg.sender?.name || '用户'}的主页` : undefined"
      @click="emit('profile', entry.profileUrl)"
      @keydown.enter="emit('profile', entry.profileUrl)"
    >
      <img
        v-if="entry.msg.sender?.avatar"
        :src="entry.msg.sender.avatar"
        :alt="entry.msg.sender?.name || ''"
        class="ik-knock__msg-avatar-img"
        draggable="false"
      />
      <img v-else src="/images/default-avatar.webp" alt="" class="ik-knock__msg-avatar-img" draggable="false" />
    </div>
    <div class="ik-knock__msg-body">
      <!-- 3.3 AI 工作流时间线：永远渲染在回答气泡上方 -->
      <AiWorkflowCard
        v-if="entry.aiRich && entry.workflowEvents.length > 0"
        :events="entry.workflowEvents"
        @open-post="emit('open-post', $event)"
        @follow-up="emit('follow-up', $event)"
      />
      <!-- AI 长消息摘要：仅对非流式 AI 长文本显示 -->
      <div
        v-if="aiSummary && !entry.aiStreaming"
        class="ik-knock__msg-summary"
      >
        {{ aiSummary }}
      </div>
      <div
        class="ik-knock__msg-bubble"
        :class="{ 'is-deleted': !!entry.msg.deletedAt, 'is-ai': entry.aiRich }"
        :title="fullTime || undefined"
      >
        <template v-if="typeof entry.rendered === 'object'">
          <CommentBody :content="entry.rendered.content" />
        </template>
        <span
          v-else-if="entry.pendingStream"
          class="ik-knock__msg-typing"
          aria-label="正在输入"
        >
          <span class="ik-knock__typing-dot" />
          <span class="ik-knock__typing-dot" />
          <span class="ik-knock__typing-dot" />
        </span>
        <!-- AI 回复：markdown 富渲染（代码高亮 / 表格 / 复制），
             流式与打字机期间由组件展示光标并跳过高亮 -->
        <AiMessageBody
          v-else-if="entry.aiRich && typeof entry.rendered === 'string'"
          :text="entry.rendered"
          :streaming="entry.aiStreaming"
          @open-post="emit('open-post', $event)"
        />
        <template v-else-if="typeof entry.rendered === 'string' && hasBubbleLinks(entry.rendered)">
          <template v-for="(seg, si) in parseBubbleSegments(entry.rendered)" :key="si">
            <span v-if="seg.type === 'text'">{{ seg.content }}</span>
            <a
              v-else
              :href="seg.href"
              class="ik-knock__msg-link"
              @click="emit('bubble-link', seg.href, $event)"
            >{{ seg.text }}</a>
          </template>
        </template>
        <template v-else>{{ entry.rendered }}</template>
        <span v-if="entry.msg.editedAt && !entry.msg.deletedAt" class="ik-knock__msg-edited">(已编辑)</span>
        <!-- 1.4 气泡 hover 操作条：复制原文（AI 消息为原始 markdown）；
             absolute 悬浮于气泡右上，不占布局 -->
        <div
          v-if="entry.copyable && !entry.aiStreaming"
          class="ik-knock__msg-actions"
        >
          <button
            type="button"
            class="ik-knock__msg-action"
            :class="{ 'is-done': copiedId === entry.msg.documentId }"
            :aria-label="copiedId === entry.msg.documentId ? '已复制' : '复制消息'"
            @click.stop="emit('copy', entry.msg)"
          >
            <CheckIcon
              v-if="copiedId === entry.msg.documentId"
              class="ik-knock__msg-action-icon"
              aria-hidden="true"
            />
            <ClipboardDocumentIcon
              v-else
              class="ik-knock__msg-action-icon"
              aria-hidden="true"
            />
            {{ copiedId === entry.msg.documentId ? "已复制" : "复制" }}
          </button>
          <!-- 2.2 重新生成：仅会话最后一条 AI 回复、且无流式进行中 -->
          <button
            v-if="showRegenerate"
            type="button"
            class="ik-knock__msg-action"
            :disabled="regenerating"
            aria-label="重新生成"
            @click.stop="emit('regenerate', entry.msg)"
          >
            <ArrowPathIcon
              class="ik-knock__msg-action-icon"
              :class="{ 'is-spinning': regenerating }"
              aria-hidden="true"
            />
            重新生成
          </button>
        </div>
      </div>
      <!-- 通知 quote 卡：点击跳到关联委托（postModal） -->
      <button
        v-if="entry.quote"
        type="button"
        class="ik-knock__msg-quote"
        @click="emit('quote-click', entry.msg)"
      >
        <DocumentTextIcon
          class="ik-knock__msg-quote-icon"
          aria-hidden="true"
        />
        <span class="ik-knock__msg-quote-text">
          <span class="ik-knock__msg-quote-label">{{ entry.quote.label }}</span>
          <span class="ik-knock__msg-quote-title">
            {{ entry.quote.title }}
          </span>
        </span>
      </button>
      <!-- 3.5 引用帖子：回答里出现过的 /post/xxx，始终展示在气泡下方 -->
      <AiCitationList
        v-if="entry.aiRich && entry.citations.length > 0"
        :citations="entry.citations"
        @open-post="emit('open-post', $event)"
        @follow-up="emit('follow-up', $event)"
      />
      <!-- 3.4 推荐阅读：回答定稿后展示搜索命中但未引用的帖子 -->
      <AiRelatedPosts
        v-if="entry.aiRich && !entry.aiStreaming && entry.relatedPosts.length > 0"
        :posts="entry.relatedPosts"
        @open-post="emit('open-post', $event)"
        @follow-up="emit('follow-up', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
/* system 分界提示（如「对话已重置」3.3.4） */
.ik-knock__sys-divider {
  display: flex;
  justify-content: center;
  margin: 10px 0;
}

.ik-knock__sys-divider span {
  font-size: 12px;
  color: #888;
  background: rgba(255, 255, 255, 0.05);
  padding: 3px 12px;
  border-radius: 10px;
}

/* 时间分隔行（QQ 风格）：居中、灰色、小字 */
.ik-knock__time-divider {
  align-self: center;
  margin: 6px 0 2px;
  padding: 2px 10px;
  color: rgba(255, 255, 255, 0.32);
  font-size: 12px;
  letter-spacing: 0.5px;
  user-select: none;
}

.ik-knock__msg {
  display: flex;
  /* 参考 chat-generator：头像与气泡间留出昵尖角的位置 */
  gap: 10px;
  align-items: flex-start;
}

/* 会话内搜索：当前命中消息的气泡打黄圈提示 */
.ik-knock__msg.is-search-hit .ik-knock__msg-bubble {
  box-shadow: 0 0 0 2px #fbfe00;
}

.ik-knock__msg-avatar {
  flex-shrink: 0;
  /* 与侧栏会话列表头像保持同尺寸 */
  width: 44px;
  height: 44px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  color: #4a4a4a;
  overflow: hidden;
}

/* 消息头像可点击跳转个人主页 */
.ik-knock__msg-avatar.is-clickable {
  cursor: pointer;
  transition: opacity 140ms ease;
}

.ik-knock__msg-avatar.is-clickable:hover {
  opacity: 0.8;
}

.ik-knock__msg-avatar.is-clickable:focus-visible {
  outline: 2px solid #fbfe00;
  outline-offset: 2px;
}

.ik-knock__msg-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  -webkit-user-drag: none;
}

.ik-knock__msg-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 限制气泡最大宽度，长消息换行不顶满整列 */
  max-width: min(560px, 92%);
}

/* AI 富文本气泡：代码块 / 表格需要更宽的展示区（:has 不支持时回退 560px） */
.ik-knock__msg-body:has(.ik-ai-md) {
  max-width: min(680px, 94%);
}

.ik-knock__msg-bubble {
  position: relative;
  /* w-fit 自适应内容宽度 */
  align-self: flex-start;
  max-width: 100%;
  /* 参考 chat-generator： 0.3125em 0.75em、圆角 0.9375em，与气泡字号成比 */
  padding: 6px 14px;
  background: #ffffff;
  border-radius: 16px;
  color: #4d4d4d;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
  white-space: pre-wrap;
}

/*
 * 左上昵尖角（bubble nipple）：复用 zenless-tools/chat-generator 原版 webp
 * 参考 ChatGeneratorItemArrow.tsx：top: 0.125em; left: -0.4375em; width/height: 0.75em
 */
.ik-knock__msg-bubble::before {
  content: "";
  position: absolute;
  top: 0.125em;
  left: -0.4375em;
  width: 0.75em;
  height: 0.75em;
  background-image: url("/images/chat_message_arrow_left.webp");
  background-size: contain;
  background-repeat: no-repeat;
  pointer-events: none;
}

/*
 * 白底气泡里的 @mention 芯片需要单独配色：
 * 默认 MentionChip 是「黄绿字 + 透明底」，在白底上几乎不可读。
 * 这里用 :deep 穿透 scoped 边界，把它改成「黄底黑字小标签」——
 * 与 KnockKnock 选中态的 #fbfe00 主色一致，整体语言统一。
 */
.ik-knock__msg-bubble :deep(.ik-mention) {
  background-color: #fbfe00;
  color: #000;
  padding: 0 6px;
  border-radius: 4px;
  font-weight: 700;
}

.ik-knock__msg-bubble :deep(.ik-mention:hover),
.ik-knock__msg-bubble :deep(.ik-mention:focus-visible) {
  background-color: #e8eb00;
  color: #000;
}

/* ── 消息入场动画（仅增量到达的新消息，仅动画 transform + opacity 不触发重排） ── */
@keyframes ik-msg-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

.ik-knock__msg.is-new,
.ik-knock__time-divider.is-new {
  animation: ik-msg-enter 300ms ease-out both;
}

/* 流式占位气泡内的加载点（首个 delta 未到达前） */
.ik-knock__msg-typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 1.2em;
  vertical-align: middle;
}

.ik-knock__typing-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  /* 气泡内的加载点需要用深色（白色点在白底气泡上不可见） */
  background: rgba(0, 0, 0, 0.35);
  animation: ik-typing-bounce 1.2s ease-in-out infinite;
}

.ik-knock__typing-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.ik-knock__typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes ik-typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* 引用委托卡片：与正常 DM 区分，hint 标签 + 标题 + 文档图标 */
.ik-knock__msg-quote {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  margin: 0;
  padding: 7px 15px;
  border: 0;
  border-radius: 999px;
  background: #000;
  color: #c8c8c8;
  cursor: pointer;
  text-align: left;
  transition: background-color 140ms ease, box-shadow 140ms ease;
}

.ik-knock__msg-quote:hover {
  /* 与侧栏会话项 hover 一致：浅白底 + 黑/白双层 inset ring */
  background-color: rgba(255, 255, 255, 0.04);
  box-shadow:
    inset 0 0 0 1px #000,
    inset 0 0 0 5px rgba(255, 255, 255, 0.35);
}

.ik-knock__msg-quote-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: rgba(251, 254, 0, 0.85);
}

.ik-knock__msg-quote-text {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.ik-knock__msg-quote-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 1px;
}

.ik-knock__msg-quote-title {
  font-size: 13px;
  color: #fff;
  font-weight: 600;
  /* 单行 ellipsis，避免长标题撑爆气泡 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* ── AI 回复内 markdown 链接样式（白底气泡上需要深色链接） ── */
.ik-knock__msg-link {
  color: #2c58e2;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  transition: color 120ms ease;
}

.ik-knock__msg-link:hover {
  color: #1a3fad;
}

/* 自己发的消息：头像 + 气泡整体右对齐；nipple 改右上 */
.ik-knock__msg.is-mine {
  flex-direction: row-reverse;
}

.ik-knock__msg.is-mine .ik-knock__msg-body {
  align-items: flex-end;
}

.ik-knock__msg.is-mine .ik-knock__msg-bubble {
  align-self: flex-end;
  /* 参考 zenless-tools chat-generator：Right 侧 accent-dark (#2c58e2) + 白字
     是 ZZZ 游戏内蓝色对话框的视觉语言；之前的黄底是项目自创版本，统一回原版 */
  background: #2c58e2;
  color: #fff;
}

/* 右侧 nipple：使用专门的右箭头 webp（zenless-tools chat_message_arrow_right.webp），
   注意右侧偏移 -0.34375em 与左侧 -0.4375em 不同——原始资源箭头形状不对称 */
.ik-knock__msg.is-mine .ik-knock__msg-bubble::before {
  left: auto;
  right: -0.34375em;
  background-image: url("/images/chat_message_arrow_right.webp");
  transform: none;
}

/* 撤回的消息：灰色斜体小占位 */
.ik-knock__msg-bubble.is-deleted {
  background: rgba(255, 255, 255, 0.06) !important;
  color: rgba(255, 255, 255, 0.45) !important;
  font-style: italic;
  font-weight: 500;
}

.ik-knock__msg-bubble.is-deleted::before {
  display: none;
}

/* "(已编辑)" 小标 */
.ik-knock__msg-edited {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 600;
}

/* 自己气泡是蓝底白字 → "(已编辑)" 用半透明白保持层级 */
.ik-knock__msg.is-mine .ik-knock__msg-edited {
  color: rgba(255, 255, 255, 0.7);
}

/* 对端气泡是白底，"(已编辑)"用浅灰 */
.ik-knock__msg:not(.is-mine) .ik-knock__msg-edited {
  color: rgba(0, 0, 0, 0.35);
}

/* ── AI 消息阅读体验增强 ────────────────────── */
/* AI 消息体放宽，让长回答更易阅读（:has 降级到 680px，统一提升到 760px） */
.ik-knock__msg.is-ai .ik-knock__msg-body,
.ik-knock__msg-body:has(.ik-ai-md) {
  max-width: min(760px, 96%);
}

/* AI 消息摘要：轻量引导语 */
.ik-knock__msg-summary {
  align-self: flex-start;
  max-width: 100%;
  padding: 6px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
}

/* AI 气泡：柔和背景，降低与深色 modal 的对比 */
.ik-knock__msg-bubble.is-ai {
  background: #f7f7f7;
  border: 1px solid rgba(0, 0, 0, 0.08);
  color: #333;
  padding: 10px 16px;
  border-radius: 18px;
}

/* AI 气泡左侧尖角颜色同步新背景（使用 CSS 三角替代 webp 资源） */
.ik-knock__msg-bubble.is-ai::before {
  background-image: none;
  top: 0.25em;
  left: -0.5em;
  width: 0;
  height: 0;
  border-top: 0.5em solid transparent;
  border-bottom: 0.5em solid transparent;
  border-right: 0.55em solid #f7f7f7;
}

/* 修复 hover 操作条在 AI 气泡上的颜色：深色按钮在白/浅灰背景上仍合适，保持 */

/* ── 1.4 气泡 hover 操作条（复制）─────────────
   Discord 式：悬浮于气泡右上角、不占布局；触屏无 hover → 长按走上下文菜单 */
.ik-knock__msg-actions {
  position: absolute;
  top: -12px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  visibility: hidden;
  transition: opacity 130ms ease, visibility 130ms ease;
  /* 覆盖气泡的 pre-wrap，避免按钮文案内空白参与排版 */
  white-space: nowrap;
}

.ik-knock__msg-bubble:hover .ik-knock__msg-actions,
.ik-knock__msg-actions:focus-within {
  opacity: 1;
  visibility: visible;
}

.ik-knock__msg-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: #232326;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
  transition: background 120ms ease, color 120ms ease;
}

.ik-knock__msg-action:hover {
  background: #fbfe00;
  color: #000;
}

.ik-knock__msg-action.is-done {
  background: #52d273;
  border-color: #52d273;
  color: #000;
}

.ik-knock__msg-action-icon {
  width: 13px;
  height: 13px;
}

/* 2.2 重新生成：请求进行中禁点 + 图标旋转 */
.ik-knock__msg-action:disabled {
  opacity: 0.55;
  cursor: default;
}

.ik-knock__msg-action-icon.is-spinning {
  animation: ik-spin 0.8s linear infinite;
}

@keyframes ik-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ik-knock__msg.is-new,
  .ik-knock__time-divider.is-new {
    animation: none;
  }
}
</style>
