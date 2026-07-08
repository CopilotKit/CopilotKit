"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useDeclarativeGenUISuggestions } from "./suggestions";
import { useSalesAnalystContext } from "./sales-context";

export function Chat() {
  useDeclarativeGenUISuggestions();
  useSalesAnalystContext();
  return (
    <CopilotChat agentId="declarative-gen-ui" className="h-full rounded-2xl" />
  );
}
