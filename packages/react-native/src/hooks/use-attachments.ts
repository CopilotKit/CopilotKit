// packages/react-native/src/hooks/use-attachments.ts
import { useCallback, useRef, useState } from "react";
import {
  randomUUID,
  getModalityFromMimeType,
  formatFileSize,
} from "@copilotkit/shared";
import type {
  Attachment,
  AttachmentUploadResult,
  AttachmentUploadErrorReason,
} from "@copilotkit/shared";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Platform-neutral file descriptor for React Native.
 * Replaces the web `File` object in all attachment APIs.
 */
export interface NativeFileInput {
  /** Local file URI (e.g. `file:///path/to/file`). */
  uri: string;
  /** Filename with extension. */
  name: string;
  /** File size in bytes. */
  size: number;
  /** MIME type (e.g. `"image/jpeg"`). */
  mimeType: string;
}

/**
 * React Native variant of AttachmentsConfig.
 * Identical to the shared AttachmentsConfig except `onUpload` receives
 * a `NativeFileInput` instead of a web `File`.
 */
export interface NativeAttachmentsConfig {
  /** Enable file attachments in the chat input. */
  enabled: boolean;
  /** MIME type filter for the file picker, default all files. */
  accept?: string;
  /** Maximum file size in bytes, default 20MB (20 * 1024 * 1024). */
  maxSize?: number;
  /** Custom upload handler. Receives the native file descriptor. */
  onUpload?: (
    file: NativeFileInput,
  ) => AttachmentUploadResult | Promise<AttachmentUploadResult>;
  /** Called when an attachment fails validation or upload. */
  onUploadFailed?: (error: {
    reason: AttachmentUploadErrorReason;
    file: NativeFileInput;
    message: string;
  }) => void;
}

export interface UseNativeAttachmentsProps {
  config?: NativeAttachmentsConfig;
}

export interface UseNativeAttachmentsReturn {
  /** Currently selected attachments (uploading + ready). */
  attachments: Attachment[];
  /** Whether attachments are enabled. */
  enabled: boolean;
  /** Open the native document picker. */
  openPicker: () => Promise<void>;
  /** Process an array of NativeFileInput objects (validate, read, add to state). */
  processFiles: (files: NativeFileInput[]) => Promise<void>;
  /** Remove an attachment by ID. */
  removeAttachment: (id: string) => void;
  /** Consume ready attachments and clear the queue. Returns the consumed attachments. */
  consumeAttachments: () => Attachment[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SIZE = 20 * 1024 * 1024; // 20 MB

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React Native hook that manages file attachment state -- picking, uploading,
 * and lifecycle. All returned callbacks are referentially stable via useCallback.
 *
 * This is the RN counterpart of the web `useAttachments` hook from
 * `@copilotkit/react-core`. It replaces web APIs (FileReader, DragEvent,
 * HTMLInputElement) with Expo modules (expo-document-picker, expo-file-system).
 */
export function useAttachments({
  config,
}: UseNativeAttachmentsProps): UseNativeAttachmentsReturn {
  const enabled = config?.enabled ?? false;

  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Refs for stable callbacks to read latest values
  const configRef = useRef(config);
  configRef.current = config;
  const attachmentsRef = useRef<Attachment[]>([]);
  attachmentsRef.current = attachments;

  /**
   * Simple MIME accept filter for NativeFileInput.
   * Handles wildcards like "image/*" and exact types like "application/pdf".
   * Comma-separated lists are supported.
   */
  const matchesAccept = useCallback(
    (file: NativeFileInput, accept: string): boolean => {
      if (!accept || accept === "*/*") return true;
      const filters = accept.split(",").map((f) => f.trim());
      return filters.some((filter) => {
        if (filter.startsWith(".")) {
          return file.name.toLowerCase().endsWith(filter.toLowerCase());
        }
        if (filter.endsWith("/*")) {
          const prefix = filter.slice(0, -2);
          return file.mimeType.startsWith(prefix + "/");
        }
        return file.mimeType === filter;
      });
    },
    [],
  );

  const processFiles = useCallback(
    async (files: NativeFileInput[]) => {
      const cfg = configRef.current;
      const accept = cfg?.accept ?? "*/*";
      const maxSize = cfg?.maxSize ?? DEFAULT_MAX_SIZE;

      // Filter by accept type
      const rejectedFiles = files.filter((f) => !matchesAccept(f, accept));
      for (const file of rejectedFiles) {
        cfg?.onUploadFailed?.({
          reason: "invalid-type",
          file,
          message: `File "${file.name}" is not accepted. Supported types: ${accept}`,
        });
      }

      const validFiles = files.filter((f) => matchesAccept(f, accept));

      for (const file of validFiles) {
        // Size check
        if (file.size > maxSize) {
          cfg?.onUploadFailed?.({
            reason: "file-too-large",
            file,
            message: `File "${file.name}" exceeds the maximum size of ${formatFileSize(maxSize)}`,
          });
          continue;
        }

        const modality = getModalityFromMimeType(file.mimeType);
        const placeholderId = randomUUID();
        const placeholder: Attachment = {
          id: placeholderId,
          type: modality,
          source: { type: "data", value: "", mimeType: file.mimeType },
          filename: file.name,
          size: file.size,
          status: "uploading",
        };

        setAttachments((prev) => [...prev, placeholder]);

        try {
          let source: Attachment["source"];
          let uploadMetadata: Record<string, unknown> | undefined;

          if (cfg?.onUpload) {
            const { metadata: meta, ...uploadSource } =
              await cfg.onUpload(file);
            source = uploadSource;
            uploadMetadata = meta;
          } else {
            // Default: read file as base64 via expo-file-system
            const base64 = await FileSystem.readAsStringAsync(file.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            source = { type: "data", value: base64, mimeType: file.mimeType };
          }

          setAttachments((prev) =>
            prev.map((att) =>
              att.id === placeholderId
                ? {
                    ...att,
                    source,
                    status: "ready" as const,
                    metadata: uploadMetadata,
                  }
                : att,
            ),
          );
        } catch (error) {
          // Remove placeholder on failure
          setAttachments((prev) =>
            prev.filter((att) => att.id !== placeholderId),
          );
          console.error(`[CopilotKit] Failed to upload "${file.name}":`, error);
          cfg?.onUploadFailed?.({
            reason: "upload-failed",
            file,
            message:
              error instanceof Error
                ? error.message
                : `Failed to upload "${file.name}"`,
          });
        }
      }
    },
    [matchesAccept],
  );

  const openPicker = useCallback(async () => {
    const cfg = configRef.current;
    const accept = cfg?.accept ?? "*/*";

    // Convert accept string to array for DocumentPicker
    const typeArray = accept
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: typeArray.length > 0 ? typeArray : ["*/*"],
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const nativeFiles: NativeFileInput[] = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name ?? "unknown",
        size: asset.size ?? 0,
        mimeType: asset.mimeType ?? "application/octet-stream",
      }));

      await processFiles(nativeFiles);
    } catch (error) {
      console.error("[CopilotKit] Document picker error:", error);
    }
  }, [processFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const consumeAttachments = useCallback(() => {
    const ready = attachmentsRef.current.filter((a) => a.status === "ready");
    if (ready.length === 0) return ready;
    setAttachments((prev) => prev.filter((a) => a.status !== "ready"));
    return ready;
  }, []);

  return {
    attachments,
    enabled,
    openPicker,
    processFiles,
    removeAttachment,
    consumeAttachments,
  };
}
