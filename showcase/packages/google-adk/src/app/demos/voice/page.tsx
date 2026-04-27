"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useConfigureSuggestions } from "@copilotkit/react-core/v2";

export default function VoiceDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="voice">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Try voice", message: "Tap the mic and ask me anything." },
      { title: "Quick tip", message: "Give me one productivity tip." },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-screen w-full bg-gradient-to-br from-purple-50 to-pink-50">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="voice"
          className="h-full rounded-2xl"
          input={{
            // The voice button is rendered automatically when @copilotkit/voice
            // is installed and the runtime exposes a transcribe endpoint;
            // CopilotChat picks it up via its default input slot.
          }}
        />
      </div>
    </div>
  );
}
