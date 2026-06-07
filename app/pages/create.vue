<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import { useMessage } from "zenless-ui";
import type {
  Category,
  DraftArticle,
  UploadedFile,
  UploadTask,
  UploadStatus,
} from "~/types/entities";
import type { Pagination } from "~/types/api";
import {
  ArrowUpTrayIcon,
  PhotoIcon,
  XMarkIcon,
  Cog6ToothIcon,
  TrashIcon,
  ChevronRightIcon,
  RectangleStackIcon,
  EyeSlashIcon,
} from "@heroicons/vue/24/outline";
import { resolveErrorMessage } from "~/utils/api-error";

const MAX_COVER_IMAGES = 9;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const AUTO_SAVE_DELAY = 800;

const api = useApi();
const auth = useAuthStore();
const router = useRouter();
const loginDialog = useLoginDialog();
const confirmDialog = useConfirmDialog();
const message = useMessage();
const pendingPost = usePendingPost();

useSeoMeta({
  title: "发帖 - 绳网",
  robots: "noindex, nofollow",
});

if (import.meta.client && !auth.isLogin) {
  loginDialog.open();
  router.replace("/");
}

/* ── Reactive State ───────────────────────────────── */
const title = ref("");
const body = ref("");
const uploadTasks = ref<UploadTask[]>([]);
const documentId = ref<string | null>(null);
const isSavingDraft = ref(false);
const isPublishing = ref(false);
const isDeletingDraft = ref(false);
const hasUnsavedChanges = ref(false);
const isAnonymous = ref(false);
const showImagePickerModal = ref(false);

/* ── 帖子分类（频道）：发帖必选，默认兜底「综合」 ── */
const DEFAULT_CATEGORY_SLUG = "general";
const categories = ref<Category[]>([]);
const selectedCategory = ref<string>(DEFAULT_CATEGORY_SLUG);

/* ── Mobile-only UI state ─────────────────────────── */
const isMobileDraftsOpen = ref(false);
const isMobileSettingsOpen = ref(false);

const suppressTracking = ref(false);
const lastSavedSnapshot = ref("");

// Draft list
const drafts = ref<DraftArticle[]>([]);
const draftsCursor = ref("");
const draftsHasNext = ref(true);
const draftsLoading = ref(false);
const draftsInitialized = ref(false);

/* ── Computed ─────────────────────────────────────── */
const uploadedImages = computed(() =>
  uploadTasks.value
    .filter((t) => t.status === "done" && t.serverId && t.serverUrl)
    .map((t) => ({ id: t.serverId!, url: t.serverUrl! })),
);

const isCoverUploading = computed(() =>
  uploadTasks.value.some(
    (t) => t.status === "uploading" || t.status === "pending",
  ),
);

const remainingCoverSlots = computed(() =>
  Math.max(0, MAX_COVER_IMAGES - uploadTasks.value.length),
);

const existingUploadIds = computed(() =>
  uploadTasks.value
    .map((task) => task.serverId)
    .filter((id): id is string => typeof id === "string" && id.length > 0),
);

const hasAnyContent = computed(
  () =>
    title.value.trim().length > 0 ||
    body.value.trim().length > 0 ||
    uploadedImages.value.length > 0,
);

const canPublish = computed(
  () =>
    !isSavingDraft.value &&
    !isPublishing.value &&
    !isDeletingDraft.value &&
    !isCoverUploading.value &&
    title.value.trim().length > 0 &&
    (body.value.trim().length > 0 || uploadedImages.value.length > 0),
);

const coverPayload = computed(() => {
  const imgs = uploadedImages.value;
  if (imgs.length === 0) return [];
  if (imgs.length === 1) return imgs[0]!.id;
  return imgs.map((i) => i.id);
});

/* ── Helpers ──────────────────────────────────────── */
function buildSnapshot(): string {
  return JSON.stringify({
    title: title.value.trim(),
    text: body.value.trim(),
    cover: coverPayload.value,
    category: selectedCategory.value,
  });
}

function syncSnapshot() {
  lastSavedSnapshot.value = buildSnapshot();
  hasUnsavedChanges.value = false;
}

function isAllowedImage(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ALLOWED_EXTENSIONS.has(ext);
}

// 封面缩略图 URL：本地 blob/data 预览不动，远程 URL 拼接七牛云的 -small.webp。
// 避免在草稿网格里加载原图（30MB+ 大图会浪费带宽和解码时间）。
function toCoverThumbUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `${url}-small.webp`;
}

/* ── Auto-save ────────────────────────────────────── */
const performSaveDraft = async (force = false) => {
  if (!auth.isLogin) return;
  if (isSavingDraft.value && !force) return;
  if (!documentId.value && !hasAnyContent.value) return;

  const snapshot = buildSnapshot();
  if (!force && snapshot === lastSavedSnapshot.value) return;

  isSavingDraft.value = true;

  try {
    const authorId = auth.user?.authorId || auth.user?.documentId;
    const payload = {
      title: title.value.trim(),
      text: body.value.trim(),
      coverId: coverPayload.value,
      authorId: authorId || undefined,
      isAnonymous: isAnonymous.value || undefined,
      category: selectedCategory.value || DEFAULT_CATEGORY_SLUG,
    };

    let result: DraftArticle;
    const isCreate = !documentId.value;
    if (isCreate) {
      result = await api.createArticleDraft(payload);
    } else {
      result = await api.updateArticleDraft(documentId.value!, payload);
    }

    if (result.documentId) {
      documentId.value = result.documentId;
    }

    // 同步左侧草稿列表
    if (result.documentId) {
      const idx = drafts.value.findIndex(
        (d) => d.documentId === result.documentId,
      );
      if (idx === -1) {
        drafts.value.unshift(result);
      } else {
        drafts.value[idx] = { ...drafts.value[idx], ...result };
      }
    }

    syncSnapshot();
  } catch (err) {
    hasUnsavedChanges.value = true;
    if (force) throw err;
    message.error(resolveErrorMessage(err, "草稿保存失败"));
  } finally {
    isSavingDraft.value = false;
  }
};

const debouncedSave = useDebounceFn(() => {
  performSaveDraft().catch(() => undefined);
}, AUTO_SAVE_DELAY);

function markDirty() {
  if (suppressTracking.value) return;
  hasUnsavedChanges.value = true;
  debouncedSave();
}

/* ── Image Upload ─────────────────────────────────── */
function createUploadTask(file: File): UploadTask {
  return {
    localId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    filename: file.name,
    file,
    status: "pending" as UploadStatus,
    progress: 0,
    previewUrl: URL.createObjectURL(file),
  };
}

