<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMessage } from "zenless-ui";
import type { Comment, Post } from "~/types/entities";
import { isNotFoundError, resolveErrorMessage } from "~/utils/api-error";
import { useRenderedBody } from "~/composables/useRenderedBody";
import { formatTime } from "~/utils/time";
import { StarIcon, ChatBubbleLeftIcon, AtSymbolIcon, EyeSlashIcon, PhotoIcon, EllipsisVerticalIcon, FaceSmileIcon } from "@heroicons/vue/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/vue/24/solid";
import { useMentionInput } from "~/composables/useMentionInput";
import { useEmoteInsert } from "~/composables/useEmoteInsert";

const DEFAULT_COVER_IMAGE = "/images/default-cover.webp";

const { isOpen: isGalleryOpen, isLoading: isGalleryLoading, loadingProgress: galleryProgress, openGallery, preload: preloadGallery, destroy: destroyPreview } = useLightGallery();

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const loginDialog = useLoginDialog();
const confirmDialog = useConfirmDialog();
const reportDialog = useReportDialog();
const pageDataLoading = usePageDataLoading();
const message = useMessage();

const post = ref<Post | null>(null);
const loading = ref(true);
const loadError = ref(false);

// 正文渲染（markdown-it + DOMPurify）按需异步加载，不进首屏 chunk。
const { bodyHtml, hasContent: bodyHasContent } = useRenderedBody(post);

const comments = ref<Comment[]>([]);
const commentsCursor = ref("");
const commentsHasNext = ref(true);
const commentsLoading = ref(false);
const commentsInitialLoading = ref(true);

const newComment = ref("");
const sendingComment = ref(false);
const commentInputBoxRef = ref<HTMLElement | null>(null);
const commentInputFocused = ref(false);
const replyTarget = ref<{ id: string; authorName: string } | null>(null);
const commentAnonymous = ref(false);

/** 真实底层 textarea：z-input 是个包装，原生 keydown / overlay 都需要它 */
const commentTextareaRef = ref<HTMLTextAreaElement | null>(null);

const scrollRef = ref<HTMLElement | null>(null);

/**
 * 评论编辑器的 @ 提及处理。
 * - text 复用 newComment（与 z-input v-model 同步的显示串）
 * - search 走 api.searchAuthors（防抖在 composable 内部）
 *
 * 注：onKeyDown / refresh 不能直接用 @keydown / @input 绑在 z-input 上——
 * z-input 是个组件，向外冒泡的事件可能被改写。我们在 onMounted 里把
 * 真实 textarea 找出来，用 addEventListener 直接挂原生事件。
 */
const mention = useMentionInput({
  text: newComment,
  textareaRef: commentTextareaRef,
  search: api.searchAuthors,
});

const emoteInsert = useEmoteInsert({
  text: newComment,
  textareaRef: commentTextareaRef,
  // 插入表情后同步平移 mention range，避免下标错位导致 mention 被丢弃
  onInsert: (start, end, insertedLength) => {
    const delta = insertedLength - (end - start);
    mention.mentions.value = mention.mentions.value
      .filter((m) => m.end <= start || m.start >= end)
      .map((m) => (m.start >= end ? { ...m, start: m.start + delta, end: m.end + delta } : m));
  },
});
const emotePickerVisible = ref(false);
const emotePickerAnchor = ref<{ top: number; left: number; height: number } | null>(null);

const toggleEmotePicker = (e: MouseEvent) => {
  if (emotePickerVisible.value) {
    emotePickerVisible.value = false;
    return;
  }
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  emotePickerAnchor.value = { top: rect.top, left: rect.left, height: rect.height };
  emotePickerVisible.value = true;
};

const onEmoteSelect = async (emote: { code: string }) => {
  const ok = await emoteInsert.insertEmote(emote.code);
  if (!ok) {
    message.warning("表情数量已达上限");
  }
  emotePickerVisible.value = false;
};

const onEmojiSelect = async (emoji: string) => {
  await emoteInsert.insertText(emoji);
  emotePickerVisible.value = false;
};

const commentImages = useCommentImages();

const postId = computed(() => String(route.params.id || ""));



const covers = computed(() => post.value?.covers ?? []);
const hasCovers = computed(() => covers.value.length > 0);
const isCommentEditorActive = computed(() => commentInputFocused.value);
const postLikeCount = computed(() => post.value?.likesCount ?? 0);
const postCommentCount = computed(() => post.value?.commentsCount ?? comments.value.length);

const firstCover = computed(() => covers.value[0] ?? null);
const coverAspectRatio = computed(() => {
  const c = firstCover.value;
  if (c?.width && c?.height && c.width > 0 && c.height > 0) return c.width / c.height;
  return 16 / 9;
});

const syncCommentInputHeight = async () => {
  await nextTick();
  const textarea = commentInputBoxRef.value?.querySelector("textarea") as HTMLTextAreaElement | null;
  if (!textarea) return;
  textarea.style.height = "42px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 62)}px`;
};

const openCoverPreview = () => {
  const images = covers.value.map((c) => ({ src: c.url, width: c.width, height: c.height }));
  if (images.length) openGallery(images, 0);
};

/* ── 数据加载 ──────────────────────────────────── */
const loadPost = async () => {
  loading.value = true;
  loadError.value = false;
  try {
    post.value = await api.getPost(postId.value);
  } catch (err) {
    if (isNotFoundError(err)) {
      showError({ statusCode: 404, message: "帖子不存在" });
      return;
    }
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
    const page = await api.getComments(postId.value, commentsCursor.value);
    comments.value.push(...page.nodes);
    commentsCursor.value = page.endCursor;
    commentsHasNext.value = page.hasNextPage;
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取评论失败"));
  } finally {
    commentsLoading.value = false;
    commentsInitialLoading.value = false;
  }
};





const recordView = async () => {
  if (!post.value?.id) return;
  try {
    const views = await api.recordArticleView(post.value.id);
    if (typeof views === "number") {
      post.value.views = views;
    }
  } catch {
  }
};

