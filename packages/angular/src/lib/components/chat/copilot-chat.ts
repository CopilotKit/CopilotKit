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
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotChatView } from "./copilot-chat-view";

import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import {
  Message,
  AbstractAgent,
  AGUIConnectNotImplementedError,
} from "@ag-ui/client";
import { isRunCompletionAware } from "@copilotkit/core";
import { injectAgentStore } from "../../agent";
import { CopilotKit } from "../../copilotkit";
import { ChatState } from "../../chat-state";

/**
 * CopilotChat component - Angular equivalent of React's <CopilotChat>
 * Provides a complete chat interface that wires an agent to the chat view.
 *
 * Run-control behaviour (mirrors React v2 CopilotChat):
 *  - Stop button is visible while a run is active.
 *  - Pressing Enter on an empty input stops the active run.
 *  - New sends are serialised behind the active run's completion promise so
 *    an interrupt-resume is never pre-empted by a concurrent new message.
 *  - The textarea stays editable while a run is in flight.
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
  host: { "data-copilotkit": "" },
  template: `
    <copilot-chat-view
      [messages]="messages() ?? []"
      [autoScroll]="true"
      [messageViewClass]="'w-full'"
      [showCursor]="showCursor()"
      [inputComponent]="inputComponent()"
    >
    </copilot-chat-view>
  `,
  providers: [
    {
      provide: ChatState,
      useExisting: CopilotChat,
    },
  ],
})
export class CopilotChat implements ChatState {
  readonly inputValue = signal<string>("");
  readonly agentId = input<string | undefined>();
  readonly threadId = input<string | undefined>();
  readonly inputComponent = input<Type<any> | undefined>();
  private readonly resolvedAgentId = computed(
    () => this.agentId() ?? DEFAULT_AGENT_ID,
  );
  readonly agentStore = injectAgentStore(this.resolvedAgentId);
  private readonly copilotKit = inject(CopilotKit);
  readonly cdr = inject(ChangeDetectorRef);
  readonly injector = inject(Injector);

  protected messages = computed(() => this.agentStore().messages());
  readonly isRunning = computed(() => this.agentStore().isRunning());
  protected showCursor = signal<boolean>(false);

  /**
   * True when a stop handler should be offered to the UI.
   * Mirrors React v2: `agent.isRunning && hasMessages` — the stop button is
   * only meaningful after at least one message is in the thread.
   */
  readonly canStopRun = computed(
    () => this.isRunning() && this.messages().length > 0,
  );

  private generatedThreadId: string = randomUUID();
  private hasConnectedOnce = false;

  constructor() {
    // Connect once when agent becomes available
    effect(
      () => {
        const a = this.agentStore().agent;
        if (!a) return;
        // Apply thread id when agent is available
        a.threadId = this.threadId() || this.generatedThreadId;
        if (!this.hasConnectedOnce) {
          this.hasConnectedOnce = true;
          if ("isCopilotKitAgent" in (a as any)) {
            this.connectToAgent(a);
          } else {
            // Non-CopilotKit agent: nothing to connect; keep default cursor state
          }
        }
      },
      { allowSignalWrites: true },
    );

    // Keep agent threadId in sync with input
    effect(() => {
      const a = this.agentStore().agent;
      if (a) {
        a.threadId = this.threadId() || this.generatedThreadId;
      }
    });

    // Hide cursor when agent starts (runAgent via core does not pass subscriber callbacks)
    effect(
      () => {
        if (this.isRunning()) {
          this.showCursor.set(false);
          this.cdr.markForCheck();
        }
      },
      { allowSignalWrites: true },
    );
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

  /**
   * Stop the currently active run.
   *
   * Mirrors React v2 `stopCurrentRun`:
   *  1. Tries `core.stopAgent({ agent })` first (also aborts in-flight tools).
   *  2. Falls back to `agent.abortRun()` if `stopAgent` throws.
   *
   * Only has effect when `canStopRun` is true (running with messages), mirroring
   * React v2's `shouldAllowStop = agent.isRunning && hasMessages` guard.
   */
  stopCurrentRun(): void {
    if (!this.canStopRun()) return;

    const agent = this.agentStore().agent;
    if (!agent) return;

    try {
      this.copilotKit.core.stopAgent({ agent });
    } catch (error) {
      console.error("CopilotChat: stopAgent failed", error);
      try {
        agent.abortRun();
      } catch (abortError) {
        console.error("CopilotChat: abortRun fallback failed", abortError);
      }
    }
  }

  /**
   * If a run is currently in flight and the agent is RunCompletionAware,
   * await its `activeRunCompletionPromise` before the next dispatch.
   *
   * Mirrors React v2 `waitForActiveRunToSettle` — prevents a new send from
   * pre-empting an interrupt-resume mid-flight (the consecutive-interrupt
   * regression fix, #5195).
   */
  private async waitForActiveRunToSettle(): Promise<void> {
    const agent = this.agentStore().agent;
    if (
      agent &&
      this.isRunning() &&
      isRunCompletionAware(agent) &&
      agent.activeRunCompletionPromise
    ) {
      try {
        await agent.activeRunCompletionPromise;
      } catch (error) {
        // The in-flight run rejected — proceed with the new send anyway,
        // but log so a chronically-failing run is observable.
        console.error(
          "CopilotChat: in-flight run rejected while queuing send",
          error,
        );
      }
    }
  }

  /**
   * Send a new user message.
   *
   * Mirrors React v2 `onSubmitInput`:
   *  - Clears the input immediately (optimistic UX).
   *  - Awaits `waitForActiveRunToSettle` so an interrupt-resume finishes
   *    before the new run begins.
   *  - Adds the user message and calls `core.runAgent`.
   */
  async submitInput(value: string): Promise<void> {
    const agent = this.agentStore().agent;
    if (!agent || !value.trim()) return;

    // Clear the input immediately so the composer reflects the accepted send
    // even though the actual dispatch may be deferred behind the in-flight run.
    this.inputValue.set("");

    // If a run is already in flight, let it finish before sending the new
    // message instead of pre-empting it (mirrors React v2 serialization).
    await this.waitForActiveRunToSettle();

    // Add user message
    const userMessage: Message = {
      id: randomUUID(),
      role: "user",
      content: value,
    };
    agent.addMessage(userMessage);

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

  changeInput(value: string): void {
    this.inputValue.set(value);
  }
}
