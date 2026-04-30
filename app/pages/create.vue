<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import { useMessage } from "zenless-ui";
import type {
  Discussion,
  DraftArticle,
  UploadTask,
  UploadStatus,
} from "~/types/entities";
import type { Pagination } from "~/types/api";
import { ArrowUpTrayIcon, EyeIcon, PhotoIcon, XMarkIcon, PlusIcon, DocumentTextIcon } from "@heroicons/vue/24/outline";
import { resolveErrorMessage } from "~/utils/api-error";

const MAX_COVER_IMAGES = 9;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const AUTO_SAVE_DELAY = 800;

const api = useApi();
const auth = useAuthStore();
const router = useRouter();
const loginDialog = useLoginDialog();
const message = useMessage();

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
const suppressTracking = ref(false);
const lastSavedSnapshot = ref("");

// Draft list
const showMobileDrafts = ref(false);
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

/* ── Live Preview ─────────────────────────────────── */
const previewDiscussion = computed<Discussion>(() => {
  const firstDone = uploadTasks.value.find(
    (t) => t.status === "done" && t.serverUrl,
  );
  return {
    id: documentId.value || "preview",
    title: title.value || "标题预览",
    bodyText: body.value || "正文内容预览…",
    rawBodyText: body.value || "",
    covers: uploadTasks.value
      .filter((t) => t.status === "done" && t.serverUrl)
      .map((t) => ({ url: t.serverUrl! })),
    cover: firstDone?.previewUrl || firstDone?.serverUrl || undefined,
    views: 0,
    likesCount: 0,
    commentsCount: 0,
    isPinned: false,
    isRead: false,
    author: {
      name: auth.user?.name || "未知作者",
      avatar: auth.user?.avatar || "/images/default-avatar.webp",
    },
    createdAt: new Date().toISOString(),
  };
});

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
    };

    let result: DraftArticle;
    if (!documentId.value) {
      result = await api.createArticleDraft(payload);
    } else {
      result = await api.updateArticleDraft(documentId.value, payload);
    }

    if (result.documentId) {
      documentId.value = result.documentId;
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
    executeUploadTask(task);
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
  if (!confirm("确定要删除这个草稿吗？此操作不可恢复。")) return;

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
    lastSavedSnapshot.value = "";
    hasUnsavedChanges.value = false;
  } finally {
    suppressTracking.value = false;
  }
}

function newDraft() {
  if (hasUnsavedChanges.value && (documentId.value || hasAnyContent.value)) {
    performSaveDraft(true).catch(() => undefined);
  }
  resetEditor();
}

/* ── Drag & Drop ──────────────────────────────────── */
const isDragging = ref(false);

