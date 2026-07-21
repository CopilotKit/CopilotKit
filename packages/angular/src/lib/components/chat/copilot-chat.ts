import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  signal,
  effect,
  ChangeDetectorRef,
  Injector,
  TemplateRef,
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
import { COPILOT_CHAT_CONFIGURATION } from "../../chat-configuration";
import { connectActiveThread } from "../../active-thread-connector";

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
        [assistantMessageComponent]="assistantMessageComponent()"
        [assistantMessageTemplate]="assistantMessageTemplate()"
        [assistantMessageClass]="assistantMessageClass()"
        [reasoningMessageComponent]="reasoningMessageComponent()"
        [reasoningMessageTemplate]="reasoningMessageTemplate()"
        [reasoningMessageClass]="reasoningMessageClass()"
        [messageViewChildrenComponent]="messageViewChildrenComponent()"
        [messageViewChildrenTemplate]="messageViewChildrenTemplate()"
        [messageViewChildrenClass]="messageViewChildrenClass()"
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
  /** Component used to render each assistant message in the prebuilt chat. */
  readonly assistantMessageComponent = input<Type<any> | undefined>();
  /** Template used to render each assistant message in the prebuilt chat. */
  readonly assistantMessageTemplate = input<TemplateRef<any> | undefined>();
  /** Class forwarded to the default or custom assistant-message renderer. */
  readonly assistantMessageClass = input<string | undefined>();
  /** Component used to render each reasoning message in the prebuilt chat. */
  readonly reasoningMessageComponent = input<Type<any> | undefined>();
  /** Template used to render each reasoning message in the prebuilt chat. */
  readonly reasoningMessageTemplate = input<TemplateRef<any> | undefined>();
  /** Class forwarded to the default or custom reasoning-message renderer. */
  readonly reasoningMessageClass = input<string | undefined>();
  /** Component rendered after the transcript messages and before the cursor. */
  readonly messageViewChildrenComponent = input<Type<any> | undefined>();
  /** Template rendered after the transcript messages and before the cursor. */
  readonly messageViewChildrenTemplate = input<TemplateRef<any> | undefined>();
  /** Class forwarded to custom transcript-children renderers. */
  readonly messageViewChildrenClass = input<string | undefined>();
  readonly attachmentsConfig = input<AttachmentsConfig | undefined>(undefined, {
    alias: "attachments",
  });
  /**
   * Ambient chat configuration, when a {@link provideCopilotChatConfiguration}
   * provider is in scope. Absent (`null`) for standalone
   * `<copilot-chat [threadId]>` usage, which has no provider — resolved via the
   * optional inject so the component does not throw without one.
   */
  private readonly config = inject(COPILOT_CHAT_CONFIGURATION, {
    optional: true,
  });
  protected readonly resolvedAgentId = computed(
    () => this.agentId() ?? this.config?.agentId() ?? DEFAULT_AGENT_ID,
  );
  readonly agentStore = injectAgentStore(this.resolvedAgentId);
  private readonly copilotKit = inject(CopilotKit);
  readonly cdr = inject(ChangeDetectorRef);
  readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  protected messages = computed(() => this.agentStore().messages());
  protected isRunning = computed(() => this.agentStore().isRunning());
  protected readonly hasExplicitThreadId =
    this.config?.hasExplicitThreadId ??
    computed(() => Boolean(this.threadId()));
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

    if (this.config) {
      // A set `[threadId]` input seeds the ambient config so the input
      // actually drives the active thread (not just the welcome flag). When
      // the config is controlled by a host-provided `threadId` option,
      // `setActiveThreadId` no-ops — so a controlled config wins over the
      // input, matching React's prop-precedence. When `[threadId]` is unset,
      // the effect does nothing and the config drives as before.
      effect(() => {
        const inputThreadId = this.threadId();
        if (inputThreadId) {
          this.config!.setActiveThreadId(inputThreadId, { explicit: true });
        }
      });

      // Ambient configuration drives the active thread: the connector pins
      // `agent.threadId` from the config's resolved thread signal and connects
      // on explicit switches (or clears messages on a fresh thread).
      //
      // The connector receives the RAW `core.connectAgent` and owns the loading
      // cursor + abort + detach lifecycle, matching the standalone
      // `connectToAgent` path exactly: cursor on at connect start, off when the
      // connect settles (guarded against a superseded run). Connect errors still
      // surface via the AgentStore's run/error subscription, not here.
      connectActiveThread(
        this.config,
        this.agentStore,
        (params) => this.copilotKit.core.connectAgent(params),
        {
          onConnectStart: () => {
            this.showCursor.set(true);
            this.cdr.markForCheck();
          },
          onConnectSettle: () => {
            this.showCursor.set(false);
            this.cdr.markForCheck();
          },
        },
      );
    } else {
      // Standalone `<copilot-chat [threadId]>` usage with no configuration
      // provider: the active thread is input-driven exactly as before.
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
