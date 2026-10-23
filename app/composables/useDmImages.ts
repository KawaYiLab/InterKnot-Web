import { computed, onBeforeUnmount, ref } from "vue";
import { useMessage } from "zenless-ui";
import type { UploadTask } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import { isAllowedImage, MAX_IMAGE_SIZE } from "~/utils/upload";

/** 一条私信最多几张图（与后端 MSG-030 一致） */
export const DM_MAX_IMAGES = 4;

const revoke = (url: string) => {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
};

/**
 * AI 私信的附图：选图 / 粘贴即上传到自己的图库，发送时带上媒体 id。
 * 只有 AI 会话能发图（真人私信不支持图片），由调用方决定是否展示入口。
 */
export function useDmImages() {
  const api = useApi();
  const message = useMessage();
  const tasks = ref<UploadTask[]>([]);

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
  }

  onBeforeUnmount(clear);

  return { tasks, uploading, imageIds, add, retry, remove, clear };
}
