"use client";

import { useMemo } from "react";
import type { ButtonHTMLAttributes } from "react";
import {
  CopilotChat,
  CopilotChatInput,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { AGENT_ID } from "@/agent";
import { Canvas } from "@/components/canvas";
import { ModelPicker } from "@/components/model-picker";
import { QUICK_PROMPTS, STARTER_PROMPTS } from "@/lib/canvas";
import { useSendPrompt } from "@/lib/use-send-prompt";

const MESSAGE_VIEW = {
  assistantMessage: { toolbarVisible: false },
  userMessage: { toolbar: () => null },
};

function NoAddButton() {
  return null;
}

function SendWithModel(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <div className="send-with-model">
      <ModelPicker />
      <CopilotChatInput.SendButton {...props} />
    </div>
  );
}

export default function Page() {
  useConfigureSuggestions({
    suggestions: STARTER_PROMPTS.map(({ title, message }) => ({
      title,
      message,
    })),
    available: "before-first-message",
  });
  const { send } = useSendPrompt();

  const input = useMemo(
    () => ({
      // The work lands on the canvas, so the input has no disclaimer.
      showDisclaimer: false,
      // No "+" (nothing to attach); the model chip sits next to send, where it
      // stays put when the input grows to two rows.
      addMenuButton: NoAddButton,
      sendButton: SendWithModel,
      // Typing "/" lists these.
      toolsMenu: [
        {
          label: "Make it compact",
          action: () => void send(QUICK_PROMPTS.compact),
        },
        { label: "Add a chart", action: () => void send(QUICK_PROMPTS.chart) },
        {
          label: "Translate to Spanish",
          action: () => void send(QUICK_PROMPTS.translate),
        },
        "-" as const,
        { label: "New chat", action: () => window.location.reload() },
      ],
    }),
    [send],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-mark" aria-hidden>
            A2UI
          </span>
          Canvas
        </div>
        <div className="topbar-by">CopilotKit × Google Antigravity</div>
      </header>
      <main className="workspace">
        <section className="chat-pane" aria-label="Chat">
          <CopilotChat
            agentId={AGENT_ID}
            labels={{
              welcomeMessageText: "What should we build on the canvas?",
              chatInputPlaceholder: "Ask anything",
            }}
            // The chat stays a plain transcript: no copy toolbars.
            messageView={MESSAGE_VIEW}
            input={input}
          />
        </section>
        <Canvas />
      </main>
    </div>
  );
}
