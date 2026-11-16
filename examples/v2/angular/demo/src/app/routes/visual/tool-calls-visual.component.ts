import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CopilotChatMessageView } from "@copilotkit/angular";
import type { Message } from "@copilotkit/angular";

/**
 * Fixed transcript for visual regression tests (`e2e/visual`). It renders the
 * app's real tool call renderer without an agent or a network request: a tool
 * call with a matching `tool` message renders as complete, one without renders
 * as running.
 */
const MESSAGES: Message[] = [
  { id: "user-1", role: "user", content: "What's the weather in Paris?" },
  {
    id: "assistant-running",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "call-running",
        type: "function",
        function: {
          name: "get_weather",
          arguments: JSON.stringify({ city: "Paris", unit: "celsius" }),
        },
      },
    ],
  },
  {
    id: "assistant-complete",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "call-complete",
        type: "function",
        function: {
          name: "search_flights",
          arguments: JSON.stringify({ from: "SFO", to: "CDG" }),
        },
      },
    ],
  },
  {
    id: "tool-complete",
    role: "tool",
    toolCallId: "call-complete",
    content: "3 flights found",
  },
];

@Component({
  selector: "tool-calls-visual",
  standalone: true,
  imports: [CopilotChatMessageView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="visual-frame" data-testid="visual-tool-calls">
      <copilot-chat-message-view [messages]="messages" />
    </div>
  `,
  styles: `
    .visual-frame {
      width: 640px;
      padding: 16px;
    }
  `,
})
export class ToolCallsVisualComponent {
  protected readonly messages = MESSAGES;
}
