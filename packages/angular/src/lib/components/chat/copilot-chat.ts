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

import type { AttachmentsConfig } from "@copilotkit/shared";
import {
  ɵChatConnection,
  ɵFreshThreadId,
  ɵInspectorThreadOverride,
  ɵcreateChatSubmitter,
  ɵresolveAgentId,
  ɵresolveChatNotice,
  ɵsubscribeToAgentSuggestions,
} from "@copilotkit/core";
import type {
  CopilotKitCoreGetSuggestionsResult,
  Suggestion,
} from "@copilotkit/core";
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
  protected readonly resolvedAgentId = computed(() =>
    ɵresolveAgentId({
      agentId: this.agentId(),
      chatAgentId: this.config?.agentId(),
    }),
  );
  readonly agentStore = injectAgentStore(this.resolvedAgentId);
  private readonly copilotKit = inject(CopilotKit);
  /**
   * Loads the thread this chat shows: keeps the agent on it, orders the
   * teardown of the previous thread, owns the connect's abort and detach, and
   * tracks connections a send must wait for. A failed connect of an Inspector
   * override ends the override.
   */
  private readonly connection = new ɵChatConnection({
    core: this.copilotKit.core,
    onInspectorOverrideFailed: (requestId) =>
      this.inspectorThreadOverride.fail(requestId),
  });
  private readonly connectionState = signal(this.connection.getSnapshot());
  readonly cdr = inject(ChangeDetectorRef);
  readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly labels = injectChatLabels();
  protected readonly showCursor = computed(
    () => this.isConnecting() || this.agentStore().isRunning(),
  );
  /** `true` while the thread's connect is loading. */
  protected readonly isConnecting = computed(() => {
    this.connectionState();
    return this.connection.isConnecting({
      threadId: this.activeThreadId(),
      explicit: this.activeHasExplicitThreadId(),
    });
  });
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
    threads: this.connection.threads,
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
  /** The locally minted thread, renewed each time a provided thread goes away. */
  private readonly freshThreadId = new ɵFreshThreadId();
  protected readonly resolvedThreadId = computed(() =>
    this.freshThreadId.resolve(this.threadId() || undefined),
  );
  /** The configuration's thread, or this chat's own. */
  private readonly baseThreadId =
    this.config?.threadId ?? this.resolvedThreadId;
  private readonly baseHasExplicitThreadId =
    this.config?.hasExplicitThreadId ?? this.hasExplicitThreadId;
  /** The thread the chat shows: the Inspector's "view thread" override, else its own. */
  private readonly activeThreadId = computed(
    () => this.inspectorOverride()?.threadId ?? this.baseThreadId(),
  );
  private readonly activeHasExplicitThreadId = computed(
    () => this.inspectorOverride() !== null || this.baseHasExplicitThreadId(),
  );
  override readonly attachmentsEnabled = computed(
    () => this.attachmentsConfig()?.enabled ?? false,
  );
  override readonly attachmentsUploading = computed(() =>
    this.attachments().some((attachment) => attachment.status === "uploading"),
  );

  constructor() {
    super();

    const unsubscribeSubmitter = this.submitter.subscribe(() => {
      const state = this.submitter.getSnapshot();
      this.submitterState.set(state);
      this.isTranscribing.set(state.isTranscribing);
      this.cdr.markForCheck();
    });
    const unsubscribeConnection = this.connection.subscribe(() => {
      this.connectionState.set(this.connection.getSnapshot());
      this.cdr.markForCheck();
    });
    this.destroyRef.onDestroy(() => {
      unsubscribeConnection();
      unsubscribeSubmitter();
      this.submitter.dispose();
      this.connection.dispose();
    });

    explicitEffect(this.resolvedAgentId, (agentId, onCleanup) => {
      onCleanup(this.bindSuggestions(agentId));
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
    // The Inspector's "view thread" override takes the place of the chat's
    // own thread while it lasts, like React and Vue.
    this.bindInspectorThreadOverride(this.baseThreadId);
    connectActiveThread(
      {
        threadId: this.activeThreadId,
        hasExplicitThreadId: this.activeHasExplicitThreadId,
        inspectorRequestId: computed(
          () => this.inspectorOverride()?.requestId ?? null,
        ),
      },
      this.agentStore,
      this.connection,
    );
  }

  private readonly inspectorThreadOverride = new ɵInspectorThreadOverride({
    agentId: this.resolvedAgentId(),
    baseThreadId: this.config?.threadId() ?? this.resolvedThreadId(),
  });
  private readonly inspectorOverride = signal(
    this.inspectorThreadOverride.getSnapshot(),
  );

  private bindInspectorThreadOverride(baseThreadId: () => string) {
    const controller = this.inspectorThreadOverride;
    const unsubscribe = controller.subscribe(() => {
      this.inspectorOverride.set(controller.getSnapshot());
    });
    explicitEffect(
      () => ({ agentId: this.resolvedAgentId(), baseThreadId: baseThreadId() }),
      (input) => controller.update(input),
    );
    this.destroyRef.onDestroy(() => {
      unsubscribe();
      controller.dispose();
    });
  }

  /**
   * Shows `agentId`'s suggestions, and loads them when nothing else does:
   * once for the chat's agent, and again when that agent registers, so the
   * provider's `suggestionsConfig` reaches the welcome screen. A config bound
   * through `configureSuggestions` loads itself, so the chat skips an agent
   * whose suggestions are already loading or loaded. Returns the cleanup.
   */
  private bindSuggestions(agentId: string) {
    const core = this.copilotKit.core;
    this.publishSuggestions(core.getSuggestions(agentId));
    const unsubscribe = ɵsubscribeToAgentSuggestions(core, agentId, (result) =>
      this.publishSuggestions(result),
    );
    const current = core.getSuggestions(agentId);
    if (!current.isLoading && current.suggestions.length === 0) {
      this.copilotKit.reloadSuggestions(agentId);
    }
    let isRegistered = core.getAgent(agentId) !== undefined;
    const agents = core.subscribe({
      onAgentsChanged: () => {
        const wasRegistered = isRegistered;
        isRegistered = core.getAgent(agentId) !== undefined;
        const arrived = isRegistered && !wasRegistered;
        if (arrived && !core.getSuggestions(agentId).isLoading) {
          this.copilotKit.reloadSuggestions(agentId);
        }
      },
    });
    return () => {
      unsubscribe();
      agents.unsubscribe();
    };
  }

  private publishSuggestions(result: CopilotKitCoreGetSuggestionsResult) {
    this.suggestions.set(result.suggestions);
    this.suggestionsLoading.set(result.isLoading);
    this.cdr.markForCheck();
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
