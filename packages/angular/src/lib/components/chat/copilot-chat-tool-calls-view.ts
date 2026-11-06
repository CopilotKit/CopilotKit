import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from "@angular/core";

import type { Signal } from "@angular/core";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { CopilotKit } from "../../copilotkit";
import { RenderToolCall } from "../../render-tool-calls";
import { ɵgetToolCallGroupState, ɵtoolCallAppearance } from "@copilotkit/core";
import { CopilotChatToolCallGroup } from "./copilot-chat-tool-call-group";
import { CopilotCollapsible } from "../tools/tool-call-parts";
import type {
  ToolCallRenderContext,
  ToolCallRowStatus,
} from "../tools/tool-call-render-context";
import { TOOL_CALL_DISPLAY_CONTEXT } from "./tool-call-display-context";
import {
  getToolCallLayouts,
  getToolCallRendererNames,
} from "./tool-call-layout";
import type { CopilotChatToolCallDisplay } from "./tool-call-layout";

/**
 * An assistant message's tool calls, each drawn by its registered renderer.
 * Calls made in a row by renderers that opt into grouping share one
 * `copilot-chat-tool-call-group`, as in React.
 */
@Component({
  selector: "copilot-chat-tool-calls-view",
  imports: [RenderToolCall, CopilotChatToolCallGroup, CopilotCollapsible],
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
        } @else if (resolvedDisplay() === "turn") {
          <!-- A row per call, in the open while the agent works; the message
               view folds them away with the rest of the work once it's done. -->
          <div
            [copilotCollapsible]="workOpen() ?? true"
            class="cpk-tool-calls-view-turn"
          >
            <div class="cpk-tool-calls-view-turn-rows">
              @for (call of segment.calls; track call.toolCall.id) {
                <copilot-render-tool-call
                  [toolCall]="call.toolCall"
                  [message]="message()"
                  [messages]="messages()"
                  [agentId]="agentId()"
                  [isLoading]="isLoading()"
                  [row]="turnRowFor(call.toolCall.id)"
                />
              }
            </div>
          </div>
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
  protected readonly appearance = computed(
    () => ɵtoolCallAppearance(this.resolvedDisplay()) ?? "card",
  );
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

  /** `"turn"` display: whether this message's work is showing. */
  protected readonly workOpen = computed(() =>
    this.#context?.workOpen().get(this.message().id),
  );

  // `"turn"` display: each call's row status, by call id.
  readonly #turnStatuses = computed(() => {
    const statuses = new Map<string, ToolCallRowStatus>();
    for (const segment of this.layout()?.segments ?? []) {
      if (segment.kind !== "group") continue;
      const active = segment.trailing && this.isRunning();
      const { statusById } = ɵgetToolCallGroupState(
        segment.calls,
        active,
        false,
      );
      for (const [id, status] of statusById) statuses.set(id, status);
    }
    return statuses;
  });
  // One row context per call, so its renderer isn't recreated on updates.
  readonly #turnRows = new Map<
    string,
    NonNullable<ToolCallRenderContext["row"]>
  >();

  protected turnRowFor(toolCallId: string): ToolCallRenderContext["row"] {
    let row = this.#turnRows.get(toolCallId);
    if (!row) {
      const status: Signal<ToolCallRowStatus> = computed(
        () => this.#turnStatuses().get(toolCallId) ?? "done",
      );
      row = { appearance: "line", status };
      this.#turnRows.set(toolCallId, row);
    }
    return row;
  }
}