function createReferencedUploadTask(upload: UploadedFile): UploadTask {
  const filename = upload.name || upload.url.split("/").pop() || "image";
  return {
    localId: `referenced_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    filename,
    file: new File([], filename),
    status: "done" as UploadStatus,
    progress: 100,
    previewUrl: upload.url,
    serverId: upload.documentId,
    serverUrl: upload.url,
  };
}

function openImagePicker() {
  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }
  if (remainingCoverSlots.value <= 0) {
    message.error(`最多上传 ${MAX_COVER_IMAGES} 张图片`);
    return;
  }
  showImagePickerModal.value = true;
}

function handleImagePickerUpload(files: File[]) {
  handleFileSelect(files);
}

function handleImagePickerSelect(uploads: UploadedFile[]) {
  const existing = new Set(existingUploadIds.value);
  const remaining = remainingCoverSlots.value;
  const available = uploads
    .filter((upload) => upload.documentId && upload.url && !existing.has(upload.documentId))
    .slice(0, remaining);

  if (!available.length) {
    message.warning("没有可添加的图片");
    return;
  }

  for (const upload of available) {
    uploadTasks.value.push(createReferencedUploadTask(upload));
  }
  markDirty();
}

async function executeUploadTask(task: UploadTask) {
  try {
    task.status = "uploading";
    task.progress = 0;

    const uploaded = await api.uploadImage(task.file, (percent) => {
      task.progress = percent;
    });

    task.serverId = uploaded.documentId;
    task.serverUrl = uploaded.url;
    task.status = "done";
    task.progress = 100;
    markDirty();
  } catch (err) {
    task.status = "error";
    task.error = resolveErrorMessage(err, "上传失败");
  }
}

function handleFileSelect(files: FileList | File[]) {
  const fileArray = Array.from(files);
  const remaining = MAX_COVER_IMAGES - uploadTasks.value.length;

  if (remaining <= 0) {
    message.error(`最多上传 ${MAX_COVER_IMAGES} 张图片`);
    return;
  }

  const valid = fileArray.filter((f) => {
    if (!isAllowedImage(f.name)) {
      message.error("仅支持 JPG、PNG、GIF、WEBP 格式");
      return false;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      message.error(`图片 ${f.name} 超过 30MB`);
      return false;
    }
    return true;
  });

  const toUpload = valid.slice(0, remaining);
  for (const file of toUpload) {
    const task = createUploadTask(file);
    uploadTasks.value.push(task);
    // ⚠️ push 进 reactive 数组后，task 的原始引用不再受 Proxy 拦截，
    // 必须取出代理后的元素，否则上传过程中 progress/status 的更新无法触发渲染。
    const reactiveTask = uploadTasks.value[uploadTasks.value.length - 1]!;
    executeUploadTask(reactiveTask);
  }
}

function retryUpload(task: UploadTask) {
  if (task.status !== "error") return;
  task.status = "pending";
  task.error = undefined;
  task.progress = 0;
  executeUploadTask(task);
}

function removeUpload(index: number) {
  const task = uploadTasks.value[index];
  if (task) {
    URL.revokeObjectURL(task.previewUrl);
    uploadTasks.value.splice(index, 1);
    markDirty();
  }
}

function onCoverFileInput(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files) {
    handleFileSelect(input.files);
    input.value = "";
  }
}

/* ── Publish ──────────────────────────────────────── */
async function publish() {
  if (!canPublish.value) return;

  if (!auth.isLogin) {
    loginDialog.open();
    return;
  }

  if (title.value.trim().length === 0) {
    message.error("标题不能为空");
    return;
  }

  isPublishing.value = true;

  try {
    await performSaveDraft(true);

    if (!documentId.value) {
      throw new Error("草稿保存后仍缺少 documentId");
    }

    await api.publishArticleDraft(documentId.value);

    // 乐观插入：fire-and-forget 拉取刚发布的帖子详情塞进 pending 队列，
    // 不阻塞跳转——usePendingPost 是响应式 ref，首页 watch 队列即可消费
    // 迟到的 push（可能晚于 onMounted 才到达）。拉取失败时首页正常列表加载兜底。
    const draftId = documentId.value;
    api.getPost(draftId).then(
      (post) => pendingPost.push(post),
      () => undefined,
    );

    router.replace("/");
  } catch (err) {
    message.error(resolveErrorMessage(err, "发布失败"));
  } finally {
    isPublishing.value = false;
  }
}

/* ── Delete Draft ─────────────────────────────────── */
async function deleteDraft() {
  if (!documentId.value) return;
  const ok = await confirmDialog.open({ title: "删除草稿", message: "确定要删除这个草稿吗？此操作不可恢复。", confirmText: "删除", danger: true });
  if (!ok) return;

  isDeletingDraft.value = true;

  try {
    await api.deleteArticle(documentId.value);
    resetEditor();
    await refreshDrafts();
  } catch (err) {
    message.error(resolveErrorMessage(err, "删除草稿失败"));
  } finally {
    isDeletingDraft.value = false;
  }
}

/* ── Draft List Helpers ───────────────────────────── */
function isDraftActive(draft: DraftArticle): boolean {
  return !!documentId.value && draft.documentId === documentId.value;
}

function draftPreviewText(draft: DraftArticle): string {
  const txt = (draft.text || "").trim();
  return txt ? txt.slice(0, 40) : "无内容";
}

const editorWordCount = computed(() => body.value.length);
const editorTitleCount = computed(() => title.value.length);

const EDITING_KEY = "__editing__";
const activeMenuKey = computed<string>(
  () => documentId.value || EDITING_KEY,
);

/* ── Mobile sheet handlers ────────────────────────── */
function openMobileCoverPicker() {
  openImagePicker();
}

function onMobileNewDraft() {
  isMobileDraftsOpen.value = false;
  if (documentId.value) newDraft();
}

function onMobileSelectDraft(draft: DraftArticle) {
  isMobileDraftsOpen.value = false;
  if (draft.documentId === documentId.value) return;
  onMenuChange(draft.documentId);
}

async function onMobileDeleteDraft() {
  isMobileSettingsOpen.value = false;
  await deleteDraft();
}

function onMenuChange(name: string | number) {
  const key = String(name);
  if (key === EDITING_KEY) {
    if (documentId.value) newDraft();
    return;
  }
  const draft = drafts.value.find((d) => d.documentId === key);
  if (draft && draft.documentId !== documentId.value) {
    openDraft(draft);
  }
}

/* ── Draft List ───────────────────────────────────── */
async function loadMoreDrafts() {
  if (!auth.isLogin || draftsLoading.value || !draftsHasNext.value) return;

  draftsLoading.value = true;
  try {
    const page: Pagination<DraftArticle> = await api.getMyDrafts(
      draftsCursor.value,
    );
    drafts.value.push(...page.nodes);
    draftsCursor.value = page.endCursor;
    draftsHasNext.value = page.hasNextPage;
  } catch (err) {
    message.error(resolveErrorMessage(err, "加载草稿失败"));
  } finally {
    draftsLoading.value = false;
  }
}

async function refreshDrafts() {
  drafts.value = [];
  draftsCursor.value = "";
  draftsHasNext.value = true;
  draftsInitialized.value = true;
  await loadMoreDrafts();
}

async function ensureDraftsLoaded() {
  if (draftsInitialized.value || draftsLoading.value) return;
  await refreshDrafts();
}

async function openDraft(draft: DraftArticle) {
  if (draft.documentId === documentId.value) {
    return;
  }

  if (hasUnsavedChanges.value && (documentId.value || hasAnyContent.value)) {
    try {
      await performSaveDraft(true);
    } catch {
      /* best effort */
    }
  }

  try {
    const detail = await api.getMyDraftDetail(draft.documentId);
    applyDraftToEditor(detail);
  } catch (err) {
    message.error(resolveErrorMessage(err, "加载草稿详情失败"));
  }
}

/* ── Editor State Management ──────────────────────── */
function applyDraftToEditor(draft: DraftArticle) {
  suppressTracking.value = true;
  try {
    documentId.value = draft.documentId;
    title.value = draft.title;
    body.value = draft.text;
    isAnonymous.value = !!draft.isAnonymous;
    selectedCategory.value = draft.category?.slug || DEFAULT_CATEGORY_SLUG;

    for (const task of uploadTasks.value) {
      URL.revokeObjectURL(task.previewUrl);
    }
    uploadTasks.value = [];

    if (draft.cover) {
      for (const cover of draft.cover) {
        uploadTasks.value.push({
          localId: `restored_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          filename: cover.url.split("/").pop() || "image",
          file: new File([], "placeholder"),
          status: "done",
          progress: 100,
          previewUrl: cover.url,
          serverId: cover.documentId || "",
          serverUrl: cover.url,
        });
      }
    }

    syncSnapshot();
  } finally {
    suppressTracking.value = false;
  }
}

