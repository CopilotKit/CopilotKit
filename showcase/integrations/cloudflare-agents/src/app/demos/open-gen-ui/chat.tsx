"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useOpenGenUISuggestions } from "./suggestions";

export function Chat() {
  useOpenGenUISuggestions();
  return <CopilotChat agentId="open-gen-ui" className="flex-1 rounded-2xl" />;
}
