import type { TemplateRef, Type } from "@angular/core";
import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  signal,
  ChangeDetectorRef,
  Injector,
  computed,
  inject,
  viewChild,
  DestroyRef,
} from "@angular/core";

import { CopilotChatView } from "./copilot-chat-view";
import { hostStyles } from "../host-styles";
import { CopilotChatAttachmentsDirective } from "./copilot-chat-attachments.directive";

import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import type { AttachmentsConfig } from "@copilotkit/shared";
import { AGUIConnectNotImplementedError } from "@ag-ui/client";
import type { AbstractAgent, Message, RunAgentInput } from "@ag-ui/client";
import {
  TranscriptionError,
  isRunCompletionAware,
  ɵisHttpAgent,
  ɵtranscribeAudio,
  ɵtranscriptionErrorMessageKey,
} from "@copilotkit/core";
import type { Suggestion } from "@copilotkit/core";
import { injectAgentStore } from "../../agent";
import { CopilotKit } from "../../copilotkit";
import { ChatState } from "../../chat-state";
import { COPILOT_CHAT_CONFIGURATION } from "../../chat-configuration";
import { injectChatLabels } from "../../chat-config";
import { connectActiveThread } from "../../active-thread-connector";
import { explicitEffect } from "../../explicit-effect";
import type { CopilotChatToolCallDisplay } from "./tool-call-layout";
import { COPILOT_CHAT_RUN_CONTROL } from "./copilot-chat-run-control";
import type { ChatRunControl } from "./copilot-chat-run-control";

/** How long a transcription error stays on screen, as in React. */
const TRANSCRIPTION_ERROR_TIMEOUT_MS = 5000;

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
  host: { "data-copilotkit": "" },
  styles: [hostStyles],
  template: `
    <div
      style="display: contents"
      copilotChatAttachments
      [config]="attachmentsConfig()"
    >
      @if (transcriptionError(); as error) {
        <div
          role="alert"
          data-testid="copilot-transcription-error"
          style="
            position: absolute;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #ef4444;
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 50;
          "
        >
          {{ error }}
        </div>
      }
      <copilot-chat-view
        [messages]="messages()"
        [state]="agentState()"
        [agentId]="resolvedAgentId()"
        [autoScroll]="true"
        [showCursor]="showCursor()"
        [toolCallDisplay]="toolCallDisplay()"
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
    {
      provide: COPILOT_CHAT_RUN_CONTROL,
      useExisting: CopilotChat,
    },
  ],
})
export class CopilotChat extends ChatState implements ChatRunControl {
  private readonly attachmentsDirective = viewChild(
    CopilotChatAttachmentsDirective,
  );

  readonly inputValue = signal<string>("");
  readonly agentId = input<string | undefined>();
  readonly threadId = input<string | undefined>();
  readonly inputComponent = input<Type<any> | undefined>();
  /**
   * How assistant messages show tool calls: `"grouped"` (default), `"line"`,
   * `"stacked"` or `"separate"`. Forwarded to the message view. Angular
   * draws `"turn"` the same as `"grouped"`.
   */
  readonly toolCallDisplay = input<CopilotChatToolCallDisplay>("grouped");
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
  private readonly labels = injectChatLabels();
  protected readonly showCursor = computed(
    () => this.connecting() || this.agentStore().isRunning(),
  );
  /** `true` while the agent runs. The chat input shows stop. */
  readonly isRunning = computed(() => this.agentStore().isRunning());
  /** A run can stop when it runs and the chat has messages, as in React. */
  readonly canStop = computed(
    () =>
      this.agentStore().isRunning() && this.agentStore().messages().length > 0,
  );
  /** The transcription error the chat shows, or `null`. */
  protected readonly transcriptionError = signal<string | null>(null);
  private transcriptionErrorTimer?: ReturnType<typeof setTimeout>;

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

    this.destroyRef.onDestroy(() => {
      this.activeConnection?.dispose();
      clearTimeout(this.transcriptionErrorTimer);
    });

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

    explicitEffect(this.resolvedAgentId, (agentId) => {
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
      explicitEffect(this.threadId, (inputThreadId) => {
        if (inputThreadId) {
          this.config!.setActiveThreadId(inputThreadId, { explicit: true });
        }
      });
    }
    // Both ambient and standalone threads share reset and connection cleanup.
    connectActiveThread(
      this.config ?? {
        threadId: this.resolvedThreadId,
        hasExplicitThreadId: this.hasExplicitThreadId,
      },
      this.agentStore,
      (agent) => this.connectToAgent(agent),
    );
  }

  private connectToAgent(agent: AbstractAgent) {
    let disposed = false;
    let initialized: RunAgentInput | undefined;
    let replaced = false;
    let completion: Promise<void> | undefined;
    let detachCompletion: Promise<void> | undefined;
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
        if (disposed) return detachCompletion;
        disposed = true;
        const current = this.activeConnection === handle;
        const detach = current && (ownsPipeline() || !initialized);
        // A successor connect may reuse HttpAgent's controller.
        if (
          !replaced &&
          (current ||
            (ɵisHttpAgent(agent) && agent.abortController !== controller))
        ) {
          controller.abort();
        }
        cleanup();
        if (detach) detachCompletion = agent.detachActiveRun().catch(() => {});
        return detachCompletion;
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

  /**
   * Stop the agent's current run, as React's chat does: through
   * `copilotkit.core.stopAgent`, or `agent.abortRun()` when that throws.
   */
  stop(): void {
    const agent = this.agentStore().agent;
    try {
      this.copilotKit.core.stopAgent({ agent });
    } catch (error) {
      console.error("[CopilotKit] stopAgent failed:", error);
      try {
        agent.abortRun();
      } catch (abortError) {
        console.error("[CopilotKit] abortRun fallback failed:", abortError);
      }
    }
  }

  override async finishTranscription(audioBlob: Blob): Promise<void> {
    this.isTranscribing.set(true);
    this.showTranscriptionError(null);
    this.cdr.markForCheck();

    try {
      const result = await ɵtranscribeAudio(this.copilotKit.core, audioBlob);
      const text = result.text?.trim();
      if (text) {
        const previous = this.inputValue().trim();
        this.inputValue.set(previous ? `${previous} ${text}` : text);
      }
    } catch (error) {
      console.error("[CopilotKit] Transcription failed:", error);
      this.showTranscriptionError(this.transcriptionErrorText(error));
    } finally {
      this.isTranscribing.set(false);
      this.cdr.markForCheck();
    }
  }

  /** The text to show the user for a failed transcription. */
  private transcriptionErrorText(error: unknown) {
    if (!(error instanceof TranscriptionError)) {
      return this.labels.transcriptionErrorGenericText;
    }
    const key = ɵtranscriptionErrorMessageKey(error.info);
    return key ? this.labels[key] : error.info.message;
  }

  /** Show a transcription error for a few seconds, or clear it with `null`. */
  private showTranscriptionError(message: string | null): void {
    clearTimeout(this.transcriptionErrorTimer);
    this.transcriptionError.set(message);
    if (message === null) return;
    this.transcriptionErrorTimer = setTimeout(() => {
      this.transcriptionError.set(null);
      this.cdr.markForCheck();
    }, TRANSCRIPTION_ERROR_TIMEOUT_MS);
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
