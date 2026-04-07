import type { AttachmentModality } from "./types";
import type { InputContentSource } from "../types/message";

const DEFAULT_MAX_SIZE = 20 * 1024 * 1024; // 20MB

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
 * Generate a thumbnail data URL from a video file by capturing a frame near the start (at 0.1s).
 * Returns undefined if thumbnail generation fails or if called outside a browser environment.
 */
export function generateVideoThumbnail(
  file: File,
): Promise<string | undefined> {
  if (typeof document === "undefined") {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    let resolved = false;
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const url = URL.createObjectURL(file);

    const cleanup = (result: string | undefined) => {
      if (resolved) return;
      resolved = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      console.warn(
        `[CopilotKit] generateVideoThumbnail: timed out for file "${file.name}"`,
      );
      cleanup(undefined);
    }, 10000);

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      clearTimeout(timeout);
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const thumbnail = canvas.toDataURL("image/jpeg", 0.7);
        cleanup(thumbnail);
      } else {
        console.warn(
          "[CopilotKit] generateVideoThumbnail: could not get 2d canvas context",
        );
        cleanup(undefined);
      }
    };

    video.onerror = () => {
      clearTimeout(timeout);
      console.warn(
        `[CopilotKit] generateVideoThumbnail: video element error for file "${file.name}"`,
      );
      cleanup(undefined);
    };

    video.src = url;
  });
}

/**
 * Check if a file's MIME type matches an accept filter string.
 * Handles file extensions (e.g. ".pdf"), MIME wildcards ("image/*"), and comma-separated lists.
 */
export function matchesAcceptFilter(file: File, accept: string): boolean {
  if (!accept || accept === "*/*") return true;

  const filters = accept.split(",").map((f) => f.trim());
  return filters.some((filter) => {
    if (filter.startsWith(".")) {
      return (file.name ?? "").toLowerCase().endsWith(filter.toLowerCase());
    }
    if (filter.endsWith("/*")) {
      const prefix = filter.slice(0, -2);
      return file.type.startsWith(prefix + "/");
    }
    return file.type === filter;
  });
}

/**
 * Convert an InputContentSource to a usable URL string.
 * For data sources, returns a base64 data URL; for URL sources, returns the URL directly.
 */
export function getSourceUrl(source: InputContentSource): string {
  if (source.type === "url") {
    return source.value;
  }
  return `data:${source.mimeType};base64,${source.value}`;
}

/**
 * Return a short human-readable label for a document MIME type (e.g. "PDF", "DOC").
 */
export function getDocumentIcon(mimeType: string): string {
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return "XLS";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint"))
    return "PPT";
  if (mimeType.includes("word") || mimeType.includes("document")) return "DOC";
  if (mimeType.includes("text/")) return "TXT";
  return "FILE";
}
