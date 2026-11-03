import {
  Directive,
  DestroyRef,
  ElementRef,
  HostListener,
  Renderer2,
  inject,
  input,
} from "@angular/core";
import { ɵAttachmentQueue, ɵbuildUserMessageContent } from "@copilotkit/core";
import type {
  Attachment,
  AttachmentsConfig,
  InputContent,
} from "@copilotkit/shared";
import { ChatState } from "../../chat-state";

/**
 * Adds file attachments to the chat: drag-and-drop, paste and a hidden file
 * picker. The queue itself (validation, uploads, ready state) lives in
 * `@copilotkit/core`'s `ɵAttachmentQueue`; this directive mirrors it into
 * {@link ChatState.attachments}.
 */
@Directive({
  selector: "[copilotChatAttachments]",
})
export class CopilotChatAttachmentsDirective {
  readonly config = input<AttachmentsConfig | undefined>();

  private readonly chat = inject(ChatState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly destroyRef = inject(DestroyRef);
  private readonly queue = new ɵAttachmentQueue(() => this.config());

  private fileInput?: HTMLInputElement;

  constructor() {
    const unsubscribe = this.queue.subscribe(() => {
      this.chat.attachments.set(this.queue.getSnapshot());
    });
    this.destroyRef.onDestroy(() => {
      unsubscribe();
      this.queue.dispose();
    });
  }

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

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      await this.processSafely(files, "Drop error");
    }
  }

  @HostListener("document:paste", ["$event"])
  async onPaste(event: ClipboardEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof Node) || !this.host.nativeElement.contains(target))
      return;

    const files = this.queue.filterPastedFiles(
      Array.from(event.clipboardData?.items ?? []),
    );
    if (files.length === 0) return;

    event.preventDefault();
    await this.processSafely(files, "Paste error");
  }

  openFilePicker(): void {
    const input = this.ensureFileInput();
    input.accept = this.config()?.accept ?? "*/*";
    input.click();
  }

  removeAttachment(id: string): void {
    this.queue.remove(id);
  }

  /** Takes the ready attachments for a message and resets the file picker. */
  consume(): Attachment[] {
    const ready = this.queue.consumeReady();
    if (this.fileInput) {
      this.fileInput.value = "";
    }
    return ready;
  }

  /**
   * The content parts of a user message with these attachments: the text
   * (as typed) and one part per attachment.
   */
  buildContent(value: string, attachments: Attachment[]): InputContent[] {
    const content = ɵbuildUserMessageContent(value, attachments);
    if (typeof content !== "string") return content;
    return content.trim() ? [{ type: "text", text: content }] : [];
  }

  private ensureFileInput(): HTMLInputElement {
    if (this.fileInput) return this.fileInput;

    const input: HTMLInputElement = this.renderer.createElement("input");
    this.renderer.setAttribute(input, "type", "file");
    this.renderer.setProperty(input, "multiple", true);
    this.renderer.setStyle(input, "display", "none");
    const unlisten = this.renderer.listen(input, "change", () => {
      void this.handleFileInputChange(input);
    });
    this.renderer.appendChild(this.host.nativeElement, input);

    this.destroyRef.onDestroy(() => {
      unlisten();
      input.remove();
    });

    this.fileInput = input;
    return input;
  }

  private async handleFileInputChange(picker: HTMLInputElement): Promise<void> {
    const files = Array.from(picker.files ?? []);
    if (files.length === 0) return;
    await this.processSafely(files, "Upload error");
    // Clear the picker so choosing the same file again fires `change`.
    picker.value = "";
  }

  private async processSafely(files: File[], label: string): Promise<void> {
    try {
      await this.queue.processFiles(files);
    } catch (error) {
      console.error(`[CopilotKit] ${label}:`, error);
    }
  }
}
