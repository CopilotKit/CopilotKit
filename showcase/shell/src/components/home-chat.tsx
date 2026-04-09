"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkitnext/react";

export function HomeChat() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <HomeChatInner />
    </CopilotKitProvider>
  );
}

function HomeChatInner() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Get started",
        message:
          "I want to get started with CopilotKit. Which agent framework should I use?",
      },
      {
        title: "Generative UI",
        message: "Show me what Generative UI looks like. What demos can I try?",
      },
      {
        title: "Live demo",
        message: "I want to try a live demo right now. What's available?",
      },
      {
        title: "Compare frameworks",
        message:
          "Compare the features supported by each agent framework integration.",
      },
      {
        title: "Help me choose",
        message: "Help me choose the right agent framework for my project.",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex-1 flex flex-col border-r border-[var(--border)]">
      <div className="px-8 pt-6 pb-4 border-b border-[var(--border)]">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">
          CopilotKit Docs
        </h1>
        <p className="text-[13px] text-[var(--text-secondary)] mt-1">
          Ask anything, explore the stack, or jump to what you need.
        </p>
      </div>
      <CopilotChat className="flex-1" />
    </div>
  );
}
