"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  CopilotChatAssistantMessage,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { CustomWelcomeScreen } from "./custom-welcome-screen";
import { CustomAssistantMessage } from "./custom-assistant-message";
import { CustomDisclaimer } from "./custom-disclaimer";

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

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
      { title: "Tell me a joke", message: "Tell me a short joke." },
    ],
    available: "always",
  });

  // @region[register-welcome-slot]
  const welcomeScreen = CustomWelcomeScreen;
  // @endregion[register-welcome-slot]
  // @region[register-disclaimer-slot]
  const input = { disclaimer: CustomDisclaimer };
  // @endregion[register-disclaimer-slot]
  // @region[register-assistant-message-slot]
  const messageView = {
    assistantMessage:
      CustomAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
  };
  // @endregion[register-assistant-message-slot]

  return (
    <CopilotChat
      agentId="chat-slots"
      className="h-full rounded-2xl"
      welcomeScreen={welcomeScreen}
      input={input}
      messageView={messageView}
    />
  );
}