function resetEditor() {
  suppressTracking.value = true;
  try {
    documentId.value = null;
    title.value = "";
    body.value = "";
    for (const task of uploadTasks.value) {
      URL.revokeObjectURL(task.previewUrl);
    }
    uploadTasks.value = [];
    isAnonymous.value = false;
    selectedCategory.value = DEFAULT_CATEGORY_SLUG;
    lastSavedSnapshot.value = "";
    hasUnsavedChanges.value = false;
  } finally {
    suppressTracking.value = false;
  }
}

async function newDraft() {
  if (hasUnsavedChanges.value && (documentId.value || hasAnyContent.value)) {
    try {
      await performSaveDraft(true);
    } catch {
      /* best effort */
    }
  }
  resetEditor();
}

/* ── Drag & Drop ──────────────────────────────────── */
const isDragging = ref(false);
let dragCounter = 0;
// 内部缩略图排序状态
const draggingIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

function isFileDrag(e: DragEvent): boolean {
  // 区分外部文件拖入（dataTransfer.types 含 'Files'）与页面内拖拽
  const types = e.dataTransfer?.types;
  if (!types) return false;
  // types 在不同浏览器是 DOMStringList 或数组，统一为数组判断
  return Array.from(types as ArrayLike<string>).includes("Files");
}

function onDragEnter(e: DragEvent) {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragCounter++;
  isDragging.value = true;
}
function onDragOver(e: DragEvent) {
  if (!isFileDrag(e)) return;
  e.preventDefault();
}
function onDragLeave(e: DragEvent) {
  if (!isFileDrag(e)) return;
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    isDragging.value = false;
  }
}
function onDrop(e: DragEvent) {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragCounter = 0;
  isDragging.value = false;
  if (e.dataTransfer?.files?.length) {
    handleFileSelect(e.dataTransfer.files);
  }
}

/* ── Cover preview (lightGallery, done tasks only) ── */
const { openGallery: openLightGallery, preload: preloadGallery } = useLightGallery();

function openCoverPreview(index: number) {
  const task = uploadTasks.value[index];
  if (!task || task.status !== "done") return;
  // 仅收集已上传完成的图，保持当前显示顺序
  const doneTasks = uploadTasks.value.filter((t) => t.status === "done");
  if (!doneTasks.length) return;
  const images = doneTasks.map((t) => ({ src: t.serverUrl || t.previewUrl }));
  const currentIndex = doneTasks.findIndex((t) => t.localId === task.localId);
  openLightGallery(images, currentIndex >= 0 ? currentIndex : 0);
}

/* ── Cover thumbnail reorder (drag inside grid) ──── */
function onThumbDragStart(e: DragEvent, index: number) {
  const task = uploadTasks.value[index];
  // 仅允许已上传完成的图片参与排序
  if (!task || task.status !== "done") {
    e.preventDefault();
    return;
  }
  draggingIndex.value = index;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    // 标记为内部拖拽载荷（与外部 'Files' 拖拽互斥）
    e.dataTransfer.setData("application/x-cover-index", String(index));
  }
}

function onThumbDragOver(e: DragEvent, index: number) {
  if (draggingIndex.value === null) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  if (dragOverIndex.value !== index) dragOverIndex.value = index;
}

function onThumbDrop(e: DragEvent, index: number) {
  if (draggingIndex.value === null) return;
  e.preventDefault();
  e.stopPropagation();
  const from = draggingIndex.value;
  const to = index;
  draggingIndex.value = null;
  dragOverIndex.value = null;
  if (from === to) return;
  const target = uploadTasks.value[to];
  // 排序的目标位置必须也是已上传完成的图片，避免穿插到上传中/失败的项
  if (!target || target.status !== "done") return;
  const arr = uploadTasks.value;
  const [moved] = arr.splice(from, 1);
  if (moved) arr.splice(to, 0, moved);
  markDirty();
}

function onThumbDragEnd() {
  draggingIndex.value = null;
  dragOverIndex.value = null;
}

/* ── Lifecycle ────────────────────────────────────── */
onBeforeUnmount(() => {
  if (hasUnsavedChanges.value && (documentId.value || hasAnyContent.value)) {
    performSaveDraft(true).catch(() => undefined);
  }
  for (const task of uploadTasks.value) {
    URL.revokeObjectURL(task.previewUrl);
  }
});

watch(title, () => markDirty());
watch(body, () => markDirty());

function selectCategory(slug: string) {
  if (!slug || slug === selectedCategory.value) return;
  selectedCategory.value = slug;
  markDirty();
}

async function loadCategories() {
  try {
    const list = await api.getCategories();
    if (list.length) {
      categories.value = list;
      // 默认选中无效（如默认分类被下架）时回落到列表首项，保证发帖必选。
      if (!list.some((c) => c.slug === selectedCategory.value)) {
        selectedCategory.value = list[0]!.slug;
      }
    }
  } catch {
    // 拉取失败不阻塞发帖：仍以默认分类兜底（后端同样会兜底「综合」）。
  }
}

if (import.meta.client && auth.isLogin) {
  ensureDraftsLoaded();
}
if (import.meta.client) {
  loadCategories();
}
</script>

