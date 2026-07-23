import {
  Directive,
  DestroyRef,
  ElementRef,
  HostListener,
  Renderer2,
  inject,
  input,
} from "@angular/core";
import {
  exceedsMaxSize,
  formatFileSize,
  generateVideoThumbnail,
  getModalityFromMimeType,
  matchesAcceptFilter,
  randomUUID,
  readFileAsBase64,
  type Attachment,
  type AttachmentsConfig,
  type InputContent,
} from "@copilotkit/shared";
import { ChatState } from "../../chat-state";

@Directive({
  selector: "[copilotChatAttachments]",
})
export class CopilotChatAttachmentsDirective {
  readonly config = input<AttachmentsConfig | undefined>();

  private readonly chat = inject(ChatState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly destroyRef = inject(DestroyRef);

  private fileInput?: HTMLInputElement;

  private get enabled(): boolean {
    return this.config()?.enabled ?? false;
  }

  onDragOver(event: DragEvent): void {
    if (!this.enabled) return;
    event.preventDefault();
    event.stopPropagation();
    this.chat.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.chat.dragOver.set(false);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.chat.dragOver.set(false);

    if (!this.enabled) return;

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      await this.processFiles(files);
    }
  }

  @HostListener("document:paste", ["$event"])
  async onPaste(event: ClipboardEvent): Promise<void> {
    if (!this.enabled) return;

    const target = event.target as Node | null;
    if (!target || !this.host.nativeElement.contains(target)) return;

    const accept = this.config()?.accept ?? "*/*";
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(
        (file): file is File => !!file && matchesAcceptFilter(file, accept),
      );

    if (files.length === 0) return;

    event.preventDefault();
    await this.processFiles(files);
  }

  openFilePicker(): void {
    const input = this.ensureFileInput();
    input.accept = this.config()?.accept ?? "*/*";
    input.click();
  }

  removeAttachment(id: string): void {
    this.chat.attachments.update((attachments) =>
      attachments.filter((attachment) => attachment.id !== id),
    );
  }

  consume(): Attachment[] {
    const readyAttachments = this.chat
      .attachments()
      .filter((attachment) => attachment.status === "ready");

    if (readyAttachments.length > 0) {
      this.chat.attachments.update((attachments) =>
        attachments.filter((attachment) => attachment.status !== "ready"),
      );
    }

    if (this.fileInput) {
      this.fileInput.value = "";
    }

    return readyAttachments;
  }

  buildContent(value: string, attachments: Attachment[]): InputContent[] {
    const content: InputContent[] = [];
    const trimmed = value.trim();

    if (trimmed) {
      content.push({ type: "text", text: trimmed });
    }

    for (const attachment of attachments) {
      content.push({
        type: attachment.type,
        source: attachment.source,
        metadata: {
          ...(attachment.filename ? { filename: attachment.filename } : {}),
          ...attachment.metadata,
        },
      } as InputContent);
    }

    return content;
  }

  private ensureFileInput(): HTMLInputElement {
    if (this.fileInput) return this.fileInput;

    const input: HTMLInputElement = this.renderer.createElement("input");
    this.renderer.setAttribute(input, "type", "file");
    this.renderer.setProperty(input, "multiple", true);
    this.renderer.setStyle(input, "display", "none");
    const unlisten = this.renderer.listen(input, "change", (event: Event) => {
      void this.handleFileInputChange(event);
    });
    this.renderer.appendChild(this.host.nativeElement, input);

    this.destroyRef.onDestroy(() => {
      unlisten();
      input.remove();
    });

    this.fileInput = input;
    return input;
  }

  private async handleFileInputChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    await this.processFiles(files);
  }

  private async processFiles(files: File[]): Promise<void> {
    const config = this.config();
    if (!config?.enabled) {
      return;
    }

    const accept = config.accept ?? "*/*";
    const maxSize = config.maxSize ?? 20 * 1024 * 1024;

    for (const file of files) {
      if (!matchesAcceptFilter(file, accept)) {
        config.onUploadFailed?.({
          reason: "invalid-type",
          file,
          message: `File "${file.name}" is not accepted. Supported types: ${accept}`,
        });
        continue;
      }

      if (exceedsMaxSize(file, maxSize)) {
        config.onUploadFailed?.({
          reason: "file-too-large",
          file,
          message: `File "${
            file.name
          }" exceeds the maximum size of ${formatFileSize(maxSize)}`,
        });
        continue;
      }

      const placeholderId = randomUUID();
      const modality = getModalityFromMimeType(file.type);
      const placeholder: Attachment = {
        id: placeholderId,
        type: modality,
        source: { type: "data", value: "", mimeType: file.type },
        filename: file.name,
        size: file.size,
        status: "uploading",
      };

      this.chat.attachments.update((attachments) => [
        ...attachments,
        placeholder,
      ]);

      try {
        const uploadResult = config.onUpload
          ? await config.onUpload(file)
          : {
              type: "data" as const,
              value: await readFileAsBase64(file),
              mimeType: file.type,
            };
        const { metadata, ...source } = uploadResult;
        const thumbnail =
          modality === "video" ? await generateVideoThumbnail(file) : undefined;

        this.chat.attachments.update((attachments) =>
          attachments.map((attachment) =>
            attachment.id === placeholderId
              ? {
                  ...attachment,
                  source,
                  status: "ready",
                  thumbnail,
                  metadata,
                }
              : attachment,
          ),
        );
      } catch (error) {
        this.chat.attachments.update((attachments) =>
          attachments.filter((attachment) => attachment.id !== placeholderId),
        );
        console.error(`[CopilotKit] Failed to upload "${file.name}":`, error);
        config.onUploadFailed?.({
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
}
