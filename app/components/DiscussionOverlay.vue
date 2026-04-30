<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMessage } from "zenless-ui";
import type { Comment, Discussion } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import { formatTime } from "~/utils/time";
import { HandThumbUpIcon, StarIcon, ChatBubbleLeftIcon, AtSymbolIcon, FaceSmileIcon, TrashIcon } from "@heroicons/vue/24/outline";
import { HandThumbUpIcon as HandThumbUpIconSolid } from "@heroicons/vue/24/solid";

const DEFAULT_COVER_IMAGE = "/images/default-cover.webp";

const { isOpen: isGalleryOpen, isLoading: isGalleryLoading, loadingProgress: galleryProgress, openGallery, preload: preloadGallery, destroy: destroyPreview } = useLightGallery();

const props = defineProps<{
  discussionId: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const api = useApi();
const auth = useAuthStore();
const discussionModal = useDiscussionModal();
const loginDialog = useLoginDialog();
const confirmDialog = useConfirmDialog();
const message = useMessage();

const discussion = ref<Discussion | null>(null);
const loading = ref(true);
const loadError = ref(false);

const comments = ref<Comment[]>([]);
const commentsCursor = ref("");
const commentsHasNext = ref(true);
const commentsLoading = ref(false);

const newComment = ref("");
const sendingComment = ref(false);
const commentInputBoxRef = ref<HTMLElement | null>(null);
const commentInputFocused = ref(false);
const replyTarget = ref<{ id: string; authorName: string } | null>(null);

const scrollRef = ref<HTMLElement | null>(null);
const covers = computed(() => discussion.value?.covers ?? []);
const hasCovers = computed(() => covers.value.length > 0);
const isCommentEditorActive = computed(() => commentInputFocused.value);
const discussionLikeCount = computed(() => discussion.value?.likesCount ?? 0);
const discussionCommentCount = computed(() => discussion.value?.commentsCount ?? comments.value.length);

const syncCommentInputHeight = async () => {
  await nextTick();
  const textarea = commentInputBoxRef.value?.querySelector("textarea") as HTMLTextAreaElement | null;
  if (!textarea) return;
  textarea.style.height = "42px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 62)}px`;
};

const firstCover = computed(() => covers.value[0] ?? null);
const coverAspectRatio = computed(() => {
  const c = firstCover.value;
  if (c?.width && c?.height && c.width > 0 && c.height > 0) return c.width / c.height;
  return 16 / 9;
});

const openCoverPreview = () => {
  const images = covers.value.map((c) => ({ src: c.url, width: c.width, height: c.height }));
  if (images.length) openGallery(images, 0);
};

/* ── 数据加载 ──────────────────────────────────── */
const loadDiscussion = async () => {
  try {
    discussion.value = await api.getDiscussion(props.discussionId);
    if (discussion.value?.title) {
      discussionModal.setTitle(discussion.value.title);
    }
  } catch (err) {
    loadError.value = true;
    message.error(resolveErrorMessage(err, "获取帖子详情失败"));
  }
};

const loadComments = async () => {
  if (commentsLoading.value || !commentsHasNext.value) return;
  commentsLoading.value = true;
  try {
    const page = await api.getComments(props.discussionId, commentsCursor.value);
    comments.value.push(...page.nodes);
    commentsCursor.value = page.endCursor;
    commentsHasNext.value = page.hasNextPage;
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取评论失败"));
  } finally {
    commentsLoading.value = false;
  }
};

const recordView = async () => {
  if (!discussion.value?.id) return;
  try {
    const views = await api.recordArticleView(discussion.value.id);
    if (typeof views === "number") {
      discussion.value.views = views;
    }
  } catch {
  }
};

const sendComment = async () => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  if (!newComment.value.trim()) return;

  sendingComment.value = true;
  const isReply = !!replyTarget.value;
  try {
    const trimmed = newComment.value.trim();
    const parentId = replyTarget.value?.id;
    const res = await api.addDiscussionComment({
      discussionId: props.discussionId,
      content: trimmed,
      authorDocumentId: auth.user?.authorId,
      parentId,
    });
    const resData = (res as Record<string, unknown>).data as Record<string, unknown> | undefined;
    const localId = String(resData?.documentId || resData?.id || `local-${Date.now()}`);
    const localAuthor: import("~/types/entities").Author = {
      documentId: auth.user?.authorId || auth.user?.documentId,
      name: auth.user?.name || auth.user?.username || "我",
      avatar: auth.user?.avatar,
      level: auth.user?.level,
    };
    if (isReply && parentId) {
      const parent = comments.value.find((c) => c.id === parentId);
      if (parent) {
        parent.replies.push({
          id: localId,
          content: trimmed,
          liked: false,
          likesCount: 0,
          createdAt: new Date().toISOString(),
          author: localAuthor,
        });
      }
    } else {
      comments.value.unshift({
        id: localId,
        content: trimmed,
        liked: false,
        likesCount: 0,
        createdAt: new Date().toISOString(),
        author: localAuthor,
        replies: [],
      });
    }
    const el = commentInputBoxRef.value?.querySelector("textarea, input") as HTMLTextAreaElement | null;
    if (el) {
      el.value = "";
      el.blur();
    }
    newComment.value = "";
    commentInputFocused.value = false;
    replyTarget.value = null;
    syncCommentInputHeight();
    if (discussion.value) {
      discussion.value.commentsCount = (discussion.value.commentsCount ?? 0) + 1;
    }
    message.success(isReply ? "回复发送成功" : "评论发送成功");
  } catch (err) {
    message.error(resolveErrorMessage(err, "发送失败"));
  } finally {
    sendingComment.value = false;
  }
};

