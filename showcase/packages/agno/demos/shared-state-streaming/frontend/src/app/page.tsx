"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function SharedStateStreamingDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-streaming">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [{ title: "Get started", message: "Hello! What can you do?" }],
  });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <CopilotChat
        agentId="shared-state-streaming"
        labels={{
          title: "State Streaming",
          placeholder: "Type a message...",
        }}
      />
    </div>
  );
}
