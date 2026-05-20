// Docs-only snippet — not imported or rendered. llamaindex's chat-slots
// production demo only registers the welcome slot (see page.tsx). The
// docs page also teaches the disclaimer and assistant-message slot
// patterns, which are framework-agnostic CopilotKit primitives. This
// file gives those two regions a real teaching example without changing
// the production demo's runtime behavior. See chat-component.snippet.tsx
// in agentic-chat for the same sibling-file pattern.

// @region[register-assistant-message-slot]
// @region[register-disclaimer-slot]
import type { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";

declare const CustomDisclaimer: React.ComponentType;
declare const CustomAssistantMessage: React.ComponentType;

export function ChatSlotsExtras() {
  const input = { disclaimer: CustomDisclaimer };
  // @endregion[register-disclaimer-slot]

  const messageView = {
    assistantMessage:
      CustomAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
  };
  // @endregion[register-assistant-message-slot]

  return { input, messageView };
}
