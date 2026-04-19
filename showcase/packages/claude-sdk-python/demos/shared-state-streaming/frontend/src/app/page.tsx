"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function SharedStateStreamingDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-streaming">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  // TODO: Implement State Streaming demo
  // See the LangGraph Python reference implementation for patterns
  //
  // Key hooks available:
  //   useFrontendTool({ name, description, parameters: z.object({...}), handler })
  //   useRenderTool({ name: "tool_name", render: ({ args }) => <Component /> })
  //   useHumanInTheLoop({ name, description, parameters, handler: ({ args, respond }) => ... })
  //   useAgentContext({ description, value })
  //   useConfigureSuggestions({ suggestions: [{ title, message }] })
  //   useInterrupt({ render: ({ event, resolve }) => <Component /> })

  useConfigureSuggestions({
    suggestions: [{ title: "Get started", message: "Hello! What can you do?" }],
  });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <CopilotChat agentId="shared-state-streaming" />
    </div>
  );
}
