<script setup lang="ts">
import type { Comment, CommentReply } from "~/types/entities";
import { formatTime } from "~/utils/time";
import { HandThumbUpIcon, ChatBubbleLeftIcon, TrashIcon, FlagIcon } from "@heroicons/vue/24/outline";
import { HandThumbUpIcon as HandThumbUpIconSolid } from "@heroicons/vue/24/solid";
import { toThumbUrl } from "~/utils/image";

import UserHoverCard from "./UserHoverCard.vue";
import CommentBody from "./CommentBody.vue";

const { openGallery } = useLightGallery();

const props = defineProps<{
  comment: Comment;
  index?: number;
  currentUserAuthorId?: string;
  highlightedCommentId?: string | null;
}>();

const emit = defineEmits<{
  likeComment: [comment: Comment];
  likeReply: [reply: CommentReply];
  replyComment: [comment: Comment];
  replyToReply: [reply: CommentReply, parentComment: Comment];
  deleteComment: [comment: Comment];
  deleteReply: [reply: CommentReply, parentComment: Comment];
  reportComment: [comment: Comment];
  reportReply: [reply: CommentReply, parentComment: Comment];
}>();

const isOwnComment = computed(() =>
  !!props.currentUserAuthorId && props.comment.author?.documentId === props.currentUserAuthorId,
);

const isOwnReply = (reply: CommentReply) =>
  !!props.currentUserAuthorId && reply.author?.documentId === props.currentUserAuthorId;

const floorLabel = computed(() =>
  props.index != null ? `F${props.index + 1}` : "",
);

const openCommentImages = (images?: Comment["images"], index = 0) => {
  if (!images?.length) return;
  openGallery(
    images.map((image) => ({
      src: image.url,
      thumb: toThumbUrl(image.url),
      width: image.width,
      height: image.height,
    })),
    index,
  );
};
</script>

