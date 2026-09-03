import React, { useCallback, useEffect, useRef, useState } from "react";
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

const DEFAULT_MAX_SIZE = 20 * 1024 * 1024;

/**
 * How many uploads run at once when `maxConcurrentUploads` is unset. Three keeps
 * a multi-file selection quick without opening a connection per file.
 */
const DEFAULT_MAX_CONCURRENT_UPLOADS = 3;

/**
 * At least one upload at a time, whole files only; `NaN` or a non-number falls back to the
 * default, and `Infinity` means "no limit" — bounded in practice by how many files are queued.
 */
function resolveMaxConcurrentUploads(configured: number | undefined): number {
  if (typeof configured !== "number" || Number.isNaN(configured)) {
    return DEFAULT_MAX_CONCURRENT_UPLOADS;
  }
  return Math.max(1, Math.floor(configured));
}

/** One file waiting for, or holding, an upload slot. */
interface QueuedUpload {
  file: File;
  placeholder: Attachment;
  /** The config as it was when this file was picked, so a later config change can't retarget it. */
  cfg: AttachmentsConfig | undefined;
  /** Resolves the `processFiles` call that queued this file once the upload has settled. */
  settle: () => void;
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
   * No-ops if the queue is already empty (no state update triggered).
   */
  consumeAttachments: () => Attachment[];
}

/**
 * Hook that manages file attachment state — uploads, drag-and-drop, paste,
 * and lifecycle. All returned callbacks are referentially stable across
 * renders (via useCallback) to avoid destabilizing downstream memoization.
 */
export function useAttachments({
  config,
}: UseAttachmentsProps): UseAttachmentsReturn {
  const enabled = config?.enabled ?? false;

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep refs to the latest values so stable callbacks can read current
  // state without appearing in dependency arrays.
  const configRef = useRef(config);
  configRef.current = config;
  const attachmentsRef = useRef<Attachment[]>([]);
  attachmentsRef.current = attachments;

  // The upload queue is the hook's, not one `processFiles` call's, so a paste landing while a
  // drop is still uploading shares the same slots instead of opening its own set.
  const uploadQueueRef = useRef<QueuedUpload[]>([]);
  const activeWorkersRef = useRef(0);

  // Upload one queued file and settle its placeholder: the source it uploaded to on success,
  // gone from the queue on failure. Resolves either way, so one bad file among many neither
  // rejects nor stops the rest.
  const uploadFile = useCallback(
    async (
      file: File,
      placeholder: Attachment,
      cfg: AttachmentsConfig | undefined,
    ) => {
      try {
        let source: Attachment["source"];
        let uploadMetadata: Record<string, unknown> | undefined;

        if (cfg?.onUpload) {
          const { metadata: meta, ...uploadSource } = await cfg.onUpload(file);
          source = uploadSource;
          uploadMetadata = meta;
        } else {
          const base64 = await readFileAsBase64(file);
          source = { type: "data", value: base64, mimeType: file.type };
        }

        let thumbnail: string | undefined;
        if (placeholder.type === "video") {
          thumbnail = await generateVideoThumbnail(file);
        }

        setAttachments((prev) =>
          prev.map((att) =>
            att.id === placeholder.id
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
          prev.filter((att) => att.id !== placeholder.id),
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
    },
    [],
  );

  // One worker: take the next queued file, upload it, repeat until the queue is empty, then
  // give the slot back. Workers are counted rather than owned by a call, which is what keeps
  // the limit global.
  const drainUploadQueue = useCallback(async () => {
    activeWorkersRef.current++;
    try {
      for (;;) {
        const item = uploadQueueRef.current.shift();
        if (!item) return;
        try {
          await uploadFile(item.file, item.placeholder, item.cfg);
        } catch (error) {
          // `uploadFile` reports its own failures; this is the belt for an unexpected throw,
          // so one file can't strand everything queued behind it.
          console.error("[CopilotKit] Upload worker error:", error);
        } finally {
          item.settle();
        }
      }
    } finally {
      activeWorkersRef.current--;
    }
  }, [uploadFile]);

  // Stable processFiles — reads config from ref, never changes identity
  const processFiles = useCallback(
    async (files: File[]) => {
      const cfg = configRef.current;
      const accept = cfg?.accept ?? "*/*";
      const maxSize = cfg?.maxSize ?? DEFAULT_MAX_SIZE;

      const rejectedFiles = files.filter(
        (file) => !matchesAcceptFilter(file, accept),
      );
      for (const file of rejectedFiles) {
        cfg?.onUploadFailed?.({
          reason: "invalid-type",
          file,
          message: `File "${file.name}" is not accepted. Supported types: ${accept}`,
        });
      }

      const validFiles = files.filter((file) =>
        matchesAcceptFilter(file, accept),
      );

      const queued: { file: File; placeholder: Attachment }[] = [];
      for (const file of validFiles) {
        if (exceedsMaxSize(file, maxSize)) {
          cfg?.onUploadFailed?.({
            reason: "file-too-large",
            file,
            message: `File "${file.name}" exceeds the maximum size of ${formatFileSize(maxSize)}`,
          });
          continue;
        }

        queued.push({
          file,
          placeholder: {
            id: randomUUID(),
            type: getModalityFromMimeType(file.type),
            source: { type: "data", value: "", mimeType: file.type },
            filename: file.name,
            size: file.size,
            status: "uploading",
          },
        });
      }

      if (queued.length === 0) return;

      // The whole selection joins the queue at once, in the order it was picked, so a file
      // waiting for a free slot is already visible rather than appearing later.
      setAttachments((prev) => [...prev, ...queued.map((q) => q.placeholder)]);

      // Hand the files to the shared queue, each with the promise this call waits on, so
      // `processFiles` still resolves when its own files have settled and no sooner.
      const settled = queued.map(
        ({ file, placeholder }) =>
          new Promise<void>((resolve) => {
            uploadQueueRef.current.push({
              file,
              placeholder,
              cfg,
              settle: resolve,
            });
          }),
      );

      // Top the pool up to the limit rather than starting a fresh one: whatever is already
      // draining counts against it, so overlapping selections never exceed the limit together.
      const limit = resolveMaxConcurrentUploads(cfg?.maxConcurrentUploads);
      const toSpawn = Math.min(
        uploadQueueRef.current.length,
        Math.max(0, limit - activeWorkersRef.current),
      );
      for (let i = 0; i < toSpawn; i++) {
        void drainUploadQueue();
      }

      await Promise.all(settled);
    },
    [drainUploadQueue],
  );

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      try {
        await processFiles(Array.from(e.target.files));
      } catch (error) {
        console.error("[CopilotKit] Upload error:", error);
      }
    },
    [processFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!configRef.current?.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (!configRef.current?.enabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        try {
          await processFiles(files);
        } catch (error) {
          console.error("[CopilotKit] Drop error:", error);
        }
      }
    },
    [processFiles],
  );

  // Clipboard paste handler — scoped to the container
  useEffect(() => {
    if (!enabled) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !containerRef.current?.contains(target)) return;

      const accept = configRef.current?.accept ?? "*/*";
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
        await processFiles(files);
      } catch (error) {
        console.error("[CopilotKit] Paste error:", error);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [enabled, processFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const consumeAttachments = useCallback(() => {
    const ready = attachmentsRef.current.filter((a) => a.status === "ready");
    if (ready.length === 0) return ready;
    setAttachments((prev) => prev.filter((a) => a.status !== "ready"));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    return ready;
  }, []);

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