const likeArticle = async () => {
  if (!discussion.value) return;
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  try {
    const result = await api.toggleLike("article", discussion.value.id);
    discussion.value.liked = result.liked;
    discussion.value.likesCount = result.likesCount;
    message.success(result.liked ? "已点赞" : "已取消点赞");
  } catch (err) {
    message.error(resolveErrorMessage(err, "点赞失败"));
  }
};

const focusCommentInput = () => {
  commentInputFocused.value = true;
  const input = commentInputBoxRef.value?.querySelector("textarea, input") as HTMLElement | null;
  input?.focus();
  syncCommentInputHeight();
};

const cancelComment = () => {
  const el = commentInputBoxRef.value?.querySelector("textarea, input") as HTMLTextAreaElement | null;
  if (el) {
    el.value = "";
    el.blur();
  }
  newComment.value = "";
  commentInputFocused.value = false;
  replyTarget.value = null;
  syncCommentInputHeight();
};

const startReply = (comment: Comment) => {
  replyTarget.value = { id: comment.id, authorName: comment.author?.name || "匿名用户" };
  focusCommentInput();
};

const startReplyToReply = (reply: Comment["replies"][number], parentComment: Comment) => {
  replyTarget.value = { id: parentComment.id, authorName: reply.author?.name || "匿名用户" };
  focusCommentInput();
};

const isOwner = computed(() => {
  if (!auth.isLogin || !discussion.value?.author?.documentId) return false;
  return auth.user?.authorId === discussion.value.author.documentId;
});

const deletingArticle = ref(false);

const handleDeleteArticle = async () => {
  if (!discussion.value?.id) return;
  const ok = await confirmDialog.open({ title: "删除帖子", message: "确定删除这篇帖子吗？此操作不可恢复。", confirmText: "删除", danger: true });
  if (!ok) return;
  deletingArticle.value = true;
  try {
    await api.deleteArticle(discussion.value.id);
    message.success("帖子已删除");
    emit("close");
  } catch (err) {
    message.error(resolveErrorMessage(err, "删除帖子失败"));
  } finally {
    deletingArticle.value = false;
  }
};

const showCollectComingSoon = () => {
  message.warning("收藏功能即将开放");
};

const likeComment = async (comment: Comment) => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  try {
    const result = await api.toggleLike("comment", comment.id);
    comment.liked = result.liked;
    comment.likesCount = result.likesCount;
  } catch (err) {
    message.error(resolveErrorMessage(err, "评论点赞失败"));
  }
};

const likeReply = async (reply: Comment["replies"][number]) => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  try {
    const result = await api.toggleLike("comment", reply.id);
    reply.liked = result.liked;
    reply.likesCount = result.likesCount;
  } catch (err) {
    message.error(resolveErrorMessage(err, "回复点赞失败"));
  }
};

const handleDeleteComment = async (comment: Comment) => {
  const ok = await confirmDialog.open({ title: "删除评论", message: "确定删除这条评论吗？", confirmText: "删除", danger: true });
  if (!ok) return;
  try {
    await api.deleteComment(comment.id);
    comments.value = comments.value.filter((c) => c.id !== comment.id);
    if (discussion.value) {
      discussion.value.commentsCount = Math.max(0, (discussion.value.commentsCount ?? 0) - 1 - (comment.replies?.length ?? 0));
    }
    message.success("评论已删除");
  } catch (err) {
    message.error(resolveErrorMessage(err, "删除评论失败"));
  }
};

const handleDeleteReply = async (reply: Comment["replies"][number], parentComment: Comment) => {
  const ok = await confirmDialog.open({ title: "删除回复", message: "确定删除这条回复吗？", confirmText: "删除", danger: true });
  if (!ok) return;
  try {
    await api.deleteComment(reply.id);
    parentComment.replies = parentComment.replies.filter((r) => r.id !== reply.id);
    if (discussion.value) {
      discussion.value.commentsCount = Math.max(0, (discussion.value.commentsCount ?? 0) - 1);
    }
    message.success("回复已删除");
  } catch (err) {
    message.error(resolveErrorMessage(err, "删除回复失败"));
  }
};

/* ── 关闭 / 键盘 ──────────────────────────────── */
const handleClose = () => {
  emit("close");
};

