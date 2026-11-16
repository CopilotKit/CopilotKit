import { readFileAsBase64 } from "@copilotkit/shared";
import type { AttachmentUploadResult } from "@copilotkit/shared";

/**
 * The chat's `onUpload` for this demo. It inlines the file as base64 with the
 * browser's MIME type, instead of uploading it to storage. The chat's
 * `maxSize` caps how large the inlined file can be.
 */
export async function fileToDataAttachment(file: File) {
  return {
    type: "data",
    value: await readFileAsBase64(file),
    mimeType: file.type || "application/octet-stream",
    metadata: {
      filename: file.name,
      size: file.size,
    },
  } satisfies AttachmentUploadResult;
}