function onDragOver(e: DragEvent) {
  e.preventDefault();
  isDragging.value = true;
}
function onDragLeave() {
  isDragging.value = false;
}
function onDrop(e: DragEvent) {
  e.preventDefault();
  isDragging.value = false;
  if (e.dataTransfer?.files) {
    handleFileSelect(e.dataTransfer.files);
  }
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
</script>

<template>
  <section class="ik-create-page" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <!-- Drag overlay -->
    <Transition name="ik-fade">
      <div v-if="isDragging" class="ik-create-drop-overlay">
        <div class="ik-create-drop-overlay__inner">
          <ArrowUpTrayIcon style="width:48px;height:48px;color:#d7ff00" />
          <span class="ik-create-drop-overlay__text">释放以上传封面图片</span>
        </div>
      </div>
    </Transition>

    <!-- ── Top Bar ──────────────────────────────── -->
    <header class="ik-create-topbar">
      <div class="ik-create-topbar__left">
        <div class="ik-create-topbar__avatar-shell">
          <img
            :src="auth.user?.avatar || '/images/default-avatar.webp'"
            alt="avatar"
            class="ik-create-topbar__avatar"
            @error="($event.target as HTMLImageElement).src = '/images/default-avatar.webp'"
          />
        </div>
        <div class="ik-create-topbar__info">
          <span class="ik-create-topbar__name">{{ auth.user?.name || "未登录" }}</span>
          <span class="ik-create-topbar__badge-label">发布委托</span>
        </div>
      </div>
      <div class="ik-create-topbar__right">
        <span v-if="isSavingDraft" class="ik-status ik-status--saving">
          <span class="ik-status__dot"></span>保存中
        </span>
        <span v-else-if="hasUnsavedChanges" class="ik-status ik-status--dirty">
          <span class="ik-status__dot"></span>未保存
        </span>
        <span v-else-if="documentId" class="ik-status ik-status--saved">
          <span class="ik-status__dot"></span>已保存
        </span>
        <button
          v-if="documentId"
          class="ik-create-topbar__del-btn"
          :disabled="isDeletingDraft"
          @click="deleteDraft"
        >
          {{ isDeletingDraft ? "删除中..." : "删除草稿" }}
        </button>
        <z-button :loading="isPublishing" :disabled="!canPublish" @click="publish">
          发布
        </z-button>
      </div>
    </header>


    <!-- ── Three-Column Body ──────────────────────── -->
    <div class="ik-create-columns">
      <!-- ── Left: Live Preview ───────────── -->
      <div class="ik-create-preview">
        <div class="ik-create-preview__header">
          <h3 class="ik-create-preview__label">
            <EyeIcon style="width:16px;height:16px" />
            主页预览
          </h3>
          <span class="ik-create-preview__hint">发布后效果</span>
        </div>
        <div class="ik-create-preview__card-wrap">
          <DiscussionCard :discussion="previewDiscussion" />
        </div>
      </div>

      <!-- ── Center: Editor + Covers ─────────── -->
      <main class="ik-create-main">
        <div class="ik-create-editor">
          <input
            v-model="title"
            class="ik-create-editor__title"
            type="text"
            placeholder="标题"
            maxlength="200"
          />
          <ZTextarea
            v-model="body"
            class="ik-create-editor__body"
            placeholder="请尽情发挥吧..."
          />
        </div>

        <!-- Covers Section (always visible) -->
        <div class="ik-create-covers">
          <div class="ik-create-covers__header">
            <h3 class="ik-create-covers__label">
              <PhotoIcon style="width:18px;height:18px" />
              封面
            </h3>
            <span class="ik-create-covers__count">{{ uploadTasks.length }}/{{ MAX_COVER_IMAGES }}</span>
          </div>
          <div class="ik-create-covers__grid">
            <div
              v-for="(task, idx) in uploadTasks"
              :key="task.localId"
              class="ik-cover-thumb"
            >
              <img :src="task.previewUrl" :alt="task.filename" class="ik-cover-thumb__img" />
              <div v-if="task.status === 'uploading'" class="ik-cover-thumb__overlay">
                <span class="ik-cover-thumb__pct">{{ task.progress }}%</span>
                <div class="ik-cover-thumb__bar">
                  <div class="ik-cover-thumb__progress" :style="{ width: task.progress + '%' }"></div>
                </div>
              </div>
              <div v-if="task.status === 'error'" class="ik-cover-thumb__overlay ik-cover-thumb__overlay--error" @click="retryUpload(task)">
                <span>失败</span>
                <span style="font-size:11px">点击重试</span>
              </div>
              <button class="ik-cover-thumb__remove" @click="removeUpload(idx)" aria-label="移除">
                <XMarkIcon style="width:12px;height:12px" />
              </button>
            </div>
            <label v-if="uploadTasks.length < MAX_COVER_IMAGES" class="ik-cover-add">
              <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden @change="onCoverFileInput" />
              <PlusIcon style="width:24px;height:24px" />
              <span class="ik-cover-add__text">添加图片</span>
            </label>
          </div>
        </div>
      </main>

      <!-- ── Side: Drafts Panel ────────────── -->
      <aside class="ik-create-aside" @mouseenter="ensureDraftsLoaded" @focusin="ensureDraftsLoaded">
        <div class="ik-create-drafts__header">
          <h3 class="ik-create-drafts__title">
            <DocumentTextIcon style="width:16px;height:16px" />
            草稿箱
          </h3>
          <button class="ik-create-drafts__new-btn" @click="newDraft">
            <PlusIcon style="width:14px;height:14px" />
            新建
          </button>
        </div>

        <div v-if="!auth.isLogin" class="ik-empty">请先登录</div>
        <div v-else-if="draftsInitialized && !drafts.length && !draftsLoading" class="ik-empty">暂无草稿</div>
        <div v-else-if="!draftsInitialized && !draftsLoading" class="ik-create-drafts__hint">移入加载草稿</div>

        <div v-if="drafts.length" class="ik-create-drafts__list">
          <button
            v-for="draft in drafts"
            :key="draft.documentId"
            class="ik-draft-item"
            :class="{ 'is-active': draft.documentId === documentId }"
            @click="openDraft(draft)"
          >
            <div class="ik-draft-item__title">{{ draft.title || "无标题" }}</div>
            <div class="ik-draft-item__meta">{{ draft.text ? draft.text.slice(0, 50) : "无内容" }}</div>
          </button>
          <div v-if="draftsHasNext" class="ik-create-drafts__load-more">
            <z-button :loading="draftsLoading" @click="loadMoreDrafts">加载更多</z-button>
          </div>
        </div>
        <div v-if="draftsLoading && !drafts.length" class="ik-empty">
          <span class="ik-status ik-status--saving"><span class="ik-status__dot"></span>加载中</span>
        </div>
      </aside>
    </div>

    <!-- ── Mobile Drafts Toggle ──────────────────── -->
    <button class="ik-mobile-drafts-toggle" @click="showMobileDrafts = !showMobileDrafts; ensureDraftsLoaded()">
      <DocumentTextIcon style="width:18px;height:18px" />
      草稿 <span v-if="drafts.length" class="ik-mobile-drafts-toggle__count">{{ drafts.length }}</span>
    </button>
    <Transition name="ik-slide-up">
      <div v-if="showMobileDrafts" class="ik-mobile-drafts-sheet" @click.self="showMobileDrafts = false">
        <div class="ik-mobile-drafts-sheet__panel">
          <div class="ik-create-drafts__header">
            <h3 class="ik-create-drafts__title">草稿箱</h3>
            <button class="ik-create-drafts__new-btn" @click="newDraft; showMobileDrafts = false">
              <PlusIcon style="width:14px;height:14px" />
              新建
            </button>
          </div>
          <div v-if="!drafts.length && !draftsLoading" class="ik-empty">暂无草稿</div>
          <div v-else class="ik-create-drafts__list">
            <button
              v-for="draft in drafts"
              :key="draft.documentId"
              class="ik-draft-item"
              :class="{ 'is-active': draft.documentId === documentId }"
              @click="openDraft(draft); showMobileDrafts = false"
            >
              <div class="ik-draft-item__title">{{ draft.title || "无标题" }}</div>
              <div class="ik-draft-item__meta">{{ draft.text ? draft.text.slice(0, 50) : "无内容" }}</div>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Create Post Page – ZZZ Unified Layout
   ═══════════════════════════════════════════════ */
.ik-create-page {
  position: relative;
  width: min(1440px, calc(100% - 40px));
  margin: 0 auto;
  padding: 20px 0 40px;
  min-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  gap: 16px;
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
}

.ik-create-drop-overlay__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px 64px;
  border: 2px dashed #d7ff00;
  border-radius: 24px;
  background: rgba(215, 255, 0, 0.04);
}

