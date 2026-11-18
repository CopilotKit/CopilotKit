"use client";

import { CopilotChat } from "@copilotkit/react-core";
import { useDeclarativeGenUISuggestions } from "./suggestions";

export function Chat() {
  useDeclarativeGenUISuggestions();
  return (
    <CopilotChat agentId="declarative-gen-ui" className="h-full rounded-2xl" />
  );
}
