export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
]);

export function isAllowedImage(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ALLOWED_IMAGE_EXTENSIONS.has(ext);
}
