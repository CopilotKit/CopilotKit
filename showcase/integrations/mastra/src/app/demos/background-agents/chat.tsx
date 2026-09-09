"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useBackgroundAgentsSuggestions } from "./suggestions";

export function Chat() {
  useBackgroundAgentsSuggestions();
  return (
    <CopilotChat agentId="background-agents" className="h-full rounded-2xl" />
  );
}