const onBackdropClick = (e: MouseEvent) => {
  if (e.target === e.currentTarget) {
    handleClose();
  }
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape" && !isGalleryOpen.value) {
    if (isCommentEditorActive.value) {
      cancelComment();
    } else {
      handleClose();
    }
  }
};

/* ── 当 discussionId 变化时重新加载 ─────────────── */
const resetAndLoad = async () => {
  discussion.value = null;
  comments.value = [];
  commentsCursor.value = "";
  commentsHasNext.value = true;
  loadError.value = false;
  newComment.value = "";
  commentInputFocused.value = false;
  replyTarget.value = null;
  loading.value = true;
  if (scrollRef.value) {
    scrollRef.value.scrollTop = 0;
  }
  await loadDiscussion();
  await Promise.all([recordView(), loadComments()]);
  loading.value = false;
};

watch(
  () => props.discussionId,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      resetAndLoad();
    }
  },
);

watch(newComment, () => {
  syncCommentInputHeight();
});

onMounted(async () => {
  window.addEventListener("keydown", onKeyDown);
  preloadGallery();
  loading.value = true;
  await loadDiscussion();
  await Promise.all([recordView(), loadComments()]);
  loading.value = false;
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  destroyPreview();
});
</script>

<template>
  <div class="ik-overlay" @click="onBackdropClick">
      <!-- ── 斜线纹理背景（ZZZ PatternPainter） ──── -->
      <div class="ik-overlay__stripe" aria-hidden="true"></div>

      <!-- ── 弹窗主体 ────────────────────────────── -->
      <div class="ik-dialog">
        <!-- 外边框（半透明白色，三圆角） -->
        <div class="ik-dialog__outer">
          <!-- 内边框（纯黑，三圆角） -->
          <div class="ik-dialog__inner">
            <!-- ── Header Bar ─────────────────────── -->
            <div class="ik-dialog__header">
              <div class="ik-dialog__header-left">
                <div class="ik-dialog__avatar-shell">
                  <img
                    v-if="discussion"
                    :src="discussion.author.avatar || '/images/default-avatar.webp'"
                    :alt="discussion.author.name || ''"
                    class="ik-dialog__avatar"
                    @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                  />
                  <div v-else class="ik-skel" style="width:100%;height:100%;border-radius:999px"></div>
                </div>
                <div v-if="discussion" class="ik-dialog__author-info">
                  <div class="ik-dialog__author-row">
                    <span class="ik-dialog__author-name">
                      {{ discussion.author.name || "匿名用户" }}
                    </span>
                    <span v-if="discussion.author.level" class="ik-dialog__level">
                      Lv.{{ discussion.author.level }}
                    </span>
                  </div>
                  <span class="ik-dialog__time">
                    {{ formatTime(discussion.createdAt) }}
                  </span>
                </div>
                <div v-else class="ik-dialog__author-info">
                  <div class="ik-skel" style="width:100px;height:20px;border-radius:3px"></div>
                  <div class="ik-skel" style="width:60px;height:16px;border-radius:3px"></div>
                </div>
              </div>
              <button class="ik-dialog__close" aria-label="关闭" @click="handleClose">
                <img src="/images/close-btn.webp" alt="关闭" class="ik-dialog__close-img" draggable="false" />
              </button>
              <!-- ── Gallery Loading Progress ────────── -->
              <div class="ik-dialog__gallery-progress" :class="{ 'is-active': isGalleryLoading }">
                <div class="ik-dialog__gallery-progress-bar" :style="{ width: `${galleryProgress}%` }" />
              </div>
            </div>

            <!-- ── Content Area ───────────────────── -->
            <div v-if="loading" class="ik-dialog__body">
              <!-- 骨架屏：左栏 -->
              <div class="ik-dialog__left">
                <div class="ik-dialog__left-scroll">
                  <div class="ik-dialog__cover-wrap">
                    <div class="ik-dialog__cover-border">
                      <div class="ik-skel ik-skel--cover"></div>
                    </div>
                  </div>
                  <div class="ik-dialog__detail">
                    <div class="ik-skel ik-skel--title"></div>
                    <div class="ik-skel ik-skel--line" style="width:100%"></div>
                    <div class="ik-skel ik-skel--line" style="width:90%"></div>
                    <div class="ik-skel ik-skel--line" style="width:75%"></div>
                    <div class="ik-skel ik-skel--line" style="width:60%"></div>
                  </div>
                </div>
              </div>
              <!-- 骨架屏：右栏 -->
              <div class="ik-dialog__right">
                <div style="flex:1;padding:16px;overflow:hidden">
                  <div v-for="n in 4" :key="n" style="display:flex;gap:12px;padding:14px 0" :style="n > 1 ? 'border-top:1px solid #1e1e1e' : ''">
                    <div style="flex-shrink:0">
                      <div class="ik-skel" style="width:36px;height:36px;border-radius:999px"></div>
                    </div>
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;align-items:center;gap:6px">
                        <div class="ik-skel" style="width:80px;height:14px;border-radius:3px"></div>
                        <div class="ik-skel" style="width:32px;height:12px;border-radius:3px"></div>
                        <div class="ik-skel" style="margin-left:auto;width:28px;height:18px;border-radius:0 6px 6px 6px"></div>
                      </div>
                      <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
                        <div class="ik-skel" style="width:95%;height:14px;border-radius:3px"></div>
                        <div class="ik-skel" style="width:60%;height:14px;border-radius:3px"></div>
                      </div>
                      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
                        <div class="ik-skel" style="width:60px;height:12px;border-radius:3px"></div>
                        <div style="display:flex;align-items:center;gap:16px;color:#666">
                          <HandThumbUpIcon style="width:16px;height:16px" />
                          <ChatBubbleLeftIcon style="width:16px;height:16px" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="ik-dialog__actions">
                  <div class="ik-engage-bar">
                    <div class="ik-engage-bar__main">
                      <div class="ik-engage-bar__content-edit" style="pointer-events:none">
                        <div class="ik-engage-bar__placeholder">
                          <img
                            :src="auth.user?.avatar || '/images/default-avatar.webp'"
                            alt=""
                            class="ik-engage-bar__placeholder-avatar"
                          />
                          <span>说点什么...</span>
                        </div>
                      </div>
                      <div class="ik-engage-bar__interact-container">
                        <div class="ik-engage-bar__buttons">
                          <button type="button" class="ik-engage-bar__action" disabled>
                            <HandThumbUpIcon class="ik-engage-icon" aria-hidden="true" />
                            <span>点赞</span>
                          </button>
                          <button type="button" class="ik-engage-bar__action" disabled>
                            <StarIcon class="ik-engage-icon" aria-hidden="true" />
                            <span>收藏</span>
                          </button>
                          <button type="button" class="ik-engage-bar__action" disabled>
                            <ChatBubbleLeftIcon class="ik-engage-icon" aria-hidden="true" />
                            <span>0</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else-if="loadError" class="ik-dialog__error">
              加载失败，请关闭后重试
            </div>

            <template v-else-if="discussion">
              <!-- 桌面端：双栏布局 -->
              <div class="ik-dialog__body">
                <!-- 左栏：封面 + 正文 -->
                <div class="ik-dialog__left">
                  <div class="ik-dialog__left-scroll" ref="scrollRef">
                    <!-- 封面 -->
                    <div class="ik-dialog__cover-wrap">
                      <div
                        class="ik-dialog__cover-border"
                        :style="{ aspectRatio: String(coverAspectRatio) }"
                      >
                        <img
                          :src="firstCover?.url || DEFAULT_COVER_IMAGE"
                          :alt="hasCovers ? discussion.title : 'default cover'"
                          class="ik-dialog__cover"
                          @click="hasCovers && openCoverPreview()"
                          @error="($event.target as HTMLImageElement).src = DEFAULT_COVER_IMAGE"
                        />
                        <span v-if="covers.length > 1" class="ik-dialog__cover-count">
                          {{ covers.length }} 张
                        </span>
                      </div>
                    </div>

                    <!-- 正文 -->
                    <div class="ik-dialog__detail">
                      <h1 class="ik-dialog__title">{{ discussion.title }}</h1>
                      <div v-if="discussion.body" class="ik-dialog__content" v-html="discussion.body"></div>
                      <p v-else-if="discussion.bodyText" class="ik-dialog__content">
                        {{ discussion.bodyText }}
                      </p>
                      <p v-else class="ik-dialog__content" style="color: #808080">
                        暂无正文内容
                      </p>
                    </div>
                  </div>
                </div>

                <!-- 右栏：评论 + 操作栏 -->
                <div class="ik-dialog__right">
                  <div class="ik-dialog__comments-scroll">
                    <div class="ik-dialog__comments-inner">
                      <div v-if="!comments.length" class="ik-empty" style="padding: 40px 0">暂时还没有评论</div>
                      <CommentItem
                        v-for="(comment, idx) in comments"
                        :key="comment.id"
                        :comment="comment"
                        :index="idx"
                        :current-user-author-id="auth.user?.authorId"
                        @like-comment="likeComment"
                        @like-reply="likeReply"
                        @reply-comment="startReply"
                        @reply-to-reply="startReplyToReply"
                        @delete-comment="handleDeleteComment"
                        @delete-reply="handleDeleteReply"
                      />
                      <div v-if="commentsHasNext" class="ik-dialog__load-more">
                        <z-button :loading="commentsLoading" @click="loadComments">加载更多评论</z-button>
                      </div>
                      <div v-else-if="comments.length" class="ik-dialog__load-more">
                        <span class="ik-meta">- 评论已全部加载 -</span>
                      </div>
                    </div>
                  </div>

                  <!-- 底部操作栏 -->
                  <div class="ik-dialog__actions" :class="{ 'ik-dialog__actions--active': isCommentEditorActive }">
                    <!-- 评论输入 -->
                    <div class="ik-engage-bar">
                      <div class="ik-engage-bar__main">
                        <div ref="commentInputBoxRef" class="ik-engage-bar__content-edit" @click="focusCommentInput">
                          <z-input
                            v-model="newComment"
                            type="textarea"
                            class="ik-engage-bar__textarea"
                            placeholder=""
                            @focus="commentInputFocused = true"
                            @input="syncCommentInputHeight"
                            @keydown.enter.exact.prevent="sendComment"
                          />
                          <div v-if="replyTarget && isCommentEditorActive" class="ik-engage-bar__reply-hint">
                            <span>回复 {{ replyTarget.authorName }}</span>
                            <button type="button" class="ik-engage-bar__reply-close" @click="replyTarget = null">✕</button>
                          </div>
                          <div v-if="!isCommentEditorActive && !newComment.trim()" class="ik-engage-bar__placeholder">
                            <img
                              :src="auth.user?.avatar || '/images/default-avatar.webp'"
                              alt=""
                              class="ik-engage-bar__placeholder-avatar"
                              @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                            />
                            <span>说点什么...</span>
                          </div>
                        </div>

                        <div class="ik-engage-bar__interact-container">
                          <div class="ik-engage-bar__buttons">
                            <button
                              type="button"
                              class="ik-engage-bar__action"
                              :class="{ 'ik-engage-bar__action--active': discussion.liked }"
                              @click="likeArticle"
                            >
                              <HandThumbUpIconSolid v-if="discussion.liked" class="ik-engage-icon" aria-hidden="true" />
                              <HandThumbUpIcon v-else class="ik-engage-icon" aria-hidden="true" />
                              <span>{{ discussionLikeCount > 0 ? discussionLikeCount : '点赞' }}</span>
                            </button>
                            <button type="button" class="ik-engage-bar__action" @click="showCollectComingSoon">
                              <StarIcon class="ik-engage-icon" aria-hidden="true" />
                              <span>收藏</span>
                            </button>
                            <button type="button" class="ik-engage-bar__action" @click="focusCommentInput">
                              <ChatBubbleLeftIcon class="ik-engage-icon" aria-hidden="true" />
                              <span>{{ discussionCommentCount }}</span>
                            </button>
                            <button
                              v-if="isOwner"
                              type="button"
                              class="ik-engage-bar__action ik-engage-bar__action--danger"
                              :disabled="deletingArticle"
                              @click="handleDeleteArticle"
                            >
                              <TrashIcon class="ik-engage-icon" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div class="ik-engage-bar__bottom">
                        <div class="ik-engage-bar__bottom-inner">
                          <div class="ik-engage-bar__left-icons">
                            <button type="button" class="ik-engage-bar__tool" aria-label="@">
                              <AtSymbolIcon class="ik-engage-icon" aria-hidden="true" />
                            </button>
                            <button type="button" class="ik-engage-bar__tool" aria-label="表情">
                              <FaceSmileIcon class="ik-engage-icon" aria-hidden="true" />
                            </button>
                          </div>
                          <div class="ik-engage-bar__right-btns">
                            <button
                              type="button"
                              class="ik-engage-bar__submit"
                              :disabled="!newComment.trim() || sendingComment"
                              @click="sendComment"
                            >
                              {{ sendingComment ? "发送中" : "发送" }}
                            </button>
                            <button type="button" class="ik-engage-bar__cancel" @click="cancelComment">
                              取消
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   ZZZ-Style Discussion Overlay
   Matches Flutter: showZZZDialog + DiscussionPage
   ═══════════════════════════════════════════════ */

