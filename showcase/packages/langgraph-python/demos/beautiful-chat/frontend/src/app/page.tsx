"use client";

// Beautiful Chat — canonical polished starter chat surface.
//
// Mirrors the chat polish from /examples/integrations/langgraph-python:
//   - Brand fonts (Plus Jakarta Sans + Spline Sans Mono) + theme tokens
//   - Centered max-w-4xl chat panel with logo chrome above it
//   - CopilotChat with `disclaimer: () => null` + pb-6 input polish
//   - Suggestion pills registered via useConfigureSuggestions
//   - Light/Dark/System theme toggle

import React from "react";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { ModeToggle } from "@/components/mode-toggle";

export default function BeautifulChatDemo() {
  return (
    <div className="h-screen w-full flex flex-col bg-[var(--background)]">
      <header className="shrink-0 flex items-center justify-between px-6 pt-6 pb-2 max-lg:px-4 max-lg:pt-4">
        <img
          src="/copilotkit-logo.svg"
          alt="CopilotKit"
          className="h-7 dark:invert"
        />
        <ModeToggle />
      </header>
      <main className="flex-1 min-h-0 flex justify-center">
        <div className="h-full w-full max-w-4xl px-4">
          <Chat />
        </div>
      </main>
    </div>
  );
}

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Explain CopilotKit",
        message: "Give me a friendly 3-sentence elevator pitch for CopilotKit.",
      },
      {
        title: "Write a sonnet",
        message: "Write a short sonnet about AI and curiosity.",
      },
      {
        title: "Plan my day",
        message:
          "Help me plan a focused 4-hour block for shipping a small feature. Give concrete steps.",
      },
      {
        title: "Teach me something",
        message:
          "Teach me one surprising concept from information theory in under a minute.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="beautiful-chat"
      className="h-full rounded-2xl"
      input={{ disclaimer: () => null, className: "pb-6" }}
    />
  );
}
