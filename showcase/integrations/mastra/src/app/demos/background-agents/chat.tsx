"use client";

import { CopilotChat } from "@copilotkit/react-core";
import { useBackgroundAgentsSuggestions } from "./suggestions";

export function Chat() {
  useBackgroundAgentsSuggestions();
  return (
    <CopilotChat agentId="background-agents" className="h-full rounded-2xl" />
  );
}
