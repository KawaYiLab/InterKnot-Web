<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import { useMessage } from "zenless-ui";
import type {
  DraftArticle,
  UploadTask,
  UploadStatus,
} from "~/types/entities";
import type { Pagination } from "~/types/api";
import {
  ArrowUpTrayIcon,
  PhotoIcon,
  XMarkIcon,
  PlusIcon,
  PencilSquareIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
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
const message = useMessage();

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

/* ── Draft List Helpers ───────────────────────────── */
function isDraftActive(draft: DraftArticle): boolean {
  return !!documentId.value && draft.documentId === documentId.value;
}

function isNewDraftMarker(draft: DraftArticle): boolean {
  if (isDraftActive(draft)) return false;
  const ts = draft.updatedAt || draft.createdAt;
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
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

if (import.meta.client && auth.isLogin) {
  ensureDraftsLoaded();
}
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
      </div>
    </header>

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
                {{ title.trim() || "新建文章" }}
              </span>
              <span class="ik-nav-item__meta">
                {{ uploadTasks.length }}/{{ MAX_COVER_IMAGES }} 图 · {{ editorWordCount }} 字
              </span>
            </div>
          </z-menu-item>

          <!-- Drafts -->
          <z-menu-item
            v-for="draft in drafts"
            :key="draft.documentId"
            :name="draft.documentId"
          >
            <div class="ik-nav-item__content">
              <span v-if="isNewDraftMarker(draft)" class="ik-nav-item__badge">NEW!</span>
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
        <div class="ik-create-panel__inner">
          <h3 class="ik-section-title">委托详情</h3>

          <!-- Title field -->
          <div class="ik-field-row">
            <span class="ik-field-row__label">委托标题</span>
            <input
              v-model="title"
              class="ik-field-row__input"
              type="text"
              placeholder="请输入标题..."
              maxlength="200"
            />
            <span class="ik-field-row__count">{{ editorTitleCount }}/200</span>
          </div>

          <!-- Body field -->
          <div class="ik-field-block">
            <div class="ik-field-block__header">
              <span class="ik-field-block__label">委托附言</span>
              <span class="ik-field-block__hint">若仅上传图片，正文可留空</span>
            </div>
            <div class="ik-field-block__body">
              <ZTextarea
                v-model="body"
                class="ik-create-editor__body"
                placeholder="请尽情发挥吧..."
              />
              <PencilSquareIcon class="ik-field-block__pencil" />
            </div>
          </div>

          <!-- Covers preview -->
          <div class="ik-field-block ik-field-block--covers">
            <div class="ik-field-block__header">
              <span class="ik-field-block__label">
                <MagnifyingGlassIcon style="width:14px;height:14px" />
                战利品预览
              </span>
              <span class="ik-field-block__hint">委托发布后将作为讨论封面展示</span>
            </div>
            <div class="ik-cover-rail">
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
                <div
                  v-if="task.status === 'error'"
                  class="ik-cover-thumb__overlay ik-cover-thumb__overlay--error"
                  @click="retryUpload(task)"
                >
                  <span>失败</span>
                  <span style="font-size:11px">点击重试</span>
                </div>
                <button class="ik-cover-thumb__remove" @click="removeUpload(idx)" aria-label="移除">
                  <XMarkIcon style="width:12px;height:12px" />
                </button>
              </div>
              <label v-if="uploadTasks.length < MAX_COVER_IMAGES" class="ik-cover-add">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  hidden
                  @change="onCoverFileInput"
                />
                <PhotoIcon style="width:22px;height:22px" />
                <span class="ik-cover-add__text">添加图片</span>
              </label>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- ── Bottom Footer (Sticky Publish Bar) ───── -->
    <footer class="ik-create-footer">
      <div class="ik-create-footer__hint">
        <span v-if="documentId" class="ik-create-footer__draft-id">草稿 #{{ documentId.slice(-6) }}</span>
        <span v-else class="ik-create-footer__draft-id">未保存草稿</span>
        <span class="ik-create-footer__count">字数 {{ editorWordCount }} · 图片 {{ uploadTasks.length }}/{{ MAX_COVER_IMAGES }}</span>
      </div>
      <button
        class="ik-publish-btn"
        :class="{ 'is-disabled': !canPublish, 'is-loading': isPublishing }"
        :disabled="!canPublish"
        @click="publish"
      >
        <span class="ik-publish-btn__inner">
          <PaperAirplaneIcon v-if="!isPublishing" style="width:18px;height:18px" />
          <span v-else class="ik-publish-btn__spinner"></span>
          <span class="ik-publish-btn__text">{{ isPublishing ? "发布中..." : "发布委托" }}</span>
        </span>
      </button>
    </footer>
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
  padding: 20px 0 110px;
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

/* ── Two-Column Layout ───────────────────────────── */
.ik-create-columns {
  flex: 1;
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
  min-height: 0;
  align-items: start;
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
  font-weight: 800;
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
  color: #d7ff00;
}

.ik-create-menu :deep(.z-menu__item.is-active) .ik-nav-item__editing-arrow {
  color: #0a0a0a;
}

.ik-nav-item__badge {
  position: absolute;
  top: -6px;
  left: -2px;
  font-size: 9px;
  font-weight: 800;
  font-style: italic;
  color: #ff4d4f;
  letter-spacing: 0.5px;
  text-shadow: 0 0 4px rgba(255, 77, 79, 0.4);
  pointer-events: none;
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
  border-color: #d7ff00;
  color: #d7ff00;
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

/* ═════════ Right Panel ═════════ */
.ik-create-panel {
  display: flex;
  flex-direction: column;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(180deg, #0c0c0c 0%, #080808 100%);
  border: 1px solid #2a2a2a;
  border-radius: 20px;
  overflow: hidden;
  min-height: 480px;
}

.ik-create-panel__inner {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px 26px 26px;
}

.ik-section-title {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 800;
  font-style: italic;
  color: #888;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* ── Field Row (Title-like) ──────────────────────── */
.ik-field-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  background: #0a0a0a;
  border: 1px solid #1a1a1a;
  border-radius: 14px;
  transition: border-color 200ms, background 200ms;
}

.ik-field-row:focus-within {
  border-color: rgba(215, 255, 0, 0.5);
  background: #0d0d0d;
}

.ik-field-row__label {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  color: #888;
  letter-spacing: 0.3px;
}

.ik-field-row__input {
  flex: 1;
  min-width: 0;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  font-family: inherit;
  outline: none;
}

.ik-field-row__input::placeholder {
  color: #444;
  font-style: italic;
  font-weight: 400;
}

.ik-field-row__count {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #555;
  font-variant-numeric: tabular-nums;
}

/* ── Field Block (Body / Covers) ─────────────────── */
.ik-field-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 18px 16px;
  background: #0a0a0a;
  border: 1px solid #1a1a1a;
  border-radius: 14px;
}

.ik-field-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ik-field-block__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: #aaa;
  letter-spacing: 0.3px;
}

.ik-field-block__label svg {
  color: #666;
}

.ik-field-block__hint {
  font-size: 11px;
  font-style: italic;
  color: #555;
}

.ik-field-block__body {
  position: relative;
}

.ik-field-block__pencil {
  position: absolute;
  right: 12px;
  bottom: 10px;
  width: 18px;
  height: 18px;
  color: #444;
  pointer-events: none;
}

/* ── Body Textarea (within field block) ──────────── */
.ik-create-editor__body {
  width: 100%;
  min-height: 220px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: #050505;
  font-size: 15px;
  line-height: 1.75;
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
  box-shadow: 0 0 0 2px rgba(215, 255, 0, 0.06);
}

.ik-create-editor__body :deep(.z-textarea__inner) {
  padding: 16px 40px 16px 18px;
  color: #e0e0e0;
  resize: vertical;
  background: transparent;
}

.ik-create-editor__body :deep(.z-textarea__inner)::placeholder {
  color: #444;
}

/* ── Cover Rail (horizontal grid) ────────────────── */
.ik-cover-rail {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 4px 0 2px;
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

/* ═════════ Bottom Footer (Sticky Publish Bar) ═════════ */
.ik-create-footer {
  position: sticky;
  bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px 12px 24px;
  background:
    url("/images/tab-bg-point.webp") repeat,
    linear-gradient(135deg, #111 0%, #0a0a0a 100%);
  border: 1px solid #2a2a2a;
  border-radius: 18px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 20;
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
  color: #d7ff00;
  letter-spacing: 0.5px;
}

.ik-create-footer__count {
  font-size: 12px;
  font-weight: 600;
  color: #777;
  font-variant-numeric: tabular-nums;
}

/* ── Publish Button (slanted) ────────────────────── */
.ik-publish-btn {
  flex-shrink: 0;
  position: relative;
  padding: 0;
  height: 50px;
  min-width: 200px;
  border: none;
  background: #d7ff00;
  color: #0a0a0a;
  font-family: inherit;
  cursor: pointer;
  clip-path: polygon(16px 0, 100% 0, calc(100% - 16px) 100%, 0 100%);
  transition: filter 200ms, transform 150ms;
}

.ik-publish-btn:hover:not(.is-disabled):not(.is-loading) {
  filter: brightness(1.1);
}

.ik-publish-btn:active:not(.is-disabled):not(.is-loading) {
  transform: translateY(1px);
}

.ik-publish-btn.is-disabled {
  background: #2a2a2a;
  color: #555;
  cursor: not-allowed;
}

.ik-publish-btn.is-loading {
  background: rgba(215, 255, 0, 0.6);
  cursor: wait;
}

.ik-publish-btn__inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 0 32px;
}

.ik-publish-btn__text {
  font-size: 16px;
  font-weight: 800;
  font-style: italic;
  letter-spacing: 1px;
}

.ik-publish-btn__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(0, 0, 0, 0.3);
  border-top-color: #0a0a0a;
  border-radius: 50%;
  animation: ik-publish-spin 0.8s linear infinite;
}

@keyframes ik-publish-spin {
  to { transform: rotate(360deg); }
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
    padding: 16px 0 100px;
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

  .ik-create-panel__inner {
    padding: 18px 18px 22px;
    gap: 12px;
  }

  .ik-field-row {
    padding: 10px 14px;
  }

  .ik-field-row__input {
    font-size: 15px;
  }

  .ik-field-block {
    padding: 12px 14px 14px;
  }

  .ik-create-editor__body {
    min-height: 180px;
    font-size: 14px;
  }

  .ik-create-footer {
    padding: 10px 14px 10px 18px;
  }

  .ik-publish-btn {
    min-width: 160px;
    height: 46px;
  }

  .ik-publish-btn__text {
    font-size: 14px;
  }
}

@media (max-width: 500px) {
  .ik-create-page {
    width: 100%;
    padding: 0 0 84px;
    gap: 0;
  }

  .ik-create-topbar {
    border-radius: 0;
    border-left: none;
    border-right: none;
    padding: 12px 16px;
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

  .ik-create-panel__inner {
    padding: 14px 14px 18px;
  }

  .ik-field-row {
    flex-wrap: wrap;
  }

  .ik-field-row__count {
    margin-left: auto;
  }

  .ik-create-editor__body {
    min-height: 160px;
  }

  .ik-create-editor__body :deep(.z-textarea__inner) {
    padding: 14px 38px 14px 14px;
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

  .ik-create-footer {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 12px;
    border-radius: 14px;
  }

  .ik-publish-btn {
    min-width: 140px;
    height: 44px;
  }

  .ik-publish-btn__inner {
    padding: 0 22px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
