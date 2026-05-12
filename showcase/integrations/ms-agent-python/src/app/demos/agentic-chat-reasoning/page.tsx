"use client";

// Agentic Chat (Reasoning) -- visible reasoning chain alongside the final
// answer for the Microsoft Agent Framework backend.
//
// How reasoning surfaces here:
//   - The backend agent (src/agents/reasoning_agent.py) routes through
//     `OpenAIChatClient` (Responses API) on `gpt-5.2` with
//     `reasoning={"effort":"medium","summary":"detailed"}`. The
//     agent-framework AG-UI bridge converts the streamed reasoning
//     summary into first-class AG-UI REASONING_MESSAGE_* events.
//   - The frontend overrides the `messageView.reasoningMessage` slot on
//     `<CopilotChat />` with `<ReasoningBlock />` -- the same pattern the
//     LangGraph reference uses. No tool plumbing, no `useRenderTool`.

import {
  CopilotKit,
  CopilotChat,
  CopilotChatReasoningMessage,
} from "@copilotkit/react-core/v2";
import { ReasoningBlock } from "./reasoning-block";

const AGENT_ID = "agentic-chat-reasoning";

export default function AgenticChatReasoningDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-reasoning" agent={AGENT_ID}>
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  return (
    <CopilotChat
      agentId={AGENT_ID}
      className="h-full rounded-2xl"
      messageView={{
        // @region[reasoning-block-render]
        reasoningMessage:
          ReasoningBlock as unknown as typeof CopilotChatReasoningMessage,
        // @endregion[reasoning-block-render]
      }}
    />
  );
}
