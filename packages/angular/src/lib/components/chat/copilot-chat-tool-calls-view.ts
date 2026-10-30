import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from "@angular/core";

import type { AssistantMessage, Message } from "@ag-ui/core";
import { CopilotKit } from "../../copilotkit";
import { RenderToolCall } from "../../render-tool-calls";
import type { CopilotChatToolCallGroupAppearance } from "../tools/tool-call-render-context";
import { CopilotChatToolCallGroup } from "./copilot-chat-tool-call-group";
import { TOOL_CALL_DISPLAY_CONTEXT } from "./tool-call-display-context";
import {
  getToolCallLayouts,
  getToolCallRendererNames,
  type CopilotChatToolCallDisplay,
} from "./tool-call-layout";

const appearances: Record<
  Exclude<CopilotChatToolCallDisplay, "separate">,
  CopilotChatToolCallGroupAppearance
> = {
  grouped: "card",
  line: "line",
  stacked: "stack",
};

/**
 * An assistant message's tool calls, each drawn by its registered renderer.
 * Calls made in a row by renderers that opt into grouping share one
 * `copilot-chat-tool-call-group`, as in React.
 */
@Component({
  selector: "copilot-chat-tool-calls-view",
  imports: [RenderToolCall, CopilotChatToolCallGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (layout(); as layout) {
      @for (segment of layout.segments; track segment.id) {
        @if (segment.kind === "call") {
          <copilot-render-tool-call
            [toolCall]="segment.call.toolCall"
            [message]="message()"
            [messages]="messages()"
            [agentId]="agentId()"
            [isLoading]="isLoading()"
          />
        } @else {
          <copilot-chat-tool-call-group
            [calls]="segment.calls"
            [appearance]="appearance()"
            [isActive]="segment.trailing && isRunning()"
            [message]="message()"
            [messages]="messages()"
            [agentId]="agentId()"
            [isLoading]="isLoading()"
          />
        }
      }
    } @else {
      @for (toolCall of message().toolCalls ?? []; track toolCall.id) {
        <copilot-render-tool-call
          [toolCall]="toolCall"
          [message]="message()"
          [messages]="messages()"
          [agentId]="agentId()"
          [isLoading]="isLoading()"
        />
      }
    }
  `,
})
export class CopilotChatToolCallsView {
  readonly message = input.required<AssistantMessage>();
  readonly messages = input.required<Message[]>();
  readonly agentId = input<string | undefined>();
  readonly isLoading = input<boolean>(false);
  /**
   * How to show the calls (see `CopilotChatToolCallDisplay`). Inside a
   * message view it follows the view's `toolCallDisplay`; on its own it
   * defaults to `"grouped"`.
   */
  readonly display = input<CopilotChatToolCallDisplay | undefined>();

  readonly #copilotKit = inject(CopilotKit);
  readonly #context = inject(TOOL_CALL_DISPLAY_CONTEXT, { optional: true });

  protected readonly resolvedDisplay = computed(
    () => this.display() ?? this.#context?.display() ?? "grouped",
  );
  protected readonly appearance = computed(() => {
    const display = this.resolvedDisplay();
    return display === "separate" ? "card" : appearances[display];
  });
  /**
   * Whether the agent may still finish a trailing group's calls. Without a
   * message view there's no run state, so a call with no result is assumed
   * to be running.
   */
  protected readonly isRunning = computed(
    () => this.#context?.isRunning() ?? true,
  );

  // Inside a message view, groups can span messages, so the view lays them
  // out for the whole list; on its own, this message's calls are grouped.
  protected readonly layout = computed(() => {
    if (this.resolvedDisplay() === "separate") return undefined;
    const message = this.message();
    return (
      this.#context?.layouts().get(message.id) ??
      getToolCallLayouts(
        [message],
        this.messages(),
        getToolCallRendererNames(this.#copilotKit),
      ).get(message.id)
    );
  });
}
