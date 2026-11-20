// Docs-only snippet — not imported or rendered. The langgraph-python
// chat-slots production demo registers a dozen slot overrides at once
// (see page.tsx) with `as unknown as typeof X` casts that exist to
// satisfy the WithSlots types when the wrappers are structurally
// compatible but not nominally identical. That's necessary in the
// running app but obscures the teaching shape.
//
// This file gives the slots docs page (custom-look-and-feel/slots.mdx)
// three minimal teaching examples — the welcome screen, assistant
// message, and disclaimer slot patterns — without changing the
// production demo's runtime behavior. See agentic-chat /
// chat-component.snippet.tsx for the same sibling-file pattern.

// @region[register-disclaimer-slot]
// @region[register-assistant-message-slot]
// @region[register-welcome-slot]
import type {
  CopilotChatAssistantMessage,
  CopilotChatInput,
  CopilotChatView,
} from "@copilotkit/react-core/v2";

declare const CustomWelcomeScreen: React.ComponentType;
declare const CustomAssistantMessage: React.ComponentType;
declare const CustomDisclaimer: React.ComponentType;

export function ChatSlotsTeachingExtracts() {
  const welcomeScreen =
    CustomWelcomeScreen as unknown as typeof CopilotChatView.WelcomeScreen;
  // @endregion[register-welcome-slot]

  const messageView = {
    assistantMessage:
      CustomAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
  };
  // @endregion[register-assistant-message-slot]

  const input = {
    disclaimer:
      CustomDisclaimer as unknown as typeof CopilotChatInput.Disclaimer,
  };
  // @endregion[register-disclaimer-slot]

  return { welcomeScreen, messageView, input };
}