/* ── Backdrop ──────────────────────────────────── */
.ik-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

/* 45° 斜线纹理 (PatternPainter) */
.ik-overlay__stripe {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    40deg,
    transparent,
    transparent 3.5px,
    rgba(255, 255, 255, 0.09) 4.5px,
    rgba(255, 255, 255, 0.09) 7.5px,
    transparent 8.5px
  );
}

/* ── Dialog Shell ──────────────────────────────── */
.ik-dialog {
  position: relative;
  width: 70%;
  height: 70%;
  /* desktop 缩放 1.1x → 实际占 77% */
  transform: scale(1.1);
  transform-origin: center;
}

/* 外边框：半透明白色，三圆角（左上/左下/右下） */
.ik-dialog__outer {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: rgba(255, 255, 255, 0.23);
  border-radius: 16px 0 16px 16px;
}

/* 内边框：纯黑 */
.ik-dialog__inner {
  width: 100%;
  height: 100%;
  padding: 2px;
  background: #000;
  border-radius: 16px 0 16px 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Header Bar ────────────────────────────────── */
.ik-dialog__header {
  position: relative;
  display: flex;
  align-items: center;
  padding: 8px 16px;
  gap: 8px;
  flex-shrink: 0;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #161616 0%, #080808 100%);
}

.ik-dialog__gallery-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 3px;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  z-index: 1;
  transition: opacity 0.3s ease;
}