const sendComment = async () => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  if (commentImages.hasPendingUploads.value) {
    message.warning("图片上传中，请稍候");
    return;
  }
  if (commentImages.hasErroredUploads.value) {
    message.warning("有图片上传失败，请重试或移除后再发送");
    return;
  }
  if (!newComment.value.trim() && !emoteInsert.hasEmotes.value) return;

  sendingComment.value = true;
  const isReply = !!replyTarget.value;
  try {
    // serializeWith 把显示串里的 mention 段还原成 `@[name](docId)` token，
    // 表情占位符还原成 `:ik-xxx:` token
    const serialized = emoteInsert.serializeWith(mention.mentions.value).trim();
    const parentId = replyTarget.value?.id;
    const res = await api.addPostComment({
      postId: postId.value,
      content: serialized,
      authorDocumentId: auth.user?.authorId,
      parentId,
      isAnonymous: commentAnonymous.value || undefined,
      images: commentImages.uploadedImageIds.value,
    });
    const resData = (res as Record<string, unknown>).data as Record<string, unknown> | undefined;
    const localId = String(resData?.documentId || resData?.id || `local-${Date.now()}`);
    const localAuthor: import("~/types/entities").Author = commentAnonymous.value
      ? { name: "匿名用户" }
      : {
          documentId: auth.user?.authorId || auth.user?.documentId,
          name: auth.user?.name || auth.user?.username || "我",
          avatar: auth.user?.avatar,
          level: auth.user?.level,
        };
    const localImages = commentImages.uploadTasks.value
      .filter((task) => task.status === "done" && task.serverUrl)
      .map((task) => ({ url: task.serverUrl! }));
    if (isReply && parentId) {
      const parent = comments.value.find((c) => c.id === parentId);
      if (parent) {
        parent.replies.push({
          id: localId,
          // 本地乐观插入用 token 串，CommentBody 会自动渲染成芯片
          content: serialized,
          liked: false,
          likesCount: 0,
          createdAt: new Date().toISOString(),
          author: localAuthor,
          images: localImages,
        });
      }
    } else {
      comments.value.unshift({
        id: localId,
        content: serialized,
        liked: false,
        likesCount: 0,
        createdAt: new Date().toISOString(),
        author: localAuthor,
        images: localImages,
        replies: [],
      });
    }
    const el = commentInputBoxRef.value?.querySelector("textarea, input") as HTMLTextAreaElement | null;
    if (el) {
      el.value = "";
      el.blur();
    }
    newComment.value = "";
    mention.reset();
    emoteInsert.reset();
    commentImages.clearUploads();
    commentInputFocused.value = false;
    replyTarget.value = null;
    syncCommentInputHeight();
    if (post.value) {
      post.value.commentsCount = (post.value.commentsCount ?? 0) + 1;
    }
    message.success(isReply ? "回复发送成功" : "评论发送成功");
  } catch (err) {
    message.error(resolveErrorMessage(err, "发送失败"));
  } finally {
    sendingComment.value = false;
  }
};

const openCommentImagePicker = () => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  commentImages.openImagePicker();
};

const focusCommentInput = () => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  commentInputFocused.value = true;
  const input = commentInputBoxRef.value?.querySelector("textarea, input") as HTMLElement | null;
  input?.focus();
  syncCommentInputHeight();
};

const handleCommentInputFocus = (e: FocusEvent) => {
  if (!auth.isLogin) {
    (e.target as HTMLElement)?.blur();
    loginDialog.open();
    return;
  }
  commentInputFocused.value = true;
};

const cancelComment = () => {
  const el = commentInputBoxRef.value?.querySelector("textarea, input") as HTMLTextAreaElement | null;
  if (el) {
    el.value = "";
    el.blur();
  }
  newComment.value = "";
  mention.reset();
  emoteInsert.reset();
  commentImages.clearUploads();
  commentInputFocused.value = false;
  replyTarget.value = null;
  syncCommentInputHeight();
};

const startReply = (comment: Comment) => {
  replyTarget.value = { id: comment.id, authorName: comment.author?.name || "匿名用户" };
  focusCommentInput();
};

const startReplyToReply = (reply: Comment["replies"][number], parentComment: Comment) => {
  // 楼中楼是「扁平到顶层」的单层结构：parentId 仍指向顶层 comment，
  // 但被回复 reply 的作者会丢失通知链路与视觉语境。
  // 修复方式：自动在 textarea 最前预填一个指向被回复 reply 作者的 @mention chip。
  // 这样 mention 通知系统会把通知发给被回复者；CommentBody 渲染也会自然带「回复 @X」语境。
  replyTarget.value = { id: parentComment.id, authorName: reply.author?.name || "匿名用户" };
  const replyAuthor = reply.author;
  const myAuthorId = auth.user?.authorId;
  if (
    replyAuthor?.documentId &&
    replyAuthor?.name &&
    // 自己回复自己时不预填——notifyMentions 也会跳过 self-mention，纯属冗余
    replyAuthor.documentId !== myAuthorId
  ) {
    mention.prependMentionChip({
      documentId: replyAuthor.documentId,
      name: replyAuthor.name,
      username: null,
      avatar: replyAuthor.avatar ?? null,
      level: replyAuthor.level ?? null,
    });
  }
  focusCommentInput();
};

const isOwner = computed(() => {
  if (!auth.isLogin || !post.value?.author?.documentId) return false;
  return auth.user?.authorId === post.value.author.documentId;
});

const deletingArticle = ref(false);

const handleDeleteArticle = async () => {
  if (!post.value?.id) return;
  const ok = await confirmDialog.open({ title: "删除帖子", message: "确定删除这篇帖子吗？此操作不可恢复。（10丁尼）", confirmText: "删除", danger: true });
  if (!ok) return;
  deletingArticle.value = true;
  try {
    const deletedId = post.value.id;
    await api.deleteArticle(deletedId);
    message.success("帖子已删除");
    window.dispatchEvent(new CustomEvent("ik:article-deleted", { detail: deletedId }));
    navigateTo("/");
  } catch (err) {
    message.error(resolveErrorMessage(err, "删除帖子失败"));
  } finally {
    deletingArticle.value = false;
  }
};

const handleEditArticle = () => {
  if (!post.value?.id || !isOwner.value) return;
  navigateTo(`/create?edit=${post.value.id}`);
};

const handleArticleMenuCommand = (command: string | number) => {
  if (command === "delete") {
    handleDeleteArticle();
  } else if (command === "edit") {
    handleEditArticle();
  } else if (command === "report") {
    handleReportArticle();
  }
};

const handleReportArticle = () => {
  if (!post.value?.id) return;
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  reportDialog.open({ targetType: "article", targetId: post.value.id, targetLabel: "帖子" });
};

const handleReportComment = (comment: Comment) => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  reportDialog.open({ targetType: "comment", targetId: comment.id, targetLabel: "评论" });
};