.ik-create-drop-overlay__text {
  font-size: 18px;
  font-weight: 700;
  color: #d7ff00;
  letter-spacing: 0.5px;
}

/* ── Transition helpers ──────────────────────────── */
.ik-fade-enter-active,
.ik-fade-leave-active { transition: opacity 200ms ease; }
.ik-fade-enter-from,
.ik-fade-leave-to { opacity: 0; }

.ik-slide-up-enter-active,
.ik-slide-up-leave-active { transition: all 300ms cubic-bezier(.4,0,.2,1); }
.ik-slide-up-enter-from,
.ik-slide-up-leave-to { opacity: 0; transform: translateY(100%); }

/* ── Top Bar ─────────────────────────────────────── */
.ik-create-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(135deg, #111 0%, #0a0a0a 100%);
  border: 1px solid #2a2a2a;
  border-radius: 20px;
  gap: 12px;
}

.ik-create-topbar__left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.ik-create-topbar__avatar-shell {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 999px;
  border: 2px solid #333;
  overflow: hidden;
  background: #1b1b1b;
}

.ik-create-topbar__avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 999px;
}

.ik-create-topbar__info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ik-create-topbar__name {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ik-create-topbar__badge-label {
  font-size: 12px;
  font-weight: 800;
  font-style: italic;
  color: #d7ff00;
  letter-spacing: 0.5px;
}

.ik-create-topbar__right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.ik-create-topbar__del-btn {
  padding: 5px 12px;
  border: 1px solid rgba(255, 77, 79, 0.5);
  border-radius: 8px;
  background: transparent;
  color: #ff6b6b;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 200ms, border-color 200ms;
}

.ik-create-topbar__del-btn:hover {
  background: rgba(255, 77, 79, 0.1);
  border-color: #ff4d4f;
}

.ik-create-topbar__del-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Status Indicator ────────────────────────────── */
.ik-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
}

