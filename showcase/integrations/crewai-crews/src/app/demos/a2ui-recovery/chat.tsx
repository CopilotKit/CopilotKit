"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useA2uiRecoverySuggestions } from "./suggestions";

export function Chat() {
  useA2uiRecoverySuggestions();
  return <CopilotChat agentId="a2ui-recovery" className="h-full rounded-2xl" />;
}
