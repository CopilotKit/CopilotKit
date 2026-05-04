import { Component, ChangeDetectionStrategy, input } from "@angular/core";
import { CommonModule } from "@angular/common";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { RenderToolCalls } from "../../render-tool-calls";

@Component({
  standalone: true,
  selector: "copilot-chat-tool-calls-view",
  imports: [CommonModule, RenderToolCalls],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <copilot-render-tool-calls
      [message]="message()"
      [messages]="messages()"
      [isLoading]="isLoading()"
    >
    </copilot-render-tool-calls>
  `,
})
export class CopilotChatToolCallsView {
  readonly message = input.required<AssistantMessage>();
  readonly messages = input.required<Message[]>();
  readonly isLoading = input<boolean>(false);
}
