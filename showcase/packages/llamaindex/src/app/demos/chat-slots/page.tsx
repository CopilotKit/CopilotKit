"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { CustomWelcomeScreen } from "./custom-welcome-screen";

export default function ChatSlotsDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="chat_slots">
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

  return (
    <CopilotChat
      agentId="chat_slots"
      className="h-full rounded-2xl"
      welcomeScreen={CustomWelcomeScreen}
    />
  );
}
