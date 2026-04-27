"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useConfigureSuggestions } from "@copilotkit/react-core/v2";

import "./theme.css";

export default function ChatCustomizationCssDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="chat_customization_css">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Quick poem", message: "Write a 4-line poem about morning coffee." },
      { title: "Travel one-liner", message: "Give me a one-liner about Tokyo at night." },
    ],
    available: "always",
  });

  return (
    <div className="chat-css-demo-scope flex justify-center items-center h-screen w-full">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat agentId="chat_customization_css" className="h-full" />
      </div>
    </div>
  );
}
