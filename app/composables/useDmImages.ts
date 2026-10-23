import { computed, onBeforeUnmount, ref } from "vue";
import { useMessage } from "zenless-ui";
import type { UploadedFile, UploadTask } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import { isAllowedImage, MAX_IMAGE_SIZE } from "~/utils/upload";

/** 一条私信最多几张图（与后端 MSG-030 一致） */
export const DM_MAX_IMAGES = 4;

const revoke = (url: string) => {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
};

/**
 * AI 私信的附图：和评论一样走图片弹窗（PostImagePickerModal）——上传新图或从「我的图库」里挑；
 * 粘贴截图直接上传。发送时带上媒体 id。
 * 只有 AI 会话能发图（真人私信不支持图片），由调用方决定是否展示入口。
 */
export function useDmImages() {
  const api = useApi();
  const message = useMessage();
  const tasks = ref<UploadTask[]>([]);
  const showPicker = ref(false);

  /** 已附上的图（图库里挑的、上传完成的），弹窗里据此标「已添加」 */
  const existingIds = computed(() =>
    tasks.value.map((t) => t.serverId).filter((id): id is string => !!id),
  );
  const remaining = computed(() => Math.max(0, DM_MAX_IMAGES - tasks.value.length));

  const uploading = computed(() =>
    tasks.value.some((t) => t.status === "pending" || t.status === "compressing" || t.status === "uploading"),
  );
  const imageIds = computed(() =>
    tasks.value.filter((t) => t.status === "done" && t.serverId).map((t) => t.serverId!),
  );

  async function upload(task: UploadTask) {
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
    } catch (err) {
      task.status = "error";
      task.error = resolveErrorMessage(err, "上传失败");
    }
  }

  function add(files: File[]) {
    const remaining = DM_MAX_IMAGES - tasks.value.length;
    if (remaining <= 0) {
      message.warning(`一条消息最多 ${DM_MAX_IMAGES} 张图片`);
      return;
    }
    const valid = files.filter((file) => {
      if (!isAllowedImage(file.name)) {
        message.error("仅支持 JPG、PNG、GIF、WEBP、AVIF 格式");
        return false;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        message.error(`图片 ${file.name} 超过 30MB`);
        return false;
      }
      return true;
    });
    if (valid.length > remaining) message.warning(`一条消息最多 ${DM_MAX_IMAGES} 张图片`);
    for (const file of valid.slice(0, remaining)) {
      tasks.value.push({
        localId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        filename: file.name,
        file,
        status: "pending",
        progress: 0,
        previewUrl: URL.createObjectURL(file),
      });
      void upload(tasks.value[tasks.value.length - 1]!);
    }
  }

  function openPicker() {
    if (remaining.value <= 0) {
      message.warning(`一条消息最多 ${DM_MAX_IMAGES} 张图片`);
      return;
    }
    showPicker.value = true;
  }

  /** 从图库里挑的图：已经在服务端，直接算上传完成 */
  function select(uploads: UploadedFile[]) {
    const existing = new Set(existingIds.value);
    const picked = uploads
      .filter((u) => u.documentId && u.url && !existing.has(u.documentId))
      .slice(0, remaining.value);
    if (!picked.length) {
      message.warning("没有可添加的图片");
      return;
    }
    for (const upload of picked) {
      tasks.value.push({
        localId: `gallery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        filename: upload.name || upload.url.split("/").pop() || "image",
        file: new File([], upload.name || "image"),
        status: "done",
        progress: 100,
        previewUrl: upload.url,
        serverId: upload.documentId,
        serverUrl: upload.url,
      });
    }
  }

  /** 弹窗里从图库删掉了某张图：已附上的也一并移除 */
  function removeByServerId(serverId: string) {
    const index = tasks.value.findIndex((t) => t.serverId === serverId);
    if (index !== -1) remove(index);
  }

  function retry(index: number) {
    const task = tasks.value[index];
    if (!task || task.status !== "error") return;
    task.error = undefined;
    void upload(task);
  }

  function remove(index: number) {
    const task = tasks.value[index];
    if (!task) return;
    revoke(task.previewUrl);
    tasks.value.splice(index, 1);
  }

  function clear() {
    for (const task of tasks.value) revoke(task.previewUrl);
    tasks.value = [];
    showPicker.value = false;
  }

  onBeforeUnmount(clear);

  return {
    tasks,
    uploading,
    imageIds,
    showPicker,
    existingIds,
    remaining,
    openPicker,
    add,
    select,
    retry,
    remove,
    removeByServerId,
    clear,
  };
}
