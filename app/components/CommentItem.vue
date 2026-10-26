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
import Tooltip from "./ui/tooltip/Tooltip.vue";
import TooltipContent from "./ui/tooltip/TooltipContent.vue";
import TooltipProvider from "./ui/tooltip/TooltipProvider.vue";
import TooltipTrigger from "./ui/tooltip/TooltipTrigger.vue";

const { openGallery } = useLightGallery();

const props = defineProps<{
  comment: Comment;
  index?: number;
  currentUserAuthorId?: string;
  /** 帖子作者 id：评论者是楼主时名字前加「[楼主]」。匿名帖没有 id，不标。 */
  postAuthorId?: string;
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

const isPostAuthor = computed(() =>
  !!props.postAuthorId && props.comment.author?.documentId === props.postAuthorId,
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
  if (typeof props.comment.floor === "number") return `${props.comment.floor}F`;
  if (props.index != null) return `${props.index + 1}F`;
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
  <div class="ik-comment" :class="{ 'ik-comment--self': isOwnComment }" :data-comment-id="featured ? undefined : comment.id">
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
              <template v-if="isPostAuthor">[楼主]</template>{{ comment.author?.name || "匿名用户" }}
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
        <TooltipProvider v-if="replyTo" :delay-duration="450">
          <Tooltip :disabled="!replyTo.comment">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="ik-comment__quote"
                :class="{ 'ik-comment__quote--gone': !replyTo.comment }"
                :disabled="!replyTo.comment"
                :aria-label="replyTo.comment ? `查看 @${replyTo.comment.authorName} 的原评论：${replyTo.comment.excerpt}` : undefined"
                @click="jumpToReplyTarget"
              >
                <template v-if="replyTo.comment">
                  <span class="ik-comment__quote-author">
                    <ArrowUturnLeftIcon class="ik-comment__quote-icon" aria-hidden="true" />
                    <span class="ik-comment__quote-name">回复 @{{ replyTo.comment.authorName }}</span>
                  </span>
                  <span class="ik-comment__quote-text">{{ replyTo.comment.excerpt || "查看原评论" }}</span>
                </template>
                <span v-else class="ik-comment__quote-text">{{ replyTo.deleted ? "原评论已删除" : "原评论不可见" }}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent v-if="replyTo.comment" side="top" align="start" class="ik-comment__quote-preview">
              <span class="ik-comment__quote-preview-name">@{{ replyTo.comment.authorName }}</span>
              <p v-if="replyTo.comment.excerpt" class="ik-comment__quote-preview-text">{{ replyTo.comment.excerpt }}</p>
              <span class="ik-comment__quote-preview-hint">点击跳转到原评论</span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

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
  padding: 16px 0;
}

.ik-comment + .ik-comment {
  border-top: 3px solid #2a2a2a;
}

.ik-comment__main {
  display: flex;
  gap: 14px;
}

.ik-comment__main--target {
  position: relative;
  /* 将负层级的高亮背景留在评论内，避免沉到页面底色后面。 */
  isolation: isolate;
  padding: 16px 12px 20px 12px;
}

/* 进入视口时先用主题色背景给出明显反馈，随后背景渐隐恢复正常。 */
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
  display: block;
  width: 52px;
  height: 52px;
  border: 3px solid #2d2d2d;
  border-radius: 999px;
  object-fit: cover;
  background: #1b1b1b;
  box-sizing: border-box;
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
  font-size: 16px;
  font-weight: 900;
  line-height: 24px;
  color: #e6e6e6;
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
  min-width: 48px;
  padding: 0 10px;
  border-radius: 8px;
  background: #3a3a3a;
  font-size: 15px;
  font-weight: 900;
  color: #8f8f8f;
  line-height: 24px;
  text-align: center;
}

/* 当前登录账户自己的评论：名字和楼层药丸高亮为黄色 */
.ik-comment--self .ik-comment__name {
  color: var(--ik-comment-self, #ffcc00);
}

.ik-comment--self .ik-comment__floor {
  background: var(--ik-comment-self, #ffcc00);
  color: #000;
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
/* 用轻量引用线融入正文；shadcn-vue Tooltip 展示被截断的摘要与跳转提示。 */
.ik-comment__quote {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  max-width: 100%;
  margin-top: 8px;
  padding: 5px 10px;
  border: 0;
  border-left: 2px solid #3a3a3a;
  border-radius: 0 4px 4px 0;
  background: rgba(255, 255, 255, 0.025);
  color: #969696;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  text-align: left;
  cursor: var(--ik-cursor-pointer);
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

.ik-comment__quote:hover:not(:disabled),
.ik-comment__quote:focus-visible {
  border-left-color: var(--ik-primary);
  background: rgba(255, 255, 255, 0.05);
  color: #bbb;
}

.ik-comment__quote:focus-visible {
  outline: 2px solid var(--ik-primary);
  outline-offset: 3px;
}

.ik-comment__quote--gone {
  background: transparent;
  color: #777;
  cursor: default;
}

.ik-comment__quote-author {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: #b0b0b0;
}

.ik-comment__quote-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: #808080;
}

.ik-comment__quote-name,
.ik-comment__quote-text {
  display: block;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ik-comment__quote-name {
  font-weight: 500;
}

.ik-comment__quote-text {
  font-size: 13px;
}

:global(.ik-comment__quote-preview) {
  max-width: min(360px, calc(100vw - 32px));
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.ik-comment__quote-preview-name {
  display: block;
  color: #b0b0b0;
  font-weight: 600;
}

.ik-comment__quote-preview-text {
  margin: 4px 0 0;
  white-space: pre-wrap;
}

.ik-comment__quote-preview-hint {
  display: block;
  margin-top: 6px;
  color: #909090;
  font-size: 11px;
}

/* ── Body ──────────────────────────────────────── */
.ik-comment__body {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.7;
  color: #d6d6d6;
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
    width: 40px;
    height: 40px;
  }

}
</style>
