"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function SubagentsDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="subagents">
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
        agentId="subagents"
        labels={{
          title: "Sub-Agents",
          placeholder: "Type a message...",
        }}
      />
    </div>
  );
}
