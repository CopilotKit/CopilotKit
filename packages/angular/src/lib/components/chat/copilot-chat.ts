import {
  afterNextRender,
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  signal,
  effect,
  ChangeDetectorRef,
  Injector,
  Type,
  computed,
  inject,
  ViewChild,
  ElementRef,
  DestroyRef,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotChatView } from "./copilot-chat-view";

import {
  DEFAULT_AGENT_ID,
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
import {
  Message,
  AbstractAgent,
  AGUIConnectNotImplementedError,
} from "@ag-ui/client";
import type { Suggestion } from "@copilotkit/core";
import { injectAgentStore } from "../../agent";
import { CopilotKit } from "../../copilotkit";
import { ChatState } from "../../chat-state";
import { isCopilotKitAgent } from "./copilot-chat-agent-utils";

/**
 * CopilotChat component - Angular equivalent of React's <CopilotChat>
 * Provides a complete chat interface that wires an agent to the chat view
 *
 * @example
 * ```html
 * <copilot-chat [agentId]="'default'" [threadId]="'abc123'"></copilot-chat>
 * ```
 */
@Component({
  selector: "copilot-chat",
  standalone: true,
  imports: [CommonModule, CopilotChatView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { "data-copilotkit": "", class: "cpk:block cpk:h-full cpk:min-h-0" },
  template: `
    <div
      style="display: contents"
      (dragover)="handleDragOver($event)"
      (dragleave)="handleDragLeave($event)"
      (drop)="handleDrop($event)"
    >
      @if (attachmentsEnabled()) {
        <input
          #fileInput
          type="file"
          multiple
          [accept]="attachmentsConfig()?.accept ?? '*/*'"
          style="display: none"
          (change)="handleFileUpload($event)"
        />
      }
      <copilot-chat-view
        [messages]="messages()"
        [agentId]="resolvedAgentId()"
        [autoScroll]="true"
        [messageViewClass]="'cpk:w-full'"
        [showCursor]="showCursor()"
        [inputComponent]="inputComponent()"
        [hasExplicitThreadId]="hasExplicitThreadId()"
      >
      </copilot-chat-view>
    </div>
  `,
  providers: [
    {
      provide: ChatState,
      useExisting: CopilotChat,
    },
  ],
})
export class CopilotChat extends ChatState {
  @ViewChild("fileInput")
  private fileInputRef?: ElementRef<HTMLInputElement>;

  readonly inputValue = signal<string>("");
  readonly agentId = input<string | undefined>();
  readonly threadId = input<string | undefined>();
  readonly inputComponent = input<Type<any> | undefined>();
  readonly attachmentsConfig = input<AttachmentsConfig | undefined>(undefined, {
    alias: "attachments",
  });
  protected readonly resolvedAgentId = computed(
    () => this.agentId() ?? DEFAULT_AGENT_ID,
  );
  readonly agentStore = injectAgentStore(this.resolvedAgentId);
  private readonly copilotKit = inject(CopilotKit);
  // readonly chatConfig = injectChatConfig();
  readonly cdr = inject(ChangeDetectorRef);
  readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  protected messages = computed(() => this.agentStore().messages());
  protected isRunning = computed(() => this.agentStore().isRunning());
  protected hasExplicitThreadId = computed(() => Boolean(this.threadId()));
  override readonly attachmentsEnabled = computed(
    () => this.attachmentsConfig()?.enabled ?? false,
  );
  override readonly attachmentsUploading = computed(() =>
    this.attachments().some((attachment) => attachment.status === "uploading"),
  );
  protected showCursor = signal<boolean>(false);

  private generatedThreadId: string = randomUUID();
  private hasConnectedOnce = false;

  constructor() {
    super();

    const suggestionsSubscription = this.copilotKit.core.subscribe({
      onAgentsChanged: () => {
        const agentId = this.resolvedAgentId();
        this.syncSuggestionsFromCore(agentId);
        if (this.copilotKit.core.getAgent(agentId)) {
          this.copilotKit.reloadSuggestions(agentId);
        }
      },
      onSuggestionsChanged: ({ agentId, suggestions }) => {
        if (agentId !== this.resolvedAgentId()) {
          return;
        }

        this.suggestions.set(suggestions);
        this.suggestionsLoading.set(
          this.copilotKit.core.getSuggestions(agentId).isLoading,
        );
        this.cdr.markForCheck();
      },
      onSuggestionsStartedLoading: ({ agentId }) => {
        if (agentId !== this.resolvedAgentId()) {
          return;
        }

        this.suggestionsLoading.set(true);
        this.cdr.markForCheck();
      },
      onSuggestionsFinishedLoading: ({ agentId }) => {
        if (agentId !== this.resolvedAgentId()) {
          return;
        }

        this.syncSuggestionsFromCore(agentId);
      },
      onSuggestionsConfigChanged: () => {
        const agentId = this.resolvedAgentId();
        this.syncSuggestionsFromCore(agentId);
        this.copilotKit.reloadSuggestions(agentId);
      },
    });

    this.destroyRef.onDestroy(() => suggestionsSubscription.unsubscribe());

    effect(() => {
      const agentId = this.resolvedAgentId();
      this.syncSuggestionsFromCore(agentId);
      this.copilotKit.reloadSuggestions(agentId);
    });

    // Keep the imperative agent object aligned with signal inputs.
    effect(() => {
      const a = this.agentStore().agent;
      if (!a) return;
      a.threadId = this.threadId() || this.generatedThreadId;
      if (!this.hasConnectedOnce) {
        this.hasConnectedOnce = true;
        if (isCopilotKitAgent(a)) {
          this.connectToAgent(a);
        } else {
          // Non-CopilotKit agent: nothing to connect; keep default cursor state
        }
      }
    });

    afterNextRender(() => {
      if (typeof document === "undefined") {
        return;
      }

      const handlePaste = (event: ClipboardEvent) => {
        const config = this.attachmentsConfig();
        if (!config?.enabled) {
          return;
        }

        const accept = config.accept ?? "*/*";
        const items = Array.from(event.clipboardData?.items ?? []);
        const files = items
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter(
            (file): file is File => !!file && matchesAcceptFilter(file, accept),
          );

        if (files.length === 0) {
          return;
        }

        event.preventDefault();
        void this.processFiles(files);
      };

      document.addEventListener("paste", handlePaste);
      this.destroyRef.onDestroy(() =>
        document.removeEventListener("paste", handlePaste),
      );
    });
  }

  private async connectToAgent(agent: AbstractAgent): Promise<void> {
    if (!agent) return;

    this.showCursor.set(true);
    this.cdr.markForCheck();

    try {
      await this.copilotKit.core.connectAgent({ agent });
      this.showCursor.set(false);
      this.cdr.markForCheck();
    } catch (error) {
      if (error instanceof AGUIConnectNotImplementedError) {
        // Connect not implemented (e.g. agent only supports run), ignore
      } else {
        console.error("Failed to connect to agent:", error);
      }
      this.showCursor.set(false);
      this.cdr.markForCheck();
    }
  }

  async submitInput(value: string): Promise<void> {
    const agent = this.agentStore().agent;
    if (!agent || !value.trim()) return;

    if (this.attachmentsUploading()) {
      console.error("[CopilotKit] Cannot send while attachments are uploading");
      return;
    }

    const readyAttachments = this.consumeAttachments();
    const userMessage: Message =
      readyAttachments.length > 0
        ? ({
            id: randomUUID(),
            role: "user",
            content: this.createAttachmentContent(value, readyAttachments),
          } as Message)
        : {
            id: randomUUID(),
            role: "user",
            content: value,
          };
    agent.addMessage(userMessage);

    // Clear the input
    this.inputValue.set("");

    // Show cursor while processing
    this.showCursor.set(true);
    this.cdr.markForCheck();

    // Run the agent via core so tools (and context, forwardedProps) are included
    try {
      await this.copilotKit.core.runAgent({ agent });
    } catch (error) {
      console.error("Agent run error:", error);
    } finally {
      this.showCursor.set(false);
      this.cdr.markForCheck();
    }
  }

  async selectSuggestion(
    suggestion: Suggestion,
    _index: number,
  ): Promise<void> {
    const agent = this.agentStore().agent;
    const message = suggestion.message.trim();
    if (!agent || !message || suggestion.isLoading) return;

    agent.addMessage({
      id: randomUUID(),
      role: "user",
      content: message,
    });

    this.inputValue.set("");
    this.showCursor.set(true);
    this.cdr.markForCheck();

    try {
      await this.copilotKit.core.runAgent({ agent });
    } catch (error) {
      console.error("Agent run error:", error);
    } finally {
      this.showCursor.set(false);
      this.cdr.markForCheck();
    }
  }

  changeInput(value: string): void {
    this.inputValue.set(value);
  }

  private syncSuggestionsFromCore(agentId: string): void {
    const result = this.copilotKit.core.getSuggestions(agentId);
    this.suggestions.set(result.suggestions);
    this.suggestionsLoading.set(result.isLoading);
    this.cdr.markForCheck();
  }

  addFile(): void {
    this.fileInputRef?.nativeElement.click();
  }

  removeAttachment(id: string): void {
    this.attachments.update((attachments) =>
      attachments.filter((attachment) => attachment.id !== id),
    );
  }

  async handleFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      return;
    }
    await this.processFiles(files);
  }

  handleDragOver(event: DragEvent): void {
    if (!this.attachmentsEnabled()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(true);
  }

  handleDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
  }

  async handleDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);

    if (!this.attachmentsEnabled()) {
      return;
    }

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      await this.processFiles(files);
    }
  }

  private async processFiles(files: File[]): Promise<void> {
    const config = this.attachmentsConfig();
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
          message: `File "${file.name}" exceeds the maximum size of ${formatFileSize(maxSize)}`,
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

      this.attachments.update((attachments) => [...attachments, placeholder]);

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

        this.attachments.update((attachments) =>
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
        this.attachments.update((attachments) =>
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

  private consumeAttachments(): Attachment[] {
    const readyAttachments = this.attachments().filter(
      (attachment) => attachment.status === "ready",
    );

    if (readyAttachments.length > 0) {
      this.attachments.update((attachments) =>
        attachments.filter((attachment) => attachment.status !== "ready"),
      );
    }

    if (this.fileInputRef?.nativeElement) {
      this.fileInputRef.nativeElement.value = "";
    }

    return readyAttachments;
  }

  private createAttachmentContent(
    value: string,
    attachments: Attachment[],
  ): InputContent[] {
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
}
