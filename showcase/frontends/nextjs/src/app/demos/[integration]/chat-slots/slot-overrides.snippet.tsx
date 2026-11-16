// Docs-only snippet: nothing imports or renders this file. page.tsx
// registers a dozen slot overrides at once, and it sends each one through
// `makeSlotOverride` (see ../_shared/slot-override.ts), because the slot
// prop types expect the exact default component. That helper hides the
// shape that the docs teach.
//
// This file gives the slots docs page (custom-look-and-feel/slots.mdx)
// three short examples: the welcome screen, the assistant message and the
// disclaimer slot. Each one shows the type assertion that a custom slot
// component needs, without a change to what page.tsx renders.

// @region[register-disclaimer-slot]
// @region[register-assistant-message-slot]
// @region[register-welcome-slot]
import type { ComponentType } from "react";
import type {
  CopilotChatAssistantMessage,
  CopilotChatInput,
  CopilotChatView,
} from "@copilotkit/react-core/v2";

declare const CustomWelcomeScreen: ComponentType;
declare const CustomAssistantMessage: ComponentType;
declare const CustomDisclaimer: ComponentType;

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
