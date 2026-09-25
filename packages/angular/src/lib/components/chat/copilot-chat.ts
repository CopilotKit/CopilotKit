import type { TemplateRef, Type } from "@angular/core";
import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  signal,
  effect,
  ChangeDetectorRef,
  Injector,
  computed,
  inject,
  viewChild,
  DestroyRef,
  untracked,
} from "@angular/core";

import { CopilotChatView } from "./copilot-chat-view";
import { CopilotChatAttachmentsDirective } from "./copilot-chat-attachments.directive";

import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import type { AttachmentsConfig } from "@copilotkit/shared";
import { AGUIConnectNotImplementedError } from "@ag-ui/client";
import type { AbstractAgent, Message, RunAgentInput } from "@ag-ui/client";
import { isRunCompletionAware, ɵisHttpAgent } from "@copilotkit/core";
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
        [state]="agentState()"
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
  private readonly connecting = signal(false);
  private activeConnection?: { dispose(): void };
  protected readonly showCursor = computed(
    () => this.connecting() || this.agentStore().isRunning(),
  );

  protected messages = computed(() => this.agentStore().messages());
  protected agentState = computed(() => this.agentStore().state());
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

  private generatedThreadId: string = randomUUID();

  constructor() {
    super();

    this.destroyRef.onDestroy(() => this.activeConnection?.dispose());

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

      // Both ambient and standalone threads use the same connection cleanup.
      connectActiveThread(this.config, this.agentStore, (agent) =>
        this.connectToAgent(agent),
      );
    } else {
      // Standalone `<copilot-chat [threadId]>` usage with no configuration
      // provider: the active thread is input-driven exactly as before.
      effect((onCleanup) => {
        const agent = this.agentRef();
        const threadId = this.resolvedThreadId();

        agent.threadId = threadId;

        if (!this.hasExplicitThreadId()) return;

        const handle = untracked(() => this.connectToAgent(agent));
        onCleanup(() => handle.dispose());
      });
    }
  }

  private connectToAgent(agent: AbstractAgent) {
    let disposed = false;
    let initialized: RunAgentInput | undefined;
    let replaced = false;
    let completion: Promise<void> | undefined;
    const controller = new AbortController();
    if (ɵisHttpAgent(agent)) agent.abortController = controller;

    const ownsPipeline = () => {
      if (!initialized || replaced) return false;
      const candidate: unknown = agent;
      const current = isRunCompletionAware(candidate)
        ? candidate.activeRunCompletionPromise
        : undefined;
      if (!current) return false;
      completion ??= current;
      return current === completion;
    };
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const subscription = agent.subscribe({
      onRunInitialized: ({ input }) => {
        if (initialized && input !== initialized) {
          replaced = true;
        } else {
          initialized = input;
          // AG-UI installs the pipeline after initialization subscribers finish.
          refresh = setTimeout(ownsPipeline, 0);
        }
      },
      onRunStartedEvent: () => {
        ownsPipeline();
      },
    });
    const cleanup = () => {
      clearTimeout(refresh);
      subscription.unsubscribe();
      if (this.activeConnection === handle) {
        this.activeConnection = undefined;
        this.connecting.set(false);
      }
    };
    const handle = {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const current = this.activeConnection === handle;
        const detach = current && ownsPipeline();
        // A successor connect may reuse HttpAgent's controller.
        if (
          !replaced &&
          (current ||
            (ɵisHttpAgent(agent) && agent.abortController !== controller))
        ) {
          controller.abort();
        }
        cleanup();
        if (detach) void agent.detachActiveRun().catch(() => {});
      },
    };
    this.activeConnection = handle;
    this.connecting.set(true);
    void Promise.resolve()
      .then(async () => {
        if (!disposed && !this.destroyRef.destroyed) {
          await this.copilotKit.core.connectAgent({ agent });
        }
      })
      .catch((error: unknown) => {
        if (!disposed && !(error instanceof AGUIConnectNotImplementedError)) {
          console.error("[CopilotKit] Failed to connect to agent:", error);
        }
      })
      .finally(cleanup);
    return handle;
  }

  // Match React: wait for the current agent pipeline before sending another turn.
  private async waitForActiveRunToSettle(agent: AbstractAgent): Promise<void> {
    const candidate: unknown = agent;
    const completion = isRunCompletionAware(candidate)
      ? candidate.activeRunCompletionPromise
      : undefined;
    if (agent.isRunning && completion) {
      try {
        await completion;
      } catch (error) {
        console.error(
          "[CopilotKit] In-flight run rejected while queuing send:",
          error,
        );
      }
    }
  }

  async submitInput(value: string): Promise<void> {
    if (
      this.destroyRef.destroyed ||
      !value.trim() ||
      this.attachmentsUploading()
    )
      return;
    const agent = this.agentStore().agent;
    const threadId = agent.threadId;
    this.inputValue.set("");
    await this.waitForActiveRunToSettle(agent);
    if (
      this.destroyRef.destroyed ||
      this.agentStore().agent !== agent ||
      agent.threadId !== threadId
    )
      return;

    // An upload can begin while this send is waiting, just as in React.
    if (this.attachmentsUploading()) {
      this.inputValue.set(value);
      console.error("[CopilotKit] Cannot send while attachments are uploading");
      return;
    }

    try {
      const attachments = this.attachmentsDirective();
      const ready = attachments?.consume() ?? [];
      const message: Message =
        ready.length > 0
          ? {
              id: randomUUID(),
              role: "user",
              content: attachments!.buildContent(value, ready),
            }
          : { id: randomUUID(), role: "user", content: value };
      agent.addMessage(message);
      await this.copilotKit.core.runAgent({ agent });
    } catch (error) {
      console.error("[CopilotKit] Agent run error:", error);
    }
  }

  async selectSuggestion(
    suggestion: Suggestion,
    _index: number,
  ): Promise<void> {
    const message = suggestion.message.trim();
    if (this.destroyRef.destroyed || !message || suggestion.isLoading) return;
    const agent = this.agentStore().agent;
    const threadId = agent.threadId;
    await this.waitForActiveRunToSettle(agent);
    if (
      this.destroyRef.destroyed ||
      this.agentStore().agent !== agent ||
      agent.threadId !== threadId
    )
      return;

    try {
      agent.addMessage({ id: randomUUID(), role: "user", content: message });
      await this.copilotKit.core.runAgent({ agent });
    } catch (error) {
      console.error("[CopilotKit] Agent run error:", error);
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
