"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import {
  DemoErrorBoundary,
  SalesDashboard,
  useShowcaseHooks,
  useShowcaseSuggestions,
  demonstrationCatalog,
} from "@copilotkit/showcase-shared";

export default function GenUiToolBasedDemo() {
  return (
    <DemoErrorBoundary demoName="Tool-Based Generative UI">
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
    </DemoErrorBoundary>
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      <div style={{ padding: "48px 80px", width: "100%", maxWidth: "56rem" }}>
        <SalesDashboard agentId="gen-ui-tool-based" />
      </div>
    </div>
  );
}
