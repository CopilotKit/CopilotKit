import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  toValue,
} from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import { ɵAttachmentQueue } from "@copilotkit/core";
import type { Attachment, AttachmentsConfig } from "@copilotkit/shared";

export interface UseAttachmentsProps {
  config?: MaybeRefOrGetter<AttachmentsConfig | undefined>;
}

export interface UseAttachmentsReturn {
  attachments: Ref<Attachment[]>;
  enabled: Ref<boolean>;
  dragOver: Ref<boolean>;
  fileInputRef: Ref<HTMLInputElement | null>;
  containerRef: Ref<HTMLElement | null>;
  /** Process files (validate, upload, add to state). No-op while attachments are disabled. */
  processFiles: (files: File[]) => Promise<void>;
  handleFileUpload: (event: Event) => Promise<void>;
  handleDragOver: (event: DragEvent) => void;
  handleDragLeave: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => Promise<void>;
  removeAttachment: (id: string) => void;
  consumeAttachments: () => Attachment[];
}

/**
 * Manages file attachment state — uploads, drag-and-drop, paste. The queue
 * itself (validation, uploads, ready state) lives in `@copilotkit/core`'s
 * `ɵAttachmentQueue`; this composable adds the DOM wiring and projects the
 * queue into a `shallowRef`.
 */
export function useAttachments(
  props: UseAttachmentsProps,
): UseAttachmentsReturn {
  const queue = new ɵAttachmentQueue(() => toValue(props.config));
  const attachments = shallowRef<Attachment[]>(queue.getSnapshot());
  const unsubscribe = queue.subscribe(() => {
    attachments.value = queue.getSnapshot();
  });
  const dragOver = ref(false);
  const fileInputRef = ref<HTMLInputElement | null>(null);
  const containerRef = ref<HTMLElement | null>(null);
  const enabled = computed(() => toValue(props.config)?.enabled ?? false);

  function processFiles(files: File[]) {
    return queue.processFiles(files);
  }

  async function processSafely(files: File[], label: string) {
    try {
      await queue.processFiles(files);
    } catch (error) {
      console.error(`[CopilotKit] ${label}:`, error);
    }
  }

  async function handleFileUpload(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.files?.length) return;
    await processSafely(Array.from(target.files), "Upload error");
    // Clear the picker so choosing the same file again fires `change`.
    target.value = "";
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
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) await processSafely(files, "Drop error");
  }

  function removeAttachment(id: string) {
    queue.remove(id);
  }

  function consumeAttachments() {
    const ready = queue.consumeReady();
    if (ready.length > 0 && fileInputRef.value) {
      fileInputRef.value.value = "";
    }
    return ready;
  }

  async function handlePaste(event: ClipboardEvent) {
    const target = event.target;
    if (!(target instanceof Node) || !containerRef.value?.contains(target))
      return;
    const files = queue.filterPastedFiles(
      Array.from(event.clipboardData?.items ?? []),
    );
    if (files.length === 0) return;
    event.preventDefault();
    await processSafely(files, "Paste error");
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
    unsubscribe();
    queue.dispose();
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
