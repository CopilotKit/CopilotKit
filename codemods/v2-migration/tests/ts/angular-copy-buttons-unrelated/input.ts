import { signal } from "@angular/core";
import { CopilotChatUserMessage } from "@copilotkit/angular";

export const messages = [CopilotChatUserMessage];

const state = { copied: signal(false) };

export function markCopied() {
  state.copied.set(true);
}
