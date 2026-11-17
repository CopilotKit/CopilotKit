"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
// The sales dataset gives the healed surface real numbers to render.
import { useSalesAnalystContext } from "../_shared/a2ui-sales-dashboard/sales-context";
import type { A2uiRecoveryPrompts } from "./config";
import { useA2uiRecoverySuggestions } from "./suggestions";

export function Chat({ prompts }: { prompts: A2uiRecoveryPrompts }) {
  useA2uiRecoverySuggestions(prompts);
  useSalesAnalystContext();
  return <CopilotChat agentId="a2ui-recovery" className="h-full rounded-2xl" />;
}
