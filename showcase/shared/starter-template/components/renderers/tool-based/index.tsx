"use client";

import React from "react";
import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/react-core";
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
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId={agentId}>
      <DashboardContent agentId={agentId} />
    </CopilotKitProvider>
  );
}
