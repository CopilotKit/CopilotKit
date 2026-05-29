"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useA2UIFixedSchemaSuggestions } from "./suggestions";

export function Chat() {
  useA2UIFixedSchemaSuggestions();
  return (
    <CopilotChat agentId="a2ui-fixed-schema" className="h-full rounded-2xl" />
  );
}
