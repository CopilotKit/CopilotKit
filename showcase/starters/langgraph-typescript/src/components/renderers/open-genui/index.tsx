"use client";

import React from "react";
import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/react-core/v2";
import { useShowcaseHooks } from "../../../hooks/use-showcase-hooks";
import { useShowcaseSuggestions } from "../../../hooks/use-showcase-suggestions";

/**
 * Open GenUI Dashboard Renderer
 *
 * The most unconstrained rendering approach: the agent generates complete
 * HTML/JS/CSS dashboards that are rendered inside CopilotKit's sandboxed
 * iframe via the `openGenerativeUI` configuration.
 *
 * The agent has full creative freedom to produce any visual output it wants
 * -- charts, tables, interactive controls, animations -- using CDN libraries
 * like Chart.js, D3, Three.js, etc. The sandbox provides security isolation.
 */

function DashboardContent() {
  useShowcaseHooks();
  useShowcaseSuggestions({ showcaseMode: "opengenui" });

  return (
    <div className="min-h-screen w-full flex items-center justify-center">
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          modalHeaderTitle: "Open GenUI Dashboard",
        }}
      />
      <div style={{ padding: "48px 80px", width: "100%", maxWidth: "56rem" }}>
        <div className="text-center text-gray-400 text-lg">
          Ask the agent to build a sales dashboard. It will generate complete
          HTML, CSS, and JavaScript rendered in a secure sandbox. Try
          &ldquo;Build me a sales dashboard with revenue charts, pipeline
          metrics, and a deal table.&rdquo;
        </div>
      </div>
    </div>
  );
}

export function OpenGenUIDashboard() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" openGenerativeUI={{}}>
      <DashboardContent />
    </CopilotKitProvider>
  );
}
