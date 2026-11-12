"use client";

import { CopilotChat } from "@copilotkit/react-core";
import { useObservationalMemorySuggestions } from "./suggestions";

export function Chat() {
  useObservationalMemorySuggestions();
  return (
    <CopilotChat
      agentId="observational-memory"
      className="h-full rounded-2xl"
    />
  );
}
