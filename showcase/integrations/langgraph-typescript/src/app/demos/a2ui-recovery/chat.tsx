"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useA2uiRecoverySuggestions } from "./suggestions";
// Reuse the declarative-gen-ui sales dataset/context so the healed surface has
// real numbers to render.
import { useSalesAnalystContext } from "../declarative-gen-ui/sales-context";

export function Chat() {
  useA2uiRecoverySuggestions();
  useSalesAnalystContext();
  return <CopilotChat agentId="a2ui-recovery" className="h-full rounded-2xl" />;
}