<template>
  <div
    class="ik-comment"
    :class="{ 'ik-comment--target': comment.id === highlightedCommentId }"
    :data-comment-id="comment.id"
  >
    <div class="ik-comment__avatar-col">
      <UserHoverCard :author-id="comment.author?.documentId" :clickable="!!comment.author?.documentId">
        <img
          :src="comment.author?.avatar || '/images/default-avatar.webp'"
          :alt="comment.author?.name || ''"
          class="ik-comment__avatar"
          @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
        />
      </UserHoverCard>
    </div>

    <div class="ik-comment__content-col">
      <!-- Author -->
      <div class="ik-comment__author-row">
        <UserHoverCard :author-id="comment.author?.documentId" :clickable="!!comment.author?.documentId">
          <span class="ik-comment__name">
            {{ comment.author?.name || "匿名用户" }}
          </span>
        </UserHoverCard>
        <span v-if="comment.author?.level && comment.author?.documentId" class="ik-comment__level">
          Lv.{{ comment.author.level }}
        </span>
        <span v-if="comment.author?.isAiAgent" class="ik-comment__ai-badge">AI</span>
        <span v-if="floorLabel" class="ik-comment__floor">{{ floorLabel }}</span>
      </div>

      <!-- Body -->
      <div class="ik-comment__body">
        <CommentBody :content="comment.content" />
      </div>

      <div v-if="comment.images?.length" class="ik-comment__media-grid">
        <button
          v-for="(image, imageIndex) in comment.images"
          :key="`${comment.id}-image-${imageIndex}`"
          type="button"
          class="ik-comment__media-item"
          @click="openCommentImages(comment.images, imageIndex)"
        >
          <img
            :src="toThumbUrl(image.url)"
            :alt="comment.author?.name || '评论图片'"
            class="ik-comment__media-thumb"
          />
        </button>
      </div>

      <!-- Footer: date left · interactions right -->
      <div class="ik-comment__footer">
        <div class="ik-comment__meta">
          <span class="ik-comment__time">{{ formatTime(comment.createdAt) }}</span>
        </div>
        <div class="ik-comment__actions">
          <button
            class="ik-comment__action-btn"
            :class="{ 'ik-comment__action-btn--active': comment.liked }"
            @click="emit('likeComment', comment)"
          >
            <HandThumbUpIconSolid v-if="comment.liked" class="ik-comment__icon" />
            <HandThumbUpIcon v-else class="ik-comment__icon" />
            <span v-if="comment.likesCount" class="ik-comment__action-count">{{ comment.likesCount }}</span>
          </button>
          <button class="ik-comment__action-btn" @click="emit('replyComment', comment)">
            <ChatBubbleLeftIcon class="ik-comment__icon" />
          </button>
          <button
            v-if="isOwnComment"
            class="ik-comment__action-btn ik-comment__action-btn--delete"
            @click="emit('deleteComment', comment)"
          >
            <TrashIcon class="ik-comment__icon" />
          </button>
          <button
            v-else
            class="ik-comment__action-btn ik-comment__action-btn--delete"
            title="举报评论"
            @click="emit('reportComment', comment)"
          >
            <FlagIcon class="ik-comment__icon" />
          </button>
        </div>
      </div>

      <!-- ── Replies ─────────────────────────── -->
      <div v-if="comment.replies?.length" class="ik-comment__replies">
        <div
          v-for="reply in comment.replies"
          :key="reply.id"
          class="ik-comment__reply"
          :class="{ 'ik-comment__reply--target': reply.id === highlightedCommentId }"
          :data-comment-id="reply.id"
        >
          <div class="ik-comment__reply-avatar-col">
            <UserHoverCard :author-id="reply.author?.documentId" :clickable="!!reply.author?.documentId">
              <img
                :src="reply.author?.avatar || '/images/default-avatar.webp'"
                :alt="reply.author?.name || ''"
                class="ik-comment__avatar ik-comment__avatar--sm"
                @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
              />
            </UserHoverCard>
          </div>
          <div class="ik-comment__reply-content-col">
            <div class="ik-comment__author-row">
              <UserHoverCard :author-id="reply.author?.documentId" :clickable="!!reply.author?.documentId">
                <span class="ik-comment__name">
                  {{ reply.author?.name || "匿名用户" }}
                </span>
              </UserHoverCard>
              <span v-if="reply.author?.level && reply.author?.documentId" class="ik-comment__level">
                Lv.{{ reply.author.level }}
              </span>
              <span v-if="reply.author?.isAiAgent" class="ik-comment__ai-badge">AI</span>
            </div>
            <div class="ik-comment__body ik-comment__body--reply">
              <CommentBody :content="reply.content" />
            </div>

            <div v-if="reply.images?.length" class="ik-comment__media-grid ik-comment__media-grid--reply">
              <button
                v-for="(image, imageIndex) in reply.images"
                :key="`${reply.id}-image-${imageIndex}`"
                type="button"
                class="ik-comment__media-item"
                @click="openCommentImages(reply.images, imageIndex)"
              >
                <img
                  :src="toThumbUrl(image.url)"
                  :alt="reply.author?.name || '回复图片'"
                  class="ik-comment__media-thumb"
                />
              </button>
            </div>
            <div class="ik-comment__footer">
              <div class="ik-comment__meta">
                <span class="ik-comment__time">{{ formatTime(reply.createdAt) }}</span>
              </div>
              <div class="ik-comment__actions">
                <button
                  class="ik-comment__action-btn"
                  :class="{ 'ik-comment__action-btn--active': reply.liked }"
                  @click="emit('likeReply', reply)"
                >
                  <HandThumbUpIconSolid v-if="reply.liked" class="ik-comment__icon" />
                  <HandThumbUpIcon v-else class="ik-comment__icon" />
                  <span v-if="reply.likesCount" class="ik-comment__action-count">{{ reply.likesCount }}</span>
                </button>
                <button class="ik-comment__action-btn" @click="emit('replyToReply', reply, comment)">
                  <ChatBubbleLeftIcon class="ik-comment__icon" />
                </button>
                <button
                  v-if="isOwnReply(reply)"
                  class="ik-comment__action-btn ik-comment__action-btn--delete"
                  @click="emit('deleteReply', reply, comment)"
                >
                  <TrashIcon class="ik-comment__icon" />
                </button>
                <button
                  v-else
                  class="ik-comment__action-btn ik-comment__action-btn--delete"
                  title="举报回复"
                  @click="emit('reportReply', reply, comment)"
                >
                  <FlagIcon class="ik-comment__icon" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   ═══════════════════════════════════════════════ */

