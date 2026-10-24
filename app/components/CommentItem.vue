<script setup lang="ts">
import type { Comment } from "~/types/entities";
import { formatTime } from "~/utils/time";
import {
  HandThumbUpIcon,
  ChatBubbleLeftIcon,
  EllipsisVerticalIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/vue/24/outline";
import {
  HandThumbUpIcon as HandThumbUpIconSolid,
  CheckBadgeIcon,
  ArrowUpCircleIcon,
} from "@heroicons/vue/24/solid";
import { toThumbUrl, toCanonicalUrl } from "~/utils/image";

import UserHoverCard from "./UserHoverCard.vue";
import CommentBody from "./CommentBody.vue";

const { openGallery } = useLightGallery();

const props = defineProps<{
  comment: Comment;
  index?: number;
  currentUserAuthorId?: string;
  isPostOwner?: boolean;
  canPin?: boolean;
  canAccept?: boolean;
  /**
   * 所在分区是否开启评论采纳。未开启时不露出「采纳评论」，但已采纳评论的「取消采纳」保留；
   * 能不能点仍由 canAccept（帖主 / 管理员）决定。
   */
  acceptEnabled?: boolean;
  highlightedCommentId?: string | null;
  /**
   * 列表顶部的采纳 / 置顶副本：同一条评论在时间线里还会出现在自己的楼层，
   * 副本不带 data-comment-id，定位与阅读断点都只认时间线里那一条。
   */
  featured?: boolean;
}>();

const emit = defineEmits<{
  likeComment: [comment: Comment];
  replyComment: [comment: Comment];
  /** 点了引用：跳到被回复的那条评论。 */
  jumpTo: [commentId: string];
  deleteComment: [comment: Comment];
  reportComment: [comment: Comment];
  pinComment: [comment: Comment];
  unpinComment: [comment: Comment];
  acceptComment: [comment: Comment];
  unacceptComment: [comment: Comment];
}>();

const isOwnComment = computed(() =>
  !!props.currentUserAuthorId && props.comment.author?.documentId === props.currentUserAuthorId,
);

const canDeleteComment = computed(() => props.isPostOwner === true || isOwnComment.value);

const handleCommentMenuCommand = (command: string | number) => {
  if (command === "pin") emit("pinComment", props.comment);
  else if (command === "unpin") emit("unpinComment", props.comment);
  else if (command === "accept") emit("acceptComment", props.comment);
  else if (command === "unaccept") emit("unacceptComment", props.comment);
  else if (command === "delete" && canDeleteComment.value) emit("deleteComment", props.comment);
  else if (command === "report") emit("reportComment", props.comment);
};

const floorLabel = computed(() => {
  if (typeof props.comment.floor === "number") return `F${props.comment.floor}`;
  if (props.index != null) return `F${props.index + 1}`;
  return "";
});

const replyTo = computed(() => props.comment.replyTo ?? null);

const jumpToReplyTarget = () => {
  const id = replyTo.value?.comment?.id;
  if (id) emit("jumpTo", id);
};

const openCommentImages = (images?: Comment["images"], index = 0) => {
  if (!images?.length) return;
  openGallery(
    images.map((image) => ({
      src: toCanonicalUrl(image.url),
      thumb: toThumbUrl(image.url),
      width: image.width,
      height: image.height,
    })),
    index,
  );
};
</script>

<template>
  <div class="ik-comment" :data-comment-id="featured ? undefined : comment.id">
    <div
      class="ik-comment__main"
      :class="{
        'ik-comment__main--target': !featured && comment.id === highlightedCommentId,
      }"
    >
      <div class="ik-comment__avatar-col">
        <UserHoverCard :author-id="comment.author?.documentId" :clickable="!!comment.author?.documentId">
          <div class="ik-comment__avatar-wrap">
            <img
              :src="comment.author?.avatar || '/images/default-avatar.webp'"
              :alt="comment.author?.name || ''"
              class="ik-comment__avatar"
              decoding="async"
              @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
            />
            <span v-if="comment.author?.level && comment.author?.documentId" class="ik-comment__level">{{ comment.author.level }}</span>
          </div>
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
          <span v-if="comment.author?.isAiAgent" class="ik-comment__ai-badge">AI</span>
          <span v-if="comment.isPinned" class="ik-comment__pinned-badge">
            <ArrowUpCircleIcon class="ik-comment__pinned-icon" />
            置顶
          </span>
          <span v-if="comment.isAccepted" class="ik-comment__accepted-badge">
            <CheckBadgeIcon class="ik-comment__accepted-icon" />
            已采纳
          </span>
          <span v-if="floorLabel" class="ik-comment__floor">{{ floorLabel }}</span>
        </div>

        <!-- 回复了哪条 -->
        <button
          v-if="replyTo"
          type="button"
          class="ik-comment__quote"
          :class="{ 'ik-comment__quote--gone': !replyTo.comment }"
          :disabled="!replyTo.comment"
          @click="jumpToReplyTarget"
        >
          <ArrowUturnLeftIcon class="ik-comment__quote-icon" aria-hidden="true" />
          <span class="ik-comment__quote-floor">F{{ replyTo.floor }}</span>
          <template v-if="replyTo.comment">
            <span class="ik-comment__quote-name">{{ replyTo.comment.authorName }}</span>
            <span class="ik-comment__quote-text">{{ replyTo.comment.excerpt }}</span>
          </template>
          <span v-else class="ik-comment__quote-text">{{ replyTo.deleted ? "原评论已删除" : "原评论不可见" }}</span>
        </button>

        <!-- Body -->
        <div v-if="comment.content?.trim()" class="ik-comment__body">
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
              decoding="async"
              referrerpolicy="no-referrer"
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
              <span v-if="comment.replyCount" class="ik-comment__action-count">{{ comment.replyCount }}</span>
            </button>
            <z-dropdown
              trigger="click"
              size="small"
              class="ik-comment__more"
              direction="auto"
              @command="handleCommentMenuCommand"
            >
              <button type="button" class="ik-comment__action-btn" title="更多操作">
                <EllipsisVerticalIcon class="ik-comment__icon" aria-hidden="true" />
              </button>
              <template #dropdown>
                <z-dropdown-item command="report" :disabled="isOwnComment">举报评论</z-dropdown-item>
                <z-dropdown-item :command="comment.isPinned ? 'unpin' : 'pin'" :disabled="!canPin">
                  {{ comment.isPinned ? '取消置顶' : '置顶评论' }}
                </z-dropdown-item>
                <z-dropdown-item
                  v-if="comment.isAccepted || acceptEnabled"
                  :command="comment.isAccepted ? 'unaccept' : 'accept'"
                  :disabled="!canAccept"
                >
                  {{ comment.isAccepted ? '取消采纳' : '采纳评论' }}
                </z-dropdown-item>
                <z-dropdown-item command="delete" :disabled="!canDeleteComment">删除评论</z-dropdown-item>
              </template>
            </z-dropdown>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   ═══════════════════════════════════════════════ */

