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
    /* TODO(copilotkit-2.0): `copied` on the Angular copy buttons is a read-only signal in 2.0. Call `handleCopy()` to copy and show the check mark, or render your own button in the `copyButton` slot. See https://docs.copilotkit.ai/migrate/chat-2.0#angular-copy-buttons */ this.user().copied.set(true);
    /* TODO(copilotkit-2.0): `copied` on the Angular copy buttons is a read-only signal in 2.0. Call `handleCopy()` to copy and show the check mark, or render your own button in the `copyButton` slot. See https://docs.copilotkit.ai/migrate/chat-2.0#angular-copy-buttons */ this.assistant().copied.update((copied) => !copied);
  }

  isCopied() {
    return this.user().copied();
  }
}