.ik-status__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.ik-status--saving { color: #d7ff00; }
.ik-status--saving .ik-status__dot {
  background: #d7ff00;
  animation: ik-dot-pulse 1s ease-in-out infinite;
}

.ik-status--dirty { color: #808080; }
.ik-status--dirty .ik-status__dot { background: #808080; }

.ik-status--saved { color: #4caf50; }
.ik-status--saved .ik-status__dot { background: #4caf50; }

@keyframes ik-dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(0.6); }
}

/* ── Three-Column Layout ─────────────────────────── */
.ik-create-columns {
  flex: 1;
  display: grid;
  grid-template-columns: calc((min(1000px, 100vw - 32px) - 36px) / 4) 1fr 280px;
  gap: 16px;
  min-height: 0;
  align-items: start;
}

/* ── Main Column ─────────────────────────────────── */
.ik-create-main {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: #0c0c0c;
  border: 1px solid #2a2a2a;
  border-radius: 20px;
  overflow: hidden;
}

/* ── Editor ───────────────────────────────────────── */
.ik-create-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 28px 28px 0;
}

.ik-create-editor__title {
  width: 100%;
  padding: 14px 0;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #fff;
  font-size: 24px;
  font-weight: 800;
  font-family: inherit;
  letter-spacing: -0.3px;
  outline: none;
  transition: border-color 300ms;
  background-image: linear-gradient(to right, #2d2d2d, #2d2d2d);
  background-size: 100% 2px;
  background-position: bottom;
  background-repeat: no-repeat;
}

.ik-create-editor__title:focus {
  border-bottom-color: #d7ff00;
  background-image: none;
}

.ik-create-editor__title::placeholder {
  color: #444;
  font-style: italic;
}

.ik-create-editor__body {
  flex: 1;
  min-height: 280px;
  width: 100%;
  margin-top: 16px;
  border: 1px solid #1e1e1e;
  border-radius: 16px;
  background: #080808;
  font-size: 16px;
  line-height: 1.8;
  font-family: inherit;
  outline: none;
  transition: border-color 300ms, box-shadow 300ms;
}

.ik-create-editor__body::after {
  border: none;
  animation: none;
}

.ik-create-editor__body.is-focused {
  border-color: rgba(215, 255, 0, 0.4);
  box-shadow: 0 0 0 3px rgba(215, 255, 0, 0.06);
}

.ik-create-editor__body :deep(.z-textarea__inner) {
  padding: 20px;
  color: #e0e0e0;
  resize: vertical;
}

.ik-create-editor__body :deep(.z-textarea__inner)::placeholder {
  color: #444;
}

/* ── Covers Section ──────────────────────────────── */
.ik-create-covers {
  padding: 20px 28px 24px;
  border-top: 1px solid #1a1a1a;
}

.ik-create-covers__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.ik-create-covers__label {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #999;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ik-create-covers__label svg {
  color: #666;
}

.ik-create-covers__count {
  font-size: 12px;
  font-weight: 600;
  color: #555;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
}

.ik-create-covers__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* ── Live Preview (Left Column) ──────────────────── */
.ik-create-preview {
  position: sticky;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ik-create-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ik-create-preview__label {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #666;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ik-create-preview__label svg {
  color: #555;
}

.ik-create-preview__hint {
  font-size: 11px;
  color: #444;
  font-style: italic;
}

.ik-create-preview__card-wrap {
  pointer-events: none;
  user-select: none;
}

/* ── Cover Thumbnail ─────────────────────────────── */
.ik-cover-thumb {
  position: relative;
  width: 100px;
  height: 100px;
  border-radius: 14px;
  overflow: hidden;
  border: 2px solid #222;
  flex-shrink: 0;
  transition: border-color 200ms, transform 200ms;
}

.ik-cover-thumb:hover {
  border-color: #444;
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
  gap: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.ik-cover-thumb__overlay--error {
  background: rgba(255, 60, 60, 0.65);
  cursor: pointer;
}

.ik-cover-thumb__pct {
  font-size: 16px;
  font-weight: 800;
  color: #d7ff00;
}

.ik-cover-thumb__bar {
  width: 70%;
  height: 3px;
  background: #444;
  border-radius: 2px;
  overflow: hidden;
}

.ik-cover-thumb__progress {
  height: 100%;
  background: #d7ff00;
  border-radius: 2px;
  transition: width 200ms;
}

.ik-cover-thumb__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms, background 150ms;
}

.ik-cover-thumb:hover .ik-cover-thumb__remove {
  opacity: 1;
}

.ik-cover-thumb__remove:hover {
  background: rgba(255, 60, 60, 0.8);
}

/* ── Cover Add Button ────────────────────────────── */
.ik-cover-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100px;
  height: 100px;
  border-radius: 14px;
  border: 2px dashed #2a2a2a;
  cursor: pointer;
  transition: border-color 200ms, background 200ms, transform 200ms;
  flex-shrink: 0;
  color: #555;
}

.ik-cover-add:hover {
  border-color: #d7ff00;
  background: rgba(215, 255, 0, 0.04);
  color: #d7ff00;
  transform: translateY(-2px);
}

.ik-cover-add__text {
  font-size: 11px;
  font-weight: 600;
}

/* ── Aside: Drafts Panel ─────────────────────────── */
.ik-create-aside {
  display: flex;
  flex-direction: column;
  background: #0c0c0c;
  border: 1px solid #2a2a2a;
  border-radius: 20px;
  padding: 20px;
  overflow-y: auto;
  max-height: calc(100vh - 200px);
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.ik-create-aside::-webkit-scrollbar { display: none; }

.ik-create-drafts__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid #1a1a1a;
}

.ik-create-drafts__title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: #ccc;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ik-create-drafts__title svg { color: #666; }

.ik-create-drafts__new-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px solid rgba(215, 255, 0, 0.35);
  border-radius: 8px;
  background: transparent;
  color: #d7ff00;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background 200ms, border-color 200ms;
}

.ik-create-drafts__new-btn:hover {
  background: rgba(215, 255, 0, 0.08);
  border-color: #d7ff00;
}

.ik-create-drafts__hint {
  text-align: center;
  color: #444;
  font-size: 13px;
  padding: 24px 0;
}

.ik-create-drafts__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ik-draft-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 14px;
  border: 1px solid #1a1a1a;
  border-radius: 12px;
  background: #0f0f0f;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 200ms, background 200ms, transform 200ms;
}

.ik-draft-item:hover {
  border-color: #333;
  background: #161616;
  transform: translateX(2px);
}

.ik-draft-item.is-active {
  border-color: rgba(215, 255, 0, 0.4);
  background: rgba(215, 255, 0, 0.04);
}

.ik-draft-item.is-active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 60%;
  border-radius: 0 3px 3px 0;
  background: #d7ff00;
}