/* ── Root ─────────────────────────────────────── */
.ik-comment {
  padding: 14px 0;
}

.ik-comment + .ik-comment {
  border-top: 3px solid #1e1e1e;
}

.ik-comment__main {
  display: flex;
  gap: 12px;
}

.ik-comment__main--target {
  position: relative;
  padding: 16px 12px 20px 12px;
}

/* 进入视口时先用主题色背景给出明显反馈，随后背景渐隐恢复正常，只保留左侧强调线 */
.ik-comment__main--target::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--ik-primary);
  opacity: 0.2;
  pointer-events: none;
  animation: ik-comment-target-flash 1.2s ease-out forwards;
}

.ik-comment__main--target::after {
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

.ik-comment__avatar-wrap {
  position: relative;
  display: inline-block;
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
  position: absolute;
  top: -3px;
  left: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 999px;
  background: #000;
  border: 1px solid #000;
  color: #fff;
  font-size: 9px;
  font-weight: 900;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.ik-comment__ai-badge {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.4;
  color: #111;
  background: var(--ik-primary);
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

.ik-comment__pinned-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ik-primary);
  line-height: 1.5;
}

.ik-comment__pinned-icon {
  width: 16px;
  height: 16px;
}

.ik-comment__accepted-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 700;
  color: #4ade80;
  line-height: 1.5;
}

.ik-comment__accepted-icon {
  width: 16px;
  height: 16px;
}

/* ── 引用：回复了哪条 ─────────────────────────── */
.ik-comment__quote {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin-top: 6px;
  padding: 4px 10px;
  border: none;
  border-left: 3px solid #444;
  border-radius: 0 6px 6px 0;
  background: rgba(255, 255, 255, 0.04);
  color: #888;
  font-size: 12px;
  line-height: 1.5;
  text-align: left;
  cursor: var(--ik-cursor-pointer);
  transition: border-color 140ms ease, color 140ms ease;
}

.ik-comment__quote:hover:not(:disabled) {
  border-left-color: var(--ik-primary);
  color: #bbb;
}

.ik-comment__quote--gone {
  cursor: default;
  font-style: italic;
}

.ik-comment__quote-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.ik-comment__quote-floor,
.ik-comment__quote-name {
  flex-shrink: 0;
  font-weight: 700;
}

.ik-comment__quote-text {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
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

.ik-comment__media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
  margin-top: 10px;
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

:deep(.ik-comment__media-thumb) {
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
  /* 让 icon 始终位于按钮右边缘，数字在左，
     这样三个图标的间距只由外层 gap 决定，不会受点赞数宽度影响 */
  flex-direction: row-reverse;
  justify-content: flex-end;
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
  color: var(--ik-primary);
}

.ik-comment__action-btn--active:hover {
  color: var(--ik-primary);
}

.ik-comment__action-btn--delete:hover {
  color: #ff6b6b;
}

.ik-comment__action-count {
  font-size: 12px;
  font-weight: 500;
}

/* ── 更多操作上拉菜单：自适应方向，避免被父级 overflow 截断 ── */
.ik-comment__more {
  margin-left: 0;
  z-index: 5;
}

.ik-comment__more :deep(.z-dropdown__content) {
  transition: opacity 0.18s ease, transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

/* ── Mobile ────────────────────────────────────── */
@media (max-width: 800px) {
  .ik-comment {
    padding: 12px 0;
  }

  .ik-comment__main {
    gap: 10px;
  }

  .ik-comment__main.ik-comment__main--target {
    padding: 12px 12px 16px 12px;
  }

  .ik-comment__avatar {
    width: 32px;
    height: 32px;
  }

}
</style>
