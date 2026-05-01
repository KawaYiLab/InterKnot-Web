<script setup lang="ts">
import { useMessage } from "zenless-ui";
import type { Comment, Discussion } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const loginDialog = useLoginDialog();
const confirmDialog = useConfirmDialog();
const pageDataLoading = usePageDataLoading();
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

const discussionId = computed(() => String(route.params.id || ""));

const loadDiscussion = async () => {
  loading.value = true;
  loadError.value = false;
  try {
    discussion.value = await api.getDiscussion(discussionId.value);
  } catch (err) {
    loadError.value = true;
    message.error(resolveErrorMessage(err, "获取帖子详情失败"));
  } finally {
    loading.value = false;
  }
};

const loadComments = async () => {
  if (commentsLoading.value || !commentsHasNext.value) return;
  commentsLoading.value = true;
  try {
    const page = await api.getComments(discussionId.value, commentsCursor.value);
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
  if (!newComment.value.trim()) {
    return;
  }

  sendingComment.value = true;
  try {
    const trimmed = newComment.value.trim();
    const res = await api.addDiscussionComment({
      discussionId: discussionId.value,
      content: trimmed,
      authorDocumentId: auth.user?.authorId,
    });
    const resData = (res as Record<string, unknown>).data as Record<string, unknown> | undefined;
    const localId = String(resData?.documentId || resData?.id || `local-${Date.now()}`);
    const localAuthor: import("~/types/entities").Author = {
      documentId: auth.user?.authorId || auth.user?.documentId,
      name: auth.user?.name || auth.user?.username || "我",
      avatar: auth.user?.avatar,
      level: auth.user?.level,
    };
    comments.value.unshift({
      id: localId,
      content: trimmed,
      liked: false,
      likesCount: 0,
      createdAt: new Date().toISOString(),
      author: localAuthor,
      replies: [],
    });
    newComment.value = "";
    if (discussion.value) {
      discussion.value.commentsCount = (discussion.value.commentsCount ?? 0) + 1;
    }
  } catch (err) {
    message.error(resolveErrorMessage(err, "评论发送失败"));
  } finally {
    sendingComment.value = false;
  }
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
    navigateTo("/");
  } catch (err) {
    message.error(resolveErrorMessage(err, "删除帖子失败"));
  } finally {
    deletingArticle.value = false;
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
  } catch (err) {
    message.error(resolveErrorMessage(err, "点赞失败"));
  }
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

const pageTitle = computed(() =>
  discussion.value?.title ? `${discussion.value.title} - 绳网` : "绳网",
);
const pageDescription = computed(() => {
  const text = discussion.value?.bodyText || discussion.value?.rawBodyText || "";
  return text.length > 160 ? text.slice(0, 157) + "..." : text || "绳网是一个游戏、技术交流平台";
});
const pageCover = computed(() => discussion.value?.cover || "/images/zzzicon_200x200.png");

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogImage: pageCover,
  ogType: "article",
});

onMounted(async () => {
  pageDataLoading.claim();
  try {
    await loadDiscussion();
    await recordView();
    await loadComments();
  } finally {
    pageDataLoading.finish();
  }
});
</script>

<template>
  <section class="container ik-stack">
    <div v-if="loading" class="ik-empty">正在加载帖子详情...</div>
    <div v-else-if="loadError" class="ik-empty">加载失败，请刷新重试</div>
    <template v-else-if="discussion">
      <z-card class="ik-panel">
        <div class="ik-stack">
          <h1 class="ik-title">{{ discussion.title }}</h1>
          <div class="ik-row">
            <span class="ik-meta">作者：{{ discussion.author.name || "未知作者" }}</span>
            <span class="ik-meta">{{ discussion.views || 0 }} 阅读</span>
            <span class="ik-meta">{{ discussion.commentsCount || 0 }} 评论</span>
          </div>
          <div v-if="discussion.body" class="ik-discussion-content" v-html="discussion.body"></div>
          <p v-else-if="discussion.bodyText" class="ik-discussion-content">
            {{ discussion.bodyText }}
          </p>
          <p v-else class="ik-discussion-content ik-meta">
            暂无正文内容
          </p>
          <div class="ik-row">
            <z-button @click="likeArticle">
              {{ discussion.liked ? "取消点赞" : "点赞" }}
              {{ discussion.likesCount || 0 }}
            </z-button>
            <z-button v-if="isOwner" :loading="deletingArticle" @click="handleDeleteArticle" style="color: #ff6b6b">
              删除帖子
            </z-button>
          </div>
        </div>
      </z-card>

      <z-card class="ik-panel">
        <div class="ik-stack">
          <h2 style="margin: 0">发表评论</h2>
          <z-input v-model="newComment" type="textarea" placeholder="说点什么..." />
          <div class="ik-row">
            <z-button :loading="sendingComment" @click="sendComment">发送评论</z-button>
            <span v-if="!auth.isLogin" class="ik-meta ik-login-link" @click="loginDialog.open()">登录后可评论</span>
          </div>
        </div>
      </z-card>

      <section class="ik-stack">
        <h2 style="margin: 0">评论区</h2>
        <div v-if="!comments.length" class="ik-empty">暂时还没有评论</div>
        <CommentItem
          v-for="(comment, idx) in comments"
          :key="comment.id"
          :comment="comment"
          :index="idx"
          :current-user-author-id="auth.user?.authorId"
          @like-comment="likeComment"
          @like-reply="likeReply"
          @delete-comment="handleDeleteComment"
          @delete-reply="handleDeleteReply"
        />
        <div class="ik-row" style="justify-content: center">
          <z-button v-if="commentsHasNext" :loading="commentsLoading" @click="loadComments">
            加载更多评论
          </z-button>
          <span v-else class="ik-meta">评论已全部加载</span>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.ik-discussion-content {
  margin: 0;
  line-height: 1.65;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.ik-discussion-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
}

.ik-discussion-content :deep(a) {
  color: #6f9cff;
  text-decoration: underline;
}

.ik-discussion-content :deep(pre) {
  background: #1a1a1a;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}

.ik-discussion-content :deep(code) {
  background: #1a1a1a;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
}

.ik-discussion-content :deep(blockquote) {
  border-left: 4px solid #d7ff00;
  padding-left: 16px;
  margin: 12px 0;
  color: #b0b0b0;
}

.ik-login-link {
  cursor: pointer;
  text-decoration: underline;
  transition: color 120ms ease;
}

.ik-login-link:hover {
  color: #d7ff00;
}
</style>
