"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// The chat-slots cell is wired to the neutral chat agent, so it does not emit
// AG-UI REASONING_MESSAGE_* events. The `messageView.reasoningMessage` slot is
// wrapped for the slot-atlas demo but stays dormant here; the reasoning demos
// live at /demos/reasoning-default and /demos/reasoning-custom instead.
export function useChatSlotsSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
      { title: "Tell me a joke", message: "Tell me a short joke." },
    ],
    available: "always",
  });
}