<template>
  <section class="ik-create-page" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <!-- 45° 斜线纹理背景 -->
    <div class="ik-create-page__stripe" aria-hidden="true"></div>

    <!-- Drag overlay -->
    <Transition name="ik-fade">
      <div v-if="isDragging" class="ik-create-drop-overlay">
        <div class="ik-create-drop-overlay__inner">
          <ArrowUpTrayIcon style="width:48px;height:48px;color:#BFFF09" />
          <span class="ik-create-drop-overlay__text">释放以上传图片</span>
        </div>
      </div>
    </Transition>

    <!-- ── Two-Column Body ─────────────────────── -->
    <div class="ik-create-columns">
      <!-- ── Left: Editing Slot + Drafts (ZMenu) ── -->
      <aside class="ik-create-nav-wrap">
        <z-menu
          class="ik-create-menu"
          :model-value="activeMenuKey"
          @change="onMenuChange"
        >
          <!-- Slot #1: Editing -->
          <z-menu-item :name="EDITING_KEY">
            <div class="ik-nav-item__content">
              <span class="ik-nav-item__title">
                <span class="ik-nav-item__editing-arrow">▶</span>
                {{ documentId ? "编辑新委托" : (title.trim() || "编辑委托") }}
              </span>
              <span v-if="documentId" class="ik-nav-item__meta">点击开始编辑新委托</span>
            </div>
          </z-menu-item>

          <!-- Drafts -->
          <z-menu-item
            v-for="draft in drafts"
            :key="draft.documentId"
            :name="draft.documentId"
          >
            <div class="ik-nav-item__content">
              <span class="ik-nav-item__title">{{ draft.title || "无标题" }}</span>
              <span class="ik-nav-item__meta">{{ draftPreviewText(draft) }}</span>
            </div>
          </z-menu-item>
        </z-menu>

        <!-- Loading / Empty / Load more -->
        <div v-if="!auth.isLogin" class="ik-nav-empty">请先登录</div>
        <div v-else-if="draftsLoading && !drafts.length" class="ik-nav-empty">
          <span class="ik-status ik-status--saving">
            <span class="ik-status__dot"></span>加载中
          </span>
        </div>
        <button
          v-if="auth.isLogin && draftsHasNext && drafts.length"
          class="ik-nav-loadmore"
          :disabled="draftsLoading"
          @click="loadMoreDrafts"
        >
          {{ draftsLoading ? "加载中..." : "加载更多" }}
        </button>
      </aside>

      <!-- ── Right: Form Panel ───────────────── -->
      <main class="ik-create-panel">
        <div class="ik-create-panel__body">
          <!-- Title field — flat TextField with bottom divider (Flutter desktop style) -->
          <div class="ik-create-section ik-create-section--title">
            <ZTextarea
              v-model="title"
              class="ik-create-title-input"
              placeholder="请输入标题"
              rows="1"
              maxlength="200"
            />
            <span class="ik-create-section__count">{{ editorTitleCount }}/200</span>
          </div>

          <!-- Category section（发帖必选频道） -->
          <div v-if="categories.length" class="ik-create-section">
            <div class="ik-create-section__head">
              <span class="ik-create-section__label">分类</span>
              <span class="ik-create-section__hint">选择帖子所属频道</span>
            </div>
            <div class="ik-create-category-chips">
              <button
                v-for="cat in categories"
                :key="cat.slug"
                type="button"
                class="ik-create-category-chip"
                :class="{ 'ik-create-category-chip--active': selectedCategory === cat.slug }"
                @click="selectCategory(cat.slug)"
              >
                {{ cat.name }}
              </button>
            </div>
          </div>

          <!-- Body section -->
          <div class="ik-create-section">
            <div class="ik-create-section__head">
              <span class="ik-create-section__label">正文</span>
              <span class="ik-create-section__hint">若仅上传图片，正文可留空</span>
            </div>
            <div class="ik-create-editor-frame">
              <ZTextarea
                v-model="body"
                class="ik-create-editor__body"
                placeholder="请尽情发挥吧..."
              />
            </div>
          </div>

          <!-- Covers section (grid layout) -->
          <div class="ik-create-section">
            <div class="ik-create-section__head">
              <span class="ik-create-section__label">
                <PhotoIcon style="width:14px;height:14px" />
                图片
                <span class="ik-create-section__count-pill">{{ uploadTasks.length }}/{{ MAX_COVER_IMAGES }}</span>
              </span>
              <span class="ik-create-section__hint">第一张图片为封面</span>
            </div>
            <div class="ik-cover-grid">
              <div
                v-for="(task, idx) in uploadTasks"
                :key="task.localId"
                class="ik-cover-thumb"
                :class="{
                  'ik-cover-thumb--dragging': draggingIndex === idx,
                  'ik-cover-thumb--drag-over': dragOverIndex === idx && draggingIndex !== null && draggingIndex !== idx,
                  'ik-cover-thumb--reorderable': task.status === 'done',
                }"
                :draggable="task.status === 'done'"
                @dragstart="onThumbDragStart($event, idx)"
                @dragover="onThumbDragOver($event, idx)"
                @drop="onThumbDrop($event, idx)"
                @dragend="onThumbDragEnd"
                @mouseenter="task.status === 'done' && preloadGallery()"
                @click="openCoverPreview(idx)"
              >
                <img
                  :src="toCoverThumbUrl(task.previewUrl)"
                  :alt="task.filename"
                  class="ik-cover-thumb__img"
                  decoding="async"
                  draggable="false"
                  @error="($event.target as HTMLImageElement).src = task.previewUrl"
                />
                <div v-if="task.status === 'uploading'" class="ik-cover-thumb__overlay">
                  <span class="ik-cover-thumb__pct">{{ task.progress }}%</span>
                  <div class="ik-cover-thumb__bar">
                    <div class="ik-cover-thumb__progress" :style="{ width: task.progress + '%' }"></div>
                  </div>
                </div>
                <div
                  v-else-if="task.status === 'pending'"
                  class="ik-cover-thumb__overlay"
                >
                  <span class="ik-cover-thumb__spinner" aria-hidden="true"></span>
                </div>
                <div
                  v-else-if="task.status === 'error'"
                  class="ik-cover-thumb__overlay ik-cover-thumb__overlay--error"
                  @click.stop="retryUpload(task)"
                >
                  <span class="ik-cover-thumb__error-label">上传失败</span>
                  <span class="ik-cover-thumb__retry">重试</span>
                </div>
                <span v-if="idx === 0" class="ik-cover-thumb__primary">封面</span>
                <button class="ik-cover-thumb__remove" @click.stop.prevent="removeUpload(idx)" aria-label="移除">
                  <XMarkIcon style="width:14px;height:14px" />
                </button>
              </div>
              <CoverImageAddButton
                v-if="uploadTasks.length < MAX_COVER_IMAGES"
                :is-dragging="isDragging"
                @click="openImagePicker"
              />
            </div>
          </div>

        </div>
      </main>
    </div>

    <!-- ── Bottom Footer (desktop) ─────────────── -->
    <footer class="ik-create-footer">
      <div class="ik-create-footer__inner">
        <div class="ik-create-footer__left"></div>
        <div class="ik-create-footer__right">
          <label class="ik-create-anon-toggle" :title="isAnonymous ? '取消匿名发布' : '匿名发布'">
            <span>匿名</span>
            <z-switch v-model="isAnonymous" @change="markDirty()" />
          </label>
          <z-button
            v-if="documentId"
            class="ik-create-delete"
            :loading="isDeletingDraft"
            :disabled="isDeletingDraft"
            @click="deleteDraft"
          >
            删除草稿
          </z-button>
          <z-button
            class="ik-create-publish"
            :type="canPublish ? undefined : 'primary'"
            :loading="isPublishing"
            :disabled="!canPublish"
            @click="publish"
          >
            {{ isPublishing ? "发布中..." : "发布委托" }}
          </z-button>
        </div>
      </div>
    </footer>

    <!-- ═══════════════════════════════════════════
         Mobile (≤768px) — Flutter-style Editor
         本区块默认隐藏，由 CSS @media 切换显示
         ═══════════════════════════════════════════ -->
    <div class="ik-create-mobile" aria-hidden="true">
      <!-- Hidden file input for "封面" setting row -->
      <input
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        hidden
        @change="onCoverFileInput"
      />

      <!-- Cover strip (horizontal scroll) -->
      <div class="ik-mobile-cover-strip">
        <button
          v-if="uploadTasks.length < MAX_COVER_IMAGES"
          type="button"
          class="ik-mobile-cover-add"
          aria-label="添加图片"
          @click="openImagePicker"
        >
          <PhotoIcon class="ik-mobile-cover-add__icon" />
        </button>
        <div
          v-for="(task, idx) in uploadTasks"
          :key="task.localId"
          class="ik-mobile-cover-tile"
          @click="task.status === 'done' && openCoverPreview(idx)"
        >
          <img
            :src="toCoverThumbUrl(task.previewUrl)"
            :alt="task.filename"
            class="ik-mobile-cover-tile__img"
            decoding="async"
            draggable="false"
            @error="($event.target as HTMLImageElement).src = task.previewUrl"
          />
          <div
            v-if="task.status === 'uploading'"
            class="ik-mobile-cover-tile__overlay"
          >
            <span class="ik-mobile-cover-tile__pct">{{ task.progress }}%</span>
          </div>
          <div
            v-else-if="task.status === 'pending'"
            class="ik-mobile-cover-tile__overlay"
          >
            <span class="ik-mobile-cover-tile__spinner" aria-hidden="true"></span>
          </div>
          <div
            v-else-if="task.status === 'error'"
            class="ik-mobile-cover-tile__overlay"
          >
            <button
              type="button"
              class="ik-mobile-cover-tile__retry"
              @click.stop="retryUpload(task)"
            >
              重试
            </button>
          </div>
          <span v-if="idx === 0" class="ik-mobile-cover-tile__primary">封面</span>
          <button
            type="button"
            class="ik-mobile-cover-tile__remove"
            aria-label="移除"
            @click.stop.prevent="removeUpload(idx)"
          >
            <XMarkIcon style="width:12px;height:12px" />
          </button>
        </div>
      </div>

      <!-- Title (flat) -->
      <input
        v-model="title"
        class="ik-mobile-title-input"
        type="text"
        placeholder="请输入标题"
        maxlength="200"
      />

      <div class="ik-mobile-divider"></div>

      <!-- Body (flat textarea) -->
      <textarea
        v-model="body"
        class="ik-mobile-body-input"
        placeholder="请尽情发挥吧"
        rows="6"
      ></textarea>

      <div class="ik-mobile-divider"></div>

      <!-- Setting rows -->
      <button type="button" class="ik-mobile-row" @click="openMobileCoverPicker">
        <PhotoIcon class="ik-mobile-row__icon" />
        <span class="ik-mobile-row__title">封面</span>
        <span class="ik-mobile-row__value">{{ uploadTasks.length }}/{{ MAX_COVER_IMAGES }}</span>
        <ChevronRightIcon class="ik-mobile-row__chevron" />
      </button>

      <div class="ik-mobile-divider"></div>

      <button
        type="button"
        class="ik-mobile-row"
        :disabled="!documentId"
        @click="isMobileSettingsOpen = true"
      >
        <Cog6ToothIcon class="ik-mobile-row__icon" />
        <span class="ik-mobile-row__title">帖子设置</span>
        <ChevronRightIcon class="ik-mobile-row__chevron" />
      </button>
    </div>

    <!-- ── Mobile bottom nav (drafts + publish) ── -->
    <div class="ik-mobile-footer" aria-hidden="true">
      <button
        v-if="auth.isLogin"
        type="button"
        class="ik-mobile-footer__drafts"
        aria-label="打开草稿箱"
        @click="isMobileDraftsOpen = true"
      >
        <RectangleStackIcon class="ik-mobile-footer__drafts-icon" />
        <span v-if="drafts.length" class="ik-mobile-footer__drafts-count">
          {{ drafts.length }}
        </span>
      </button>
      <label
        class="ik-mobile-footer__anon"
        :aria-label="isAnonymous ? '取消匿名' : '匿名发布'"
      >
        <z-switch v-model="isAnonymous" @change="markDirty()" />
      </label>
      <button
        type="button"
        class="ik-mobile-footer__publish"
        :class="{ 'is-disabled': !canPublish }"
        :disabled="!canPublish"
        @click="publish"
      >
        <span v-if="isPublishing" class="ik-mobile-footer__spinner" aria-hidden="true"></span>
        {{ isPublishing ? "发布中..." : isSavingDraft ? "正在保存" : "发布" }}
      </button>
    </div>

    <!-- ── Mobile Drafts Sheet (slide up from bottom, near full height) ── -->
    <Teleport to="body">
      <Transition name="ik-mobile-sheet">
        <div
          v-if="isMobileDraftsOpen"
          class="ik-mobile-sheet ik-mobile-sheet--full"
          role="dialog"
          aria-modal="true"
          @click.self="isMobileDraftsOpen = false"
        >
          <div class="ik-mobile-sheet__panel ik-mobile-sheet__panel--full">
            <div class="ik-mobile-sheet__handle"></div>
            <header class="ik-mobile-sheet__header">
              <span class="ik-mobile-sheet__title">草稿箱</span>
              <button
                type="button"
                class="ik-mobile-sheet__close"
                aria-label="关闭"
                @click="isMobileDraftsOpen = false"
              >
                <XMarkIcon style="width:20px;height:20px" />
              </button>
            </header>
            <div class="ik-mobile-sheet__body">
              <button
                type="button"
                class="ik-mobile-draft-row ik-mobile-draft-row--new"
                :class="{ 'is-active': !documentId }"
                @click="onMobileNewDraft"
              >
                <span class="ik-mobile-draft-row__title">编辑新委托</span>
                <span class="ik-mobile-draft-row__meta">
                  {{ documentId ? "点击开始编辑新委托" : "当前正在编辑" }}
                </span>
              </button>
              <button
                v-for="draft in drafts"
                :key="draft.documentId"
                type="button"
                class="ik-mobile-draft-row"
                :class="{ 'is-active': draft.documentId === documentId }"
                @click="onMobileSelectDraft(draft)"
              >
                <span class="ik-mobile-draft-row__title">
                  {{ draft.title || "无标题" }}
                </span>
                <span class="ik-mobile-draft-row__meta">
                  {{ draftPreviewText(draft) }}
                </span>
              </button>
              <div v-if="!auth.isLogin" class="ik-mobile-draft-empty">
                请先登录
              </div>
              <div v-else-if="draftsLoading && !drafts.length" class="ik-mobile-draft-empty">
                加载中...
              </div>
              <button
                v-if="auth.isLogin && draftsHasNext && drafts.length"
                type="button"
                class="ik-mobile-draft-loadmore"
                :disabled="draftsLoading"
                @click="loadMoreDrafts"
              >
                {{ draftsLoading ? "加载中..." : "加载更多" }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ── Mobile Post Settings Sheet (bottom, short) ── -->
    <Teleport to="body">
      <Transition name="ik-mobile-sheet">
        <div
          v-if="isMobileSettingsOpen"
          class="ik-mobile-sheet"
          role="dialog"
          aria-modal="true"
          @click.self="isMobileSettingsOpen = false"
        >
          <div class="ik-mobile-sheet__panel">
            <div class="ik-mobile-sheet__handle"></div>
            <span class="ik-mobile-sheet__title">帖子设置</span>
            <div class="ik-mobile-sheet__body ik-mobile-sheet__body--compact">
              <button
                v-if="documentId"
                type="button"
                class="ik-mobile-settings-row ik-mobile-settings-row--danger"
                :disabled="isDeletingDraft"
                @click="onMobileDeleteDraft"
              >
                <TrashIcon class="ik-mobile-settings-row__icon" />
                <span class="ik-mobile-settings-row__title">删除草稿</span>
                <ChevronRightIcon class="ik-mobile-settings-row__chevron" />
              </button>
              <div v-else class="ik-mobile-draft-empty">该委托尚未保存为草稿</div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <ClientOnly>
      <Teleport to="body">
        <Transition name="ik-overlay" appear>
          <PostImagePickerModal
            v-if="showImagePickerModal"
            :existing-ids="existingUploadIds"
            :remaining="remainingCoverSlots"
            @close="showImagePickerModal = false"
            @upload="handleImagePickerUpload"
            @select="handleImagePickerSelect"
          />
        </Transition>
      </Teleport>
    </ClientOnly>
  </section>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Create Post Page – ZZZ "发布委托" Layout
   ═══════════════════════════════════════════════ */
.ik-create-page {
  position: relative;
  width: min(1440px, calc(100% - 40px));
  margin: 0 auto;
  padding: 20px 0 100px;
  min-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 45° 斜线纹理（与帖子弹窗一致） */
.ik-create-page__stripe {
  position: fixed;
  inset: 0;
  z-index: 0;
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

.ik-create-page > .ik-create-columns {
  position: relative;
  z-index: 1;
}

.ik-create-footer {
  z-index: 50;
}

/* ── Drag & Drop Overlay ─────────────────────────── */
.ik-create-drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  pointer-events: none;
}

.ik-create-drop-overlay__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px 64px;
  border: 2px dashed #BFFF09;
  border-radius: 24px;
  background: rgba(215, 255, 0, 0.04);
}

.ik-create-drop-overlay__text {
  font-size: 18px;
  font-weight: 700;
  color: #BFFF09;
  letter-spacing: 0.5px;
}

/* ── Transition helpers ──────────────────────────── */
.ik-fade-enter-active,
.ik-fade-leave-active { transition: opacity 200ms ease; }
.ik-fade-enter-from,
.ik-fade-leave-to { opacity: 0; }

/* ── Two-Column Layout ───────────────────────────── */
.ik-create-columns {
  flex: 1;
  display: grid;
  grid-template-columns: 230px 1fr;
  gap: 16px;
  min-height: 0;
  align-items: stretch;
}

/* ═════════ Left Nav: Editing + Drafts (ZMenu) ═════════ */
.ik-create-nav-wrap {
  position: sticky;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: calc(100vh - 100px);
}

.ik-create-menu {
  flex: 1;
  min-height: 320px !important;
  max-height: 100%;
}

/* Customize ZMenu items: stack title + meta vertically */
.ik-create-menu :deep(.z-menu__item) {
  align-items: stretch;
  min-height: 56px;
  padding: 10px 16px;
}

.ik-create-menu :deep(.z-menu__item) > * {
  width: 100%;
}

.ik-nav-item__content {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  width: 100%;
}

.ik-nav-item__title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.2px;
}

