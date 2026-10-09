import { Component, ChangeDetectionStrategy, input } from "@angular/core";

import type { AssistantMessage, Message } from "@ag-ui/core";
import { RenderToolCalls } from "../../render-tool-calls";

@Component({
  selector: "copilot-chat-tool-calls-view",
  imports: [RenderToolCalls],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <copilot-render-tool-calls
      [message]="message()"
      [messages]="messages()"
      [agentId]="agentId()"
      [isLoading]="isLoading()"
    >
    </copilot-render-tool-calls>
  `,
})
export class CopilotChatToolCallsView {
  readonly message = input.required<AssistantMessage>();
  readonly messages = input.required<Message[]>();
  readonly agentId = input<string | undefined>();
  readonly isLoading = input<boolean>(false);
}
