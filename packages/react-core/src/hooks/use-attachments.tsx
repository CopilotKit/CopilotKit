import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ɵAttachmentQueue } from "@copilotkit/core";
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
  /** Process an array of files (validate, upload, add to state). No-op while attachments are disabled. */
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
 * and lifecycle. The queue itself (validation, uploads, ready state) lives in
 * `@copilotkit/core`'s `ɵAttachmentQueue`; this hook adds the DOM wiring. All
 * returned callbacks are referentially stable across renders.
 */
export function useAttachments({
  config,
}: UseAttachmentsProps): UseAttachmentsReturn {
  const enabled = config?.enabled ?? false;

  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep a ref to the latest config so the queue and stable callbacks read it
  // without appearing in dependency arrays.
  const configRef = useRef(config);
  configRef.current = config;

  const [queue] = useState(() => new ɵAttachmentQueue(() => configRef.current));
  const attachments = useSyncExternalStore(
    useCallback((onChange) => queue.subscribe(onChange), [queue]),
    () => queue.getSnapshot(),
    () => queue.getSnapshot(),
  );

  const processFiles = useCallback(
    (files: File[]) => queue.processFiles(files),
    [queue],
  );

  const processSafely = useCallback(
    async (files: File[], label: string) => {
      try {
        await queue.processFiles(files);
      } catch (error) {
        console.error(`[CopilotKit] ${label}:`, error);
      }
    },
    [queue],
  );

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      if (!input.files?.length) return;
      await processSafely(Array.from(input.files), "Upload error");
      // Clear the picker so choosing the same file again fires `change`.
      input.value = "";
    },
    [processSafely],
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
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) await processSafely(files, "Drop error");
    },
    [processSafely],
  );

  // Clipboard paste handler — scoped to the container
  useEffect(() => {
    if (!enabled) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target;
      if (!(target instanceof Node) || !containerRef.current?.contains(target))
        return;
      const files = queue.filterPastedFiles(
        Array.from(e.clipboardData?.items ?? []),
      );
      if (files.length === 0) return;
      e.preventDefault();
      await processSafely(files, "Paste error");
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [enabled, queue, processSafely]);

  const removeAttachment = useCallback(
    (id: string) => queue.remove(id),
    [queue],
  );

  const consumeAttachments = useCallback(() => {
    const ready = queue.consumeReady();
    if (ready.length > 0 && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    return ready;
  }, [queue]);

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
