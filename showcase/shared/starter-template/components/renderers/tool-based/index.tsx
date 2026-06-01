"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { useShowcaseHooks } from "../../../hooks/use-showcase-hooks";
import { useShowcaseSuggestions } from "../../../hooks/use-showcase-suggestions";
import { SalesDashboard } from "../../sales-dashboard";

interface ToolBasedDashboardProps {
  agentId: string;
}

function DashboardContent({ agentId }: ToolBasedDashboardProps) {
  useShowcaseHooks();
  useShowcaseSuggestions();

  return (
    <div className="min-h-screen w-full flex items-center justify-center">
      <SalesDashboard agentId={agentId} />
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          modalHeaderTitle: "Sales Dashboard Assistant",
        }}
      />
    </div>
  );
}

export function ToolBasedDashboard({ agentId }: ToolBasedDashboardProps) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={agentId}>
      <DashboardContent agentId={agentId} />
    </CopilotKit>
  );
}
