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

import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkitnext/shared";
import { Message, AbstractAgent } from "@ag-ui/client";
import { injectAgentStore } from "../../agent";
import { ChatState } from "../../chat-state";

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
    () => this.agentId() ?? DEFAULT_AGENT_ID
  );
  readonly agentStore = injectAgentStore(this.resolvedAgentId);
  // readonly chatConfig = injectChatConfig();
  readonly cdr = inject(ChangeDetectorRef);
  readonly injector = inject(Injector);

  protected messages = computed(() => this.agentStore()?.messages());
  protected isRunning = computed(() => this.agentStore()?.isRunning());
  protected showCursor = signal<boolean>(false);

  private generatedThreadId: string = randomUUID();
  private hasConnectedOnce = false;

  constructor() {
    // Connect once when agent becomes available
    // Connect once when agent becomes available
    effect(
      () => {
        const a = this.agentStore()?.agent;
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
      { allowSignalWrites: true }
    );

    // Keep agent threadId in sync with input
    effect(() => {
      const a = this.agentStore()?.agent;
      if (a) {
        a.threadId = this.threadId() || this.generatedThreadId;
      }
    });
  }

  private async connectToAgent(agent: AbstractAgent): Promise<void> {
    if (!agent) return;

    this.showCursor.set(true);
    this.cdr.markForCheck();

    try {
      await agent.runAgent(
        { forwardedProps: { __copilotkitConnect: true } },
        {
          onTextMessageStartEvent: () => {
            this.showCursor.set(false);
            this.cdr.detectChanges();
          },
          onToolCallStartEvent: () => {
            this.showCursor.set(false);
            this.cdr.detectChanges();
          },
        }
      );
      this.showCursor.set(false);
      this.cdr.markForCheck();
    } catch (error) {
      console.error("Failed to connect to agent:", error);
      this.showCursor.set(false);
      this.cdr.markForCheck();
    }
  }

  async submitInput(value: string): Promise<void> {
    const agent = this.agentStore()?.agent;
    if (!agent || !value.trim()) return;

    // Add user message
    const userMessage: Message = {
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

    // Run the agent with named subscriber callbacks
    try {
      await agent.runAgent(
        {},
        {
          onTextMessageStartEvent: () => {
            this.showCursor.set(false);
            this.cdr.detectChanges();
          },
          onToolCallStartEvent: () => {
            this.showCursor.set(false);
            this.cdr.detectChanges();
          },
        }
      );
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
