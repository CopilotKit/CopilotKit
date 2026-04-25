"use client";

import React from "react";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import { CustomWelcomeScreen } from "./custom-welcome-screen";

// Outer layer — provider + layout chrome.
export default function ChatSlotsDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="chat-slots">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

// The actual view — just the chat, with a custom welcome screen slot.
function Chat() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
      { title: "Tell me a joke", message: "Tell me a short joke." },
    ],
    available: "always",
  });

  // The welcomeScreen slot is wired in as a prop on <CopilotChat>.
  // @region[register-welcome-slot]
  const welcomeScreen = CustomWelcomeScreen;
  // @endregion[register-welcome-slot]

  return (
    <CopilotChat
      agentId="chat-slots"
      className="h-full rounded-2xl"
      welcomeScreen={welcomeScreen}
    />
  );
}
