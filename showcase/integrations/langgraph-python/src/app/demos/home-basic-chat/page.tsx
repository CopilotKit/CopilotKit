"use client";

/**
 * Homepage: Basic Chat — the bare-minimum CopilotChat surface, styled
 * in the experimental "lavender glass" design language so the iframe
 * preview on the website homepage dojo matches the page around it.
 *
 * Reuses the `agentic_chat` LangGraph backend. All visual customization
 * is one stylesheet import + one scope wrapper — no slot overrides,
 * no headless rendering. Suggestion pills give the empty state a few
 * one-click prompts so the dojo's first impression isn't a blank input.
 */

import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import "../_experimental-theme/theme.css";

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
      { title: "Tell me a joke", message: "Tell me a one-line joke." },
      { title: "Is 17 prime?", message: "Walk me through whether 17 is prime." },
    ],
    available: "always",
  });
  return <CopilotChat agentId="agentic_chat" className="h-full" />;
}

export default function HomeBasicChatDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="agentic_chat"
      enableInspector={false}
    >
      <div className="hd-exp-scope h-screen w-screen overflow-hidden">
        <Chat />
      </div>
    </CopilotKit>
  );
}
