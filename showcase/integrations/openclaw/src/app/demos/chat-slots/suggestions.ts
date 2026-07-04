"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// The chat-slots cell drives the same neutral OpenClaw agent as agentic-chat
// (plain streamed chat, no reasoning config), so it never emits AG-UI
// REASONING_MESSAGE_* events — the `messageView.reasoningMessage` slot is
// wrapped for the slot-atlas demo but stays dormant here. A "Show reasoning"
// pill therefore can't light it up; that demo lives at
// /demos/agentic-chat-reasoning instead.
export function useChatSlotsSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
      { title: "Tell me a joke", message: "Tell me a short joke." },
    ],
    available: "always",
  });
}
