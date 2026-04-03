import type { AttachmentModality } from "./props";

const DEFAULT_MAX_SIZE = 20 * 1024 * 1024; // 20MB

// ---------------------------------------------------------------------------
// Deprecation warning helpers
// ---------------------------------------------------------------------------

const suppressedWarnings = new Set<string>();
let globalSuppress = false;

/**
 * Issue a deprecation warning once per key per session.
 * Suppressed entirely if the user calls suppressDeprecationWarnings().
 */
export function deprecationWarning(key: string, message: string) {
  if (globalSuppress || suppressedWarnings.has(key)) return;
  if (process.env.NODE_ENV === "production") return;
  suppressedWarnings.add(key);
  console.warn(`[CopilotKit] Deprecation: ${message}`);
}

/**
 * Suppress all CopilotKit deprecation warnings.
 */
export function suppressDeprecationWarnings() {
  globalSuppress = true;
}

/**
 * Derive the attachment modality from a MIME type string.
 */
export function getModalityFromMimeType(mimeType: string): AttachmentModality {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

/**
 * Format a byte count as a human-readable file size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if a file exceeds the maximum allowed size.
 */
export function exceedsMaxSize(
  file: File,
  maxSize: number = DEFAULT_MAX_SIZE,
): boolean {
  return file.size > maxSize;
}

/**
 * Read a File as a base64 string (without the data URL prefix).
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      const base64 = result?.split(",")[1];
      if (base64) {
        resolve(base64);
      } else {
        reject(new Error("Failed to read file as base64"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Generate a thumbnail data URL from a video file by capturing the first frame.
 * Returns undefined if thumbnail generation fails.
 */
export function generateVideoThumbnail(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const url = URL.createObjectURL(file);

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const thumbnail = canvas.toDataURL("image/jpeg", 0.7);
        resolve(thumbnail);
      } else {
        resolve(undefined);
      }
      URL.revokeObjectURL(url);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };

    video.src = url;
  });
}

/**
 * Check if a file's MIME type matches an accept filter string.
 * Handles wildcards like "image/*" and comma-separated lists.
 */
export function matchesAcceptFilter(
  file: File,
  accept: string,
): boolean {
  if (accept === "*/*") return true;

  const filters = accept.split(",").map((f) => f.trim());
  return filters.some((filter) => {
    if (filter.endsWith("/*")) {
      const prefix = filter.slice(0, -2);
      return file.type.startsWith(prefix + "/");
    }
    return file.type === filter;
  });
}
