// packages/react-native/src/hooks/use-attachments.ts
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { ɵAttachmentQueue } from "@copilotkit/core";
import type {
  Attachment,
  AttachmentsConfig,
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
// Queue adapter
// ---------------------------------------------------------------------------

/**
 * The queue's view of a picked file: the `name`, `size` and `type` it reads to
 * validate the file and to draw its placeholder.
 */
interface QueuedNativeFile {
  name: string;
  size: number;
  type: string;
}

// The native descriptor behind each file the queue holds, so the app's
// callbacks get the `NativeFileInput` they were typed for.
const nativeFiles = new WeakMap<QueuedNativeFile, NativeFileInput>();

/**
 * Wraps a native file for core's `ɵAttachmentQueue`, which is typed for the
 * web `File`. The queue reads only `name`, `size` and `type`, because the
 * config from {@link toQueueConfig} always uploads through `onUpload` and the
 * queue never reads the bytes itself.
 */
function toQueueFile(file: NativeFileInput) {
  const queued: QueuedNativeFile = {
    name: file.name,
    size: file.size,
    type: file.mimeType,
  };
  nativeFiles.set(queued, file);
  return queued as unknown as File;
}

function toNativeFile(file: File) {
  const native = nativeFiles.get(file as unknown as QueuedNativeFile);
  if (!native) {
    throw new Error(`[CopilotKit] "${file.name}" was not picked natively`);
  }
  return native;
}

/** Reads a picked file as base64 with expo-file-system. */
async function readNativeFile(file: NativeFileInput) {
  const value = await FileSystem.readAsStringAsync(file.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { type: "data" as const, value, mimeType: file.mimeType };
}

/**
 * The RN config as core's queue takes it. Uploads go through the app's
 * `onUpload`, or through expo-file-system when there is none.
 */
function toQueueConfig(
  config: NativeAttachmentsConfig | undefined,
): AttachmentsConfig | undefined {
  if (!config) return undefined;
  const { onUpload, onUploadFailed, ...rest } = config;
  return {
    ...rest,
    onUpload: (file) => {
      const native = toNativeFile(file);
      return onUpload ? onUpload(native) : readNativeFile(native);
    },
    onUploadFailed: onUploadFailed
      ? ({ file, ...error }) =>
          onUploadFailed({ ...error, file: toNativeFile(file) })
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React Native hook that manages file attachment state -- picking, uploading,
 * and lifecycle. All returned callbacks are referentially stable.
 *
 * The queue itself (accept filter, size check, uploads, ready state) is
 * `@copilotkit/core`'s `ɵAttachmentQueue`, shared with the web chats. This
 * hook adds the native glue: expo-document-picker to pick files and
 * expo-file-system to read them.
 */
export function useAttachments({
  config,
}: UseNativeAttachmentsProps): UseNativeAttachmentsReturn {
  const enabled = config?.enabled ?? false;

  // The queue reads the latest config on every action.
  const configRef = useRef(config);
  configRef.current = config;

  const [queue] = useState(
    () => new ɵAttachmentQueue(() => toQueueConfig(configRef.current)),
  );
  const attachments = useSyncExternalStore(
    useCallback((onChange) => queue.subscribe(onChange), [queue]),
    () => queue.getSnapshot(),
    () => queue.getSnapshot(),
  );

  const processFiles = useCallback(
    (files: NativeFileInput[]) => queue.processFiles(files.map(toQueueFile)),
    [queue],
  );

  const openPicker = useCallback(async () => {
    const accept = configRef.current?.accept ?? "*/*";

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

      const pickedFiles: NativeFileInput[] = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name ?? "unknown",
        size: asset.size ?? 0,
        mimeType: asset.mimeType ?? "application/octet-stream",
      }));

      await processFiles(pickedFiles);
    } catch (error) {
      console.error("[CopilotKit] Document picker error:", error);
    }
  }, [processFiles]);

  const removeAttachment = useCallback(
    (id: string) => queue.remove(id),
    [queue],
  );

  const consumeAttachments = useCallback(() => queue.consumeReady(), [queue]);

  return {
    attachments,
    enabled,
    openPicker,
    processFiles,
    removeAttachment,
    consumeAttachments,
  };
}
