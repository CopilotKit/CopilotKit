"use client";

/**
 * Configures `useAttachments` for the headless-complete demo. Inlines
 * uploads as base64 (no external storage), accepts images and PDFs, and
 * caps each file at 20MB.
 *
 * The hook returns the full attachment pipeline: `fileInputRef` for the
 * hidden `<input type="file">`, `containerRef` for paste support,
 * drag/drop handlers, the live attachment list, plus `consumeAttachments`
 * which is called at submit time and clears the queue.
 */

import { useCallback } from "react";
import {
  useAttachments,
  type UseAttachmentsReturn,
} from "@copilotkit/react-core/v2";
import type { AttachmentUploadResult } from "@copilotkit/shared";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ACCEPT_MIME = "image/*,application/pdf";

export function useAttachmentsConfig(): UseAttachmentsReturn {
  const onUpload = useCallback(fileToBase64, []);

  return useAttachments({
    config: {
      enabled: true,
      accept: ACCEPT_MIME,
      maxSize: MAX_FILE_SIZE_BYTES,
      onUpload,
      onUploadFailed: (err) => {
        console.warn("[headless-complete] attachment rejected", err);
      },
    },
  });
}

function fileToBase64(file: File): Promise<AttachmentUploadResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error(`FileReader failed for ${file.name}`));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error(`Unexpected FileReader result for ${file.name}`));
        return;
      }
      const commaIdx = result.indexOf(",");
      const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({
        type: "data",
        value: base64,
        mimeType: file.type || "application/octet-stream",
        metadata: { filename: file.name, size: file.size },
      });
    };
    reader.readAsDataURL(file);
  });
}