.ik-draft-item__title {
  font-size: 14px;
  font-weight: 700;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-draft-item__meta {
  font-size: 12px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ik-create-drafts__load-more {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

/* ── Mobile Drafts Toggle ────────────────────────── */
.ik-mobile-drafts-toggle {
  display: none;
}

.ik-mobile-drafts-sheet {
  display: none;
}

/* ═══════════════════════════════════════════════
   Responsive
   ═══════════════════════════════════════════════ */
@media (max-width: 1200px) {
  .ik-create-columns {
    grid-template-columns: 260px 1fr;
  }

  .ik-create-aside {
    display: none;
  }

  .ik-mobile-drafts-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 40;
    padding: 10px 18px;
    border: 1px solid #333;
    border-radius: 999px;
    background: #111;
    color: #ccc;
    font-size: 13px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    transition: background 200ms, border-color 200ms;
  }

  .ik-mobile-drafts-toggle:hover {
    background: #1a1a1a;
    border-color: #d7ff00;
  }

  .ik-mobile-drafts-toggle__count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 99px;
    background: #d7ff00;
    color: #000;
    font-size: 10px;
    font-weight: 800;
  }

  .ik-mobile-drafts-sheet {
    display: flex;
    position: fixed;
    inset: 0;
    z-index: 50;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.5);
  }

  .ik-mobile-drafts-sheet__panel {
    width: 100%;
    max-height: 60vh;
    overflow-y: auto;
    padding: 20px;
    background: #111;
    border-top: 1px solid #2a2a2a;
    border-radius: 20px 20px 0 0;
  }
}

