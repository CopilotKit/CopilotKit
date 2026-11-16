"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// The chat-slots agent is a plain chat agent with no reasoning settings, so
// it does not send AG-UI REASONING_MESSAGE_* events. The page wraps the
// `messageView.reasoningMessage` slot for the slot atlas, but that slot stays
// empty here. For this reason, there is no "Show reasoning" suggestion. The
// reasoning-default and reasoning-custom demos show reasoning.
export function useChatSlotsSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
      { title: "Tell me a joke", message: "Tell me a short joke." },
    ],
    available: "always",
  });
}
