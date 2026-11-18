import { Component, viewChild } from "@angular/core";
import {
  CopilotChatAssistantMessageCopyButton,
  CopilotChatUserMessageCopyButton,
} from "@copilotkit/angular";

@Component({
  selector: "app-copy",
  imports: [CopilotChatUserMessageCopyButton, CopilotChatAssistantMessageCopyButton],
  template: `
    <copilot-chat-user-message-copy-button #user content="Hi" />
    <copilot-chat-assistant-message-copy-button #assistant content="Hello" />
  `,
})
export class CopyComponent {
  readonly user = viewChild.required<CopilotChatUserMessageCopyButton>("user");
  readonly assistant =
    viewChild.required<CopilotChatAssistantMessageCopyButton>("assistant");

  markCopied() {
    this.user().copied.set(true);
    this.assistant().copied.update((copied) => !copied);
  }

  isCopied() {
    return this.user().copied();
  }
}