const handleReportReply = (reply: Comment["replies"][number]) => {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  reportDialog.open({ targetType: "comment", targetId: reply.id, targetLabel: "回复" });
};

const favoriting = ref(false);

const favoriteArticle = async () => {
  if (!post.value) return;
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  if (favoriting.value) return;
  favoriting.value = true;
  try {
    const result = await api.toggleFavorite(post.value.id);
    post.value.favorited = result.favorited;
    post.value.favoritesCount = result.favoritesCount;
    message.success(result.favorited ? "已收藏" : "已取消收藏");
  } catch (err) {
    message.error(resolveErrorMessage(err, "收藏失败"));
  } finally {
    favoriting.value = false;
  }
};

const likeArticle = async () => {
  if (!post.value) return;
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  try {
    const result = await api.toggleLike("article", post.value.id);
    post.value.liked = result.liked;
    post.value.likesCount = result.likesCount;
    message.success(result.liked ? "已点赞（￣︶￣）↗　" : "已取消点赞(；′⌒`)");
  } catch (err) {
    message.error(resolveErrorMessage(err, "点赞失败"));
  }
};

const tripling = ref(false);
const tripleCharge = ref({ progress: 0, active: false });
const onTripleCharge = (payload: { progress: number; active: boolean }) => {
  tripleCharge.value = payload;
};

const handleTriple = async () => {
  if (!post.value) return;
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  if (tripling.value) return;
  tripling.value = true;

  // 仅当确有可能投币时才乐观 -1，避免无谓的余额回弹
  const willCoin =
    !post.value.hasGivenDenny &&
    !isOwner.value &&
    !post.value.isAnonymous;
  if (willCoin) window.dispatchEvent(new CustomEvent("ik:denny-decrement"));

  try {
    const result = await api.tripleAction(post.value.id);
    post.value.liked = result.liked;
    post.value.likesCount = result.likesCount;
    post.value.favorited = result.favorited;
    post.value.favoritesCount = result.favoritesCount;
    post.value.dennyCount = result.dennyCount;
    if (result.coinGiven) post.value.hasGivenDenny = true;

    if (typeof result.newBalance === "number")
      window.dispatchEvent(
        new CustomEvent("ik:denny-updated", { detail: result.newBalance }),
      );
    else
      // 未真正投币 → 回滚乐观 -1
      window.dispatchEvent(new CustomEvent("ik:denny-updated"));

    message.success("三连成功！(￣︶￣)↗");
  } catch (err) {
    window.dispatchEvent(new CustomEvent("ik:denny-updated"));
    message.error(resolveErrorMessage(err, "三连失败"));
  } finally {
    tripling.value = false;
  }
};

const givingDenny = ref(false);

const giveDenny = async () => {
  if (!post.value) return;
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  if (isOwner.value) {
    message.warning("不能给自己的帖子投币");
    return;
  }
  if (post.value.isAnonymous) {
    message.warning("匿名帖不能投币");
    return;
  }
  if (post.value.hasGivenDenny) {
    message.warning("已经投过币了");
    return;
  }

  const prevHasGiven = post.value.hasGivenDenny;
  const prevDennyCount = post.value.dennyCount ?? 0;

  post.value.hasGivenDenny = true;
  post.value.dennyCount = prevDennyCount + 1;
  givingDenny.value = true;

  window.dispatchEvent(new CustomEvent("ik:denny-decrement"));

  try {
    const result = await api.giveDennyToArticle(post.value.id);
    if (result?.success) {
      message.success("投币成功");
      if (typeof result.articleDennyCount === "number") {
        post.value.dennyCount = result.articleDennyCount;
      }
      if (typeof result.newBalance === "number") {
        window.dispatchEvent(new CustomEvent("ik:denny-updated", { detail: result.newBalance }));
      } else {
        window.dispatchEvent(new CustomEvent("ik:denny-updated"));
      }
    } else {
      throw new Error("投币失败");
    }
  } catch (err) {
    post.value.hasGivenDenny = prevHasGiven;
    post.value.dennyCount = prevDennyCount;
    window.dispatchEvent(new CustomEvent("ik:denny-updated"));
    message.error(resolveErrorMessage(err, "投币失败"));
  } finally {
    givingDenny.value = false;
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
    if (post.value) {
      post.value.commentsCount = Math.max(0, (post.value.commentsCount ?? 0) - 1 - (comment.replies?.length ?? 0));
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
    if (post.value) {
      post.value.commentsCount = Math.max(0, (post.value.commentsCount ?? 0) - 1);
    }
    message.success("回复已删除");
  } catch (err) {
    message.error(resolveErrorMessage(err, "删除回复失败"));
  }
};

const pageTitle = computed(() =>
  post.value?.title ? `${post.value.title} - 绳网` : "绳网",
);
const pageDescription = computed(() => {
  const text = post.value?.bodyText || post.value?.rawBodyText || "";
  return text.length > 160 ? text.slice(0, 157) + "..." : text || "绳网是一个游戏、技术交流平台";
});
const pageCover = computed(() => post.value?.cover || "/images/zzzicon_200x200.png");

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogImage: pageCover,
  ogType: "article",
});

/**
 * 把真实 textarea 拿到并接上 mention 事件钩子。
 * z-input 被多次重新渲染时（例如登录 / 切讨论）需要重新查找；用 watch 监视容器即可。
 */
let teardownMentionListeners: (() => void) | null = null;
const attachMentionToTextarea = () => {
  const root = commentInputBoxRef.value;
  if (!root) return;
  const ta = root.querySelector("textarea") as HTMLTextAreaElement | null;
  if (!ta || ta === commentTextareaRef.value) return;

  // 卸载旧的（如有）
  teardownMentionListeners?.();

  commentTextareaRef.value = ta;

  // input：z-input 的 v-model 已经把 newComment 同步过来了；此处拿到事件后再
  // 跑一次 mention.refresh() 以更新 picker 状态 / 高亮 segment。
  const onInput = () => {
    mention.refresh();
    emoteInsert.refresh();
  };
  // keydown：直接挂原生 textarea 上，确保比 z-input 包装层先收到事件，
  // 这样 picker 打开时 Enter / Tab / Esc 能被正确拦截，不会落到 sendComment。
  // 表情占位区间的原子删除也在这里处理（两者 range 不重叠，互不冲突）。
  const onKeyDown = (e: KeyboardEvent) => {
    mention.onKeyDown(e);
    emoteInsert.onKeyDown(e);
  };
  // selection 变化（点击 / 方向键移动光标）也要刷新一次 picker
  const onSelect = (e: Event) => {
    mention.refresh(e);
    emoteInsert.refresh();
  };

  ta.addEventListener("input", onInput);
  ta.addEventListener("keydown", onKeyDown);
  ta.addEventListener("click", onSelect);
  ta.addEventListener("keyup", onSelect);

  teardownMentionListeners = () => {
    ta.removeEventListener("input", onInput);
    ta.removeEventListener("keydown", onKeyDown);
    ta.removeEventListener("click", onSelect);
    ta.removeEventListener("keyup", onSelect);
  };
};

