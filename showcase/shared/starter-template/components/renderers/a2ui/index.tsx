"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
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
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent={agentId}
      a2ui={{ catalog: demonstrationCatalog }}
    >
      <DashboardContent agentId={agentId} />
    </CopilotKit>
  );
}