/* ── Root: two-column flex row ────────────────── */
.ik-comment {
  display: flex;
  gap: 12px;
  padding: 14px 0;
}

.ik-comment + .ik-comment {
  border-top: 3px solid #1e1e1e;
}

.ik-comment--target,
.ik-comment__reply--target {
  position: relative;
  padding: 16px 12px 20px 12px;
}

/* 进入视口时先用主题色背景给出明显反馈，随后背景渐隐恢复正常，只保留左侧强调线 */
.ik-comment--target::before,
.ik-comment__reply--target::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--ik-primary);
  opacity: 0.2;
  pointer-events: none;
  animation: ik-comment-target-flash 1.2s ease-out forwards;
}

.ik-comment--target::after,
.ik-comment__reply--target::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 4px;
  background: var(--ik-primary);
  opacity: 0.8;
  pointer-events: none;
}

@keyframes ik-comment-target-flash {
  0% {
    opacity: 0.2;
  }
  100% {
    opacity: 0;
  }
}

.ik-comment__reply--target {
  padding: 12px 12px 16px 12px;
}

/* ── Avatar column ────────────────────────────── */
.ik-comment__avatar-col {
  flex-shrink: 0;
}

.ik-comment__avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  object-fit: cover;
  background: #1b1b1b;
}

.ik-comment__avatar--sm {
  width: 28px;
  height: 28px;
}

/* ── Content column ───────────────────────────── */
.ik-comment__content-col {
  flex: 1;
  min-width: 0;
}

/* ── Author row ───────────────────────────────── */
.ik-comment__author-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ik-comment__name {
  font-size: 14px;
  font-weight: 700;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-comment__level {
  font-size: 11px;
  font-weight: 700;
  font-style: italic;
  color: #BFFF09;
  flex-shrink: 0;
}

.ik-comment__ai-badge {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.4;
  color: #111;
  background: #BFFF09;
  border: 1px solid #111;
  border-radius: 4px;
}

.ik-comment__floor {
  flex-shrink: 0;
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 0 6px 6px 6px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 11px;
  font-weight: 500;
  color: #999;
  line-height: 1.5;
}

/* ── Body ──────────────────────────────────────── */
.ik-comment__body {
  margin-top: 6px;
  font-size: 15px;
  line-height: 1.6;
  color: #f0f0f0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.ik-comment__body--reply {
  font-size: 14px;
}

.ik-comment__media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.ik-comment__media-grid--reply {
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
}

.ik-comment__media-item {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  padding: 0;
  border: 0;
  border-radius: 10px;
  overflow: hidden;
  background: #1d1d1d;
  cursor: var(--ik-cursor-pointer);
}

.ik-comment__media-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* ── Footer: meta (left) + actions (right) ────── */
.ik-comment__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.ik-comment__meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ik-comment__time {
  font-size: 12px;
  color: #666;
}

.ik-comment__actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.ik-comment__action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: #666;
  font-size: 12px;
  cursor: pointer;
  transition: color 140ms ease;
}

.ik-comment__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.ik-comment__action-btn:hover {
  color: #bbb;
}

.ik-comment__action-btn--active {
  color: #BFFF09;
}

.ik-comment__action-btn--active:hover {
  color: #BFFF09;
}

.ik-comment__action-btn--delete:hover {
  color: #ff6b6b;
}

.ik-comment__action-count {
  font-size: 12px;
  font-weight: 500;
}

/* ── Replies ───────────────────────────────────── */
.ik-comment__replies {
  margin-top: 10px;
  padding: 4px 0 0;
  display: flex;
  flex-direction: column;
}

.ik-comment__reply {
  display: flex;
  gap: 10px;
  padding: 10px 0;
}

.ik-comment__reply + .ik-comment__reply {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.ik-comment__reply-avatar-col {
  flex-shrink: 0;
}

.ik-comment__reply-content-col {
  flex: 1;
  min-width: 0;
}

/* ── Mobile ────────────────────────────────────── */
@media (max-width: 800px) {
  .ik-comment {
    gap: 10px;
    padding: 12px 0;
  }

  .ik-comment.ik-comment--target {
    padding: 12px 12px 16px 12px;
  }

  .ik-comment__avatar {
    width: 32px;
    height: 32px;
  }

  .ik-comment__avatar--sm {
    width: 24px;
    height: 24px;
  }
}
</style>
