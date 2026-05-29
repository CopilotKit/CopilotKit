import type { AttachmentUploadResult } from "@copilotkit/shared";

/**
 * `onUpload` must resolve to an `AttachmentUploadResult` (data or url). We
 * always return the `data` variant — the demo inlines base64 instead of
 * uploading to external storage, matching the Wave 2b spec.
 */
type DataUploadResult = Extract<AttachmentUploadResult, { type: "data" }>;

/**
 * Convert a File into the `AttachmentsConfig.onUpload` result shape —
 * inline base64 with the browser-provided mime type. We do this in the
 * browser rather than uploading to external storage because Wave 2b is a
 * self-contained demo; `maxSize: 10 MB` (set below) caps bloat.
 *
 * `FileReader` produces a `data:<mime>;base64,<payload>` URL; we strip the
 * prefix so the runtime forwards the raw base64 value (what the agent
 * expects in `source.value`).
 */
export function fileToDataAttachment(file: File): Promise<DataUploadResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error(`FileReader failed for ${file.name}`));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error(`Unexpected FileReader result type for ${file.name}`));
        return;
      }
      // result looks like "data:image/png;base64,iVBORw0K..." — strip the prefix.
      const commaIdx = result.indexOf(",");
      const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({
        type: "data",
        value: base64,
        mimeType: file.type || "application/octet-stream",
        metadata: {
          filename: file.name,
          size: file.size,
        },
      });
    };
    reader.readAsDataURL(file);
  });
}
