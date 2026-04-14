"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import {
  SalesDashboard,
  useShowcaseHooks,
  useShowcaseSuggestions,
  demonstrationCatalog,
} from "@copilotkit/showcase-shared";

export default function GenUiToolBasedDemo() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent="gen-ui-tool-based"
        a2ui={{ catalog: demonstrationCatalog }}
      >
        <SidebarWithSuggestions />
        <DashboardDisplay />
      </CopilotKit>
    </div>
  );
}

function SidebarWithSuggestions() {
  useShowcaseSuggestions();

  return (
    <CopilotSidebar
      defaultOpen={true}
      labels={{
        modalHeaderTitle: "Sales Pipeline",
      }}
    />
  );
}

function DashboardDisplay() {
  useShowcaseHooks();

  return (
    <div className="relative flex items-center justify-center h-full w-full">
      <div style={{ padding: "48px 80px", width: "100%", maxWidth: "56rem" }}>
        <SalesDashboard agentId="gen-ui-tool-based" />
      </div>
    </div>
  );
}
