"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useMcpAppsSuggestions } from "./suggestions";

export function Chat() {
  useMcpAppsSuggestions();
  return <CopilotChat agentId="mcp-apps" className="h-full rounded-2xl" />;
}
