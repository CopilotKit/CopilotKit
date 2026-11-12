"use client";

import React from "react";
import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/react-core";
import { useShowcaseHooks } from "../../../hooks/use-showcase-hooks";
import { useShowcaseSuggestions } from "../../../hooks/use-showcase-suggestions";
import { SalesDashboard } from "../../sales-dashboard";
import { demonstrationCatalog } from "./renderers";

interface A2UIDashboardProps {
  agentId: string;
}

function DashboardContent({ agentId }: A2UIDashboardProps) {
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

export function A2UIDashboard({ agentId }: A2UIDashboardProps) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agentId={agentId}
      generativeUI={{ ui: demonstrationCatalog }}
    >
      <DashboardContent agentId={agentId} />
    </CopilotKitProvider>
  );
}
