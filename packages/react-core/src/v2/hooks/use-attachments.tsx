import React, { useEffect, useRef, useState } from "react";
import {
  randomUUID,
  getModalityFromMimeType,
  exceedsMaxSize,
  readFileAsBase64,
  generateVideoThumbnail,
  matchesAcceptFilter,
  formatFileSize,
} from "@copilotkit/shared";
import type { Attachment, AttachmentsConfig } from "@copilotkit/shared";

export interface UseAttachmentsProps {
  config?: AttachmentsConfig;
}

export interface UseAttachmentsReturn {
  /** Currently selected attachments (uploading + ready). */
  attachments: Attachment[];
  /** Whether attachments are enabled. */
  enabled: boolean;
  /** Whether the user is dragging a file over the drop zone. */
  dragOver: boolean;
  /** Ref for the hidden file input element. */
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  /** Ref for the container element (used for scoped paste handling). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Process an array of files (validate, upload, add to state). */
  processFiles: (files: File[]) => Promise<void>;
  /** Handler for `<input type="file" onChange>`. */
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  /** Handler for `onDragOver` on the drop zone. */
  handleDragOver: (e: React.DragEvent) => void;
  /** Handler for `onDragLeave` on the drop zone. */
  handleDragLeave: (e: React.DragEvent) => void;
  /** Handler for `onDrop` on the drop zone. */
  handleDrop: (e: React.DragEvent) => Promise<void>;
  /** Remove an attachment by ID. */
  removeAttachment: (id: string) => void;
  /**
   * Consume ready attachments and clear the queue.
   * Returns the attachments that were ready; resets the file input.
   */
  consumeAttachments: () => Attachment[];
}

export function useAttachments({
  config,
}: UseAttachmentsProps): UseAttachmentsReturn {
  const enabled = config?.enabled ?? false;
  const accept = config?.accept ?? "*/*";
  const maxSize = config?.maxSize ?? 20 * 1024 * 1024;

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const processFilesRef = useRef<(files: File[]) => Promise<void>>(
    async () => {},
  );

  const processFiles = async (files: File[]) => {
    const rejectedFiles = files.filter(
      (file) => !matchesAcceptFilter(file, accept),
    );
    for (const file of rejectedFiles) {
      config?.onUploadFailed?.({
        reason: "invalid-type",
        file,
        message: `File "${file.name}" is not accepted. Supported types: ${accept}`,
      });
    }

    const validFiles = files.filter((file) =>
      matchesAcceptFilter(file, accept),
    );

    for (const file of validFiles) {
      if (exceedsMaxSize(file, maxSize)) {
        config?.onUploadFailed?.({
          reason: "file-too-large",
          file,
          message: `File "${file.name}" exceeds the maximum size of ${formatFileSize(maxSize)}`,
        });
        continue;
      }

      const modality = getModalityFromMimeType(file.type);
      const placeholderId = randomUUID();
      const placeholder: Attachment = {
        id: placeholderId,
        type: modality,
        source: { type: "data", value: "", mimeType: file.type },
        filename: file.name,
        size: file.size,
        status: "uploading",
      };

      setAttachments((prev) => [...prev, placeholder]);

      try {
        let source: Attachment["source"];
        let uploadMetadata: Record<string, unknown> | undefined;

        if (config?.onUpload) {
          const { metadata: meta, ...uploadSource } =
            await config.onUpload(file);
          source = uploadSource;
          uploadMetadata = meta;
        } else {
          const base64 = await readFileAsBase64(file);
          source = { type: "data", value: base64, mimeType: file.type };
        }

        let thumbnail: string | undefined;
        if (modality === "video") {
          thumbnail = await generateVideoThumbnail(file);
        }

        setAttachments((prev) =>
          prev.map((att) =>
            att.id === placeholderId
              ? {
                  ...att,
                  source,
                  status: "ready" as const,
                  thumbnail,
                  metadata: uploadMetadata,
                }
              : att,
          ),
        );
      } catch (error) {
        setAttachments((prev) =>
          prev.filter((att) => att.id !== placeholderId),
        );
        console.error(`[CopilotKit] Failed to upload "${file.name}":`, error);
        config?.onUploadFailed?.({
          reason: "upload-failed",
          file,
          message:
            error instanceof Error
              ? error.message
              : `Failed to upload "${file.name}"`,
        });
      }
    }
  };
  processFilesRef.current = processFiles;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    try {
      await processFiles(Array.from(e.target.files));
    } catch (error) {
      console.error("[CopilotKit] Upload error:", error);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!enabled) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      try {
        await processFiles(files);
      } catch (error) {
        console.error("[CopilotKit] Drop error:", error);
      }
    }
  };

  // Clipboard paste handler — scoped to the container
  useEffect(() => {
    if (!enabled) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !containerRef.current?.contains(target)) return;

      const items = Array.from(e.clipboardData?.items || []);
      const fileItems = items.filter(
        (item) =>
          item.kind === "file" &&
          item.getAsFile() !== null &&
          matchesAcceptFilter(item.getAsFile()!, accept),
      );

      if (fileItems.length === 0) return;
      e.preventDefault();

      const files = fileItems
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);

      try {
        await processFilesRef.current(files);
      } catch (error) {
        console.error("[CopilotKit] Paste error:", error);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [enabled, accept]);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const consumeAttachments = () => {
    const ready = attachments.filter((a) => a.status === "ready");
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    return ready;
  };

  return {
    attachments,
    enabled,
    dragOver,
    fileInputRef,
    containerRef,
    processFiles,
    handleFileUpload,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    consumeAttachments,
  };
}
