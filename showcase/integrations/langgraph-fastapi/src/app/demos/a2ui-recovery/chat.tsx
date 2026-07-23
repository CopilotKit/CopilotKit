"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useA2uiRecoverySuggestions } from "./suggestions";

// Note: this integration's declarative-gen-ui demo does not ship a
// sales-context hook (unlike langgraph-python / strands), so the recovery demo
// does not inject one either. The agent's system prompt + the render planner's
// composition guide carry the dataset; the aimock fixtures drive heal/exhaust.
export function Chat() {
  useA2uiRecoverySuggestions();
  return <CopilotChat agentId="a2ui-recovery" className="h-full rounded-2xl" />;
}