.ik-dialog__gallery-progress.is-active {
  opacity: 1;
}

.ik-dialog__gallery-progress-bar {
  height: 100%;
  background: #fbfe00;
  box-shadow: 0 0 8px rgba(251, 254, 0, 0.6);
  transition: width 0.2s ease;
}

.ik-dialog__header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.ik-dialog__avatar-shell {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 3px solid #2d2d2d;
  overflow: hidden;
}

.ik-dialog__avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 999px;
  background: #1b1b1b;
}

.ik-dialog__avatar--placeholder {
  background: #2a2a2a;
}

.ik-dialog__author-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ik-dialog__author-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ik-dialog__author-name {
  font-size: 16px;
  font-weight: 700;
  line-height: 20px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-dialog__level {
  font-size: 12px;
  font-weight: 700;
  font-style: italic;
  line-height: 20px;
  color: #d7ff00;
  flex-shrink: 0;
}

.ik-dialog__time {
  font-size: 12px;
  line-height: 16px;
  color: #808080;
}

.ik-engage-bar__action--danger {
  color: #ff6b6b;
}

.ik-engage-bar__action--danger:hover {
  color: #ff4040;
}

.ik-engage-bar__action--danger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ik-dialog__close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: opacity 140ms ease, transform 140ms ease;
}

