import {
  randomUUID,
  getModalityFromMimeType,
  exceedsMaxSize,
  readFileAsBase64,
  generateVideoThumbnail,
  matchesAcceptFilter,
  formatFileSize,
} from "@copilotkit/shared";
import type {
  Attachment,
  AttachmentUploadResult,
  AttachmentsConfig,
} from "@copilotkit/shared";

export type AttachmentsConfigInput =
  | AttachmentsConfig
  | (() => AttachmentsConfig | undefined);

export interface CreateAttachmentsProps {
  config?: AttachmentsConfigInput;
}

function resolveInput(
  input: AttachmentsConfigInput | undefined,
): AttachmentsConfig | undefined {
  if (typeof input === "function") {
    return (input as () => AttachmentsConfig | undefined)();
  }
  return input;
}

export interface CreateAttachmentsReturn {
  attachments: Attachment[];
  enabled: boolean;
  dragOver: boolean;
  fileInputRef: HTMLInputElement | null;
  containerRef: HTMLElement | null;
  /** Assign the hidden file input (for `bind:this`-style callbacks). */
  setFileInputRef: (el: HTMLInputElement | null) => void;
  /** Assign the paste-scope container (for `bind:this`-style callbacks). */
  setContainerRef: (el: HTMLElement | null) => void;
  /** Svelte action for the hidden file input (`use:attachments.fileInputAction`). */
  fileInputAction: (node: HTMLInputElement) => { destroy: () => void };
  /** Svelte action for the paste-scope container (`use:attachments.containerAction`). */
  containerAction: (node: HTMLElement) => { destroy: () => void };
  processFiles: (files: File[]) => Promise<void>;
  handleFileUpload: (event: Event) => Promise<void>;
  handleDragOver: (event: DragEvent) => void;
  handleDragLeave: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => Promise<void>;
  removeAttachment: (id: string) => void;
  consumeAttachments: () => Attachment[];
}

export function createAttachments(
  props: CreateAttachmentsProps,
): CreateAttachmentsReturn {
  let attachments = $state<Attachment[]>([]);
  let dragOver = $state(false);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  let containerEl = $state<HTMLElement | null>(null);
  let attachmentsRef: Attachment[] = [];

  const resolvedConfig = $derived(resolveInput(props.config));
  const enabled = $derived(resolvedConfig?.enabled ?? false);

  function setFileInputRef(el: HTMLInputElement | null) {
    fileInputEl = el;
  }

  function setContainerRef(el: HTMLElement | null) {
    containerEl = el;
  }

  function fileInputAction(node: HTMLInputElement) {
    fileInputEl = node;
    return {
      destroy() {
        if (fileInputEl === node) fileInputEl = null;
      },
    };
  }

  function containerAction(node: HTMLElement) {
    containerEl = node;
    return {
      destroy() {
        if (containerEl === node) containerEl = null;
      },
    };
  }

  const setAttachments = (next: Attachment[]) => {
    attachments = next;
    attachmentsRef = next;
  };

  const updateAttachments = (
    updater: (previous: Attachment[]) => Attachment[],
  ) => {
    setAttachments(updater(attachmentsRef));
  };

  async function processFiles(files: File[]) {
    // Read the live config on every call so reactive getter updates apply
    // to in-flight UI without re-creating the hook.
    const config = resolveInput(props.config);
    const accept = config?.accept ?? "*/*";
    const maxSize = config?.maxSize ?? 20 * 1024 * 1024;

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
      updateAttachments((previous) => [
        ...previous,
        {
          id: placeholderId,
          type: modality,
          source: { type: "data", value: "", mimeType: file.type },
          filename: file.name,
          size: file.size,
          status: "uploading",
        },
      ]);

      try {
        let source: Attachment["source"];
        let uploadMetadata: Record<string, unknown> | undefined;
        if (config?.onUpload) {
          const uploadResult: AttachmentUploadResult =
            await config.onUpload(file);
          const { metadata, ...uploadSource } = uploadResult;
          source = uploadSource;
          uploadMetadata = metadata;
        } else {
          const base64 = await readFileAsBase64(file);
          source = { type: "data", value: base64, mimeType: file.type };
        }

        let thumbnail: string | undefined;
        if (modality === "video") {
          thumbnail = await generateVideoThumbnail(file);
        }

        updateAttachments((previous) =>
          previous.map((attachment) =>
            attachment.id === placeholderId
              ? {
                  ...attachment,
                  source,
                  status: "ready",
                  thumbnail,
                  metadata: uploadMetadata,
                }
              : attachment,
          ),
        );
      } catch (error) {
        updateAttachments((previous) =>
          previous.filter((a) => a.id !== placeholderId),
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
  }

  async function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement | null;
    if (!target?.files?.length) return;
    await processFiles(Array.from(target.files));
    if (target) target.value = "";
  }

  function handleDragOver(event: DragEvent) {
    if (!enabled) return;
    event.preventDefault();
    event.stopPropagation();
    dragOver = true;
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragOver = false;
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragOver = false;
    if (!enabled) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      await processFiles(files);
    }
  }

  function removeAttachment(id: string) {
    updateAttachments((previous) =>
      previous.filter((attachment) => attachment.id !== id),
    );
  }

  function consumeAttachments() {
    const ready = attachmentsRef.filter(
      (attachment) => attachment.status === "ready",
    );
    if (ready.length === 0) return ready;
    updateAttachments((previous) =>
      previous.filter((attachment) => attachment.status !== "ready"),
    );
    if (fileInputEl) {
      fileInputEl.value = "";
    }
    return ready;
  }

  async function handlePaste(event: ClipboardEvent) {
    const liveConfig = resolveInput(props.config);
    if (!(liveConfig?.enabled ?? false)) return;
    const target = event.target as HTMLElement | null;
    const scope = containerEl;
    // Paste is scoped to the composer/container: ignore pastes outside it so
    // unrelated page pastes never enqueue uploads.
    if (!target || !scope?.contains(target)) return;
    const accept = liveConfig?.accept ?? "*/*";
    const items = Array.from(event.clipboardData?.items ?? []);
    const fileItems = items.filter((item) => {
      if (item.kind !== "file") return false;
      const file = item.getAsFile();
      return file !== null && matchesAcceptFilter(file, accept);
    });
    if (fileItems.length === 0) return;
    event.preventDefault();
    const files = fileItems
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    await processFiles(files);
  }

  $effect(() => {
    if (typeof document === "undefined") return;
    // Always attached; enabled + container scoping is checked at event time
    // so reactive config updates apply without re-subscribing.
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  });

  return {
    get attachments() {
      return attachments;
    },
    get enabled() {
      return enabled;
    },
    get dragOver() {
      return dragOver;
    },
    get fileInputRef() {
      return fileInputEl;
    },
    get containerRef() {
      return containerEl;
    },
    setFileInputRef,
    setContainerRef,
    fileInputAction,
    containerAction,
    processFiles,
    handleFileUpload,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    consumeAttachments,
  };
}
