"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useConfigureSuggestions } from "@copilotkit/react-core/v2";

export default function MultimodalDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="multimodal">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Describe upload",
        message: "Describe what you see in the attached image.",
      },
      {
        title: "Summarize PDF",
        message: "Summarize the attached PDF in 3 bullet points.",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-screen w-full bg-gray-50">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="multimodal"
          className="h-full rounded-2xl"
          labels={{
            chatInputPlaceholder:
              "Attach an image or PDF, then ask about it...",
          }}
        />
      </div>
    </div>
  );
}