.ik-dialog__close:hover {
  opacity: 0.85;
  transform: scale(1.08);
}

.ik-dialog__close:active {
  transform: scale(0.95);
}

.ik-dialog__close-img {
  height: 32px;
  width: auto;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

/* ── Skeleton ──────────────────────────────────── */
@keyframes ik-shimmer {
  0% { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}

.ik-skel {
  border-radius: 6px;
  background: linear-gradient(90deg, #1a1a1a 25%, #252525 50%, #1a1a1a 75%);
  background-size: 800px 100%;
  animation: ik-shimmer 1.6s ease infinite;
}

.ik-skel--cover {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
}

.ik-skel--title {
  width: 55%;
  height: 26px;
  margin-bottom: 16px;
  border-radius: 4px;
}

.ik-skel--line {
  height: 14px;
  margin-top: 8px;
  border-radius: 3px;
}

/* ── Error ─────────────────────────────────────── */
.ik-dialog__error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: #ffb1b1;
  background: #121212;
  text-align: center;
}

/* ── Body (两栏 / 单栏) ───────────────────────── */
.ik-dialog__body {
  flex: 1;
  display: flex;
  min-height: 0;
  background: #121212;
}

/* ── Left Column ───────────────────────────────── */
.ik-dialog__left {
  flex: 3;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ik-dialog__left-scroll {
  flex: 1;
  overflow-y: auto;
  margin: 16px 8px 16px 16px;
  background: #070707;
  border-radius: 16px;
  /* 隐藏滚动条 */
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.ik-dialog__left-scroll::-webkit-scrollbar {
  display: none;
}

/* 封面 */
.ik-dialog__cover-wrap {
  padding: 16px 24px 16px 16px;
}

.ik-dialog__cover-border {
  position: relative;
  width: 100%;
  max-height: 50vh;
  border-radius: 12px;
  border: 4px solid #313132;
  overflow: hidden;
  background: #0a0a0a;
}

.ik-dialog__cover {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: var(--ik-cursor-pointer);
}

.ik-dialog__cover-count {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 2px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
}

/* 正文 */
.ik-dialog__detail {
  padding: 0 16px 32px;
}

.ik-dialog__title {
  margin: 0 0 16px;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 0.5px;
  color: #fff;
}

.ik-dialog__content {
  margin: 0;
  font-size: 16px;
  line-height: 1.7;
  color: #e0e0e0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.ik-dialog__content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  cursor: pointer;
}

.ik-dialog__content :deep(a) {
  color: #6f9cff;
  text-decoration: underline;
}

.ik-dialog__content :deep(pre) {
  background: #1a1a1a;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}

.ik-dialog__content :deep(code) {
  background: #1a1a1a;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
}

.ik-dialog__content :deep(blockquote) {
  border-left: 4px solid #d7ff00;
  padding-left: 16px;
  margin: 12px 0;
  color: #b0b0b0;
}

/* ── Right Column ──────────────────────────────── */
.ik-dialog__right {
  flex: 2;
  min-width: 0;
  display: flex;
  flex-direction: column;
  margin: 16px 16px 16px 8px;
  background: #070707;
  border-radius: 16px;
  overflow: hidden;
}

.ik-dialog__comments-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.ik-dialog__comments-scroll::-webkit-scrollbar {
  display: none;
}

.ik-dialog__comments-inner {
  width: 100%;
  min-height: 100%;
  padding: 16px;
  box-sizing: border-box;
}

.ik-dialog__comments-inner {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ik-dialog__load-more {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

/* ── Actions Bar ───────────────────────────────── */
.ik-dialog__actions {
  flex-shrink: 0;
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(7, 7, 7, 0.98);
  border-top: 1px solid #202020;
}

.ik-dialog__input-bar {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.ik-dialog__comment-input {
  flex: 1;
}

.ik-dialog__send-btn {
  flex-shrink: 0;
}

.ik-engage-bar {
  display: flex;
  flex-direction: column;
  color: #f5f5f5;
}

.ik-engage-bar__main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  overflow: hidden;
}

.ik-engage-bar__content-edit {
  position: relative;
  flex: 1 1 0%;
  min-width: 0;
  min-height: 44px;
  cursor: text;
  transition: flex-basis 220ms cubic-bezier(0.22, 1, 0.36, 1),
              border-radius 160ms ease;
}

.ik-dialog__actions--active .ik-engage-bar__content-edit {
  flex-basis: 100%;
}

.ik-engage-bar__textarea {
  width: 100%;
}

.ik-engage-bar__textarea :deep(.z-input),
.ik-engage-bar__textarea :deep(.z-textarea) {
  min-height: 44px;
  max-height: 64px;
  border: 1px solid #303030 !important;
  border-radius: 999px !important;
  box-shadow: none !important;
  background: #171717 !important;
  overflow: hidden;
  transition: border-color 160ms ease,
              background-color 160ms ease,
              border-radius 160ms ease;
}

.ik-engage-bar__textarea :deep(.z-input::after),
.ik-engage-bar__textarea :deep(.z-textarea::after) {
  display: none !important;
}

.ik-dialog__actions--active .ik-engage-bar__textarea :deep(.z-input),
.ik-dialog__actions--active .ik-engage-bar__textarea :deep(.z-textarea) {
  border-color: #4a4a4a !important;
  border-radius: 20px !important;
  background: #111 !important;
}

.ik-engage-bar__textarea :deep(.z-input:hover),
.ik-engage-bar__textarea :deep(.z-input.is-focused),
.ik-engage-bar__textarea :deep(.z-textarea:hover),
.ik-engage-bar__textarea :deep(.z-textarea.is-focused) {
  box-shadow: none !important;
}

.ik-engage-bar__textarea :deep(.z-input__inner),
.ik-engage-bar__textarea :deep(.z-textarea__inner),
.ik-engage-bar__textarea :deep(textarea) {
  height: 42px;
  min-height: 42px;
  max-height: 62px;
  padding: 11px 16px !important;
  border: none;
  outline: none;
  box-shadow: none;
  resize: none !important;
  overflow-y: auto;
  background: transparent !important;
  color: #f5f5f5 !important;
  font: inherit;
  font-size: 14px !important;
  line-height: 20px !important;
  box-sizing: border-box;
}

.ik-engage-bar__textarea :deep(.z-input__inner::placeholder),
.ik-engage-bar__textarea :deep(.z-textarea__inner::placeholder),
.ik-engage-bar__textarea :deep(textarea::placeholder) {
  color: transparent;
}

.ik-engage-bar__reply-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 0;
  font-size: 12px;
  color: #d7ff00;
}

.ik-engage-bar__reply-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: #999;
  font-size: 11px;
  cursor: pointer;
  border-radius: 999px;
  transition: color 140ms ease, background-color 140ms ease;
}

.ik-engage-bar__reply-close:hover {
  color: #fff;
  background: #333;
}

.ik-engage-bar__placeholder {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  color: #8b8b8b;
  font-size: 14px;
  pointer-events: none;
}

.ik-engage-bar__placeholder-avatar {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  object-fit: cover;
  background: #2a2a2a;
}

.ik-engage-bar__interact-container {
  flex: none;
  width: auto;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  transform: translateX(0);
  transition: width 220ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity 140ms ease,
              transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.ik-dialog__actions--active .ik-engage-bar__interact-container {
  width: 0;
  min-width: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateX(36px);
  pointer-events: none;
}

.ik-engage-bar__buttons {
  display: flex;
  align-items: center;
  gap: 14px;
}

.ik-engage-bar__action,
.ik-engage-bar__tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: #f1f1f1;
  cursor: pointer;
  transition: color 140ms ease, transform 140ms ease;
}

.ik-engage-bar__action {
  gap: 4px;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.ik-engage-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.ik-engage-bar__action:hover,
.ik-engage-bar__tool:hover {
  color: var(--ik-primary);
}

.ik-engage-bar__action--active {
  color: var(--ik-primary);
}

.ik-engage-bar__action:active,
.ik-engage-bar__tool:active {
  transform: scale(0.94);
}

.ik-engage-bar__bottom {
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateY(-4px);
  transition: max-height 180ms ease, opacity 140ms ease, transform 180ms ease;
}

.ik-dialog__actions--active .ik-engage-bar__bottom {
  max-height: 44px;
  margin-top: 8px;
  opacity: 1;
  transform: translateY(0);
}

.ik-engage-bar__bottom-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
}

.ik-engage-bar__left-icons,
.ik-engage-bar__right-btns {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ik-engage-bar__tool {
  width: 28px;
  height: 28px;
  color: #bfbfbf;
}

.ik-engage-bar__submit,
.ik-engage-bar__cancel {
  height: 30px;
  padding: 0 16px;
  border: none;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: opacity 140ms ease, transform 140ms ease, background-color 140ms ease;
}

.ik-engage-bar__submit {
  background: var(--ik-primary);
  color: #000;
}

.ik-engage-bar__submit:disabled {
  background: #4a4a4a;
  color: #9a9a9a;
  cursor: not-allowed;
}

.ik-engage-bar__cancel {
  background: transparent;
  color: #bfbfbf;
}

.ik-engage-bar__submit:not(:disabled):hover,
.ik-engage-bar__cancel:hover {
  opacity: 0.86;
}

.ik-engage-bar__submit:not(:disabled):active,
.ik-engage-bar__cancel:active {
  transform: scale(0.96);
}

/* ═══════════════════════════════════════════════
   Transition Animations
   Flutter showZZZDialog:
     background → Interval(0, 0.01) = 近乎瞬现
     stripes   → 随 background 一起，但视觉上有扫入感
     dialog    → easeOutQuart, slideX(5%) + fade, 200ms
   ═══════════════════════════════════════════════ */

/* ── Stripe sweep-in keyframe ──────────────────── */
@keyframes stripe-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes stripe-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}

/* ── Enter ─────────────────────────────────────── */
.ik-overlay-enter-active {
  transition: background-color 80ms ease-out, backdrop-filter 80ms ease-out, -webkit-backdrop-filter 80ms ease-out;
}

.ik-overlay-enter-from {
  background-color: transparent !important;
  backdrop-filter: blur(0) !important;
  -webkit-backdrop-filter: blur(0) !important;
}

.ik-overlay-enter-active .ik-overlay__stripe {
  animation: stripe-fade-in 250ms ease-out both;
}

.ik-overlay-enter-active .ik-dialog {
  /* easeOutQuart: cubic-bezier(0.165, 0.84, 0.44, 1) */
  transition: transform 250ms cubic-bezier(0.165, 0.84, 0.44, 1),
              opacity 200ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.ik-overlay-enter-from .ik-overlay__stripe {
  opacity: 0;
}

.ik-overlay-enter-from .ik-dialog {
  opacity: 0;
  transform: scale(1.1) translateX(5%);
}

/* ── Leave ─────────────────────────────────────── */
.ik-overlay-leave-active {
  transition: background-color 160ms ease-out, backdrop-filter 160ms ease-out, -webkit-backdrop-filter 160ms ease-out;
}

.ik-overlay-leave-active .ik-overlay__stripe {
  animation: stripe-fade-out 180ms ease-in both;
}

.ik-overlay-leave-active .ik-dialog {
  transition: transform 200ms cubic-bezier(0.55, 0, 1, 0.45),
              opacity 180ms ease-in;
}

.ik-overlay-leave-to {
  background-color: transparent !important;
  backdrop-filter: blur(0) !important;
  -webkit-backdrop-filter: blur(0) !important;
}

.ik-overlay-leave-to .ik-dialog {
  opacity: 0;
  transform: scale(1.1) translateX(-5%);
}

/* ═══════════════════════════════════════════════
   Mobile Layout (< 800px)
   ═══════════════════════════════════════════════ */
@media (max-width: 800px) {
  .ik-dialog {
    width: 90%;
    height: 90%;
    transform: scale(1);
  }

  .ik-overlay-enter-from .ik-dialog {
    transform: scale(1) translateX(5%);
  }

  .ik-overlay-leave-to .ik-dialog {
    transform: scale(1) translateX(-5%);
  }

  .ik-dialog__body {
    flex-direction: column;
  }

  .ik-dialog__left {
    flex: none;
  }

  .ik-dialog__left-scroll {
    flex: none;
    max-height: none;
    overflow-y: visible;
    margin: 0;
    border-radius: 0;
  }

  .ik-dialog__cover-wrap {
    padding: 0;
  }

  .ik-dialog__cover-border {
    border-radius: 0;
    border-width: 0 0 4px;
  }

  .ik-dialog__detail {
    padding: 16px;
  }

  .ik-dialog__right {
    flex: 1;
    margin: 0;
    border-radius: 0;
    border-top: 1px solid #313132;
  }

  /* 移动端整体变为可滚动单栏 */
  .ik-dialog__body {
    overflow-y: auto;
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .ik-dialog__body::-webkit-scrollbar {
    display: none;
  }

  .ik-dialog__right {
    min-height: 300px;
  }
}

@media (max-width: 500px) {
  .ik-dialog {
    width: 100%;
    height: 100%;
  }

  .ik-dialog__outer {
    border-radius: 0;
  }

  .ik-dialog__inner {
    border-radius: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-overlay-enter-active,
  .ik-overlay-enter-active .ik-dialog,
  .ik-overlay-leave-active,
  .ik-overlay-leave-active .ik-dialog {
    transition: none;
  }

  .ik-overlay-enter-active .ik-overlay__stripe,
  .ik-overlay-leave-active .ik-overlay__stripe {
    animation: none;
  }
}
</style>
