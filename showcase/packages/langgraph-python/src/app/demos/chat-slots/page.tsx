"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatAssistantMessage,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import type { CopilotChatAssistantMessageProps } from "@copilotkit/react-core/v2";

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

// The actual view — just the chat, with two slot overrides.
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
      agentId="chat-slots"
      className="h-full rounded-2xl"
      welcomeScreen={CustomWelcomeScreen}
      input={{ disclaimer: CustomDisclaimer }}
      messageView={{
        assistantMessage:
          CustomAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
      }}
    />
  );
}

// Custom assistantMessage sub-slot of messageView — wraps the default assistant
// message in a visibly tinted card with a corner "slot" badge, proving the slot
// override is active during the in-chat message flow (not just the welcome screen).
function CustomAssistantMessage(props: CopilotChatAssistantMessageProps) {
  return (
    <div
      data-testid="custom-assistant-message"
      className="relative rounded-xl border border-indigo-200 bg-indigo-50/60 dark:bg-indigo-950/40 dark:border-indigo-800 p-3 my-3"
    >
      <span className="absolute -top-2 -left-2 inline-block rounded-full bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 shadow">
        slot
      </span>
      <CopilotChatAssistantMessage {...props} />
    </div>
  );
}

// Custom welcomeScreen slot — a visibly distinct gradient card wrapping the
// default input + suggestions props passed in by CopilotChatView.
function CustomWelcomeScreen({
  input,
  suggestionView,
}: {
  input: React.ReactElement;
  suggestionView: React.ReactElement;
}) {
  return (
    <div
      data-testid="custom-welcome-screen"
      className="flex-1 flex flex-col items-center justify-center px-4"
    >
      <div className="w-full max-w-3xl flex flex-col items-center">
        <div className="mb-6 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-6 text-white shadow-lg text-center">
          <div className="inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider mb-3">
            Custom Slot
          </div>
          <h1 className="text-2xl font-bold">Welcome to the Slots demo</h1>
          <p className="mt-2 text-sm text-white/90">
            This welcome card is rendered via the{" "}
            <code className="font-mono">welcomeScreen</code> slot.
          </p>
        </div>
        <div className="w-full">{input}</div>
        <div className="mt-4 flex justify-center">{suggestionView}</div>
      </div>
    </div>
  );
}

// Custom disclaimer sub-slot of the input — visibly tagged so reviewers can
// tell the slot is in use even once the welcome screen is dismissed.
function CustomDisclaimer(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      data-testid="custom-disclaimer"
      className="text-xs text-center text-muted-foreground py-2"
    >
      <span className="inline-block rounded bg-indigo-100 text-indigo-700 px-2 py-0.5 mr-2 font-semibold">
        slot
      </span>
      Custom disclaimer injected via <code>input.disclaimer</code>.
    </div>
  );
}