.ik-nav-item__meta {
  font-size: 11px;
  font-weight: 700;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}

.ik-create-menu :deep(.z-menu__item.is-active) .ik-nav-item__meta {
  color: rgba(0, 0, 0, 0.6);
  opacity: 1;
}

.ik-nav-item__editing-arrow {
  font-size: 10px;
  color: #BFFF09;
}

.ik-create-menu :deep(.z-menu__item.is-active) .ik-nav-item__editing-arrow {
  color: #0a0a0a;
}

.ik-nav-loadmore {
  flex-shrink: 0;
  padding: 8px 10px;
  border: 1px dashed #2a2a2a;
  border-radius: 8px;
  background: transparent;
  color: #888;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 200ms, color 200ms;
}

.ik-nav-loadmore:hover:not(:disabled) {
  border-color: #BFFF09;
  color: #BFFF09;
}

.ik-nav-loadmore:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ik-nav-empty {
  flex-shrink: 0;
  text-align: center;
  color: #555;
  font-size: 12px;
  padding: 12px 0;
}

/* ═════════ Right Panel (mirrors PostOverlay border) ═════════ */
.ik-create-panel {
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: #2D2C2D;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
  min-height: 480px;
}

.ik-create-panel__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px 26px 28px;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #0a0a0a 0%, #070707 100%);
  border: 4px solid #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
}

