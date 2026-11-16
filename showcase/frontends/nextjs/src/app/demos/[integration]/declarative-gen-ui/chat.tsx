"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useSalesAnalystContext } from "../_shared/a2ui-sales-dashboard/sales-context";
import { useDeclarativeGenUISuggestions } from "./suggestions";

export function Chat() {
  useDeclarativeGenUISuggestions();
  useSalesAnalystContext();
  return (
    <CopilotChat agentId="declarative-gen-ui" className="h-full rounded-2xl" />
  );
}
