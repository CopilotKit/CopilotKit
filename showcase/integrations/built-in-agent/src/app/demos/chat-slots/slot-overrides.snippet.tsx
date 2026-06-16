// Docs-only snippet — not imported or rendered. The production demo registers
// a larger slot atlas in page.tsx; this file keeps the docs example focused on
// the three slot patterns users usually copy first.
//
// This file gives the slots docs page (custom-look-and-feel/slots.mdx)
// three minimal teaching examples — the welcome screen, assistant
// message, and disclaimer slot patterns — without changing the
// production demo's runtime behavior.

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
