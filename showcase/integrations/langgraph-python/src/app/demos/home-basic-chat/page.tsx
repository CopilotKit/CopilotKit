"use client";

/**
 * Homepage: Basic Chat — the bare-minimum CopilotChat surface, styled
 * in the experimental "lavender glass" design language so the iframe
 * preview on the website homepage dojo matches the page around it.
 *
 * Reuses the `agentic_chat` LangGraph backend. All visual customization
 * is one stylesheet import + one scope wrapper — no slot overrides,
 * no headless rendering.
 */

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

import "../_experimental-theme/theme.css";

export default function HomeBasicChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic_chat">
      <div className="hd-exp-scope h-screen w-screen overflow-hidden">
        <CopilotChat agentId="agentic_chat" className="h-full" />
      </div>
    </CopilotKit>
  );
}