/* ── Delete draft button (in footer) ─────────────────── */
.ik-create-delete {
  min-width: 140px;
  font-size: 16px;
  font-weight: 900;
  --z-button-color: #ff4444;
}

.ik-create-delete :deep(.z-button__inner),
.ik-create-delete :deep(button) {
  padding: 14px 32px;
  font-size: 16px;
  letter-spacing: 1px;
}

/* ── Publish button (in footer) ──────────────────── */
.ik-create-publish {
  min-width: 140px;
  font-size: 16px;
  font-weight: 900;
}

.ik-create-publish :deep(.z-button__inner),
.ik-create-publish :deep(button) {
  padding: 14px 32px;
  font-size: 16px;
  letter-spacing: 1px;
}

/* ── Section (flat, divider-based) ─────────────── */
.ik-create-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ik-create-section--title {
  position: relative;
  flex-direction: row;
  align-items: flex-end;
  gap: 12px;
  padding: 4px 2px 14px;
  border-bottom: 1px solid #1f1f1f;
}

.ik-create-section--title:focus-within {
  border-bottom-color: #fbfe00;
}

.ik-create-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px;
}

.ik-create-section__label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 900;
  color: #f0f0f0;
  letter-spacing: 0.4px;
}

.ik-create-section__label svg {
  color: #BFFF09;
}

.ik-create-section__hint {
  font-size: 11px;
  font-weight: 700;
  color: #777;
  letter-spacing: 0.2px;
}

.ik-create-category-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 与 z-tag 默认标签一致：深底 #1c1c1c + #222 描边、白字、胶囊圆角 */
.ik-create-category-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 16px;
  border-radius: 9999px;
  border: 2px solid #222;
  background: #222222;
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.ik-create-category-chip--active {
  color: #222;
  background: var(--ik-primary, #BFFF09);
  border-color: var(--ik-primary, #BFFF09);
  font-weight: 700;
}

.ik-create-section__count {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #888;
  font-variant-numeric: tabular-nums;
  padding-bottom: 8px;
}

.ik-create-section__count-pill {
  margin-left: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(215, 255, 0, 0.12);
  color: #BFFF09;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.3px;
  font-variant-numeric: tabular-nums;
}

/* ── Title input (large, flat) ──────────────────── */
.ik-create-title-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  overflow: visible;
}

.ik-create-title-input :deep(.z-textarea__inner) {
  padding: 6px 0;
  background: transparent;
  color: #fff;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: 0.3px;
  line-height: 1.4;
  border: none;
  resize: none;
}

.ik-create-title-input :deep(.z-textarea__inner)::placeholder {
  color: #4a4a4a;
  font-weight: 700;
  font-style: normal;
}

.ik-create-title-input :deep(.z-textarea__inner):focus {
  outline: none;
  box-shadow: none;
}

.ik-create-title-input::after {
  display: none;
}

/* ── Body editor frame (Flutter-like grey outline) ── */
.ik-create-editor-frame {
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: #050505;
  transition: border-color 220ms, box-shadow 220ms;
  overflow: hidden;
}

.ik-create-editor-frame:focus-within {
  border-color: #fbfe00;
  box-shadow: 0 0 0 1px #fbfe00;
}

/* ── Body Textarea (within editor frame) ────────── */
.ik-create-editor__body {
  width: 100%;
  min-height: 240px;
  border: none;
  border-radius: 0;
  background: transparent;
  font-size: 15px;
  line-height: 1.75;
  font-family: inherit;
  outline: none;
}

.ik-create-editor__body::after {
  border: none;
  animation: none;
}

.ik-create-editor__body :deep(.z-textarea__inner) {
  padding: 16px;
  color: #e0e0e0;
  resize: vertical;
  background: transparent;
  border: none;
}

.ik-create-editor__body :deep(.z-textarea__inner)::placeholder {
  color: #4a4a4a;
}

.ik-create-editor__body :deep(.z-textarea__inner):focus {
  box-shadow: none;
  outline: none;
}

/* ── Cover Grid (Flutter SliverGrid maxCrossAxisExtent=160) ── */
.ik-cover-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
  padding: 2px 0;
}

/* ── Cover Thumbnail ─────────────────────────────── */
.ik-cover-thumb {
  position: relative;
  aspect-ratio: 1 / 1;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  background: #1e1e1e;
  transition: border-color 200ms, background 200ms, transform 200ms;
}

.ik-cover-thumb:hover {
  border-color: #fbfe00;
  background: #1a1a0a;
  transform: translateY(-2px);
}

.ik-cover-thumb--reorderable {
  cursor: grab;
}

.ik-cover-thumb--reorderable:active {
  cursor: grabbing;
}

.ik-cover-thumb--dragging {
  opacity: 0.4;
  transform: scale(0.96);
}

.ik-cover-thumb--drag-over {
  border-color: #fbfe00;
  box-shadow: 0 0 0 2px rgba(215, 255, 0, 0.45);
  transform: translateY(-2px);
}

.ik-cover-thumb__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ik-cover-thumb__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.ik-cover-thumb__overlay--error {
  background: rgba(0, 0, 0, 0.7);
  cursor: pointer;
}

.ik-cover-thumb__error-label {
  color: #ff6b6b;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.ik-cover-thumb__retry {
  padding: 3px 12px;
  border-radius: 999px;
  background: #BFFF09;
  color: #000;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.3px;
}