onMounted(async () => {
  // lightgallery 完全惰性：直到用户点击封面触发 openCoverPreview 才加载，
  // 让只看文字、不点图的用户不必下载这套资源。
  pageDataLoading.claim();
  try {
    await loadPost();
    await Promise.all([recordView(), loadComments()]);
  } finally {
    pageDataLoading.finish();
  }
  // 等数据加载完 z-input 已挂载到 DOM
  await nextTick();
  attachMentionToTextarea();
});

// 评论编辑器从 placeholder 模式切到激活模式时 z-input 可能重新挂载，
// 重新尝试 attach（attach 函数内部对相同 textarea 是幂等的）
watch(commentInputFocused, () => {
  nextTick(() => attachMentionToTextarea());
});

onBeforeUnmount(() => {
  destroyPreview();
  teardownMentionListeners?.();
  teardownMentionListeners = null;
});
</script>

<template>
  <section class="ik-page-container">
    <!-- ── Gallery Loading Progress ────────── -->
    <div class="ik-page__gallery-progress" :class="{ 'is-active': isGalleryLoading }">
      <div class="ik-page__gallery-progress-bar" :style="{ width: `${galleryProgress}%` }" />
    </div>

    <!-- ── 斜线纹理背景（ZZZ PatternPainter） ──── -->
    <div class="ik-page__stripe" aria-hidden="true"></div>

    <!-- ── Loading skeleton ──────────────────── -->
    <div v-if="loading" class="ik-page__shell">
      <div class="ik-page__outer">
        <div class="ik-page__inner">
          <div class="ik-page__header">
            <div class="ik-page__header-left">
              <div class="ik-skel" style="width:40px;height:40px;border-radius:999px"></div>
              <div style="display:flex;flex-direction:column;gap:4px">
                <div class="ik-skel" style="width:100px;height:18px;border-radius:3px"></div>
                <div class="ik-skel" style="width:60px;height:14px;border-radius:3px"></div>
              </div>
            </div>
          </div>
          <div class="ik-page__main">
            <IkZzzMarquee />
          <div class="ik-page__body">
            <div class="ik-page__left">
              <div class="ik-page__left-scroll">
                <div class="ik-page__cover-wrap">
                  <div class="ik-skel ik-skel--cover"></div>
                </div>
                <div class="ik-page__detail">
                  <div class="ik-skel ik-skel--title"></div>
                  <div class="ik-skel ik-skel--line" style="width:100%"></div>
                  <div class="ik-skel ik-skel--line" style="width:90%"></div>
                  <div class="ik-skel ik-skel--line" style="width:75%"></div>
                  <div class="ik-skel ik-skel--line" style="width:60%"></div>
                </div>
              </div>
            </div>
            <div class="ik-page__right">
              <div style="flex:1;padding:16px;overflow:hidden">
                <div v-for="n in 4" :key="n" style="display:flex;gap:12px;padding:14px 0" :style="n > 1 ? 'border-top:1px solid #1e1e1e' : ''">
                  <div style="flex-shrink:0">
                    <div class="ik-skel" style="width:36px;height:36px;border-radius:999px"></div>
                  </div>
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;gap:6px">
                      <div class="ik-skel" style="width:80px;height:14px;border-radius:3px"></div>
                      <div class="ik-skel" style="width:32px;height:12px;border-radius:3px"></div>
                    </div>
                    <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
                      <div class="ik-skel" style="width:95%;height:14px;border-radius:3px"></div>
                      <div class="ik-skel" style="width:60%;height:14px;border-radius:3px"></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="ik-page__actions">
                <div class="ik-skel ik-skel--actions-bar"></div>
              </div>
            </div>
          </div>
          </div><!-- /.ik-page__main -->
        </div>
      </div>
    </div>

    <!-- ── Error ─────────────────────────────── -->
    <div v-else-if="loadError" class="ik-page__shell">
      <div class="ik-page__outer">
        <div class="ik-page__inner">
          <div class="ik-page__main">
            <IkZzzMarquee />
          <div class="ik-page__error">
            加载失败，请刷新重试
          </div>
          </div><!-- /.ik-page__main -->
        </div>
      </div>
    </div>

    <!-- ── Loaded Content ────────────────────── -->
    <template v-else-if="post">
      <div class="ik-page__shell">
        <div class="ik-page__outer">
          <div class="ik-page__inner">
        <!-- ── Header Bar ────────────────────── -->
        <div class="ik-page__header">
          <div class="ik-page__header-left">
            <UserHoverCard :author-id="post.author?.documentId" :clickable="!!post.author?.documentId">
              <div class="ik-page__avatar-shell">
                <img
                  :src="post.author.avatar || '/images/default-avatar.webp'"
                  :alt="post.author.name || ''"
                  class="ik-page__avatar"
                  @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                />
              </div>
            </UserHoverCard>
            <div class="ik-page__author-info">
              <div class="ik-page__author-row">
                <UserHoverCard :author-id="post.author?.documentId" :clickable="!!post.author?.documentId">
                  <span class="ik-page__author-name">
                    {{ post.author.name || "匿名用户" }}
                  </span>
                </UserHoverCard>
                <span v-if="post.author.level && post.author.documentId" class="ik-page__level">
                  Lv.{{ post.author.level }}
                </span>
              </div>
              <span class="ik-page__time">
                {{ formatTime(post.createdAt) }}
                <template v-if="post.views"> · {{ post.views }} 阅读</template>
              </span>
            </div>
          </div>
        </div>

        <div class="ik-page__main">
          <IkZzzMarquee />
        <!-- ── Body (双栏) ───────────────────── -->
        <div class="ik-page__body">
          <!-- 左栏：封面 + 正文 -->
          <div class="ik-page__left">
            <div class="ik-page__left-scroll" ref="scrollRef">
              <!-- 封面 -->
              <div v-if="hasCovers" class="ik-page__cover-wrap">
                <div
                  class="ik-page__cover-border"
                  :style="{ aspectRatio: String(coverAspectRatio) }"
                >
                  <img
                    :src="firstCover?.url || DEFAULT_COVER_IMAGE"
                    :alt="post.title"
                    class="ik-page__cover"
                    @click="openCoverPreview()"
                    @error="($event.target as HTMLImageElement).src = DEFAULT_COVER_IMAGE"
                  />
                  <span v-if="covers.length > 1" class="ik-page__cover-count">
                    {{ covers.length }} 张
                  </span>
                </div>
              </div>

              <!-- 正文 -->
              <div class="ik-page__detail">
                <div v-if="post.isHidden" class="ik-page__hidden-banner" role="alert">
                  <EyeSlashIcon class="ik-page__hidden-icon" aria-hidden="true" />
                  <span>该帖子因收到举报已被隐藏，仅你自己可见。如有异议请联系管理员。</span>
                </div>
                <h1 class="ik-page__title">
                  <span v-if="post.category" class="ik-page__title-cat">[ {{ post.category.name }} ]</span>{{ post.title }}
                </h1>
                <div
                  v-if="bodyHasContent"
                  class="ik-page__content"
                  v-html="bodyHtml"
                ></div>
                <p v-else class="ik-page__content" style="color: #808080">
                  啥都木有¯\(°_o)/¯
                </p>
              </div>
            </div>
          </div>

          <!-- 右栏：评论 + 操作栏 -->
          <div class="ik-page__right">
            <div class="ik-page__comments-scroll">
              <div class="ik-page__comments-inner">

                <!-- 评论骨架屏 -->
                <template v-if="commentsInitialLoading">
                  <div v-for="n in 4" :key="'cskel-'+n" class="ik-comment-skel">
                    <div class="ik-comment-skel__avatar">
                      <div class="ik-skel" style="width:36px;height:36px;border-radius:999px"></div>
                    </div>
                    <div class="ik-comment-skel__body">
                      <div style="display:flex;align-items:center;gap:6px">
                        <div class="ik-skel" style="width:80px;height:14px;border-radius:3px"></div>
                        <div class="ik-skel" style="width:32px;height:12px;border-radius:3px"></div>
                      </div>
                      <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
                        <div class="ik-skel" :style="{ width: (95 - n * 10) + '%', height: '14px', borderRadius: '3px' }"></div>
                        <div class="ik-skel" :style="{ width: (60 - n * 5) + '%', height: '14px', borderRadius: '3px' }"></div>
                      </div>
                    </div>
                  </div>
                </template>
                <div v-else-if="!comments.length" class="ik-empty" style="padding: 40px 0">啥都木有¯\(°_o)/¯</div>
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
                  @report-comment="handleReportComment"
                  @report-reply="handleReportReply"
                />
                <div v-if="commentsHasNext" class="ik-page__load-more">
                  <z-button :loading="commentsLoading" @click="loadComments">加载更多评论</z-button>
                </div>
                <div v-else-if="comments.length" class="ik-page__load-more">
                  <span class="ik-meta">- 评论已全部加载 -</span>
                </div>
              </div>
            </div>

            <!-- 底部操作栏 -->
            <div class="ik-page__actions" :class="{ 'ik-page__actions--active': isCommentEditorActive }">
              <div class="ik-engage-bar">
                <div class="ik-engage-bar__main">
                  <div ref="commentInputBoxRef" class="ik-engage-bar__content-edit" @click="focusCommentInput">
                    <z-input
                      v-model="newComment"
                      type="textarea"
                      class="ik-engage-bar__textarea"
                      placeholder=""
                      @focus="handleCommentInputFocus"
                      @input="syncCommentInputHeight"
                      @keydown.enter.exact.prevent="sendComment"
                    />
                    <div v-if="commentImages.uploadTasks.value.length" class="ik-engage-bar__attachments">
                      <div
                        v-for="(task, index) in commentImages.uploadTasks.value"
                        :key="task.localId"
                        class="ik-engage-bar__attachment"
                        :class="`is-${task.status}`"
                      >
                        <img
                          :src="task.serverUrl || task.previewUrl"
                          :alt="task.filename"
                          class="ik-engage-bar__attachment-thumb"
                        />
                        <div v-if="task.status === 'uploading' || task.status === 'pending' || task.status === 'compressing'" class="ik-engage-bar__attachment-progress">
                          <span>{{ Math.round(task.progress) }}%</span>
                        </div>
                        <button
                          v-else-if="task.status === 'error'"
                          type="button"
                          class="ik-engage-bar__attachment-error"
                          @click.stop="commentImages.retryUpload(task)"
                        >
                          <span>{{ task.error || '上传失败' }}<br>点击重试</span>
                        </button>
                        <button
                          type="button"
                          class="ik-engage-bar__attachment-remove"
                          aria-label="移除"
                          @click.stop="commentImages.removeUpload(index)"
                        >✕</button>
                      </div>
                    </div>
                    <!-- @ 提及高亮叠加层：teleport 到 textarea 父级，与 textarea 同位置；
                         pointer-events:none 不影响输入。 -->
                    <MentionHighlightOverlay
                      :target="commentTextareaRef"
                      :text="newComment"
                      :mentions="mention.mentions.value"
                      :emotes="emoteInsert.emotes.value"
                    />
                    <div v-if="replyTarget && isCommentEditorActive" class="ik-engage-bar__reply-hint">
                      <span>回复 {{ replyTarget.authorName }}</span>
                      <button type="button" class="ik-engage-bar__reply-close" @click="replyTarget = null">✕</button>
                    </div>
                    <div v-if="!isCommentEditorActive && !newComment.trim() && !emoteInsert.hasEmotes.value" class="ik-engage-bar__placeholder">
                      <img
                        :src="auth.user?.avatar || '/images/default-avatar.webp'"
                        alt=""
                        class="ik-engage-bar__placeholder-avatar"
                        @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                      />
                      <span>说点什么...</span>
                    </div>
                    <!-- 移动到输入框内部右居中的评论数小标 -->
                    <div
                      v-if="!isCommentEditorActive"
                      class="ik-engage-bar__comment-badge"
                    >
                      <ChatBubbleLeftIcon class="ik-engage-comment-icon" aria-hidden="true" />
                      <span>{{ postCommentCount }}</span>
                    </div>
                  </div>

                  <div class="ik-engage-bar__interact-container">
                    <div class="ik-engage-bar__buttons">
                      <TripleActionButton
                        :liked="post.liked"
                        :likes-count="postLikeCount"
                        :can-triple="auth.isLogin && !isOwner"
                        :busy="tripling"
                        fallback="点赞"
                        @like="likeArticle"
                        @triple="handleTriple"
                        @charge="onTripleCharge"
                      />
                      <button
                        type="button"
                        class="ik-engage-bar__action"
                        :class="{ 'ik-engage-bar__action--active': post.hasGivenDenny }"
                        :disabled="isOwner || post.isAnonymous || givingDenny"
                        :title="isOwner ? '不能给自己的帖子投币' : post.isAnonymous ? '匿名帖子无法投币' : '给作者投喂丁尼'"
                        @click="giveDenny"
                      >
                        <span class="ik-triple__icon-shell">
                          <img src="/images/materials/dennies_v2.webp" class="ik-engage-icon ik-engage-icon--denny" alt="投币" />
                          <TripleChargeRing :progress="tripleCharge.progress" :show="tripleCharge.active" />
                        </span>
                        <IkRollingDigit :value="post.dennyCount ?? 0" fallback="投币" />
                      </button>
                      <button
                        type="button"
                        class="ik-engage-bar__action"
                        :class="{ 'ik-engage-bar__action--active': post.favorited }"
                        :disabled="favoriting"
                        @click="favoriteArticle"
                      >
                        <span class="ik-triple__icon-shell">
                          <StarIconSolid v-if="post.favorited" class="ik-engage-icon" aria-hidden="true" />
                          <StarIcon v-else class="ik-engage-icon" aria-hidden="true" />
                          <TripleChargeRing :progress="tripleCharge.progress" :show="tripleCharge.active" />
                        </span>
                        <IkRollingDigit :value="post.favoritesCount ?? 0" fallback="收藏" />
                      </button>
                      <z-dropdown
                        trigger="click"
                        size="small"
                        class="ik-engage-bar__more"
                        @command="handleArticleMenuCommand"
                      >
                        <button type="button" class="ik-engage-bar__action" title="更多操作">
                          <EllipsisVerticalIcon class="ik-engage-icon" aria-hidden="true" />
                        </button>
                        <template #dropdown>
                          <z-dropdown-item command="report" :disabled="isOwner">举报帖子</z-dropdown-item>
                          <z-dropdown-item command="edit" :disabled="!isOwner">编辑帖子</z-dropdown-item>
                          <z-dropdown-item command="delete" :disabled="!isOwner || deletingArticle">删除帖子</z-dropdown-item>
                        </template>
                      </z-dropdown>
                    </div>
                  </div>
                </div>

                <div class="ik-engage-bar__bottom">
                  <div class="ik-engage-bar__bottom-inner">
                    <div class="ik-engage-bar__left-icons">
                      <button
                        type="button"
                        class="ik-engage-bar__tool"
                        :class="{ 'ik-engage-bar__tool--active': commentImages.uploadTasks.value.length > 0 }"
                        aria-label="添加图片"
                        :title="commentImages.remainingImageSlots.value <= 0 ? '图片数量已达上限' : '添加图片'"
                        :disabled="commentImages.remainingImageSlots.value <= 0"
                        @click.stop="openCommentImagePicker"
                      >
                        <PhotoIcon class="ik-engage-icon" aria-hidden="true" />
                      </button>
                      <!-- @ 按钮：在光标处插入 @ 并立即弹出 picker。
                           click.stop 阻止冒泡到外层的 focusCommentInput。 -->
                      <button
                        type="button"
                        class="ik-engage-bar__tool"
                        aria-label="@"
                        :disabled="mention.isAtLimit.value"
                        :title="mention.isAtLimit.value ? '已达到提及上限' : '提及用户'"
                        @click.stop="mention.insertAtTrigger"
                      >
                        <AtSymbolIcon class="ik-engage-icon" aria-hidden="true" />
                      </button>
                      <!-- 表情按钮：点击弹出 EmotePicker 浮层。
                           @mousedown.stop 阻止冒泡到 document，避免 EmotePicker
                           的 click-outside 在点击按钮时误触发 close。 -->
                      <button
                        type="button"
                        class="ik-engage-bar__tool"
                        :class="{ 'ik-engage-bar__tool--active': emotePickerVisible }"
                        aria-label="表情"
                        :disabled="emoteInsert.isAtLimit.value"
                        :title="emoteInsert.isAtLimit.value ? '表情数量已达上限' : '插入表情'"
                        @click.stop="toggleEmotePicker"
                        @mousedown.stop
                      >
                        <FaceSmileIcon class="ik-engage-icon" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="ik-engage-bar__tool"
                        :class="{ 'ik-engage-bar__tool--active': commentAnonymous }"
                        :aria-label="commentAnonymous ? '取消匿名' : '匿名评论'"
                        :title="commentAnonymous ? '取消匿名' : '匿名评论'"
                        @click.stop="commentAnonymous = !commentAnonymous"
                      >
                        <EyeSlashIcon class="ik-engage-icon" aria-hidden="true" />
                      </button>
                    </div>
                    <div class="ik-engage-bar__right-btns">
                      <button
                        type="button"
                        class="ik-engage-bar__submit"
                        :disabled="sendingComment || commentImages.hasPendingUploads.value || commentImages.hasErroredUploads.value || (!newComment.trim() && !emoteInsert.hasEmotes.value)"
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
        </div><!-- /.ik-page__main -->
          </div>
        </div>
      </div>
    </template>

    <Teleport to="body">
      <Transition name="ik-overlay" appear>
        <PostImagePickerModal
          v-if="commentImages.showImagePickerModal.value"
          :existing-ids="commentImages.existingUploadIds.value"
          :remaining="commentImages.remainingImageSlots.value"
          @close="commentImages.showImagePickerModal.value = false"
          @upload="commentImages.handleImagePickerUpload"
          @select="commentImages.handleImagePickerSelect"
        />
      </Transition>
    </Teleport>

    <!-- 表情面板：组件内部 Teleport 到 body -->
    <EmotePicker
      :visible="emotePickerVisible"
      :anchor="emotePickerAnchor"
      @select="onEmoteSelect"
      @select-emoji="onEmojiSelect"
      @close="emotePickerVisible = false"
    />

    <!-- @ 提及候选下拉：组件内部 Teleport 到 body，避免父级 overflow 截断 -->
    <MentionPicker
      :visible="mention.pickerVisible.value"
      :loading="mention.pickerLoading.value"
      :results="mention.pickerResults.value"
      :active-index="mention.pickerActiveIndex.value"
      :anchor="mention.pickerAnchor.value"
      @select="mention.selectCandidate"
      @hover="(idx: number) => (mention.pickerActiveIndex.value = idx)"
    />
  </section>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Post Page – Full ZZZ Style
   ═══════════════════════════════════════════════ */

