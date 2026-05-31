<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMessage } from "zenless-ui";
import type { Author, Comment, Post } from "~/types/entities";
import type { PostPreview } from "~/composables/usePostModal";
import { resolveErrorMessage } from "~/utils/api-error";
import { formatBodyText, sanitizeBodyHtml } from "~/utils/format-body";
import { formatTime } from "~/utils/time";
import { HandThumbUpIcon, StarIcon, ChatBubbleLeftIcon, AtSymbolIcon, FaceSmileIcon, TrashIcon, ChevronLeftIcon, ChevronRightIcon, EyeSlashIcon } from "@heroicons/vue/24/outline";
import { HandThumbUpIcon as HandThumbUpIconSolid } from "@heroicons/vue/24/solid";
import { useMentionInput } from "~/composables/useMentionInput";

const DEFAULT_COVER_IMAGE = "/images/default-cover.webp";

const { isOpen: isGalleryOpen, isLoading: isGalleryLoading, loadingProgress: galleryProgress, openGallery, preload: preloadGallery, destroy: destroyPreview } = useLightGallery();

const props = defineProps<{
  postId: string;
  coverHint?: number | null;
  preview?: PostPreview | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const api = useApi();
const auth = useAuthStore();
const postModal = usePostModal();
const loginDialog = useLoginDialog();
const confirmDialog = useConfirmDialog();
const message = useMessage();

const post = ref<Post | null>(null);
const loading = ref(true);
const loadError = ref(false);

// 弹窗刚打开时优先展示首页卡片传入的 preview，等接口数据回来后无缝替换。
const headerAuthor = computed<Author | null>(() => post.value?.author ?? props.preview?.author ?? null);
const headerCreatedAt = computed<string | undefined>(() => post.value?.createdAt ?? props.preview?.createdAt);
const headerTitle = computed<string>(() => post.value?.title ?? props.preview?.title ?? "");

const comments = ref<Comment[]>([]);
const commentsCursor = ref("");
const commentsHasNext = ref(true);
const commentsLoading = ref(false);

const newComment = ref("");
const sendingComment = ref(false);
const commentInputBoxRef = ref<HTMLElement | null>(null);
const commentInputFocused = ref(false);
const replyTarget = ref<{ id: string; authorName: string } | null>(null);
const commentAnonymous = ref(false);

/** 真实底层 textarea：z-input 是个包装，原生 keydown / overlay 都需要它 */
const commentTextareaRef = ref<HTMLTextAreaElement | null>(null);

/**
 * 评论编辑器的 @ 提及处理。逻辑与路由页 pages/post/[id].vue 完全对称——
 * 弹窗模式只是同一编辑器的另一种呈现，没有理由维护两份分支。
 */
const mention = useMentionInput({
  text: newComment,
  textareaRef: commentTextareaRef,
  search: api.searchAuthors,
});

const scrollRef = ref<HTMLElement | null>(null);
const covers = computed(() => post.value?.covers ?? []);
const hasCovers = computed(() => covers.value.length > 0);
const isCommentEditorActive = computed(() => commentInputFocused.value);
const postLikeCount = computed(() => post.value?.likesCount ?? 0);
const postCommentCount = computed(() => post.value?.commentsCount ?? comments.value.length);

const syncCommentInputHeight = async () => {
  await nextTick();
  const textarea = commentInputBoxRef.value?.querySelector("textarea") as HTMLTextAreaElement | null;
  if (!textarea) return;
  textarea.style.height = "42px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 62)}px`;
};

const firstCover = computed(() => covers.value[0] ?? null);

// 真实图片解码完成的索引集合：用于在解码完成前继续显示骨架屏，
// 避免"骨架结束 → 黑色封面框 → 图片淡入"的中间黑屏。
const loadedCoverImages = ref<Set<number>>(new Set());
const isCoverImageLoaded = (i: number) => loadedCoverImages.value.has(i);
const onCoverImageLoad = (i: number) => {
  if (!loadedCoverImages.value.has(i)) {
    loadedCoverImages.value = new Set([...loadedCoverImages.value, i]);
  }
};
const coverAspectRatio = computed(() => {
  const c = firstCover.value;
  if (c?.width && c?.height && c.width > 0 && c.height > 0) return c.width / c.height;
  // 无真实封面时优先沿用骨架阶段使用的 coverHint，避免骨架→默认占位图之间的高度跳动。
  if (props.coverHint && props.coverHint > 0) return props.coverHint;
  return 643 / 408;
});

const openCoverPreview = (index = 0) => {
  const images = covers.value.map((c) => ({ src: c.url, width: c.width, height: c.height }));
  if (images.length) openGallery(images, Math.min(Math.max(index, 0), images.length - 1));
};

/* ── 封面轮播 ─────────────────────────────────── */
const coverScrollerRef = ref<HTMLElement | null>(null);
const coverIndex = ref(0);
let coverScrollRAF: number | null = null;

// 已批准加载的封面索引集合：只有命中其中的图片才会真正请求 src。
// 设计目的：让新图的网络请求 + 解码不要砸在切换动画的同一帧里。
// 切换动画进行时窗口保持不变；动画结束（滚动稳定）后，再把当前 ±2 加入窗口。
const loadedCoverIndices = ref<Set<number>>(new Set([0, 1, 2]));
const LOAD_WINDOW_RADIUS = 2;
const COVER_SETTLE_DELAY_MS = 160;
let coverSettleTimer: ReturnType<typeof setTimeout> | null = null;

const expandLoadWindow = () => {
  const i = coverIndex.value;
  const total = covers.value.length;
  if (total === 0) return;
  const next = new Set(loadedCoverIndices.value);
  let changed = false;
  for (let k = i - LOAD_WINDOW_RADIUS; k <= i + LOAD_WINDOW_RADIUS; k++) {
    if (k >= 0 && k < total && !next.has(k)) {
      next.add(k);
      changed = true;
    }
  }
  if (changed) loadedCoverIndices.value = next;
};

const scheduleExpandLoadWindow = () => {
  if (coverSettleTimer !== null) clearTimeout(coverSettleTimer);
  coverSettleTimer = setTimeout(() => {
    coverSettleTimer = null;
    expandLoadWindow();
  }, COVER_SETTLE_DELAY_MS);
};

const resetLoadWindow = () => {
  if (coverSettleTimer !== null) {
    clearTimeout(coverSettleTimer);
    coverSettleTimer = null;
  }
  // 重置到初始窗口（前三张），与首次进入时一致
  loadedCoverIndices.value = new Set([0, 1, 2]);
};

// 命中加载窗口、或正好是当前焦点的图片，才允许真正请求 src。
const isCoverNearby = (i: number) =>
  i === coverIndex.value || loadedCoverIndices.value.has(i);

const onCoverScroll = () => {
  // 任何一次 scroll 事件都会重置 settle 定时器，确保动画进行中窗口不会扩张
  scheduleExpandLoadWindow();
  if (coverScrollRAF !== null) return;
  coverScrollRAF = requestAnimationFrame(() => {
    coverScrollRAF = null;
    const el = coverScrollerRef.value;
    if (!el) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const idx = Math.round(el.scrollLeft / w);
    if (idx !== coverIndex.value) coverIndex.value = idx;
  });
};

const goCover = (index: number) => {
  const el = coverScrollerRef.value;
  if (!el) return;
  const total = covers.value.length;
  if (total <= 1) return;
  const target = Math.min(Math.max(index, 0), total - 1);
  el.scrollTo({ left: target * el.clientWidth, behavior: "smooth" });
};

// 拦截滚轮：只拦截会被横向滑动吞掉的那部分（平板/鼠标水平滚轮），
// 转换为外层弹窗的垂直滚动，避免被诤判为切图。
// 垂直滚轮（deltaY）不拦截——交给浏览器原生平滑滚动处理，避免"瞬移"感。
const onCoverWheel = (e: WheelEvent) => {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  const parent = scrollRef.value;
  if (parent) parent.scrollTop += e.deltaX;
};

/* ── 鼠标拖拽切图 ─────────────────────────────── */
// 触屏由原生 overflow-x 滑动接管；鼠标/笔需要我们手动模拟拖拽，
// 否则按住拖动会被识别成 click 直接打开预览。
const DRAG_THRESHOLD_PX = 6;
// 拖动距离超过单页宽度该比例即切下一张（不到一半也算）
const DRAG_SNAP_RATIO = 0.01;
// 释放瞬间速度超过该值（px/ms）也触发切图，方便"轻甩"
const DRAG_FLING_VELOCITY = 0.01;
let isDraggingCover = false;
let coverDragStartX = 0;
let coverDragStartScroll = 0;
let coverDragStartIndex = 0;
let coverDragMoved = false;
let coverDragLastX = 0;
let coverDragLastT = 0;
let coverDragVelocity = 0;

const onCoverPointerDown = (e: PointerEvent) => {
  if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
  if (covers.value.length <= 1) return;
  const el = coverScrollerRef.value;
  if (!el) return;
  isDraggingCover = true;
  coverDragMoved = false;
  coverDragStartX = e.clientX;
  coverDragStartScroll = el.scrollLeft;
  coverDragStartIndex = coverIndex.value;
  coverDragLastX = e.clientX;
  coverDragLastT = performance.now();
  coverDragVelocity = 0;
  (e.target as Element).setPointerCapture?.(e.pointerId);
};

const onCoverPointerMove = (e: PointerEvent) => {
  if (!isDraggingCover) return;
  const el = coverScrollerRef.value;
  if (!el) return;
  const dx = e.clientX - coverDragStartX;
  if (!coverDragMoved && Math.abs(dx) > DRAG_THRESHOLD_PX) coverDragMoved = true;
  el.scrollLeft = coverDragStartScroll - dx;

  // 实时估算速度（px/ms），向右为正、向左为负
  const now = performance.now();
  const dt = now - coverDragLastT;
  if (dt > 0) {
    const instV = (e.clientX - coverDragLastX) / dt;
    // 指数平滑，减少抖动
    coverDragVelocity = coverDragVelocity * 0.5 + instV * 0.5;
  }
  coverDragLastX = e.clientX;
  coverDragLastT = now;
};

const onCoverPointerUp = (e: PointerEvent) => {
  if (!isDraggingCover) return;
  isDraggingCover = false;
  const el = coverScrollerRef.value;
  if (!el) return;
  try {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }
  if (!coverDragMoved) return;

  const w = el.clientWidth;
  if (w <= 0) return;

  // 起始页相对位移：>0 表示朝下一页，<0 表示朝上一页
  const offset = el.scrollLeft - coverDragStartIndex * w;
  // 速度 > 0 表示手指向右移动（看上一张），< 0 表示向左（看下一张）
  const v = coverDragVelocity;
  let targetIdx = coverDragStartIndex;
  if (offset > w * DRAG_SNAP_RATIO || v < -DRAG_FLING_VELOCITY) {
    targetIdx = coverDragStartIndex + 1;
  } else if (offset < -w * DRAG_SNAP_RATIO || v > DRAG_FLING_VELOCITY) {
    targetIdx = coverDragStartIndex - 1;
  }
  targetIdx = Math.max(0, Math.min(covers.value.length - 1, targetIdx));
  el.scrollTo({ left: targetIdx * w, behavior: "smooth" });
};

// 在 click 捕获阶段拦截：拖动后产生的 click 不应打开预览
const onCoverClickCapture = (e: MouseEvent) => {
  if (coverDragMoved) {
    coverDragMoved = false;
    e.preventDefault();
    e.stopPropagation();
  }
};

// 切换帖子时重置封面索引并将容器滚回起点
watch(() => props.postId, () => {
  coverIndex.value = 0;
  resetLoadWindow();
  loadedCoverImages.value = new Set();
  nextTick(() => {
    const el = coverScrollerRef.value;
    if (el) el.scrollLeft = 0;
  });
});

// 首次拿到封面列表后，根据当前 coverIndex 立即扩张一次窗口，
// 保证打开弹窗时前几张就处于可加载状态。
watch(() => covers.value.length, (n) => {
  if (n > 0) expandLoadWindow();
});

/* ── 数据加载 ──────────────────────────────────── */
const loadPost = async () => {
  try {
    post.value = await api.getPost(props.postId);
    if (post.value?.title) {
      postModal.setTitle(post.value.title);
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
    const page = await api.getComments(props.postId, commentsCursor.value);
    comments.value.push(...page.nodes);
    commentsCursor.value = page.endCursor;
    commentsHasNext.value = page.hasNextPage;
  } catch (err) {
    message.error(resolveErrorMessage(err, "获取评论失败"));
  } finally {
    commentsLoading.value = false;
  }
};

/** 正文渲染后再拉评论，避免与入场动画、骨架屏切换抢主线程 */
const scheduleLoadComments = () => {
  if (!import.meta.client) return;
  const run = () => {
    void loadComments();
  };
  requestAnimationFrame(() => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(run, { timeout: 500 });
    } else {
      setTimeout(run, 16);
    }
  });
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
  if (!newComment.value.trim()) return;

  sendingComment.value = true;
  const isReply = !!replyTarget.value;
  try {
    // serializeForSend 把显示串里的 `@<name>` 段还原成 `@[name](docId)` token；
    // 没有任何 mention 时等价于原 newComment.value
    const serialized = mention.serializeForSend().trim();
    const parentId = replyTarget.value?.id;
    const res = await api.addPostComment({
      postId: props.postId,
      content: serialized,
      authorDocumentId: auth.user?.authorId,
      parentId,
      isAnonymous: commentAnonymous.value || undefined,
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
  mention.reset();
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
  const ok = await confirmDialog.open({ title: "删除帖子", message: "确定删除这篇帖子吗？此操作不可恢复。", confirmText: "删除", danger: true });
  if (!ok) return;
  deletingArticle.value = true;
  try {
    const deletedId = post.value.id;
    await api.deleteArticle(deletedId);
    message.success("帖子已删除");
    window.dispatchEvent(new CustomEvent("ik:article-deleted", { detail: deletedId }));
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

/* ── 当 postId 变化时重新加载 ─────────────── */
const resetAndLoad = async () => {
  post.value = null;
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
  await loadPost();
  // 主体一拿到就解除骨架屏；评论与浏览数后台继续，不阻塞 UI。
  loading.value = false;
  void recordView();
  if (!loadError.value) {
    scheduleLoadComments();
  }
};

watch(
  () => props.postId,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      resetAndLoad();
    }
  },
);

watch(newComment, () => {
  syncCommentInputHeight();
});

/**
 * 把真实 textarea 拿到并接上 mention 事件钩子。
 * 与 pages/post/[id].vue 完全对称。
 */
let teardownMentionListeners: (() => void) | null = null;
const attachMentionToTextarea = () => {
  const root = commentInputBoxRef.value;
  if (!root) return;
  const ta = root.querySelector("textarea") as HTMLTextAreaElement | null;
  if (!ta || ta === commentTextareaRef.value) return;

  teardownMentionListeners?.();
  commentTextareaRef.value = ta;

  const onInput = () => mention.refresh();
  const onKeyDownMention = (e: KeyboardEvent) => mention.onKeyDown(e);
  const onSelect = () => mention.refresh();

  ta.addEventListener("input", onInput);
  ta.addEventListener("keydown", onKeyDownMention);
  ta.addEventListener("click", onSelect);
  ta.addEventListener("keyup", onSelect);

  teardownMentionListeners = () => {
    ta.removeEventListener("input", onInput);
    ta.removeEventListener("keydown", onKeyDownMention);
    ta.removeEventListener("click", onSelect);
    ta.removeEventListener("keyup", onSelect);
  };
};

// 编辑器从 placeholder 模式切到激活模式时 z-input 会重新挂载，
// 需要重新查找真实 textarea 并 attach 一次。
watch(commentInputFocused, () => {
  nextTick(() => attachMentionToTextarea());
});

onMounted(async () => {
  window.addEventListener("keydown", onKeyDown);
  // lightgallery 完全惰性：直到用户点击封面触发 openCoverPreview 才加载，
  // 让只看文字、不点图的用户不必下载这套资源。
  loading.value = true;
  await loadPost();
  // 主体一拿到就解除骨架屏；评论与浏览数后台继续，不阻塞 UI。
  loading.value = false;
  void recordView();
  await nextTick();
  if (!loadError.value) {
    scheduleLoadComments();
  }
  await nextTick();
  attachMentionToTextarea();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  destroyPreview();
  if (coverSettleTimer !== null) {
    clearTimeout(coverSettleTimer);
    coverSettleTimer = null;
  }
  teardownMentionListeners?.();
  teardownMentionListeners = null;
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
                <UserHoverCard :author-id="headerAuthor?.documentId" :clickable="!!headerAuthor?.documentId">
                  <div class="ik-dialog__avatar-shell">
                    <img
                      v-if="headerAuthor"
                      :src="headerAuthor.avatar || '/images/default-avatar.webp'"
                      :alt="headerAuthor.name || ''"
                      class="ik-dialog__avatar"
                      @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
                    />
                    <div v-else class="ik-skel" style="width:100%;height:100%;border-radius:999px"></div>
                  </div>
                </UserHoverCard>
                <div v-if="headerAuthor" class="ik-dialog__author-info">
                  <div class="ik-dialog__author-row">
                    <UserHoverCard :author-id="headerAuthor.documentId" :clickable="!!headerAuthor?.documentId">
                      <span class="ik-dialog__author-name">
                        {{ headerAuthor.name || "匿名用户" }}
                      </span>
                    </UserHoverCard>
                    <span v-if="headerAuthor.level && headerAuthor.documentId" class="ik-dialog__level">
                      Lv.{{ headerAuthor.level }}
                    </span>
                  </div>
                  <span v-if="headerCreatedAt" class="ik-dialog__time">
                    {{ formatTime(headerCreatedAt) }}
                  </span>
                  <div v-else class="ik-skel" style="width:60px;height:16px;border-radius:3px"></div>
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
            <div class="ik-dialog__main">
              <IkZzzMarquee />

            <div v-if="loading" class="ik-dialog__body">
              <!-- 骨架屏：左栏 -->
              <div class="ik-dialog__left">
                <div class="ik-dialog__left-scroll">
                  <div class="ik-dialog__cover-wrap">
                    <div
                      class="ik-dialog__cover-border"
                      :style="props.coverHint ? { aspectRatio: String(props.coverHint) } : {}"
                    >
                      <div class="ik-skel ik-dialog__cover-skel" aria-hidden="true"></div>
                    </div>
                  </div>
                  <div class="ik-dialog__detail">
                    <h1 v-if="headerTitle" class="ik-dialog__title">{{ headerTitle }}</h1>
                    <div v-else class="ik-skel ik-skel--title"></div>
                    <div class="ik-skel ik-skel--line" style="width:100%"></div>
                    <div class="ik-skel ik-skel--line" style="width:90%"></div>
                    <div class="ik-skel ik-skel--line" style="width:75%"></div>
                    <div class="ik-skel ik-skel--line" style="width:60%"></div>
                  </div>
                </div>
              </div>
              <!-- 骨架屏：右栏（与评论自身骨架保持一致） -->
              <div class="ik-dialog__right">
                <div style="flex:1;padding:16px;overflow:hidden">
                  <div v-for="n in 5" :key="n" style="display:flex;gap:12px;padding:14px 0" :style="n > 1 ? 'border-top:1px solid #1e1e1e' : ''">
                    <div class="ik-skel" style="width:36px;height:36px;border-radius:999px;flex-shrink:0"></div>
                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
                      <div class="ik-skel" style="width:80px;height:14px;border-radius:3px"></div>
                      <div class="ik-skel" style="width:95%;height:14px;border-radius:3px"></div>
                      <div class="ik-skel" style="width:60%;height:14px;border-radius:3px"></div>
                    </div>
                  </div>
                </div>
                <div class="ik-dialog__actions">
                  <div class="ik-skel ik-skel--actions-bar"></div>
                </div>
              </div>
            </div>

            <div v-else-if="loadError" class="ik-dialog__error">
              加载失败，请关闭后重试
            </div>

            <template v-else-if="post">
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
                        <!-- 单张封面 -->
                        <template v-if="!hasCovers || covers.length === 1">
                          <img
                            :src="firstCover?.url || DEFAULT_COVER_IMAGE"
                            :alt="hasCovers ? post.title : 'default cover'"
                            class="ik-dialog__cover"
                            decoding="async"
                            @load="onCoverImageLoad(0)"
                            @click="hasCovers && openCoverPreview(0)"
                            @error="onCoverImageLoad(0); ($event.target as HTMLImageElement).src = DEFAULT_COVER_IMAGE"
                          />
                          <div
                            v-if="!isCoverImageLoaded(0)"
                            class="ik-skel ik-dialog__cover-skel"
                            aria-hidden="true"
                          ></div>
                        </template>

                        <!-- 多图轮播：横向滑动 + 滚动捕捉 -->
                        <template v-else>
                          <div
                            ref="coverScrollerRef"
                            class="ik-dialog__cover-scroller"
                            @scroll.passive="onCoverScroll"
                            @wheel="onCoverWheel"
                            @pointerdown="onCoverPointerDown"
                            @pointermove="onCoverPointerMove"
                            @pointerup="onCoverPointerUp"
                            @pointercancel="onCoverPointerUp"
                            @click.capture="onCoverClickCapture"
                          >
                            <div
                              v-for="(c, i) in covers"
                              :key="c.url + i"
                              class="ik-dialog__cover-slide"
                            >
                              <img
                                :src="isCoverNearby(i) ? c.url : undefined"
                                :alt="`${post.title} - ${i + 1}`"
                                class="ik-dialog__cover"
                                :loading="i === 0 ? 'eager' : 'lazy'"
                                decoding="async"
                                draggable="false"
                                @load="onCoverImageLoad(i)"
                                @click="openCoverPreview(i)"
                                @error="onCoverImageLoad(i); ($event.target as HTMLImageElement).src = DEFAULT_COVER_IMAGE"
                              />
                              <div
                                v-if="!isCoverImageLoaded(i)"
                                class="ik-skel ik-dialog__cover-skel"
                                aria-hidden="true"
                              ></div>
                            </div>
                          </div>

                          <button
                            v-show="coverIndex > 0"
                            type="button"
                            class="ik-dialog__cover-nav ik-dialog__cover-nav--prev"
                            aria-label="上一张"
                            @click.stop="goCover(coverIndex - 1)"
                          >
                            <ChevronLeftIcon style="width:20px;height:20px" />
                          </button>
                          <button
                            v-show="coverIndex < covers.length - 1"
                            type="button"
                            class="ik-dialog__cover-nav ik-dialog__cover-nav--next"
                            aria-label="下一张"
                            @click.stop="goCover(coverIndex + 1)"
                          >
                            <ChevronRightIcon style="width:20px;height:20px" />
                          </button>

                          <div class="ik-dialog__cover-dots">
                            <button
                              v-for="(_, i) in covers"
                              :key="i"
                              type="button"
                              class="ik-dialog__cover-dot"
                              :class="{ 'ik-dialog__cover-dot--active': i === coverIndex }"
                              :aria-label="`第 ${i + 1} 张`"
                              :aria-current="i === coverIndex ? 'true' : undefined"
                              @click.stop="goCover(i)"
                            />
                          </div>

                          <span class="ik-dialog__cover-count ik-dialog__cover-count--top">
                            {{ coverIndex + 1 }} / {{ covers.length }}
                          </span>
                        </template>
                      </div>
                    </div>

                    <!-- 正文 -->
                    <div class="ik-dialog__detail">
                      <h1 class="ik-dialog__title">{{ post.title }}</h1>
                      <div
                        v-if="post.body"
                        class="ik-dialog__content"
                        v-html="sanitizeBodyHtml(post.body)"
                      ></div>
                      <div
                        v-else-if="post.bodyText"
                        class="ik-dialog__content"
                        v-html="formatBodyText(post.bodyText)"
                      ></div>
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
                      <div v-if="commentsLoading && !comments.length">
                        <div v-for="n in 5" :key="n" style="display:flex;gap:12px;padding:14px 0" :style="n > 1 ? 'border-top:1px solid #1e1e1e' : ''">
                          <div class="ik-skel" style="width:36px;height:36px;border-radius:999px;flex-shrink:0"></div>
                          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
                            <div class="ik-skel" style="width:80px;height:14px;border-radius:3px"></div>
                            <div class="ik-skel" style="width:95%;height:14px;border-radius:3px"></div>
                            <div class="ik-skel" style="width:60%;height:14px;border-radius:3px"></div>
                          </div>
                        </div>
                      </div>
                      <div v-else-if="!comments.length" class="ik-empty" style="padding: 40px 0">暂时还没有评论</div>
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
                      <div v-if="commentsHasNext && comments.length" class="ik-dialog__load-more">
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
                          <!-- @ 提及高亮叠加层：teleport 到 textarea 父级，pointer-events:none -->
                          <MentionHighlightOverlay
                            :target="commentTextareaRef"
                            :text="newComment"
                            :mentions="mention.mentions.value"
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
                              :class="{ 'ik-engage-bar__action--active': post.liked }"
                              @click="likeArticle"
                            >
                              <HandThumbUpIconSolid v-if="post.liked" class="ik-engage-icon" aria-hidden="true" />
                              <HandThumbUpIcon v-else class="ik-engage-icon" aria-hidden="true" />
                              <span>{{ postLikeCount > 0 ? postLikeCount : '点赞' }}</span>
                            </button>
                            <button type="button" class="ik-engage-bar__action" @click="showCollectComingSoon">
                              <StarIcon class="ik-engage-icon" aria-hidden="true" />
                              <span>收藏</span>
                            </button>
                            <button type="button" class="ik-engage-bar__action" @click="focusCommentInput">
                              <ChatBubbleLeftIcon class="ik-engage-icon" aria-hidden="true" />
                              <span>{{ postCommentCount }}</span>
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
                            <button type="button" class="ik-engage-bar__tool" aria-label="表情">
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
            </div><!-- /.ik-dialog__main -->
          </div>
        </div>
      </div>

      <!-- @ 提及候选下拉：组件内部 Teleport 到 body，避免父级 overflow 截断；
           放在 .ik-overlay 内只是为了保持单根模板，不影响渲染位置。 -->
      <MentionPicker
        :visible="mention.pickerVisible.value"
        :loading="mention.pickerLoading.value"
        :results="mention.pickerResults.value"
        :active-index="mention.pickerActiveIndex.value"
        :anchor="mention.pickerAnchor.value"
        @select="mention.selectCandidate"
        @hover="(idx: number) => (mention.pickerActiveIndex.value = idx)"
      />
    </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   ZZZ-Style Post Overlay
   Matches Flutter: showZZZDialog + PostPage
   ═══════════════════════════════════════════════ */

/* ── Backdrop ──────────────────────────────────── */
/* 与 Flutter showZZZDialog 完全一致：
   - 黑遮罩 alpha 0.6
   - BackdropFilter blur 10px */
.ik-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

/* 斜线纹理（PatternPainter）—— web 端调优版：
   40°、~9px 间距、3px 线宽、白 alpha 0.09。
   不是严格复刻 Flutter（45°/5px/1.5px/0.15），而是过去针对 web 端
   显示密度与对比度调过的更舒适版本，保留。 */
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

/* 外边框 */
.ik-dialog__outer {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
}

/* 内边框 */
.ik-dialog__inner {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Header Bar ────────────────────────────────── */
.ik-dialog__header {
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
.ik-dialog__main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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

.ik-skel--actions-bar {
  width: 100%;
  height: 36px;
  border-radius: 18px;
}

/* ── Error ─────────────────────────────────────── */
.ik-dialog__error {
  position: relative;
  z-index: 1;
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
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  min-height: 0;
  background: transparent;
  border-radius: 0 0 18px 18px;
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
  background: rgba(0, 0, 0, 0.85);
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

.ik-dialog__cover-skel {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 1;
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
  font-weight: 700;
  pointer-events: none;
  z-index: 2;
}

.ik-dialog__cover-count--top {
  top: 10px;
  bottom: auto;
}

/* 多图轮播 */
.ik-dialog__cover-scroller {
  position: absolute;
  inset: 0;
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
  user-select: none;
  -webkit-user-select: none;
  touch-action: pan-x;
}

.ik-dialog__cover-scroller::-webkit-scrollbar {
  display: none;
}

.ik-dialog__cover-slide {
  position: relative;
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  scroll-snap-align: center;
  scroll-snap-stop: always;
}

.ik-dialog__cover-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: var(--ik-cursor-pointer);
  transition: background 160ms ease, opacity 160ms ease;
  z-index: 2;
}

.ik-dialog__cover-nav:hover {
  background: rgba(0, 0, 0, 0.75);
}

.ik-dialog__cover-nav--prev {
  left: 10px;
}

.ik-dialog__cover-nav--next {
  right: 10px;
}

.ik-dialog__cover-dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  z-index: 2;
}

.ik-dialog__cover-dot {
  appearance: none;
  border: none;
  padding: 0;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.45);
  cursor: var(--ik-cursor-pointer);
  transition: width 200ms ease, background-color 200ms ease, transform 160ms ease;
}

.ik-dialog__cover-dot:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: scale(1.2);
}

.ik-dialog__cover-dot--active {
  width: 18px;
  background: var(--ik-primary);
}

.ik-dialog__cover-dot--active:hover {
  background: var(--ik-primary);
  transform: none;
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
  /* 由 markdown-it 渲染成 HTML，无需 pre-wrap；详见 utils/format-body.ts。 */
  white-space: normal;
  word-wrap: break-word;
}

/* markdown-it 在"段落内嵌块级 HTML"场景会产出空 <p></p>，过滤掉避免多余间距。 */
.ik-dialog__content :deep(p:empty) {
  display: none;
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

.ik-dialog__content :deep(table) {
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
.ik-dialog__content :deep(table th),
.ik-dialog__content :deep(table td) {
  padding: 8px 12px;
  border: 1px solid #2a2a2a;
  text-align: left;
  vertical-align: top;
}
.ik-dialog__content :deep(table thead th) {
  background: #1a1a1a;
  color: #fff;
  font-weight: 700;
}
.ik-dialog__content :deep(table tbody tr:nth-child(even)) {
  background: #161616;
}

/* ── Right Column ──────────────────────────────── */
.ik-dialog__right {
  flex: 2;
  min-width: 0;
  display: flex;
  flex-direction: column;
  margin: 16px 16px 16px 8px;
  background: rgba(0, 0, 0, 0.85);
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
  background: transparent;
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

/* ═══════════════════════════════════════════════
   Transition Animations —— 仅覆盖 transform 起止值
   ───────────────────────────────────────────────
   动画时长 / 曲线 / will-change 等在全局 theme.css 里定义（所有
   .ik-overlay 弹窗共用）。此处仅因为本弹窗 .ik-dialog 自带
   transform: scale(1.1) 静态变换，需在 enter-from / leave-to
   补回 scale(1.1) 部分，避免动画过程中弹窗被缩到 1.0。
   ═══════════════════════════════════════════════ */

.ik-overlay-enter-from .ik-dialog {
  /* FractionalTranslation(0.05, 0)：CSS translateX(5%) 也是元素自身宽度的 5%，等价 */
  transform: scale(1.1) translateX(5%);
}

.ik-overlay-leave-to .ik-dialog {
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

</style>