.ik-cover-thumb__pct {
  font-size: 14px;
  font-weight: 900;
  color: #fff;
  letter-spacing: 0.3px;
  font-variant-numeric: tabular-nums;
}

.ik-cover-thumb__bar {
  width: 70%;
  height: 3px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
  overflow: hidden;
}

.ik-cover-thumb__progress {
  height: 100%;
  background: #BFFF09;
  border-radius: 2px;
  transition: width 200ms;
}

.ik-cover-thumb__spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2.5px solid rgba(215, 255, 0, 0.25);
  border-top-color: #BFFF09;
  animation: ik-cover-spin 800ms linear infinite;
}

@keyframes ik-cover-spin {
  to { transform: rotate(360deg); }
}

.ik-cover-thumb__primary {
  position: absolute;
  left: 6px;
  top: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #BFFF09;
  color: #000;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.3px;
  pointer-events: none;
}

.ik-cover-thumb__remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms, background 150ms;
}

.ik-cover-thumb:hover .ik-cover-thumb__remove,
.ik-cover-thumb:focus-within .ik-cover-thumb__remove {
  opacity: 1;
}

.ik-cover-thumb__remove:hover {
  background: rgba(255, 80, 80, 0.85);
}

/* ═════════ Bottom Footer (mirrors AppHeader) ═════════ */
.ik-create-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  background: #000;
}

