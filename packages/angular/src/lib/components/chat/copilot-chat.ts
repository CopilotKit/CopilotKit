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
import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import {
  isRunCompletionAware,
  ɵcreateChatSubmitter,
  ɵisHttpAgent,
  ɵresolveChatNotice,
  ɵThreadSwitchCoordinator,
} from "@copilotkit/core";
import type { Suggestion, ɵThreadSelection } from "@copilotkit/core";
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
        [autoScroll]="autoScroll()"
        [showCursor]="showCursor()"
        [isRunning]="isRunning()"
        [isConnecting]="isConnecting()"
        [welcomeScreen]="welcomeScreen()"
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
  /** Whether the message list follows new messages to the bottom. Default `true`. */
  readonly autoScroll = input<boolean>(true);
  /** `false` turns the welcome screen off for an empty chat. Default `true`. */
  readonly welcomeScreen = input<boolean>(true);
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
  /**
   * Keeps the agent on the thread this chat shows, orders the teardown of the
   * previous thread, and tracks connections a send must wait for.
   */
  private readonly threads = new ɵThreadSwitchCoordinator(this.copilotKit.core);
  readonly cdr = inject(ChangeDetectorRef);
  readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly connecting = signal(false);
  private activeConnection?: { dispose(): void };
  private readonly labels = injectChatLabels();
  protected readonly showCursor = computed(
    () => this.connecting() || this.agentStore().isRunning(),
  );
  /** `true` while the thread's connect is loading. */
  protected readonly isConnecting = computed(() => this.connecting());
  /** `true` while the agent runs. The chat input shows stop. */
  readonly isRunning = computed(() => this.agentStore().isRunning());
  /** A run can stop when it runs and the chat has messages, as in React. */
  readonly canStop = computed(
    () =>
      this.agentStore().isRunning() && this.agentStore().messages().length > 0,
  );
  /**
   * The send side — queueing behind the run in flight and the thread's
   * connection, the upload guard, stop, and transcription — lives in core.
   */
  private readonly submitter = ɵcreateChatSubmitter({
    core: this.copilotKit.core,
    getAgent: () => this.agentStore().agent,
    input: {
      get: () => this.inputValue(),
      set: (value) => this.inputValue.set(value),
    },
    attachments: {
      isUploading: () => this.attachmentsUploading(),
      consumeReady: () => this.attachmentsDirective()?.consume() ?? [],
    },
    threads: this.threads,
  });
  private readonly submitterState = signal(this.submitter.getSnapshot());
  /** The notice the chat shows (a failed transcription, a blocked send), or `null`. */
  protected readonly transcriptionError = computed(() => {
    const { notice } = this.submitterState();
    return notice ? ɵresolveChatNotice(notice, this.labels) : null;
  });

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

    const unsubscribeSubmitter = this.submitter.subscribe(() => {
      const state = this.submitter.getSnapshot();
      this.submitterState.set(state);
      this.isTranscribing.set(state.isTranscribing);
      this.cdr.markForCheck();
    });
    this.destroyRef.onDestroy(() => {
      this.activeConnection?.dispose();
      unsubscribeSubmitter();
      this.submitter.dispose();
      this.threads.dispose();
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
      (agent, selection) => this.connectToAgent(agent, selection),
      this.threads,
    );
  }

  private connectToAgent(agent: AbstractAgent, selection: ɵThreadSelection) {
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
    // Tracked, so a send waits for the thread to load instead of racing it.
    void this.threads
      .trackConnection(selection, () =>
        Promise.resolve()
          .then(async () => {
            if (!disposed && !this.destroyRef.destroyed) {
              await this.copilotKit.core.connectAgent({ agent });
            }
          })
          .catch((error: unknown) => {
            if (disposed || error instanceof AGUIConnectNotImplementedError) {
              return;
            }
            // The coordinator logs the failure and blocks sends on it.
            throw error;
          }),
      )
      .finally(cleanup);
    return handle;
  }

  async submitInput(value: string): Promise<void> {
    if (this.destroyRef.destroyed) return;
    await this.submitter.submit(value);
  }

  async selectSuggestion(
    suggestion: Suggestion,
    _index: number,
  ): Promise<void> {
    if (this.destroyRef.destroyed) return;
    await this.submitter.selectSuggestion(suggestion);
  }

  changeInput(value: string): void {
    this.inputValue.set(value);
  }

  /**
   * Stop the agent's current run, as React's chat does: through
   * `copilotkit.core.stopAgent`, or `agent.abortRun()` when that throws.
   */
  stop(): void {
    this.submitter.stop();
  }

  override async finishTranscription(audioBlob: Blob): Promise<void> {
    await this.submitter.transcribe(audioBlob);
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
