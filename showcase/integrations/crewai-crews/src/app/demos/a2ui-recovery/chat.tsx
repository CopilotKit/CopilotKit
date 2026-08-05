"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useSalesAnalystContext } from "../declarative-gen-ui/sales-context";
import { useA2uiRecoverySuggestions } from "./suggestions";

export function Chat() {
  useA2uiRecoverySuggestions();
  useSalesAnalystContext();
  return <CopilotChat agentId="a2ui-recovery" className="h-full rounded-2xl" />;
}