.ik-create-footer__inner {
  width: min(1440px, calc(100% - 40px));
  margin: 0 auto;
  min-height: 78px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.ik-create-footer__left {
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
}

.ik-create-footer__right {
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}

.ik-create-footer__hint {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ik-create-footer__draft-id {
  font-size: 11px;
  font-weight: 700;
  font-style: italic;
  color: #BFFF09;
  letter-spacing: 0.5px;
}

.ik-create-footer__count {
  font-size: 12px;
  font-weight: 700;
  color: #777;
  font-variant-numeric: tabular-nums;
}

.ik-create-anon-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-right: 12px;
  color: #999;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

/* ═══════════════════════════════════════════════
   Mobile (≤768px) editor – default hidden
   ═══════════════════════════════════════════════ */
.ik-create-mobile,
.ik-mobile-footer {
  display: none;
}

/* ═══════════════════════════════════════════════
   Responsive
   ═══════════════════════════════════════════════ */
@media (max-width: 1200px) {
  .ik-create-columns {
    grid-template-columns: 200px 1fr;
  }
}

@media (max-width: 900px) {
  .ik-create-page {
    width: calc(100% - 24px);
    gap: 12px;
    padding: 16px 0 96px;
  }

  .ik-create-columns {
    grid-template-columns: 1fr;
  }

  .ik-create-nav-wrap {
    position: static;
    max-height: 280px;
  }

  .ik-create-menu {
    min-height: 200px !important;
  }

  .ik-create-panel__body {
    padding: 20px 20px 24px;
    gap: 14px;
  }

  .ik-create-title-input :deep(.z-textarea__inner) {
    font-size: 18px;
  }

  .ik-create-editor__body {
    min-height: 180px;
    font-size: 14px;
  }

  .ik-create-editor__body :deep(.z-textarea__inner) {
    padding: 14px;
  }

  .ik-cover-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
  }

}

@media (max-width: 500px) {
  .ik-create-page {
    width: 100%;
    padding: 0 0 90px;
    gap: 0;
  }

  .ik-create-columns {
    padding: 0 12px;
    gap: 12px;
  }

  .ik-create-menu :deep(.z-menu--vertical) {
    border-radius: 14px;
  }

  .ik-create-panel {
    border-radius: 14px;
  }

  .ik-create-panel__body {
    padding: 16px 16px 20px;
  }

  .ik-create-section--title {
    flex-wrap: wrap;
    padding-bottom: 10px;
  }

  .ik-create-section__count {
    margin-left: auto;
    padding-bottom: 0;
  }

  .ik-create-title-input :deep(.z-textarea__inner) {
    font-size: 17px;
  }

  .ik-create-editor__body {
    min-height: 160px;
  }

  .ik-create-editor__body :deep(.z-textarea__inner) {
    padding: 12px 14px;
  }

  .ik-cover-grid {
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px;
  }

  .ik-cover-thumb {
    border-radius: 8px;
  }

  .ik-cover-thumb__remove {
    opacity: 1;
  }

  .ik-create-footer__inner {
    min-height: 66px;
    padding: 6px 16px;
    gap: 8px;
  }
}

/* ═══════════════════════════════════════════════
   Mobile (≤768px) — Flutter-inspired flat editor
   隐藏桌面双栏布局，启用紧凑垂直布局 + 底部固定操作栏
   ═══════════════════════════════════════════════ */
@media (max-width: 768px) {
  .ik-create-page {
    width: 100%;
    margin: 0;
    padding: 0 0 calc(62px + env(safe-area-inset-bottom, 0px));
    gap: 0;
    background: #121212;
    /* 抑制 iOS/Android 纵向橡皮筋导致暴露 fixed 背景层 */
    overscroll-behavior-y: contain;
  }
  /* Flutter mobile 设计无斜纹底纹，避免 overscroll / 软键盘缝隙时露出 */
  .ik-create-page__stripe {
    display: none;
  }
  .ik-create-page > .ik-create-columns,
  .ik-create-footer {
    display: none !important;
  }
  .ik-create-mobile {
    display: flex;
    flex-direction: column;
    position: relative;
    z-index: 1;
    min-height: calc(100vh - 62px);
    background: #121212;
  }
  .ik-mobile-footer {
    display: flex;
  }

  /* ── Cover strip (horizontal scroll) ─────────── */
  .ik-mobile-cover-strip {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 14px 16px 8px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .ik-mobile-cover-strip::-webkit-scrollbar {
    display: none;
  }

  .ik-mobile-cover-add {
    flex: 0 0 auto;
    width: 90px;
    height: 90px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    appearance: none;
    border-radius: 10px;
    border: 1px dashed #2a2a2a;
    background: #1a1a1a;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 160ms ease, background 160ms ease;
  }
  .ik-mobile-cover-add:active {
    background: #232323;
    border-color: #3a3a3a;
  }
  .ik-mobile-cover-add__icon {
    width: 30px;
    height: 30px;
    color: #909090;
  }

  .ik-mobile-cover-tile {
    flex: 0 0 auto;
    position: relative;
    width: 90px;
    height: 90px;
    border-radius: 8px;
    overflow: hidden;
    background: #1a1a1a;
    cursor: pointer;
  }
  .ik-mobile-cover-tile__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .ik-mobile-cover-tile__overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
  }
  .ik-mobile-cover-tile__pct {
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .ik-mobile-cover-tile__spinner {
    width: 22px;
    height: 22px;
    border: 2.5px solid rgba(215, 255, 0, 0.25);
    border-top-color: #BFFF09;
    border-radius: 50%;
    animation: ik-mobile-spin 800ms linear infinite;
  }
  .ik-mobile-cover-tile__retry {
    appearance: none;
    border: 0;
    padding: 3px 10px;
    border-radius: 10px;
    background: #BFFF09;
    color: #000;
    font-size: 11px;
    font-weight: 900;
    cursor: pointer;
  }
  .ik-mobile-cover-tile__primary {
    position: absolute;
    left: 4px;
    bottom: 4px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(215, 255, 0, 0.85);
    color: #000;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.5px;
  }
  .ik-mobile-cover-tile__remove {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  @keyframes ik-mobile-spin {
    to { transform: rotate(360deg); }
  }

  /* ── Title (flat) ─────────────────────────────── */
  .ik-mobile-title-input {
    width: 100%;
    appearance: none;
    border: 0;
    outline: 0;
    background: transparent;
    color: #fff;
    font-family: inherit;
    font-size: 20px;
    font-weight: 700;
    padding: 12px 16px;
  }
  .ik-mobile-title-input::placeholder {
    color: #505050;
    font-weight: 700;
  }
  .ik-mobile-title-input:focus {
    background: #1a1a0a;
  }

  /* ── Divider (1px hairline) ───────────────────── */
  .ik-mobile-divider {
    height: 1px;
    background: #2a2a2a;
  }

  /* ── Body (flat textarea) ─────────────────────── */
  .ik-mobile-body-input {
    width: 100%;
    min-height: 220px;
    appearance: none;
    border: 0;
    outline: 0;
    resize: none;
    background: transparent;
    color: #e0e0e0;
    font-family: inherit;
    font-size: 16px;
    line-height: 1.6;
    padding: 14px 16px;
  }
  .ik-mobile-body-input::placeholder {
    color: #505050;
  }
  .ik-mobile-body-input:focus {
    background: #1a1a0a;
  }

  /* ── Setting row ──────────────────────────────── */
  .ik-mobile-row {
    width: 100%;
    appearance: none;
    border: 0;
    background: transparent;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    font-family: inherit;
    font-size: 16px;
    text-align: left;
    cursor: pointer;
    transition: background 140ms ease;
  }
  .ik-mobile-row:active {
    background: rgba(255, 255, 255, 0.04);
  }
  .ik-mobile-row:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .ik-mobile-row__icon {
    width: 20px;
    height: 20px;
    color: #9a9a9a;
    flex-shrink: 0;
  }
  .ik-mobile-row__title {
    flex: 1;
    font-weight: 700;
  }
  .ik-mobile-row__value {
    color: #9a9a9a;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  .ik-mobile-row__chevron {
    width: 20px;
    height: 20px;
    color: #686868;
    flex-shrink: 0;
  }

  /* ── Mobile footer (fixed) ────────────────────── */
  .ik-mobile-footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    height: calc(62px + env(safe-area-inset-bottom, 0px));
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
    background: #181818;
    border-top: 1px solid #2a2a2a;
    align-items: center;
    gap: 8px;
  }
  .ik-mobile-footer__drafts {
    flex: 0 0 auto;
    position: relative;
    width: 46px;
    height: 42px;
    padding: 0;
    appearance: none;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: #a0a0a0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 140ms ease;
  }
  .ik-mobile-footer__drafts:active {
    background: rgba(255, 255, 255, 0.06);
  }
  .ik-mobile-footer__drafts-icon {
    width: 24px;
    height: 24px;
  }
  .ik-mobile-footer__drafts-count {
    position: absolute;
    top: 4px;
    right: 4px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: #fbc02d;
    color: #000;
    font-size: 10px;
    font-weight: 900;
    line-height: 16px;
    text-align: center;
  }
  .ik-mobile-footer__anon {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .ik-mobile-footer__publish {
    flex: 1;
    appearance: none;
    border: 0;
    height: 42px;
    border-radius: 21px;
    background: #BFFF09;
    color: #000;
    font-family: inherit;
    font-size: 15px;
    font-weight: 900;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: filter 140ms ease, background 140ms ease;
  }
  .ik-mobile-footer__publish:active:not(.is-disabled) {
    filter: brightness(0.92);
  }
  .ik-mobile-footer__publish.is-disabled {
    background: rgba(215, 255, 0, 0.32);
    color: rgba(0, 0, 0, 0.6);
    cursor: not-allowed;
  }
  .ik-mobile-footer__spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(0, 0, 0, 0.2);
    border-top-color: #000;
    border-radius: 50%;
    animation: ik-mobile-spin 700ms linear infinite;
  }
}

/* ═══════════════════════════════════════════════
   Mobile bottom sheets (Teleported to body, so NOT
   inside scoped <style scoped>'s subtree restriction
   if Vue treats them as scoped slot. Using global
   selectors via :global() is unnecessary here because
   Teleport descendants still receive the [data-v-*]
   attribute from the host component.)
   ═══════════════════════════════════════════════ */
.ik-mobile-sheet {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.ik-mobile-sheet__panel {
  width: 100%;
  max-width: 640px;
  background: #181818;
  border-radius: 16px 16px 0 0;
  padding: 10px 16px calc(20px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
}

.ik-mobile-sheet__panel--full {
  height: 88vh;
  padding-top: 6px;
}

.ik-mobile-sheet__handle {
  width: 36px;
  height: 4px;
  margin: 6px auto 4px;
  border-radius: 99px;
  background: #383838;
}

.ik-mobile-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0 6px;
}

.ik-mobile-sheet__title {
  color: #fff;
  font-size: 16px;
  font-weight: 700;
}

.ik-mobile-sheet__close {
  appearance: none;
  border: 0;
  background: transparent;
  color: #a0a0a0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.ik-mobile-sheet__close:active {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.ik-mobile-sheet__body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 8px;
  -webkit-overflow-scrolling: touch;
}
.ik-mobile-sheet__body--compact {
  flex: 0 0 auto;
  padding: 6px 0 0;
}

/* ── Draft list rows (in drafts sheet) ────────── */
.ik-mobile-draft-row {
  width: 100%;
  appearance: none;
  border: 1px solid #2a2a2a;
  background: #1f1f1f;
  border-radius: 12px;
  padding: 12px 14px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease;
  font-family: inherit;
}
.ik-mobile-draft-row:active {
  background: #262626;
}
.ik-mobile-draft-row.is-active {
  border-color: #BFFF09;
  background: rgba(215, 255, 0, 0.06);
}
.ik-mobile-draft-row__title {
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ik-mobile-draft-row__meta {
  color: #9a9a9a;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ik-mobile-draft-row--new .ik-mobile-draft-row__title {
  color: #BFFF09;
}

.ik-mobile-draft-empty {
  text-align: center;
  color: #6a6a6a;
  font-size: 13px;
  padding: 24px 0;
}

.ik-mobile-draft-loadmore {
  appearance: none;
  border: 1px solid #2a2a2a;
  background: transparent;
  color: #b0b0b0;
  border-radius: 999px;
  height: 40px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  margin: 8px auto 4px;
  padding: 0 18px;
  align-self: center;
}
.ik-mobile-draft-loadmore:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Settings rows (in settings sheet) ────────── */
.ik-mobile-settings-row {
  width: 100%;
  appearance: none;
  border: 1px solid #2a2a2a;
  background: #1f1f1f;
  border-radius: 12px;
  padding: 14px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 140ms ease;
}
.ik-mobile-settings-row:active {
  background: #262626;
}
.ik-mobile-settings-row__icon {
  width: 20px;
  height: 20px;
  color: #c0c0c0;
  flex-shrink: 0;
}
.ik-mobile-settings-row__title {
  flex: 1;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
}
.ik-mobile-settings-row__chevron {
  width: 18px;
  height: 18px;
  color: #686868;
  flex-shrink: 0;
}
.ik-mobile-settings-row--danger .ik-mobile-settings-row__icon,
.ik-mobile-settings-row--danger .ik-mobile-settings-row__title {
  color: #ff6b6b;
}

/* ── Sheet enter/leave transitions ────────────── */
.ik-mobile-sheet-enter-active,
.ik-mobile-sheet-leave-active {
  transition: opacity 220ms ease;
}
.ik-mobile-sheet-enter-active .ik-mobile-sheet__panel,
.ik-mobile-sheet-leave-active .ik-mobile-sheet__panel {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ik-mobile-sheet-enter-from,
.ik-mobile-sheet-leave-to {
  opacity: 0;
}
.ik-mobile-sheet-enter-from .ik-mobile-sheet__panel,
.ik-mobile-sheet-leave-to .ik-mobile-sheet__panel {
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