.ik-page-container {
  position: fixed;
  top: 78px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: none;
}

/* 45° 斜线纹理 (PatternPainter) */
.ik-page__stripe {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background: repeating-linear-gradient(
    40deg,
    transparent,
    transparent 3.5px,
    rgba(255, 255, 255, 0.09) 4.5px,
    rgba(255, 255, 255, 0.09) 7.5px,
    transparent 8.5px
  );
}

/* ── Gallery Loading Progress ─────────────────── */
.ik-page__gallery-progress {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  z-index: 100;
  transition: opacity 0.3s ease;
}

.ik-page__gallery-progress.is-active {
  opacity: 1;
}

.ik-page__gallery-progress-bar {
  height: 100%;
  background: #fbfe00;
  box-shadow: 0 0 8px rgba(251, 254, 0, 0.6);
  transition: width 0.2s ease;
}

/* ── Shell ──────────────────────────────────── */
.ik-page__shell {
  position: relative;
  z-index: 1;
  width: min(1280px, calc(100vw - 32px));
  max-height: calc(100vh - 78px - 32px);
  max-height: calc(100dvh - 78px - 32px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  overflow: hidden;
}

/* 外边框（半透明白色，三圆角） */
.ik-page__outer {
  flex: 1;
  min-height: 0;
  max-height: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 内边框（纯黑，三圆角） */
.ik-page__inner {
  flex: 1;
  min-height: 0;
  padding: 4px;
  background: #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Header Bar ─────────────────────────────── */
.ik-page__header {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  padding: 8px 16px;
  gap: 8px;
  flex-shrink: 0;
  border-radius: 18px 0 0 0;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #161616 0%, #080808 100%);
}

/* ── Content shell（header 下方，承载跑马灯 + body） ─ */
.ik-page__main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ik-page__header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.ik-page__avatar-shell {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 3px solid #2d2d2d;
  overflow: hidden;
}

.ik-page__avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 999px;
  background: #1b1b1b;
}

.ik-page__author-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ik-page__author-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ik-page__author-name {
  font-size: 16px;
  font-weight: 700;
  line-height: 20px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-page__level {
  font-size: 12px;
  font-weight: 700;
  font-style: italic;
  line-height: 20px;
  color: #BFFF09;
  flex-shrink: 0;
}

.ik-page__time {
  font-size: 12px;
  line-height: 16px;
  color: #808080;
}

/* ── Error ────────────────────────────────────── */
.ik-page__error {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px 32px;
  color: #ffb1b1;
  background: #121212;
  text-align: center;
}

/* ── Body (双栏) ──────────────────────────────── */
.ik-page__body {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  min-height: 0;
  background: transparent;
  border-radius: 0 0 18px 18px;
}

/* ── Left Column ──────────────────────────────── */
.ik-page__left {
  flex: 3;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ik-page__left-scroll {
  flex: 1;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.85);
  margin: 16px 8px 16px 16px;
  border-radius: 16px;
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.ik-page__left-scroll::-webkit-scrollbar {
  display: none;
}

/* 封面 */
.ik-page__cover-wrap {
  padding: 16px 24px 16px 16px;
}

.ik-page__cover-border {
  position: relative;
  width: 100%;
  max-height: 50vh;
  border-radius: 12px;
  border: 4px solid #313132;
  overflow: hidden;
  background: #0a0a0a;
}

.ik-page__cover {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: var(--ik-cursor-pointer);
}

.ik-page__cover-count {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 2px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
}

/* 正文 */
.ik-page__detail {
  padding: 0 16px 32px;
}

.ik-page__hidden-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 14px;
  border: 1px solid rgba(255, 170, 0, 0.4);
  border-radius: 0 10px 10px 10px;
  background: rgba(255, 170, 0, 0.08);
  color: #ffaa00;
  font-size: 13px;
  line-height: 1.5;
}

.ik-page__hidden-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.ik-page__title-cat {
  margin-right: 6px;
}

.ik-page__title {
  margin: 0 0 16px;
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 0.5px;
  color: #fff;
}

.ik-page__content {
  margin: 0;
  font-size: 16px;
  line-height: 1.7;
  color: #e0e0e0;
  /* 内容已由 markdown-it 渲染成正规 HTML（含 <br>/<p>），这里不再用 pre-wrap，
     否则源串里保留的字面换行会被重复渲染出多余空行。 */
  white-space: normal;
  word-wrap: break-word;
}

/* markdown-it 在"段落内嵌块级 HTML"场景会产出空 <p></p>，过滤掉避免多余间距。 */
.ik-page__content :deep(p:empty) {
  display: none;
}

.ik-page__content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  cursor: pointer;
}

.ik-page__content :deep(a) {
  color: #6f9cff;
  text-decoration: underline;
}

.ik-page__content :deep(pre) {
  background: #1a1a1a;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}

.ik-page__content :deep(code) {
  background: #1a1a1a;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
}

.ik-page__content :deep(blockquote) {
  border-left: 4px solid #BFFF09;
  padding-left: 16px;
  margin: 12px 0;
  color: #b0b0b0;
}

.ik-page__content :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 14px;
  background: #111;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
}
.ik-page__content :deep(table th),
.ik-page__content :deep(table td) {
  padding: 8px 12px;
  border: 1px solid #2a2a2a;
  text-align: left;
  vertical-align: top;
}
.ik-page__content :deep(table thead th) {
  background: #1a1a1a;
  color: #fff;
  font-weight: 700;
}
.ik-page__content :deep(table tbody tr:nth-child(even)) {
  background: #161616;
}

/* ── Right Column ─────────────────────────────── */
.ik-page__right {
  flex: 2;
  min-width: 0;
  display: flex;
  flex-direction: column;
  margin: 16px 16px 16px 8px;
  background: rgba(0, 0, 0, 0.85);
  border-radius: 16px;
  overflow: hidden;
}

.ik-page__comments-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.ik-page__comments-scroll::-webkit-scrollbar {
  display: none;
}

.ik-page__comments-inner {
  width: 100%;
  min-height: 100%;
  padding: 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0;
}



.ik-page__load-more {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

/* ── Actions Bar ──────────────────────────────── */
.ik-page__actions {
  position: relative;
  z-index: 4;
  flex-shrink: 0;
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: transparent;
  border-top: 1px solid #202020;
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
  /* 不能 overflow:hidden：会把「⋮」上拉菜单剪掉 */
  overflow: visible;
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

.ik-page__actions--active .ik-engage-bar__content-edit {
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

.ik-page__actions--active .ik-engage-bar__textarea :deep(.z-input),
.ik-page__actions--active .ik-engage-bar__textarea :deep(.z-textarea) {
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
  color: #BFFF09;
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

.ik-engage-bar__attachments {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
  margin: 10px 0 0;
}

.ik-engage-bar__attachment {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 10px;
  overflow: hidden;
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.ik-engage-bar__attachment-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ik-engage-bar__attachment-progress,
.ik-engage-bar__attachment-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  text-align: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.48);
  font-size: 12px;
  font-weight: 700;
}

.ik-engage-bar__attachment-error {
  border: 0;
  line-height: 1.3;
  cursor: var(--ik-cursor-pointer);
}

.ik-engage-bar__attachment-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: var(--ik-cursor-pointer);
}

.ik-engage-bar__attachment-remove:hover {
  background: rgba(0, 0, 0, 0.85);
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

.ik-page__actions--active .ik-engage-bar__interact-container {
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

.ik-triple__icon-shell {
  position: relative;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
}

.ik-engage-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.ik-engage-icon--denny {
  width: 24px;
  height: 24px;
  margin: 0;
  object-fit: contain;
  opacity: 0.65;
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ik-engage-bar__action:hover:not(:disabled) .ik-engage-icon--denny {
  transform: scale(1.1) rotate(15deg);
  opacity: 0.9;
}

.ik-engage-bar__action--active .ik-engage-icon--denny {
  opacity: 1 !important;
}

.ik-engage-bar__action:disabled .ik-engage-icon--denny {
  opacity: 0.3;
}

.ik-engage-bar__comment-badge {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  color: #9a9a9a;
  font-size: 13px;
  font-weight: 700;
  pointer-events: none; /* 让点击穿透，原生触发输入框聚焦 */
  z-index: 2;
}

.ik-engage-comment-icon {
  width: 20px;
  height: 20px;
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

/* ── 「⋮」上拉菜单：z-dropdown 默认向下展开，这里改为向上 ── */
.ik-engage-bar__more {
  margin-left: 0;
  z-index: 5;
}

.ik-engage-bar__more :deep(.z-dropdown__content) {
  bottom: auto;
  top: -8px;
  transform-origin: bottom;
  transform: translateY(-100%) scaleY(0.6);
  transition: opacity 0.18s ease,
              transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.ik-engage-bar__more.is-visible :deep(.z-dropdown__content) {
  transform: translateY(-100%) scaleY(1);
}

.ik-engage-bar__more :deep(.z-dropdown__content)::before {
  top: 0;
  bottom: -8px;
}

.ik-engage-bar__bottom {
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateY(-4px);
  transition: max-height 180ms ease, opacity 140ms ease, transform 180ms ease;
}

.ik-page__actions--active .ik-engage-bar__bottom {
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

.ik-engage-bar__tool--active {
  color: var(--ik-primary);
}

.ik-engage-bar__submit,
.ik-engage-bar__cancel {
  height: 30px;
  padding: 0 16px;
  border: none;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 900;
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

/* ── Skeleton ─────────────────────────────────── */
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

.ik-skel--actions-bar {
  width: 100%;
  height: 36px;
  border-radius: 18px;
}

/* ── Comment Skeleton ──────────────────── */
.ik-comment-skel {
  display: flex;
  gap: 12px;
  padding: 14px 0;
}

.ik-comment-skel + .ik-comment-skel {
  border-top: 1px solid #1e1e1e;
}

.ik-comment-skel__avatar {
  flex-shrink: 0;
}

.ik-comment-skel__body {
  flex: 1;
  min-width: 0;
}

/* ═══════════════════════════════════════════════
   Mobile Layout (< 800px) → 单列
   ═══════════════════════════════════════════════ */
@media (max-width: 800px) {
  .ik-page-container {
    top: 66px;
  }

  .ik-page__shell {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 66px - 24px);
    max-height: calc(100dvh - 66px - 24px);
  }

  .ik-page__outer {
    border-radius: 20px 0 20px 20px;
  }

  .ik-page__inner {
    border-radius: 18px 0 18px 18px;
  }

  .ik-page__body {
    flex-direction: column;
    height: auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    -ms-overflow-style: none;
    scrollbar-width: none;
    border-radius: 0;
    background: transparent;
    will-change: scroll-position;
    -webkit-transform: translateZ(0);
  }

  .ik-page__body::-webkit-scrollbar {
    display: none;
  }

  .ik-page__left {
    flex: none;
  }

  .ik-page__left-scroll {
    flex: none;
    max-height: none;
    overflow: visible;
    margin: 0;
    border-radius: 0;
    will-change: auto;
    transform: none;
  }

  .ik-page__cover-wrap {
    padding: 0;
  }

  .ik-page__cover-border {
    border-radius: 0;
    border-width: 0 0 4px;
    max-height: none;
  }

  .ik-page__detail {
    padding: 16px;
  }

  .ik-page__right {
    flex: 1 0 auto;
    margin: 0;
    border-radius: 0;
    overflow: visible;
    border-top: 1px solid #313132;
    background: transparent;
  }

  .ik-page__comments-scroll {
    flex: 1 0 auto;
    min-height: 0;
    overflow: visible;
    will-change: auto;
    transform: none;
  }

  .ik-page__actions {
    position: sticky;
    bottom: 0;
    z-index: 3;
    border-radius: 0;
    background: rgba(7, 7, 7, 0.96);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
  }
}

@media (max-width: 500px) {
  .ik-page__shell {
    width: 100vw;
    max-height: calc(100vh - 66px);
    max-height: calc(100dvh - 66px);
  }

  .ik-page__outer {
    border-radius: 0;
  }

  .ik-page__inner {
    border-radius: 0;
  }
}
</style>
