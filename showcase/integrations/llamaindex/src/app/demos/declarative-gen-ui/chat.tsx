"use client";

import { CopilotChat, useAgentContext } from "@copilotkit/react-core/v2";
import {
  dashboardCompositionContext,
  salesDatasetContext,
} from "../../../../_shared/ts/a2ui/sales-context";
import { useDeclarativeGenUISuggestions } from "./suggestions";

export function Chat() {
  useDeclarativeGenUISuggestions();
  useAgentContext(salesDatasetContext);
  useAgentContext(dashboardCompositionContext);
  return (
    <CopilotChat agentId="declarative-gen-ui" className="h-full rounded-2xl" />
  );
}
