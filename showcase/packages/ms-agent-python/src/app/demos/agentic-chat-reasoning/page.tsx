"use client";

// Agentic Chat (Reasoning) — visible reasoning chain alongside the final
// answer for the Microsoft Agent Framework backend.
//
// How reasoning surfaces here:
//   - LangGraph reference relies on AG-UI REASONING_MESSAGE_* events, which
//     CopilotKit renders via the first-class `reasoningMessage` slot on
//     CopilotChat.
//   - The MS Agent Framework AG-UI bridge does not currently emit those
//     events. To provide the equivalent UX, the backend agent is instructed
//     to call a `think(thought=...)` tool before every answer, and the
//     frontend uses `useRenderTool` to render that tool call as a visibly
//     tagged amber block — the same visual language as the reference.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ReasoningBlock } from "./reasoning-block";

export default function AgenticChatReasoningDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-reasoning"
      agent="agentic-chat-reasoning"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // @region[reasoning-block-render]
  useRenderTool({
    name: "think",
    parameters: z.object({
      thought: z.string(),
    }),
    render: ({ args, status }: any) => (
      <ReasoningBlock args={args} status={status} />
    ),
  });
  // @endregion[reasoning-block-render]

  return (
    <CopilotChat
      agentId="agentic-chat-reasoning"
      className="h-full rounded-2xl"
    />
  );
}
