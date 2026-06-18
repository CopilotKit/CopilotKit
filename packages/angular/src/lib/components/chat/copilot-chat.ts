import {
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
  viewChild,
  DestroyRef,
} from "@angular/core";

import { CopilotChatView } from "./copilot-chat-view";
import { CopilotChatAttachmentsDirective } from "./copilot-chat-attachments.directive";

import {
  DEFAULT_AGENT_ID,
  randomUUID,
  type AttachmentsConfig,
} from "@copilotkit/shared";
import {
  Message,
  AbstractAgent,
  HttpAgent,
  AGUIConnectNotImplementedError,
} from "@ag-ui/client";
import type { Suggestion } from "@copilotkit/core";
import { injectAgentStore } from "../../agent";
import { CopilotKit } from "../../copilotkit";
import { ChatState } from "../../chat-state";
import { transcribeAudio } from "../../transcription";

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
  imports: [CopilotChatView, CopilotChatAttachmentsDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { "data-copilotkit": "", class: "cpk:block cpk:h-full cpk:min-h-0" },
  template: `
    <div
      style="display: contents"
      copilotChatAttachments
      [config]="attachmentsConfig()"
    >
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
  private readonly attachmentsDirective = viewChild(
    CopilotChatAttachmentsDirective,
  );

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
  protected readonly agentRef = computed(() => this.agentStore().agent);
  protected readonly resolvedThreadId = computed(
    () => this.threadId() || this.generatedThreadId,
  );
  override readonly attachmentsEnabled = computed(
    () => this.attachmentsConfig()?.enabled ?? false,
  );
  override readonly attachmentsUploading = computed(() =>
    this.attachments().some((attachment) => attachment.status === "uploading"),
  );
  protected showCursor = signal<boolean>(false);

  private generatedThreadId: string = randomUUID();

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

    effect((onCleanup) => {
      const agent = this.agentRef();
      const threadId = this.resolvedThreadId();

      agent.threadId = threadId;

      if (!this.hasExplicitThreadId()) return;

      let detached = false;
      const abortController = new AbortController();
      if (agent instanceof HttpAgent) {
        agent.abortController = abortController;
      }

      void this.connectToAgent(agent, () => detached);

      onCleanup(() => {
        detached = true;
        abortController.abort();
        void agent.detachActiveRun().catch(() => {});
      });
    });
  }

  private async connectToAgent(
    agent: AbstractAgent,
    isDetached: () => boolean,
  ): Promise<void> {
    this.showCursor.set(true);
    this.cdr.markForCheck();

    try {
      await this.copilotKit.core.connectAgent({ agent });
    } catch (error) {
      if (isDetached()) return;
      if (!(error instanceof AGUIConnectNotImplementedError)) {
        console.error("Failed to connect to agent:", error);
      }
    } finally {
      if (!isDetached()) {
        this.showCursor.set(false);
        this.cdr.markForCheck();
      }
    }
  }

  async submitInput(value: string): Promise<void> {
    const agent = this.agentStore().agent;
    if (!agent || !value.trim()) return;

    if (this.attachmentsUploading()) {
      console.error("[CopilotKit] Cannot send while attachments are uploading");
      return;
    }

    const attachments = this.attachmentsDirective();
    const readyAttachments = attachments?.consume() ?? [];
    const userMessage: Message =
      readyAttachments.length > 0
        ? ({
            id: randomUUID(),
            role: "user",
            content: attachments!.buildContent(value, readyAttachments),
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

  override async finishTranscription(audioBlob: Blob): Promise<void> {
    this.isTranscribing.set(true);
    this.cdr.markForCheck();

    try {
      const result = await transcribeAudio(this.copilotKit.core, audioBlob);
      const text = result.text?.trim();
      if (text) {
        const previous = this.inputValue().trim();
        this.inputValue.set(previous ? `${previous} ${text}` : text);
      }
    } catch (error) {
      console.error("[CopilotKit] Transcription failed:", error);
    } finally {
      this.isTranscribing.set(false);
      this.cdr.markForCheck();
    }
  }

  private syncSuggestionsFromCore(agentId: string): void {
    const result = this.copilotKit.core.getSuggestions(agentId);
    this.suggestions.set(result.suggestions);
    this.suggestionsLoading.set(result.isLoading);
    this.cdr.markForCheck();
  }

  addFile(): void {
    this.attachmentsDirective()?.openFilePicker();
  }

  removeAttachment(id: string): void {
    this.attachmentsDirective()?.removeAttachment(id);
  }

  handleDragOver(event: DragEvent): void {
    this.attachmentsDirective()?.onDragOver(event);
  }

  handleDragLeave(event: DragEvent): void {
    this.attachmentsDirective()?.onDragLeave(event);
  }

  handleDrop(event: DragEvent): void {
    void this.attachmentsDirective()?.onDrop(event);
  }
}