@media (max-width: 900px) {
  .ik-create-page {
    width: calc(100% - 24px);
    gap: 12px;
  }

  .ik-create-columns {
    grid-template-columns: 1fr;
  }

  .ik-create-preview {
    position: static;
  }

  .ik-create-preview__card-wrap {
    max-width: 300px;
  }

  .ik-create-editor {
    padding: 20px 20px 0;
  }

  .ik-create-editor__title {
    font-size: 20px;
  }

  .ik-create-editor__body {
    min-height: 200px;
    font-size: 15px;
  }

  .ik-create-covers {
    padding: 16px 20px 20px;
  }
}

@media (max-width: 500px) {
  .ik-create-page {
    width: 100%;
    padding: 0;
    gap: 0;
  }

  .ik-create-topbar {
    border-radius: 0;
    border-left: none;
    border-right: none;
    padding: 12px 16px;
  }

  .ik-create-main {
    border-radius: 0;
    border-left: none;
    border-right: none;
  }

  .ik-create-editor {
    padding: 16px 16px 0;
  }

  .ik-create-editor__title {
    font-size: 18px;
    padding: 10px 0;
  }

  .ik-create-editor__body {
    min-height: 180px;
    border-radius: 12px;
  }

  .ik-create-editor__body :deep(.z-textarea__inner) {
    padding: 14px;
  }

  .ik-create-covers {
    padding: 14px 16px 18px;
  }

  .ik-create-preview__card-wrap {
    max-width: 100%;
  }

  .ik-cover-thumb {
    width: 76px;
    height: 76px;
    border-radius: 10px;
  }

  .ik-cover-add {
    width: 76px;
    height: 76px;
    border-radius: 10px;
  }

  .ik-cover-thumb__remove {
    opacity: 1;
  }

  .ik-create-topbar__name {
    font-size: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
