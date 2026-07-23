import { computed, onBeforeUnmount, ref } from "vue";
import { useMessage } from "zenless-ui";
import type { UploadedFile, UploadStatus, UploadTask } from "~/types/entities";
import { resolveErrorMessage } from "~/utils/api-error";
import { isAllowedImage, MAX_IMAGE_SIZE } from "~/utils/upload";

const createUploadTask = (file: File): UploadTask => ({
  localId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  filename: file.name,
  file,
  status: "pending" as UploadStatus,
  progress: 0,
  previewUrl: URL.createObjectURL(file),
});

const createReferencedUploadTask = (upload: UploadedFile): UploadTask => {
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
    nsfwStatus: upload.nsfwStatus,
  };
};

const safeRevokeObjectUrl = (url: string) => {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
};

export function useCommentImages() {
  const api = useApi();
  const message = useMessage();
  // 等级权益：评论图片数上限随等级变化
  const { commentMaxImages: maxCommentImages } = useBenefits();
  const uploadTasks = ref<UploadTask[]>([]);
  const showImagePickerModal = ref(false);

  const existingUploadIds = computed(() =>
    uploadTasks.value
      .map((task) => task.serverId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const remainingImageSlots = computed(() =>
    Math.max(0, maxCommentImages.value - uploadTasks.value.length),
  );

  const hasPendingUploads = computed(() =>
    uploadTasks.value.some(
      (task) =>
        task.status === "pending" ||
        task.status === "compressing" ||
        task.status === "uploading",
    ),
  );

  const uploadedImageIds = computed(() =>
    uploadTasks.value
      .filter((task) => task.status === "done" && task.serverId)
      .map((task) => task.serverId!),
  );

  const hasErroredUploads = computed(() =>
    uploadTasks.value.some((task) => task.status === "error"),
  );

  const openImagePicker = () => {
    if (remainingImageSlots.value <= 0) {
      message.warning(`当前等级最多添加 ${maxCommentImages.value} 张图片，升级可提升上限`);
      return;
    }
    showImagePickerModal.value = true;
  };

  const handleImagePickerUpload = (files: File[]) => {
    handleFileSelect(files);
  };

  const handleImagePickerSelect = (uploads: UploadedFile[]) => {
    const existing = new Set(existingUploadIds.value);
    const remaining = remainingImageSlots.value;
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
  };

  async function executeUploadTask(task: UploadTask) {
    try {
      task.status = "uploading";
      task.progress = 0;

      const uploaded = await api.uploadImage(task.file, (percent) => {
        task.progress = percent;
      });

      task.serverId = uploaded.documentId;
      task.serverUrl = uploaded.url;
      task.nsfwStatus = uploaded.nsfwStatus;
      task.status = "done";
      task.progress = 100;
    } catch (err) {
      task.status = "error";
      task.error = resolveErrorMessage(err, "上传失败");
    }
  }

  function handleFileSelect(files: FileList | File[]) {
    const fileArray = Array.from(files);
    const remaining = maxCommentImages.value - uploadTasks.value.length;

    if (remaining <= 0) {
      message.error(`当前等级最多添加 ${maxCommentImages.value} 张图片，升级可提升上限`);
      return;
    }

    const valid = fileArray.filter((file) => {
      if (!isAllowedImage(file.name)) {
        message.error("仅支持 JPG、PNG、GIF、WEBP、AVIF 格式");
        return false;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        message.error(`图片 ${file.name} 超过 10MB`);
        return false;
      }
      return true;
    });

    const toUpload = valid.slice(0, remaining);
    for (const file of toUpload) {
      const task = createUploadTask(file);
      uploadTasks.value.push(task);
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
    if (!task) return;
    safeRevokeObjectUrl(task.previewUrl);
    uploadTasks.value.splice(index, 1);
  }

  function removeUploadByServerId(serverId: string) {
    const index = uploadTasks.value.findIndex((task) => task.serverId === serverId);
    if (index !== -1) removeUpload(index);
  }

  function clearUploads() {
    for (const task of uploadTasks.value) {
      safeRevokeObjectUrl(task.previewUrl);
    }
    uploadTasks.value = [];
  }

  onBeforeUnmount(() => {
    clearUploads();
  });

  return {
    maxCommentImages,
    uploadTasks,
    showImagePickerModal,
    existingUploadIds,
    remainingImageSlots,
    hasPendingUploads,
    hasErroredUploads,
    uploadedImageIds,
    openImagePicker,
    handleImagePickerUpload,
    handleImagePickerSelect,
    retryUpload,
    removeUpload,
    removeUploadByServerId,
    clearUploads,
  };
}
