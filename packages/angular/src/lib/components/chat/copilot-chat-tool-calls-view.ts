import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
} from "@angular/core";

import type { AssistantMessage, Message } from "@ag-ui/core";
import { RenderToolCalls } from "../../render-tool-calls";
import { CopilotInspector } from "../../inspector";
import { CopilotChatConfiguration } from "../../chat-configuration";
import { injectChatLabels } from "../../chat-config";
import { Bookmark, CopilotIcon } from "../icons/copilot-icon";
import { CopilotChatAssistantMessageToolbarButton } from "./copilot-chat-assistant-message-buttons";
import { CopilotSaveSnippetBeside } from "./copilot-save-snippet-beside";

type AssistantToolCall = NonNullable<AssistantMessage["toolCalls"]>[number];

@Component({
  selector: "copilot-chat-tool-calls-view",
  imports: [
    RenderToolCalls,
    CopilotIcon,
    CopilotChatAssistantMessageToolbarButton,
    CopilotSaveSnippetBeside,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (toolCall of message().toolCalls ?? []; track toolCall.id) {
      <copilot-save-snippet-beside [enabled]="inspectorEnabled()">
        <copilot-render-tool-calls
          [message]="singleToolMessage(toolCall)"
          [messages]="messages()"
          [agentId]="agentId()"
          [isLoading]="isLoading()"
        >
        </copilot-render-tool-calls>
        <button
          saveSnippet
          type="button"
          copilotChatAssistantMessageToolbarButton
          data-testid="copilot-tool-save-snippet-button"
          [title]="saveSnippetTitle()"
          (click)="saveToolSnippet(toolCall)"
        >
          <copilot-icon [img]="bookmarkIcon" [size]="18" />
        </button>
      </copilot-save-snippet-beside>
    }
  `,
})
export class CopilotChatToolCallsView {
  readonly message = input.required<AssistantMessage>();
  readonly messages = input.required<Message[]>();
  readonly agentId = input<string | undefined>();
  readonly isLoading = input<boolean>(false);

  private readonly inspector = inject(CopilotInspector, { optional: true });
  private readonly chatConfig = inject(CopilotChatConfiguration, {
    optional: true,
  });
  protected readonly labels = injectChatLabels();
  protected readonly bookmarkIcon = Bookmark;

  protected inspectorEnabled(): boolean {
    return this.inspector?.isLocalInspectorEnabled === true;
  }

  protected saveSnippetTitle(): string {
    return `${this.labels.assistantMessageToolbarSaveSnippetLabel} (${this.labels.assistantMessageToolbarInspectorLocalOnlyLabel})`;
  }

  protected singleToolMessage(toolCall: AssistantToolCall): AssistantMessage {
    return {
      ...this.message(),
      toolCalls: [toolCall],
    };
  }

  protected saveToolSnippet(toolCall: AssistantToolCall): void {
    void this.inspector?.saveEventSnippet({
      kind: "tool-call",
      messageId: this.message().id,
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      argsJson: toolCall.function.arguments || "{}",
      threadId: this.chatConfig?.threadId(),
      agentId: this.chatConfig?.agentId(),
    });
  }
}
