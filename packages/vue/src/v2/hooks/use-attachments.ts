import { computed, onBeforeUnmount, onMounted, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
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

export interface UseAttachmentsProps {
  config?: MaybeRefOrGetter<AttachmentsConfig | undefined>;
}

export interface UseAttachmentsReturn {
  attachments: Ref<Attachment[]>;
  enabled: Ref<boolean>;
  dragOver: Ref<boolean>;
  fileInputRef: Ref<HTMLInputElement | null>;
  containerRef: Ref<HTMLElement | null>;
  processFiles: (files: File[]) => Promise<void>;
  handleFileUpload: (event: Event) => Promise<void>;
  handleDragOver: (event: DragEvent) => void;
  handleDragLeave: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => Promise<void>;
  removeAttachment: (id: string) => void;
  consumeAttachments: () => Attachment[];
}

export function useAttachments(
  props: UseAttachmentsProps,
): UseAttachmentsReturn {
  const attachments = ref<Attachment[]>([]);
  const dragOver = ref(false);
  const fileInputRef = ref<HTMLInputElement | null>(null);
  const containerRef = ref<HTMLElement | null>(null);
  const configRef = ref<AttachmentsConfig | undefined>(toValue(props.config));
  const attachmentsRef = ref<Attachment[]>(attachments.value);
  const enabled = computed(() => configRef.value?.enabled ?? false);

  watch(
    () => toValue(props.config),
    (next) => {
      configRef.value = next;
    },
    { immediate: true },
  );

  const setAttachments = (next: Attachment[]) => {
    attachments.value = next;
    attachmentsRef.value = next;
  };

  const updateAttachments = (
    updater: (previous: Attachment[]) => Attachment[],
  ) => {
    setAttachments(updater(attachmentsRef.value));
  };

  async function processFiles(files: File[]) {
    const config = configRef.value;
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
          previous.filter((attachment) => attachment.id !== placeholderId),
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
    if (!enabled.value) return;
    event.preventDefault();
    event.stopPropagation();
    dragOver.value = true;
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragOver.value = false;
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragOver.value = false;
    if (!enabled.value) return;

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
    const ready = attachmentsRef.value.filter(
      (attachment) => attachment.status === "ready",
    );
    if (ready.length === 0) {
      return ready;
    }
    updateAttachments((previous) =>
      previous.filter((attachment) => attachment.status !== "ready"),
    );
    if (fileInputRef.value) {
      fileInputRef.value.value = "";
    }
    return ready;
  }

  async function handlePaste(event: ClipboardEvent) {
    if (!enabled.value) return;

    const target = event.target as HTMLElement | null;
    if (!target || !containerRef.value?.contains(target)) return;

    const accept = configRef.value?.accept ?? "*/*";
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

  onMounted(() => {
    if (typeof document !== "undefined") {
      document.addEventListener("paste", handlePaste);
    }
  });

  onBeforeUnmount(() => {
    if (typeof document !== "undefined") {
      document.removeEventListener("paste", handlePaste);
    }
  });

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
