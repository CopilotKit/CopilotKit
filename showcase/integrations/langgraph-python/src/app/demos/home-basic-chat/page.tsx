"use client";

/**
 * Homepage: Basic Chat — the bare-minimum CopilotChat surface.
 *
 * Reuses the `agentic_chat` LangGraph backend (same as /demos/agentic-chat),
 * but strips the suggestions module and any layout wrapper. This is the
 * iframe target for the "Basic Chat" chip on the website homepage dojo.
 */

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

export default function HomeBasicChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic_chat">
      <CopilotChat agentId="agentic_chat" />
    </CopilotKit>
  );
}
